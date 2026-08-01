// 真实 PDF 页处理器：接入 pdf.js + Tauri 文件系统能力，完成 Task 5 的全部子任务。
//
// 替换 MockPageProcessor：
//   - expandPdfs: files 模式过滤 PDF；folder 模式调用 Rust scan_pdf_files
//   - prepareWorkItem: 读取 PDF 字节 → 加载 pdf.js 文档 → 读取总页数 → 解析页码规则
//   - renderAndExportPage: 渲染高分辨率源图 → 合成 3:4 画布 → 导出 JPG → 写入磁盘
//
// 与 taskRunner 三层失败隔离配合：
//   - expandPdfs 抛出 → 任务级失败（如文件夹不存在）
//   - prepareWorkItem 抛出 → PDF 级失败（如 PDF 损坏）
//   - renderAndExportPage 抛出 → 页级失败（如渲染失败、写盘失败）
//
// Task 7 异常分类：
//   - 文件不存在 → PDF 级失败（prepareWorkItem 抛 PdfFileNotReadableError）
//   - PDF 解析失败 → PDF 级失败（prepareWorkItem 抛 PdfParseError）
//   - 输出目录不可写 → 页级失败（renderAndExportPage 抛 OutputDirNotWritableError）
//   所有错误都通过 taskRunner 的三层 catch 捕获，不会导致应用崩溃。

import { invoke } from "@tauri-apps/api/core";
import type {
  PageResult,
  PdfWorkItem,
  TaskConfig,
} from "../types/task";
import type { PageProcessor, PageProcessContext } from "./pageProcessor";
import {
  loadPdfDocument,
  readPdfBytes,
  renderPageToCanvas,
  destroyPdfDocument,
  isCanvasBlank,
} from "./pdf";
import {
  buildPageImageFileName,
  calculateFitScale,
  writeImageToDisk,
  embedJfifDpi,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  TARGET_DPI,
} from "./exportImage";
import {
  createEncodeWorker,
  encodeBitmapInWorker,
  terminateEncodeWorker,
} from "./encodeWorker";
import { resolvePageRule } from "./pageRule";
import { logger } from "./logger";
import { isSupportedInputPath } from "./inputValidation";
import type { PDFDocumentProxy } from "pdfjs-dist";

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function pdfBaseName(p: string): string {
  return basename(p).replace(/\.pdf$/i, "");
}

function joinPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/[\\/]+$/, ""))
    .filter(Boolean)
    .join("/");
}

// ─── Task 7 错误分类 ───
// 通过错误消息关键词识别底层错误类型，生成用户友好的错误消息。
// taskRunner 不区分子类，仅展示 errorMessage；这里仅用于产出清晰消息。

function classifyReadError(pdfPath: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  // Rust read_pdf_bytes 错误："文件不存在：{path}" 或 "读取 PDF 失败：{io}"
  if (msg.includes("不存在") || msg.includes("not exist")) {
    return new Error(`PDF 文件不存在：${basename(pdfPath)}（${pdfPath}）`);
  }
  if (msg.includes("不是文件") || msg.includes("not a file")) {
    return new Error(`PDF 路径不是文件：${pdfPath}`);
  }
  return new Error(`PDF 文件无法读取：${basename(pdfPath)} - ${msg}`);
}

function classifyPdfParseError(pdfPath: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  // pdf.js 常见解析错误关键词：Invalid PDF、Password、Syntax Error、bad XRef
  if (msg.includes("Password") || msg.includes("password")) {
    return new Error(`PDF 加密无法解析（需要密码）：${basename(pdfPath)}`);
  }
  if (msg.includes("Invalid PDF") || msg.includes("invalid")) {
    return new Error(`PDF 文件损坏或格式无效：${basename(pdfPath)}`);
  }
  return new Error(`PDF 解析失败：${basename(pdfPath)} - ${msg}`);
}

function classifyWriteError(outputPath: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  // Rust ensure_output_dir / write_image_file 错误：
  //   "创建目录失败：{io}"、"写入图片失败：{io}"、"路径已存在但不是目录：{path}"
  if (
    msg.includes("创建目录失败") ||
    msg.includes("路径已存在但不是目录") ||
    msg.includes("Permission denied") ||
    msg.includes("permission")
  ) {
    return new Error(
      `输出目录不可写：${outputPath} - ${msg}`
    );
  }
  if (msg.includes("写入图片失败")) {
    return new Error(`图片写入失败：${outputPath} - ${msg}`);
  }
  if (msg.includes("输出目录不存在")) {
    return new Error(`输出目录不存在：${outputPath}`);
  }
  return new Error(`输出失败：${outputPath} - ${msg}`);
}

// 缓存条目：PDF 文档 + 该 PDF 的 workItem（用于判断最后一页）。
type CachedDoc = {
  doc: PDFDocumentProxy;
  pdfPath: string;
};

export class PdfPageProcessor implements PageProcessor {
  // pdfPath → 缓存条目。
  // 在 prepareWorkItem 中写入，在 renderAndExportPage 最后一页后清理。
  private readonly docCache = new Map<string, CachedDoc>();
  // 共享编码 Worker：首个页面懒创建，末页/cleanup 时终止，避免每页重建。
  private encodeWorker: Worker | null = null;
  // 流水线预取：当前页编码期间提前渲染下一页，使页 N 的编码（Worker）与
  // 页 N+1 的光栅化（主线程）重叠，缩短单 PDF 总墙钟。
  // 预取失败返回 null（下次实际渲染时再正常报错），避免 unhandled rejection。
  private prefetch: {
    pageNumber: number;
    promise: Promise<HTMLCanvasElement | null>;
  } | null = null;

  private async getEncodeWorker(): Promise<Worker> {
    if (!this.encodeWorker) {
      this.encodeWorker = await createEncodeWorker();
    }
    return this.encodeWorker;
  }

  // 渲染单页到 canvas（probe 计算 scale + pdf.js 光栅化 + 空白检测 + page 清理）。
  // 供正常渲染与流水线预取共用。
  private async renderOne(
    doc: PDFDocumentProxy,
    pageNumber: number,
    task: TaskConfig,
    pdfPath: string,
  ): Promise<HTMLCanvasElement> {
    const probePage = await doc.getPage(pageNumber);
    const probeViewport = probePage.getViewport({ scale: 1 });
    probePage.cleanup();

    const fitScale = calculateFitScale(probeViewport.width, probeViewport.height);
    const { canvas: sourceCanvas, page } = await renderPageToCanvas(doc, pageNumber, fitScale);
    logger.pageInfo(task.taskId, pdfPath, pageNumber,
      `PDF 页面渲染完成，canvas 尺寸：${sourceCanvas.width}x${sourceCanvas.height}`);
    if (isCanvasBlank(sourceCanvas)) {
      logger.pageWarn(task.taskId, pdfPath, pageNumber, `页面渲染结果疑似空白`);
    }
    page.cleanup();
    return sourceCanvas;
  }

  // 触发下一页预取（异步，不阻塞当前页编码）。prefetch 失败时置空并吞掉，
  // 由实际渲染路径重新报错，避免 unhandled rejection。
  private prefetchNextPage(
    doc: PDFDocumentProxy,
    workItem: PdfWorkItem,
    currentPageNumber: number,
    task: TaskConfig,
    pdfPath: string,
  ): void {
    const selected = workItem.selectedPages;
    const currentIdx = selected.indexOf(currentPageNumber);
    const nextPageNumber = selected[currentIdx + 1];
    if (nextPageNumber === undefined) return;
    this.prefetch = {
      pageNumber: nextPageNumber,
      promise: this.renderOne(doc, nextPageNumber, task, pdfPath).catch(() => {
        this.prefetch = null;
        return null;
      }),
    };
  }

  async expandPdfs(task: TaskConfig): Promise<string[]> {
    if (task.sourceType === "files") {
      // files 模式：过滤出受支持的输入（PDF 或 Word）。
      return task.sourcePaths.filter((p) => isSupportedInputPath(p));
    }

    // folder 模式：调用 Rust 命令扫描顶层 PDF 与 Word 文件。
    const folder = task.sourcePaths[0];
    if (!folder) {
      throw new Error("未选择文件夹");
    }
    try {
      const pdfs = await invoke<string[]>("scan_input_files", { folder });
      return pdfs;
    } catch (err) {
      // 文件夹不存在 / 无访问权限 → 任务级失败。
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`无法扫描文件夹：${folder} - ${msg}`);
    }
  }

  async prepareWorkItem(
    task: TaskConfig,
    pdfPath: string
  ): Promise<PdfWorkItem> {
    // 1. 读取 PDF 字节。
    //    文件不存在 / 无读取权限 → PDF 级失败（继续同任务其他 PDF）。
    let bytes: Uint8Array;
    try {
      logger.taskInfo(task.taskId, `读取 PDF 字节开始：${basename(pdfPath)}`);
      bytes = await readPdfBytes(pdfPath);
      logger.taskInfo(task.taskId, `读取 PDF 字节完成：${bytes.byteLength} bytes`);
    } catch (err) {
      throw classifyReadError(pdfPath, err);
    }

    // 2. 加载 pdf.js 文档。
    //    PDF 损坏 / 加密 / 格式无效 → PDF 级失败。
    let doc: PDFDocumentProxy;
    try {
      logger.taskInfo(task.taskId, `加载 PDF 文档开始：${bytes.length} bytes`);
      doc = await loadPdfDocument(bytes);
      logger.taskInfo(task.taskId, `加载 PDF 文档完成：${doc.numPages} 页`);
    } catch (err) {
      throw classifyPdfParseError(pdfPath, err);
    }

    // 3. 读取总页数。
    const totalPages = doc.numPages;
    if (totalPages <= 0) {
      await destroyPdfDocument(doc);
      throw new Error(`PDF 总页数为 0：${basename(pdfPath)}`);
    }

    // 4. 解析页码规则。
    const ruleResult = resolvePageRule(
      {
        firstN: task.pageRuleMode === "custom" ? undefined : task.firstN,
        customPages: task.pageRuleMode === "firstN" ? undefined : task.customPages,
      },
      totalPages
    );

    // 5. 记录超范围警告（不阻断）。
    for (const w of ruleResult.warnings) {
      logger.taskWarn(task.taskId, `${basename(pdfPath)} - ${w}`);
    }

    // 6. 解析失败（非法表达式或最终无合法页码）→ PDF 级失败。
    if (ruleResult.error) {
      await destroyPdfDocument(doc);
      throw new Error(ruleResult.error);
    }

    // 7. 预扫描阶段不缓存 doc：解析页码后立即销毁，避免整批 PDF 的
    //    PDFDocumentProxy + 各自 pdf.js worker 线程全部常驻（批量大时
    //    内存达 GB 级）。渲染阶段由 openDocument() 按需重新加载当前
    //    PDF，保证任意时刻仅 ~1 个 doc + 1 个 worker 存活。
    await destroyPdfDocument(doc);

    return {
      taskId: task.taskId,
      pdfPath,
      pdfName: pdfBaseName(pdfPath),
      totalPages,
      selectedPages: ruleResult.pages,
      status: "pending",
    };
  }

  // 渲染前按需加载 PDF 文档并缓存（配合预扫描不缓存，逐 PDF 生命周期）。
  // 仅在 prepareWorkItem 解析出合法页码的 PDF 上由 taskRunner 调用；
  // 加载失败抛 PDF 级错误（由 taskRunner 捕获记 failed 并继续下一 PDF）。
  async openDocument(pdfPath: string): Promise<void> {
    if (this.docCache.has(pdfPath)) return;

    let bytes: Uint8Array;
    try {
      bytes = await readPdfBytes(pdfPath);
    } catch (err) {
      throw classifyReadError(pdfPath, err);
    }

    let doc: PDFDocumentProxy;
    try {
      doc = await loadPdfDocument(bytes);
    } catch (err) {
      throw classifyPdfParseError(pdfPath, err);
    }

    this.docCache.set(pdfPath, { doc, pdfPath });
  }

  async renderAndExportPage(ctx: PageProcessContext): Promise<PageResult> {
    const { task, workItem, pageNumber, pdfOutputDir } = ctx;
    const pdfPath = workItem.pdfPath;

    const cached = this.docCache.get(pdfPath);
    if (!cached) {
      throw new Error("PDF 文档未缓存，请重新执行 prepareWorkItem");
    }
    const { doc } = cached;

    try {
      // 1. 渲染当前页：优先使用上一页触发的流水线预取结果（页间重叠）；
      //    否则现场渲染（pdf.js 光栅化 + 空白检测，见 renderOne）。
      let sourceCanvas: HTMLCanvasElement;
      if (this.prefetch && this.prefetch.pageNumber === pageNumber) {
        const prefetched = await this.prefetch.promise;
        this.prefetch = null;
        sourceCanvas = prefetched ?? (await this.renderOne(doc, pageNumber, task, pdfPath));
      } else {
        // 丢弃可能指向其他页的过期预取：已产出的 canvas 归零，强制回收 GPU 显存。
        void this.prefetch?.promise
          .then((c) => {
            if (c) {
              c.width = 0;
              c.height = 0;
            }
          })
          .catch(() => {});
        this.prefetch = null;
        sourceCanvas = await this.renderOne(doc, pageNumber, task, pdfPath);
      }

      // 2. 立即触发下一页渲染预取（异步，不阻塞当前页编码）：
      //    页 N 的 JPEG 编码（Worker）与页 N+1 的光栅化（主线程）并行，
      //    缩短单 PDF 总墙钟；末页不预取。
      this.prefetchNextPage(doc, workItem, pageNumber, task, pdfPath);

      // 3. 合成 3:4 画布 + 导出 JPG。
      //    PDF 渲染结果转为 ImageBitmap（一次 GPU 位图提交），transfer 给编码
      //    Worker 做等比合成 + JPEG 编码，主线程不再被 toBlob 同步编码阻塞。
      //    DPI 元数据在主线程嵌入（轻量字节拼接）。
      const bitmap = await createImageBitmap(sourceCanvas);

      // 释放源 canvas 显存：宽高归零强制 WebKit 回收 GPU 显存。
      // 不释放会逐页累积（每页 ~30MB RGBA），任务末尾 getContext('2d') 稳定返回 null。
      sourceCanvas.width = 0;
      sourceCanvas.height = 0;

      const encodeWorker = await this.getEncodeWorker();
      const rawJpeg = await encodeBitmapInWorker(
        encodeWorker,
        bitmap,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT,
      );
      const jpegBytes = embedJfifDpi(new Uint8Array(rawJpeg), TARGET_DPI);

      // 4. 确保输出目录存在。
      //    输出目录不可写 → 页级失败（taskRunner 会继续下一页；
      //    虽然下一页也会失败，但保持页级粒度符合 spec）。
      const fileName = buildPageImageFileName(workItem.pdfName, pageNumber);
      const outputPath = joinPath(pdfOutputDir, fileName);

      try {
        await invoke<void>("ensure_output_dir", { path: pdfOutputDir });
      } catch (err) {
        throw classifyWriteError(pdfOutputDir, err);
      }

      // 5. 写入磁盘。写盘失败（磁盘满 / 权限）→ 页级失败。
      // 路径作为二进制前缀编码到 body，invoke 顶层传 Uint8Array → 零序列化，
      // 避免原来 Array.from(jpegBytes) → JSON 数字数组字符串在主线程阻塞。
      try {
        await writeImageToDisk(outputPath, jpegBytes);
      } catch (err) {
        throw classifyWriteError(outputPath, err);
      }

      // 6. 如果是最后一页，销毁 PDF 文档释放资源。
      await this.cleanupIfLastPage(pdfPath, pageNumber, workItem, doc);

      return {
        taskId: task.taskId,
        pdfPath,
        pageNumber,
        status: "success",
        outputPath,
      };
    } catch (err) {
      // 渲染或写盘失败：抛出异常由 taskRunner 捕获并生成 failed PageResult。
      // 注意：即使失败，如果是最后一页，仍需清理 doc 缓存。
      // 预取可能指向其他页，失败后丢弃，避免残留渲染占用资源。
      this.prefetch = null;
      await this.cleanupIfLastPage(pdfPath, pageNumber, workItem, doc);
      throw err;
    }
  }

  // 末页清理：销毁 PDF 文档并终止编码 Worker（成功与失败路径共用）。
  // Worker 仅在任务结束（末页）时终止，页与页之间保持复用。
  private async cleanupIfLastPage(
    pdfPath: string,
    pageNumber: number,
    workItem: PdfWorkItem,
    doc: PDFDocumentProxy,
  ): Promise<void> {
    const selectedPages = workItem.selectedPages;
    if (pageNumber !== selectedPages[selectedPages.length - 1]) return;
    await destroyPdfDocument(doc);
    this.docCache.delete(pdfPath);
    terminateEncodeWorker(this.encodeWorker);
    this.encodeWorker = null;
  }

  // 兜底清理：队列结束后若仍有缓存（如任务被中止），释放资源。
  async cleanup(): Promise<void> {
    this.prefetch = null;
    for (const { doc } of this.docCache.values()) {
      await destroyPdfDocument(doc);
    }
    this.docCache.clear();
    terminateEncodeWorker(this.encodeWorker);
    this.encodeWorker = null;
  }
}
