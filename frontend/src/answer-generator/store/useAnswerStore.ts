// 答案生成器状态：配置 / 资料文件列表 / 批量进度 / 结果。
//
// 批量工作流：串行处理每个文件（提取 → 自动 OCR → 流式生成 → 转 PDF → 落盘到输出文件夹）。
// 单个文件失败标记 error 并继续下一个；全部完成后 status 置 "done"。
//
// 流式监听在模块级注册一次（幂等）：收到 chunk 时推进「当前生成中」文件的进度条
// （15%→85%），不再逐字展示原始 HTML。取消用模块级 cancelRequested 标志，
// 结合 Rust 侧逐 taskId 的取消标志，流式循环抛"已取消"后按 pending 回退。

import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { logger } from "../../lib/logger";
import { loadAnswerConfig, saveAnswerConfig } from "../lib/answerConfig";
import { DEFAULT_ANSWER_PROMPT } from "../lib/prompt";
import { extractPdfTextFromPath } from "../lib/extractPdfText";
import {
  generateAnswers,
  cancelAnswerGeneration,
  convertAnswerHtmlToPdf,
  copyFile,
  openFolder,
} from "../services/answerIpc";
import type {
  AnswerConfig,
  AnswerFileItem,
  AnswerStreamChunk,
  BatchStatus,
} from "../types";

// ─── 工具 ───

function createTaskId(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** 去 .pdf 的文件名，用于输出命名。 */
function pdfBaseName(p: string): string {
  return basename(p).replace(/\.pdf$/i, "");
}

/** 取父目录（macOS `/` 与 Windows `\` 都兼容）。 */
function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx > 0 ? p.slice(0, idx) : "";
}

/** 拼接目录与文件名，自动适配目录分隔符。 */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const hasSep = dir.endsWith("/") || dir.endsWith("\\");
  return hasSep ? `${dir}${name}` : `${dir}${sep}${name}`;
}

// ─── 模块级批量状态（不触发渲染，仅驱动流程/进度）───

let runToken = 0;                   // 每轮 start/cancel 递增：过期循环靠它自行退出
let activeTaskId: string | null = null; // 当前流式生成中的文件 taskId（取消用）
let cancelRequested = false;            // 用户请求取消整个队列
let genCharAccum = 0;                   // 当前文件已收到字符数（驱动进度 15→85）

// ─── 流式事件监听（模块级，幂等）───

let streamReady = false;

async function ensureStreamListeners(): Promise<void> {
  if (streamReady) return;
  streamReady = true;
  await listen<AnswerStreamChunk>("answer-stream-chunk", (e) => {
    if (cancelRequested || e.payload.taskId !== activeTaskId) return;
    const st = useAnswerStore.getState();
    if (st.status !== "running") return;
    const idx = st.files.findIndex((f) => f.status === "generating");
    if (idx < 0) return;
    genCharAccum += e.payload.delta.length;
    // 按累计字符把生成阶段进度从 15 推到 85（封顶），约 4000 字符到顶。
    const p = Math.min(85, Math.floor(15 + (genCharAccum / 4000) * 70));
    useAnswerStore.setState((prev) => ({
      files: prev.files.map((f, i) =>
        i === idx && f.progress < p ? { ...f, progress: p } : f
      ),
    }));
  });
}

// ─── Store ───

type AnswerStoreState = {
  config: AnswerConfig;
  /** 资料文件列表，顺序即处理顺序。 */
  files: AnswerFileItem[];
  status: BatchStatus;
  /** 预览区选中的已完成文件下标（null 表示未选择）。 */
  selectedIndex: number | null;
  error: string | null;

  setConfig: (partial: Partial<AnswerConfig>) => void;
  resetPrompt: () => void;
  setFiles: (paths: string[]) => void;
  setOutputDir: (dir: string) => void;
  resetOutputDir: () => void;
  selectFile: (index: number) => void;
  startGeneration: () => Promise<void>;
  cancelGeneration: () => void;
  openOutputFolder: () => Promise<void>;
  reset: () => void;
};

function updateItem(idx: number, patch: Partial<AnswerFileItem>): void {
  useAnswerStore.setState((prev) => ({
    files: prev.files.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
  }));
}

export const useAnswerStore = create<AnswerStoreState>((set, get) => ({
  config: loadAnswerConfig(),
  files: [],
  status: "idle",
  selectedIndex: null,
  error: null,

  setConfig: (partial) => {
    const next = { ...get().config, ...partial };
    set({ config: next });
    saveAnswerConfig(next);
  },

  resetPrompt: () => {
    get().setConfig({ customPrompt: DEFAULT_ANSWER_PROMPT });
  },

  setFiles: (paths) => {
    const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
    if (pdfs.length === 0) {
      set({ error: "请选择 PDF 格式的试卷文件" });
      return;
    }
    const files: AnswerFileItem[] = pdfs.map((p) => ({
      path: p,
      name: basename(p),
      baseName: pdfBaseName(p),
      status: "pending",
      progress: 0,
    }));
    // 输出文件夹未设置时，默认取第一个输入文件的所在目录。
    const cfg = get().config;
    const outputDir = cfg.outputDir.trim() || dirname(pdfs[0]);
    const config = outputDir ? { ...cfg, outputDir } : cfg;
    if (outputDir) saveAnswerConfig(config);
    set({
      files,
      config,
      status: "idle",
      selectedIndex: null,
      error: null,
    });
    runToken++; // 旧循环令牌失效，避免残留回调覆盖新文件列表
    cancelRequested = false;
    activeTaskId = null;
    genCharAccum = 0;
  },

  setOutputDir: (dir) => {
    get().setConfig({ outputDir: dir });
  },

  resetOutputDir: () => {
    get().setConfig({ outputDir: "" });
  },

  selectFile: (index) => {
    const item = get().files[index];
    if (item && item.status === "done" && item.resultHtml) {
      set({ selectedIndex: index });
    }
  },

  startGeneration: async () => {
    const st = get();
    if (st.status === "running") return;
    const cfg = st.config;
    if (st.files.length === 0) {
      set({ error: "请先选择试卷 PDF 文件" });
      return;
    }
    if (!cfg.baseUrl.trim() || !cfg.apiKey.trim() || !cfg.model.trim()) {
      set({ error: "请先配置 BaseURL、API Key 与模型名称" });
      return;
    }
    const outputDir = cfg.outputDir.trim() || dirname(st.files[0].path);
    if (!outputDir) {
      set({ error: "无法确定输出文件夹，请在「输出文件夹」中选择目录" });
      return;
    }

    const myRun = ++runToken; // 本轮令牌：取消/新任务会递增，过期循环在 await 后自动退出
    cancelRequested = false;
    activeTaskId = null;
    genCharAccum = 0;
    set({ status: "running", error: null, selectedIndex: null });

    // 仅当仍在本轮（未被取消/新任务取代）时更新文件状态，避免过期回调覆盖新进度。
    const isCurrent = () => myRun === runToken;

    const processOne = async (file: AnswerFileItem, idx: number): Promise<void> => {
      try {
        // 1. 提取文本层；不足 30 字符视为扫描版，自动本地 OCR（模仿 DeepSeek 网页端）
        updateItem(idx, { status: "extracting", progress: 5, error: undefined });
        let result = await extractPdfTextFromPath(file.path);
        if (!isCurrent()) return;
        if (result.text.trim().length < 30) {
          updateItem(idx, { status: "ocr", progress: 8, error: undefined });
          const { ocrPdfTextFromPath } = await import("../lib/pdfOcr");
          result = await ocrPdfTextFromPath(file.path, (page, total, _detail) => {
            if (!isCurrent()) return;
            const p = total > 0 ? Math.min(15, 5 + (page / total) * 10) : 8;
            updateItem(idx, { progress: p });
          });
          if (!isCurrent()) return;
          if (result.text.trim().length < 30) {
            throw new Error("无法识别试卷文字：该 PDF 无文本层，且 OCR 未提取到有效内容");
          }
        }
        if (!isCurrent() || cancelRequested) return;

        // 2. 流式生成（chunk 事件驱动进度条，invoke 返回值为权威结果）
        const taskId = createTaskId();
        activeTaskId = taskId;
        genCharAccum = 0;
        await ensureStreamListeners();
        updateItem(idx, { status: "generating", progress: 15, error: undefined });
        const html = await generateAnswers({
          pdfText: result.text,
          // 用户在 Prompt 编辑框清空时回退到默认 Prompt
          customPrompt: cfg.customPrompt.trim() || DEFAULT_ANSWER_PROMPT,
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          protocol: cfg.format,
          taskId,
        });
        activeTaskId = null;
        if (!isCurrent()) return;
        if (cancelRequested) return;

        // 3. HTML → PDF → 落盘到输出文件夹（不再弹保存对话框）
        updateItem(idx, { status: "converting", progress: 90, error: undefined });
        const cachedPdf = await convertAnswerHtmlToPdf(taskId, html);
        if (!isCurrent()) return;
        const dst = joinPath(outputDir, `${file.baseName}-参考答案.pdf`);
        await copyFile(cachedPdf, dst);
        if (!isCurrent()) return;
        logger.appInfo(`答案 PDF 已保存：${dst}`);

        updateItem(idx, { status: "done", progress: 100, resultHtml: html });
      } catch (err) {
        if (!isCurrent()) return; // 过期轮次的异常不再改状态
        activeTaskId = null;
        const msg = err instanceof Error ? err.message : String(err);
        if (cancelRequested) {
          // 取消导致的异常：文件回到待处理，由下次生成补齐
          updateItem(idx, { status: "pending", progress: 0, error: undefined });
        } else {
          updateItem(idx, { status: "error", error: msg });
        }
      }
    };

    // 串行处理；done 的文件跳过（取消后再生成只补剩余），失败的文件允许重试
    for (let i = 0; i < get().files.length; i++) {
      const item = get().files[i];
      if (item.status === "done" || item.status === "converting") continue;
      if (cancelRequested) break;
      await processOne(item, i);
      if (!isCurrent()) return; // 被取消或新任务取代，静默退出
      if (cancelRequested) break;
    }
    if (!isCurrent()) return;
    if (cancelRequested) {
      cancelRequested = false;
      return; // status 已在 cancelGeneration 置 idle
    }
    set({ status: "done" });
  },

  cancelGeneration: () => {
    const { status } = get();
    if (status !== "running") return;
    runToken++; // 使当前循环的 isCurrent() 失效，循环在下次 await 后自行退出
    cancelRequested = true;
    if (activeTaskId) {
      void cancelAnswerGeneration(activeTaskId).catch(() => {});
    }
    activeTaskId = null;
    // 提取/OCR/生成/转换中的文件一律回 pending（转换无法中断，落盘在后台自然收尾；
    // 回 pending 避免留下卡住的「转换中」行，重跑时重新生成覆盖同名文件）。
    useAnswerStore.setState((prev) => ({
      status: "idle",
      files: prev.files.map((f) =>
        f.status === "extracting" ||
        f.status === "ocr" ||
        f.status === "generating" ||
        f.status === "converting"
          ? { ...f, status: "pending" as const, progress: 0, error: undefined }
          : f
      ),
    }));
  },

  openOutputFolder: async () => {
    const dir = get().config.outputDir.trim();
    if (!dir) {
      set({ error: "尚未设置输出文件夹" });
      return;
    }
    try {
      await openFolder(dir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
    }
  },

  reset: () => {
    runToken++;
    cancelRequested = false;
    activeTaskId = null;
    genCharAccum = 0;
    set({ status: "idle", selectedIndex: null, error: null });
  },
}));

export { ensureStreamListeners };
