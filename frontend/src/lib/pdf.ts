// pdf.js 包装：加载 PDF、读取页数、渲染单页到 Canvas。
//
// 与 spec.md Requirement: PDF 逐页处理与失败续跑 对齐：
//   - 每页 PDF 渲染为一张图片
//   - 单页失败抛出异常由 taskRunner 捕获，继续下一页
//
// 与技术架构文档 §5.3 导出链路对齐：
//   读取 PDF 字节 → pdf.js 加载 → 渲染高分辨率 Canvas → 后续由 exportImage 合成 3:4
//
// 版本选择：pdfjs-dist v3.11.174
//   - v6/v4 使用 ES2024/2025 API（Promise.withResolvers/try、Uint8Array.toHex、
//     Map.getOrInsertComputed 等）和 top-level await，Tauri 内嵌 WKWebView
//     在低版本 macOS 上既不支持新 API 也不支持 top-level await，dev 模式下
//     esbuild target 无法轻易调整，会持续踩坑。
//   - v3.11.174 是 UMD 格式（pdf.min.js / pdf.worker.min.js），无 ESM / TLA 问题，
//     无 ES2024+ 依赖，在 WKWebView 中稳定运行。
//   - v3 的 API（getDocument / doc.getPage / page.render）与 v4/v6 完全兼容。

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";
// Vite 通过 `?url` 后缀把资源打包并返回最终 URL 字符串。
// v3 的 worker 是经典脚本，WKWebView 兼容性最佳。
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

// 配置 worker 路径（仅配置一次）。
let workerConfigured = false;
function ensureWorker(): void {
  if (workerConfigured) return;
  GlobalWorkerOptions.workerSrc = workerUrl;
  workerConfigured = true;
  logger.appInfo(`[pdf] worker configured via ?url: ${workerUrl}`);
}

// 通过 Tauri 命令读取 PDF 文件字节。
// Rust 侧返回 tauri::ipc::Response（二进制通道），前端直接收到 ArrayBuffer，
// 避免 JSON 序列化 Vec<u8> 为 number[] 的巨大开销（5MB PDF → 20MB JSON + 40MB 内存）。
export async function readPdfBytes(pdfPath: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>("read_pdf_bytes", { path: pdfPath });
  return new Uint8Array(buffer);
}

// 加载 PDF 文档。调用方负责在用完后调用 doc.destroy()。
//
// stopAtErrors=false（pdf.js 默认）：内容流中的局部错误（如畸形 ExtGState、
// 缺失 CMap）会被忽略并跳过对应元素，页面其余内容照常渲染。
// 之前设为 true 会在这类可恢复错误处直接中止整页解析，导致页面渲染成空白
// （实测 00041《基础会计学》章节练习题.pdf 第 1 页因此变成 0 个绘制操作）。
// 真正的致命错误（文件损坏、加密）仍会在后续 getPage/render 阶段抛出，
// 由 taskRunner 的三级失败隔离捕获。
export async function loadPdfDocument(
  bytes: Uint8Array
): Promise<PDFDocumentProxy> {
  ensureWorker();
  const loadingTask = getDocument({
    data: bytes,
    stopAtErrors: false,
    disableFontFace: false,
    // 未嵌入的中文 CID 字体（如标题用的 SimSun）必须靠 CMap 解码字符；
    // 资源由 vite.config 的 viteStaticCopy 复制到产物 pdfjs/cmaps 与 pdfjs/standard_fonts。
    // useWorkerFetch=false：让 CMap 走主线程按页面 URL 解析相对路径；
    // 默认 true 会在 worker 内 fetch，相对路径基于 worker 脚本 URL（/assets/...）而 404。
    cMapUrl: "./pdfjs/cmaps/",
    cMapPacked: true,
    useWorkerFetch: false,
    standardFontDataUrl: "./pdfjs/standard_fonts/",
  });
  // 超时检测：worker 通信卡住时 30 秒后抛错。定时器在 finally 清理，避免每个
  // 文档残留 30s 闭包挂住 reject；超时分支额外 destroy loadingTask 取消残留加载。
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      loadingTask.destroy().catch(() => {});
      reject(new Error("PDF 加载超时（30s），疑似 worker 通信卡住"));
    }, 30000);
  });
  try {
    const doc = await Promise.race([loadingTask.promise, timeout]);
    return doc;
  } catch (err) {
    // 解析失败（损坏/加密）时显式销毁 loadingTask，及时终止 pdf.js worker，
    // 避免 worker 线程残留到下一次 GC。
    loadingTask.destroy().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 读取 PDF 总页数。用于 prepareWorkItem 中生成 selectedPages。
export function getPdfPageCount(doc: PDFDocumentProxy): number {
  return doc.numPages;
}

// 渲染单页 PDF 到 Canvas。
//
// scale 控制渲染分辨率：
//   - PDF 默认坐标系是 72 DPI，scale=1 → 72 DPI
//   - 目标 300 DPI 对应 scale = 300/72 ≈ 4.167
//   - 调用方按目标画布尺寸与页面原始尺寸计算合适的 scale，
//     使得渲染结果能填满 3:4 目标画布。
//
// 返回的 HTMLCanvasElement 由调用方进一步合成到 3:4 画布。
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<{ canvas: HTMLCanvasElement; viewport: PageViewport; page: PDFPageProxy }> {
  const page = await doc.getPage(pageNumber);
  // 优先按页面自身旋转（rotate）生成 viewport，避免横排页面被裁切。
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  // Tauri WebView 在长任务/高内存下偶发 getContext 返回 null，重试新建 canvas 防御。
  let ctx: CanvasRenderingContext2D | null = null;
  for (let attempt = 0; attempt < 3 && !ctx; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
    ctx = canvas.getContext("2d");
  }
  if (!ctx) {
    await page.cleanup();
    throw new Error("无法获取 2D Canvas 上下文");
  }

  // pdf.js v3 RenderParameters 使用 `canvasContext` + `viewport`。
  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
    background: "#ffffff",
  });

  // 渲染超时检测：60 秒未完成视为卡住。定时器在 finally 清理，
  // 避免每页残留 60s 闭包挂住 renderTask/reject。
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`PDF 渲染超时（60s），page=${pageNumber}`)),
      60000
    );
  });
  try {
    await Promise.race([renderTask.promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }

  return { canvas, viewport, page };
}

// 判定 Canvas 渲染结果是否接近空白（纯白）。
//
// 思路：把源 canvas 缩略绘制到小画布（64×64）后采样像素，统计非白像素占比。
// 缩略采样既控制开销（全尺寸 getImageData 对 300 DPI 大画布是 MB 级内存），
// 也能容忍单个像素级噪声。占比 < 0.5% 视为空白。
//
// 用途：PDF 页面渲染后检查是否整页空白（纯白底），用于在日志中提示"疑似空白
// 页"，帮助区分合法空白页与渲染异常。仅作诊断，不触发重渲染。
export function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const SAMPLE_W = 64;
  const SAMPLE_H = 64;
  const sample = document.createElement("canvas");
  sample.width = SAMPLE_W;
  sample.height = SAMPLE_H;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false; // 拿不到上下文时保守判定为非空白，避免误触发回退
  ctx.drawImage(canvas, 0, 0, SAMPLE_W, SAMPLE_H);
  const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  let nonWhite = 0;
  for (let i = 0; i < data.length; i += 4) {
    // 三个通道都接近 255 视为白；任一通道明显偏暗即为有内容。
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
      nonWhite += 1;
    }
  }
  return nonWhite / (data.length / 4) < 0.005;
}

// 销毁 PDF 文档，释放 worker 资源。
// 必须在某个 PDF 的所有 selectedPages 渲染完毕后调用。
export async function destroyPdfDocument(
  doc: PDFDocumentProxy
): Promise<void> {
  try {
    await doc.cleanup();
  } catch {
    /* cleanup 失败不阻断 */
  }
  try {
    await doc.destroy();
  } catch {
    // pdf.js v3：loadingTask.destroy() 中若 transport.destroy() 抛错，会在
    // terminate worker 之前 rethrow，导致 worker 线程永久泄漏。重试一次让
    // destroy 走完 terminate；仍失败则由浏览器/进程兜底回收。
    try {
      await doc.destroy();
    } catch {
      /* 忽略 */
    }
  }
}
