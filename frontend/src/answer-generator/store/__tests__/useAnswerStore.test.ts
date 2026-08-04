// useAnswerStore 单测：批量工作流（多文件串行、每文件进度、失败跳过、取消、
// 输出文件夹默认值、预览选择、打开输出文件夹）。

import { describe, beforeEach, expect, it, vi } from "vitest";
import { useAnswerStore } from "../useAnswerStore";
import { DEFAULT_ANSWER_CONFIG } from "../../lib/answerConfig";
import type { AnswerConfig } from "../../types";

// mock pdf 文本提取、OCR 与 IPC，隔离真实 Tauri / pdf.js / tesseract.js。
vi.mock("../../lib/extractPdfText", () => ({
  extractPdfTextFromPath: vi.fn(),
}));

vi.mock("../../lib/pdfOcr", () => ({
  ocrPdfTextFromPath: vi.fn(),
}));

vi.mock("../../services/answerIpc", () => ({
  generateAnswers: vi.fn(),
  cancelAnswerGeneration: vi.fn(),
  convertAnswerHtmlToPdf: vi.fn(),
  copyFile: vi.fn(),
  openFolder: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { extractPdfTextFromPath } from "../../lib/extractPdfText";
import { ocrPdfTextFromPath } from "../../lib/pdfOcr";
import {
  generateAnswers,
  cancelAnswerGeneration,
  convertAnswerHtmlToPdf,
  copyFile,
  openFolder,
} from "../../services/answerIpc";

const mockedExtract = vi.mocked(extractPdfTextFromPath);
const mockedOcr = vi.mocked(ocrPdfTextFromPath);
const mockedGenerate = vi.mocked(generateAnswers);
const mockedCancel = vi.mocked(cancelAnswerGeneration);
const mockedConvert = vi.mocked(convertAnswerHtmlToPdf);
const mockedCopy = vi.mocked(copyFile);
const mockedOpenFolder = vi.mocked(openFolder);

const VALID_CONFIG: AnswerConfig = {
  ...DEFAULT_ANSWER_CONFIG,
  apiKey: "sk-test",
};

const LONG_TEXT = {
  text: "一、单项选择题 1.下列属于发展经济学研究对象的是（ ）。A.发展中国家 B.发达国家 C.转轨国家 D.新兴市场国家。这是一份足够长的试卷文本，确保超过扫描版识别阈值。",
  summary: { pageCount: 3, charCount: 120, truncated: false },
};

const PDFS = ["/tmp/exam/paper1.pdf", "/tmp/exam/paper2.pdf"];

function baseState() {
  useAnswerStore.setState({
    config: { ...VALID_CONFIG, outputDir: "" },
    files: [],
    status: "idle",
    selectedIndex: null,
    error: null,
  });
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(fn: () => boolean, timeout = 300): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("waitFor 超时");
    await tick();
  }
}

describe("useAnswerStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    baseState();
  });

  it("未选择文件时报错", async () => {
    await useAnswerStore.getState().startGeneration();
    const s = useAnswerStore.getState();
    expect(s.error).toContain("试卷");
    expect(s.status).toBe("idle");
  });

  it("未配置 API Key 时报错", async () => {
    useAnswerStore.getState().setFiles(PDFS);
    useAnswerStore.setState({ config: { ...VALID_CONFIG, apiKey: "" } });
    await useAnswerStore.getState().startGeneration();
    const s = useAnswerStore.getState();
    expect(s.error).toContain("API Key");
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("setFiles：过滤非 PDF，输出文件夹为空时默认取第一个文件目录", () => {
    useAnswerStore.getState().setFiles(["/tmp/a/paper.pdf", "/tmp/b/notes.docx", "/tmp/b/readme.txt"]);
    const s = useAnswerStore.getState();
    expect(s.files).toHaveLength(1);
    expect(s.files[0].name).toBe("paper.pdf");
    expect(s.files[0].baseName).toBe("paper");
    expect(s.config.outputDir).toBe("/tmp/a");
  });

  it("setFiles：已有输出文件夹时不覆盖", () => {
    useAnswerStore.setState({ config: { ...VALID_CONFIG, outputDir: "/custom/out" } });
    useAnswerStore.getState().setFiles(PDFS);
    expect(useAnswerStore.getState().config.outputDir).toBe("/custom/out");
  });

  it("happy path：两份 PDF 串行生成并自动落盘到输出文件夹", async () => {
    useAnswerStore.getState().setFiles(PDFS);
    mockedExtract.mockResolvedValue(LONG_TEXT);
    mockedGenerate
      .mockResolvedValueOnce("<html><body>答案一</body></html>")
      .mockResolvedValueOnce("<html><body>答案二</body></html>");
    mockedConvert.mockResolvedValue("/tmp/cache/abc/answer.pdf");
    mockedCopy.mockResolvedValue(undefined);

    await useAnswerStore.getState().startGeneration();
    const s = useAnswerStore.getState();
    expect(s.status).toBe("done");
    expect(s.files.every((f) => f.status === "done")).toBe(true);
    expect(s.files.every((f) => f.progress === 100)).toBe(true);
    expect(s.files[0].resultHtml).toContain("答案一");
    expect(s.files[1].resultHtml).toContain("答案二");
    // 串行：generate 调用两次，pdfText 分别为对应文件
    expect(mockedGenerate).toHaveBeenCalledTimes(2);
    // 落盘命名：{baseName}-参考答案.pdf
    expect(mockedCopy.mock.calls[0][1]).toContain("/tmp/exam/paper1-参考答案.pdf");
    expect(mockedCopy.mock.calls[1][1]).toContain("/tmp/exam/paper2-参考答案.pdf");
    // 协议透传
    expect(mockedGenerate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ protocol: "openai", taskId: expect.any(String) })
    );
  });

  it("Anthropic 协议：generateAnswers 携带 protocol=anthropic", async () => {
    useAnswerStore.setState({
      config: {
        ...VALID_CONFIG,
        baseUrl: "https://opencode.ai/zen/go/v1",
        model: "qwen3.8-max",
        format: "anthropic",
      },
    });
    useAnswerStore.getState().setFiles([PDFS[0]]);
    mockedExtract.mockResolvedValue(LONG_TEXT);
    mockedGenerate.mockResolvedValue("<html><body>答案</body></html>");
    mockedConvert.mockResolvedValue("/tmp/cache/x/answer.pdf");
    mockedCopy.mockResolvedValue(undefined);

    await useAnswerStore.getState().startGeneration();
    expect(mockedGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://opencode.ai/zen/go/v1",
        model: "qwen3.8-max",
        protocol: "anthropic",
      })
    );
  });

  it("扫描版：文本层不足自动 OCR 后继续生成", async () => {
    useAnswerStore.getState().setFiles([PDFS[0]]);
    mockedExtract.mockResolvedValue({
      text: "太短",
      summary: { pageCount: 1, charCount: 2, truncated: false },
    });
    mockedOcr.mockResolvedValue(LONG_TEXT);
    mockedGenerate.mockResolvedValue("<html><body>OCR 答案</body></html>");
    mockedConvert.mockResolvedValue("/tmp/cache/x/answer.pdf");
    mockedCopy.mockResolvedValue(undefined);

    await useAnswerStore.getState().startGeneration();
    const s = useAnswerStore.getState();
    expect(s.status).toBe("done");
    expect(mockedOcr).toHaveBeenCalledTimes(1);
    expect(mockedGenerate.mock.calls[0][0].pdfText).toContain("发展经济学");
  });

  it("单个文件失败：标记 error，继续处理下一个，整体 done", async () => {
    useAnswerStore.getState().setFiles(PDFS);
    mockedExtract.mockResolvedValue(LONG_TEXT);
    mockedGenerate
      .mockResolvedValueOnce("<html><body>ok</body></html>")
      .mockRejectedValueOnce(new Error("额度不足"));
    mockedConvert.mockResolvedValue("/tmp/cache/x/answer.pdf");
    mockedCopy.mockResolvedValue(undefined);

    await useAnswerStore.getState().startGeneration();
    const s = useAnswerStore.getState();
    expect(s.status).toBe("done");
    expect(s.files[0].status).toBe("done");
    expect(s.files[1].status).toBe("error");
    expect(s.files[1].error).toContain("额度不足");
  });

  it("生成中取消：调用 cancelAnswerGeneration，当前文件回 pending，整体回 idle", async () => {
    useAnswerStore.getState().setFiles(PDFS);
    mockedExtract.mockResolvedValue(LONG_TEXT);
    let resolveGen: (v: string) => void = () => {};
    mockedGenerate.mockImplementation(
      () => new Promise<string>((res) => (resolveGen = res))
    );
    mockedCancel.mockResolvedValue(undefined);

    const p = useAnswerStore.getState().startGeneration(); // 不 await，挂在生成中
    await waitFor(() => mockedGenerate.mock.calls.length > 0);

    useAnswerStore.getState().cancelGeneration();
    const s = useAnswerStore.getState();
    expect(s.status).toBe("idle");
    expect(s.files[0].status).toBe("pending");
    expect(mockedCancel).toHaveBeenCalledTimes(1);
    expect(mockedCancel.mock.calls[0][0]).toEqual(expect.any(String));

    // 让挂起的生成结束，循环正常收尾
    resolveGen("<html/>");
    await p;
    expect(useAnswerStore.getState().status).toBe("idle");
  });

  it("selectFile：仅 done 且有 resultHtml 的文件可选中预览", () => {
    useAnswerStore.setState({
      files: [
        { path: "a.pdf", name: "a.pdf", baseName: "a", status: "done", progress: 100, resultHtml: "<html/>" },
        { path: "b.pdf", name: "b.pdf", baseName: "b", status: "pending", progress: 0 },
      ],
    });
    const st = useAnswerStore.getState();
    st.selectFile(0);
    expect(useAnswerStore.getState().selectedIndex).toBe(0);
    st.selectFile(1); // pending 不可选
    expect(useAnswerStore.getState().selectedIndex).toBe(0);
  });

  it("取消后重跑：已完成保留，只补剩余文件", async () => {
    useAnswerStore.getState().setFiles(PDFS);
    mockedExtract.mockResolvedValue(LONG_TEXT);
    mockedConvert.mockResolvedValue("/tmp/cache/x/answer.pdf");
    mockedCopy.mockResolvedValue(undefined);
    let resolveGen2: (v: string) => void = () => {};
    mockedGenerate
      .mockResolvedValueOnce("<html>一</html>") // 文件1 立即完成
      .mockImplementationOnce(
        () => new Promise<string>((res) => (resolveGen2 = res)) // 文件2 挂起
      );

    const p1 = useAnswerStore.getState().startGeneration();
    await waitFor(() => mockedGenerate.mock.calls.length >= 2); // 文件1 done、文件2 生成中
    useAnswerStore.getState().cancelGeneration();
    resolveGen2("<html/>");
    await p1;
    expect(useAnswerStore.getState().files[0].status).toBe("done");
    expect(useAnswerStore.getState().files[1].status).toBe("pending");
    expect(useAnswerStore.getState().status).toBe("idle");

    // 重新生成：跳过 done 的文件，只补文件2
    mockedGenerate.mockResolvedValue("<html>二</html>");
    await useAnswerStore.getState().startGeneration();
    const s = useAnswerStore.getState();
    expect(s.status).toBe("done");
    expect(s.files[0].status).toBe("done");
    expect(s.files[1].status).toBe("done");
    expect(s.files[1].resultHtml).toContain("二");
  });

  it("openOutputFolder：用输出目录调用 open_folder；空目录报错", async () => {
    useAnswerStore.setState({ config: { ...VALID_CONFIG, outputDir: "/tmp/out" } });
    mockedOpenFolder.mockResolvedValue(undefined);
    await useAnswerStore.getState().openOutputFolder();
    expect(mockedOpenFolder).toHaveBeenCalledWith("/tmp/out");

    useAnswerStore.setState({ config: { ...VALID_CONFIG, outputDir: "" } });
    await useAnswerStore.getState().openOutputFolder();
    expect(useAnswerStore.getState().error).toContain("输出文件夹");
  });
});
