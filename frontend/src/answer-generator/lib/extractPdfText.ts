// 试卷文本提取：pdf.js 逐页 getTextContent()，按 y/x 坐标排序还原阅读顺序。
// 扫描版（无文本层）PDF 提取结果为空，由调用方据此提示用户。

import { readPdfBytes, loadPdfDocument, destroyPdfDocument } from "../../lib/pdf";
import { MAX_PAGE_CHARS, MAX_TOTAL_CHARS } from "./prompt";
import type { ExtractResult } from "../types";

/** pdf.js TextItem 的瘦子集，便于单测合成数据。 */
export type TextItemLike = { str: string; transform: number[] };

/** 同一行文本项的 y 坐标容差（PDF 坐标系单位为点）。 */
const LINE_EPS = 4;

/**
 * 将 pdf.js 文本项按阅读顺序拼成多行文本。
 * PDF 坐标系 y 轴向上（越大越靠页面上方）：先按 y 降序分组合并为行，
 * 行内再按 x 升序拼接。纯函数，可单测。
 */
export function sortTextItemsToLines(items: TextItemLike[]): string {
  const pos = items
    .filter((it) => typeof it.str === "string" && it.str.length > 0)
    .map((it) => ({ str: it.str, x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0 }));
  pos.sort((a, b) => b.y - a.y);

  const lines: { x: number; y: number; str: string }[][] = [];
  for (const it of pos) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= LINE_EPS) {
      last.push(it);
    } else {
      lines.push([it]);
    }
  }

  return lines
    .map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.str).join(""))
    .join("\n");
}

/** 提取 PDF 全卷文本，含逐页/总量截断与摘要。 */
export async function extractPdfTextFromPath(pdfPath: string): Promise<ExtractResult> {
  const bytes = await readPdfBytes(pdfPath);
  const doc = await loadPdfDocument(bytes);
  try {
    const pages: string[] = [];
    let total = 0;
    let truncated = false;

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      let lineText = "";
      try {
        const content = await page.getTextContent();
        lineText = sortTextItemsToLines(content.items as unknown as TextItemLike[]);
      } finally {
        page.cleanup();
      }
      if (lineText.length > MAX_PAGE_CHARS) {
        lineText = lineText.slice(0, MAX_PAGE_CHARS);
      }
      pages.push(lineText);
      total += lineText.length;
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
