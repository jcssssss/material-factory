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
export async function loadPdfDocument(
  bytes: Uint8Array
): Promise<PDFDocumentProxy> {
  ensureWorker();
  // stopAtErrors=true: 解析失败时直接抛出，让 taskRunner 走 PDF 级失败隔离。
  const loadingTask = getDocument({
    data: bytes,
    stopAtErrors: true,
    disableFontFace: false,
  });
  // 超时检测：worker 通信卡住时 30 秒后抛错。
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("PDF 加载超时（30s），疑似 worker 通信卡住")),
      30000
    );
  });
  const doc = await Promise.race([loadingTask.promise, timeout]);
  return doc;
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

  const ctx = canvas.getContext("2d");
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

  // 渲染超时检测：60 秒未完成视为卡住。
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`PDF 渲染超时（60s），page=${pageNumber}`)),
      60000
    );
  });
  await Promise.race([renderTask.promise, timeout]);

  return { canvas, viewport, page };
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
    // 销毁失败不阻断后续流程。
  }
}
