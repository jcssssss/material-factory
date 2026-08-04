// 扫描版试卷本地 OCR：pdf.js 渲染每页为图像 → tesseract.js 识别中英文 → 返回文本。
// 模仿 DeepSeek 网页端对扫描版 PDF 的处理：自动转文字后喂给模型，而非报错。
//
// 资源打包（viteStaticCopy）：
//   worker  → dist/tesseract/worker.min.js
//   核心    → dist/tesseract/tesseract-core*.wasm(.js)（worker 按 SIMD 能力自动选择）
//   语言包  → dist/tesseract/lang/{chi_sim,eng}.traineddata.gz（gzip:true 加载）
//
// 路径约定：worker 内 importScripts / fetch 无法解析文档相对路径，必须用
// document.baseURI 拼出绝对 URL；workerBlobURL:false 让 worker 直接从打包 URL 加载
//（与 pdf.js 用 new Worker(bundledUrl) 的既有模式一致，在 Tauri WebView 已验证可行）。

import { createWorker, OEM, type Worker } from "tesseract.js";
import {
  readPdfBytes,
  loadPdfDocument,
  destroyPdfDocument,
  renderPageToCanvas,
} from "../../lib/pdf";
import { MAX_TOTAL_CHARS } from "./prompt";
import type { ExtractResult } from "../types";

/** OCR 渲染倍率：≈144 DPI，中文印刷体精度与耗时平衡。 */
const OCR_SCALE = 2;
/** 图像无 DPI 元数据时告诉 tesseract 实际 DPI，避免按默认 70 DPI 缩放。 */
const OCR_DPI = Math.round(OCR_SCALE * 72);

export type OcrProgressFn = (
  page: number,
  total: number,
  detail: string,
  progress: number
) => void;

let workerPromise: Promise<Worker> | null = null;

function appBase(): string {
  return document.baseURI.replace(/\/+$/, "");
}

/** 懒加载并复用 tesseract worker（全局单例，加载失败允许下次重试）。 */
function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = createWorker(["chi_sim", "eng"], OEM.LSTM_ONLY, {
    workerPath: `${appBase()}/tesseract/worker.min.js`,
    corePath: `${appBase()}/tesseract`,
    langPath: `${appBase()}/tesseract/lang`,
    gzip: true,
    workerBlobURL: false,
  })
    .then(async (w) => {
      await w.setParameters({ user_defined_dpi: String(OCR_DPI) });
      return w;
    })
    .catch((err) => {
      workerPromise = null;
      throw err;
    });
  return workerPromise;
}

/** 识别单张画布，返回文本。 */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return data.text;
}

/** 对扫描版 PDF 逐页渲染 + OCR，返回拼接文本与摘要。 */
export async function ocrPdfTextFromPath(
  pdfPath: string,
  onProgress?: OcrProgressFn
): Promise<ExtractResult> {
  const bytes = await readPdfBytes(pdfPath);
  const doc = await loadPdfDocument(bytes);
  try {
    const pages: string[] = [];
    let total = 0;
    let truncated = false;

    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.(i, doc.numPages, "渲染页面", 0);
      const { canvas, page } = await renderPageToCanvas(doc, i, OCR_SCALE);
      try {
        onProgress?.(i, doc.numPages, "文字识别", 0);
        const text = (await ocrCanvas(canvas)).trim();
        pages.push(text);
        total += text.length;
      } finally {
        page.cleanup();
        // 归零强制 WebKit 回收 GPU 显存，避免逐页累积
        canvas.width = 0;
        canvas.height = 0;
      }
      if (total >= MAX_TOTAL_CHARS) {
        truncated = true;
        break;
      }
    }

    const text = pages.join("\n\n").slice(0, MAX_TOTAL_CHARS);
    return {
      text,
      summary: { pageCount: doc.numPages, charCount: text.length, truncated },
    };
  } finally {
    await destroyPdfDocument(doc);
  }
}
