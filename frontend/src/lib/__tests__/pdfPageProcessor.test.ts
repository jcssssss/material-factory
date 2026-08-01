// pdfPageProcessor 异常处理单元测试。
//
// 覆盖 SubTask 7.1 验证项：
//   - 文件不存在 → PDF 级失败，错误消息清晰
//   - PDF 解析失败 → PDF 级失败，错误消息区分加密 / 损坏
//   - 输出目录不可写 → 页级失败，错误消息清晰
//   - 文件夹扫描失败 → 任务级失败
//
// 通过 mock @tauri-apps/api/core invoke 与 ./pdf 模块模拟底层失败，
// 验证 PdfPageProcessor 产出的错误消息符合 Task 7 异常分类规范。

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke。
// 不同命令返回不同结果，通过 mockImplementation 按命令名分发。
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock ./pdf 模块，让 readPdfBytes / loadPdfDocument 可控。
const readPdfBytesMock = vi.fn();
const loadPdfDocumentMock = vi.fn();
const renderPageToCanvasMock = vi.fn();
const destroyPdfDocumentMock = vi.fn();
vi.mock("../pdf", () => ({
  readPdfBytes: (...args: unknown[]) => readPdfBytesMock(...args),
  loadPdfDocument: (...args: unknown[]) => loadPdfDocumentMock(...args),
  renderPageToCanvas: (...args: unknown[]) => renderPageToCanvasMock(...args),
  destroyPdfDocument: (...args: unknown[]) => destroyPdfDocumentMock(...args),
  // 本文件聚焦异常分类，空白页回退逻辑由 pdfBlank.test.ts 覆盖。
  isCanvasBlank: () => false,
}));

// Mock ./exportImage 模块。
const writeImageToDiskMock = vi.fn();
vi.mock("../exportImage", () => ({
  // embedJfifDpi 在测试中按原样返回（DPI 字节拼接逻辑由 exportImage.test.ts 覆盖）。
  embedJfifDpi: (bytes: Uint8Array, _dpi: number) => bytes,
  writeImageToDisk: (...args: unknown[]) => writeImageToDiskMock(...args),
  buildPageImageFileName: (pdfName: string, pageNumber: number) =>
    `${pdfName}_p${String(pageNumber).padStart(3, "0")}.jpg`,
  calculateFitScale: () => 1,
  OUTPUT_WIDTH: 1242,
  OUTPUT_HEIGHT: 1656,
  TARGET_DPI: 150,
}));

// Mock ./encodeWorker 模块。
const createEncodeWorkerMock = vi.fn();
const encodeBitmapInWorkerMock = vi.fn();
const terminateEncodeWorkerMock = vi.fn();
vi.mock("../encodeWorker", () => ({
  createEncodeWorker: (...args: unknown[]) => createEncodeWorkerMock(...args),
  encodeBitmapInWorker: (...args: unknown[]) => encodeBitmapInWorkerMock(...args),
  terminateEncodeWorker: (...args: unknown[]) => terminateEncodeWorkerMock(...args),
}));

// Mock 全局 createImageBitmap（jsdom 无此 API）：返回假 bitmap。
function stubCreateImageBitmap(): void {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 1000, height: 1000 }),
  );
}

// logger 调用 store.appendLog，store 调用 persistence.appendLogToDisk（调 invoke），
// 在测试中 invoke 被 mock，会走到 invokeMock，需要让未知命令返回 undefined。
// 这里导入真实 logger 即可，副作用是日志进入 store（不影响断言）。

import { PdfPageProcessor } from "../pdfPageProcessor";
import type { TaskConfig, PdfWorkItem } from "../../types/task";

function makeTask(overrides: Partial<TaskConfig> = {}): TaskConfig {
  return {
    taskId: "task_test",
    taskName: "test-task",
    sourceType: "files",
    sourcePaths: ["/test/doc.pdf"],
    outputDir: "/out",
    firstN: 3,
    pageRuleMode: "firstN",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// 构造一个 mock PDFDocumentProxy（仅需要 numPages / getPage / cleanup / loadingTask.destroy）
function makeMockDoc(numPages: number) {
  return {
    numPages,
    getPage: vi.fn().mockResolvedValue({
      getViewport: () => ({ width: 1000, height: 1000 }),
      cleanup: vi.fn(),
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
    loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) },
  };
}

// 构造一个 mock canvas（renderPageToCanvas 返回值）
function makeMockCanvas() {
  return { width: 1000, height: 1000 } as unknown as HTMLCanvasElement;
}

describe("SubTask 7.1: 文件不存在异常处理", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invokeMock.mockResolvedValue([]);
    destroyPdfDocumentMock.mockResolvedValue(undefined);
  });

  it("prepareWorkItem：文件不存在 → 抛出含「PDF 文件不存在」的错误", async () => {
    readPdfBytesMock.mockRejectedValue(new Error("文件不存在：/test/missing.pdf"));

    const processor = new PdfPageProcessor();
    const task = makeTask({ sourcePaths: ["/test/missing.pdf"] });

    await expect(processor.prepareWorkItem(task, "/test/missing.pdf")).rejects.toThrow(
      /PDF 文件不存在/
    );
  });

  it("prepareWorkItem：读取失败（权限） → 抛出含「PDF 文件无法读取」的错误", async () => {
    readPdfBytesMock.mockRejectedValue(
      new Error("读取 PDF 失败：Permission denied (os error 13)")
    );

    const processor = new PdfPageProcessor();
    const task = makeTask();

    await expect(processor.prepareWorkItem(task, "/test/doc.pdf")).rejects.toThrow(
      /PDF 文件无法读取/
    );
  });
});

describe("SubTask 7.1: PDF 解析失败异常处理", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readPdfBytesMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    destroyPdfDocumentMock.mockResolvedValue(undefined);
  });

  it("PDF 加密 → 抛出含「PDF 加密无法解析」的错误", async () => {
    loadPdfDocumentMock.mockRejectedValue(new Error("Password required to open PDF"));

    const processor = new PdfPageProcessor();
    const task = makeTask();

    await expect(processor.prepareWorkItem(task, "/test/doc.pdf")).rejects.toThrow(
      /PDF 加密无法解析/
    );
  });

  it("PDF 损坏 → 抛出含「PDF 文件损坏或格式无效」的错误", async () => {
    loadPdfDocumentMock.mockRejectedValue(new Error("Invalid PDF structure"));

    const processor = new PdfPageProcessor();
    const task = makeTask();

    await expect(processor.prepareWorkItem(task, "/test/doc.pdf")).rejects.toThrow(
      /PDF 文件损坏或格式无效/
    );
  });

  it("PDF 解析其他错误 → 抛出含「PDF 解析失败」的错误", async () => {
    loadPdfDocumentMock.mockRejectedValue(new Error("bad XRef entry"));

    const processor = new PdfPageProcessor();
    const task = makeTask();

    await expect(processor.prepareWorkItem(task, "/test/doc.pdf")).rejects.toThrow(
      /PDF 解析失败/
    );
  });
});

describe("SubTask 7.1: 输出目录不可写异常处理", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    readPdfBytesMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    loadPdfDocumentMock.mockResolvedValue(makeMockDoc(10));
    renderPageToCanvasMock.mockResolvedValue({
      canvas: makeMockCanvas(),
      page: { cleanup: vi.fn() },
    });
    stubCreateImageBitmap();
    createEncodeWorkerMock.mockResolvedValue({} as Worker);
    encodeBitmapInWorkerMock.mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
    terminateEncodeWorkerMock.mockResolvedValue(undefined);
    destroyPdfDocumentMock.mockResolvedValue(undefined);
  });

  it("ensure_output_dir 失败（权限） → 抛出含「输出目录不可写」的错误", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_output_dir") {
        throw new Error("创建目录失败：Permission denied (os error 13)");
      }
      return undefined;
    });

    const processor = new PdfPageProcessor();
    const task = makeTask();

    // 先 prepareWorkItem 成功
    const workItem: PdfWorkItem = await processor.prepareWorkItem(task, "/test/doc.pdf");
    // 渲染前按需加载文档（预扫描不缓存，renderAndExportPage 依赖 docCache 命中）。
    await processor.openDocument("/test/doc.pdf");

    // renderAndExportPage 时 ensure_output_dir 失败
    await expect(
      processor.renderAndExportPage({
        task,
        workItem,
        pageNumber: 1,
        taskOutputDir: "/out/test-task",
        pdfOutputDir: "/out/test-task/doc",
      })
    ).rejects.toThrow(/输出目录不可写/);
  });

  it("write_image_binary 失败 → 抛出含「图片写入失败」的错误", async () => {
    writeImageToDiskMock.mockRejectedValue(
      new Error("写入图片失败：No space left on device")
    );

    const processor = new PdfPageProcessor();
    const task = makeTask();

    const workItem: PdfWorkItem = await processor.prepareWorkItem(task, "/test/doc.pdf");
    // 渲染前按需加载文档（预扫描不缓存，renderAndExportPage 依赖 docCache 命中）。
    await processor.openDocument("/test/doc.pdf");

    await expect(
      processor.renderAndExportPage({
        task,
        workItem,
        pageNumber: 1,
        taskOutputDir: "/out/test-task",
        pdfOutputDir: "/out/test-task/doc",
      })
    ).rejects.toThrow(/图片写入失败/);
  });

  it("正常流程：所有步骤成功 → 返回 success PageResult", async () => {
    invokeMock.mockResolvedValue(undefined);

    const processor = new PdfPageProcessor();
    const task = makeTask();

    const workItem: PdfWorkItem = await processor.prepareWorkItem(task, "/test/doc.pdf");
    // 渲染前按需加载文档（预扫描不缓存，renderAndExportPage 依赖 docCache 命中）。
    await processor.openDocument("/test/doc.pdf");
    const result = await processor.renderAndExportPage({
      task,
      workItem,
      pageNumber: 1,
      taskOutputDir: "/out/test-task",
      pdfOutputDir: "/out/test-task/doc",
    });

    expect(result.status).toBe("success");
    expect(result.outputPath).toBe("/out/test-task/doc/doc_p001.jpg");
  });
});

describe("逐 PDF 文档生命周期（预扫描不缓存 + 渲染前 openDocument）", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invokeMock.mockResolvedValue(undefined);
    readPdfBytesMock.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    loadPdfDocumentMock.mockResolvedValue(makeMockDoc(10));
    renderPageToCanvasMock.mockResolvedValue({
      canvas: makeMockCanvas(),
      page: { cleanup: vi.fn() },
    });
    stubCreateImageBitmap();
    createEncodeWorkerMock.mockResolvedValue({} as Worker);
    encodeBitmapInWorkerMock.mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
    );
    terminateEncodeWorkerMock.mockResolvedValue(undefined);
    destroyPdfDocumentMock.mockResolvedValue(undefined);
  });

  it("prepareWorkItem 成功后不缓存 doc（销毁文档，避免整批常驻）", async () => {
    const processor = new PdfPageProcessor();
    const task = makeTask();

    const workItem = await processor.prepareWorkItem(task, "/test/doc.pdf");

    // 预扫描阶段解析完页码即销毁 doc（不缓存），避免整批 PDF 文档 + worker 常驻。
    expect(destroyPdfDocumentMock).toHaveBeenCalled();
    expect(workItem.selectedPages.length).toBeGreaterThan(0);

    // 未 openDocument 前 renderAndExportPage 应抛「文档未缓存」。
    await expect(
      processor.renderAndExportPage({
        task,
        workItem,
        pageNumber: 1,
        taskOutputDir: "/out/test-task",
        pdfOutputDir: "/out/test-task/doc",
      })
    ).rejects.toThrow(/PDF 文档未缓存/);
  });

  it("openDocument 后 docCache 命中，renderAndExportPage 正常返回 success", async () => {
    const processor = new PdfPageProcessor();
    const task = makeTask();

    const workItem = await processor.prepareWorkItem(task, "/test/doc.pdf");
    await processor.openDocument("/test/doc.pdf");

    const result = await processor.renderAndExportPage({
      task,
      workItem,
      pageNumber: 1,
      taskOutputDir: "/out/test-task",
      pdfOutputDir: "/out/test-task/doc",
    });
    expect(result.status).toBe("success");
    expect(result.outputPath).toBe("/out/test-task/doc/doc_p001.jpg");
  });
});

describe("SubTask 7.1: 文件夹扫描失败异常处理", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("folder 模式：文件夹不存在 → expandPdfs 抛出含「无法扫描文件夹」的错误", async () => {
    invokeMock.mockRejectedValue(new Error("文件夹不存在：/missing/folder"));

    const processor = new PdfPageProcessor();
    const task = makeTask({
      sourceType: "folder",
      sourcePaths: ["/missing/folder"],
    });

    await expect(processor.expandPdfs(task)).rejects.toThrow(/无法扫描文件夹/);
  });

  it("folder 模式：正常扫描 → 返回 PDF 列表", async () => {
    invokeMock.mockResolvedValue(["/folder/a.pdf", "/folder/b.pdf"]);

    const processor = new PdfPageProcessor();
    const task = makeTask({
      sourceType: "folder",
      sourcePaths: ["/folder"],
    });

    const pdfs = await processor.expandPdfs(task);
    expect(pdfs).toEqual(["/folder/a.pdf", "/folder/b.pdf"]);
  });

  it("files 模式：过滤非 PDF 文件", async () => {
    const processor = new PdfPageProcessor();
    const task = makeTask({
      sourceType: "files",
      sourcePaths: ["/test/a.pdf", "/test/b.txt", "/test/c.pdf"],
    });

    const pdfs = await processor.expandPdfs(task);
    expect(pdfs).toEqual(["/test/a.pdf", "/test/c.pdf"]);
  });
});
