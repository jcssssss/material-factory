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
} from "./pdf";
import {
  exportPageAsJpegBytes,
  buildPageImageFileName,
  calculateFitScale,
} from "./exportImage";
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

    // 7. 缓存 doc 供后续 renderAndExportPage 使用。
    this.docCache.set(pdfPath, { doc, pdfPath });

    return {
      taskId: task.taskId,
      pdfPath,
      pdfName: pdfBaseName(pdfPath),
      totalPages,
      selectedPages: ruleResult.pages,
      status: "pending",
    };
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
      // 1. 渲染高分辨率源图。
      //    计算合适的 scale：先获取页面 scale=1 的尺寸，
      //    再按目标画布的 fit-scale 渲染，保证源图分辨率 ≥ 目标画布。
      const probePage = await doc.getPage(pageNumber);
      const probeViewport = probePage.getViewport({ scale: 1 });
      // 探测后立即释放（实际渲染会重新 getPage）。
      probePage.cleanup();

      const fitScale = calculateFitScale(
        probeViewport.width,
        probeViewport.height
      );
      // 渲染到目标画布等比例尺寸，避免后续合成时再放大导致画质损失。
      const renderScale = fitScale;

      const { canvas: sourceCanvas, page } = await renderPageToCanvas(
        doc,
        pageNumber,
        renderScale
      );
      logger.pageInfo(task.taskId, pdfPath, pageNumber,
        `PDF 页面渲染完成，canvas 尺寸：${sourceCanvas.width}x${sourceCanvas.height}`);
      // 渲染完成后清理 page 资源。
      page.cleanup();

      // 2. 合成 3:4 画布 + 导出 JPG（300 DPI 元数据嵌入）。
      const jpegBytes = await exportPageAsJpegBytes(sourceCanvas);

      // 3. 确保输出目录存在。
      //    输出目录不可写 → 页级失败（taskRunner 会继续下一页；
      //    虽然下一页也会失败，但保持页级粒度符合 spec）。
      const fileName = buildPageImageFileName(workItem.pdfName, pageNumber);
      const outputPath = joinPath(pdfOutputDir, fileName);

      try {
        await invoke<void>("ensure_output_dir", { path: pdfOutputDir });
      } catch (err) {
        throw classifyWriteError(pdfOutputDir, err);
      }

      // 4. 写入磁盘。
      //    写盘失败（磁盘满 / 权限）→ 页级失败。
      // JPG 字节通过 JSON 序列化传给 Rust（write_image_file 接收 Vec<u8>）。
      // 单页 JPG 通常 200KB-1MB，JSON 开销可接受。
      // read_pdf_bytes 走二进制通道（PDF 5MB+ 是主要瓶颈），write_image_file 保持 JSON 兼容 WKWebView。
      try {
        await invoke<void>("write_image_file", {
          path: outputPath,
          bytes: Array.from(jpegBytes),
        });
      } catch (err) {
        throw classifyWriteError(outputPath, err);
      }

      // 5. 如果是最后一页，销毁 PDF 文档释放资源。
      const selectedPages = workItem.selectedPages;
      const isLastPage = pageNumber === selectedPages[selectedPages.length - 1];
      if (isLastPage) {
        await destroyPdfDocument(doc);
        this.docCache.delete(pdfPath);
      }

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
      const selectedPages = workItem.selectedPages;
      const isLastPage = pageNumber === selectedPages[selectedPages.length - 1];
      if (isLastPage) {
        await destroyPdfDocument(doc);
        this.docCache.delete(pdfPath);
      }
      throw err;
    }
  }

  // 兜底清理：队列结束后若仍有缓存（如任务被中止），释放资源。
  async cleanup(): Promise<void> {
    for (const { doc } of this.docCache.values()) {
      await destroyPdfDocument(doc);
    }
    this.docCache.clear();
  }
}
