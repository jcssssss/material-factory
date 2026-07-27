// 资料列表展示图生成器：文件类型图标资源。
//
// 与 v1.2.0 spec.md "Scenario: 文件类型图标映射" 对齐：
//   - .pdf → PDF 图标（红色）
//   - .docx/.doc → Word 图标（蓝色）
//   - .xlsx/.xls → Excel 图标（绿色）
//   - .pptx/.ppt → PPT 图标（橙色）
//   - 文件夹 → 文件夹图标（黄色）
//   - 未识别后缀 → 通用文件图标（灰色）
//
// 所有 SVG 统一 64×64 视口，便于在 Canvas 中按统一尺寸绘制。
// 图标设计为「文件形状 + 类型标签」的简洁扁平风格，保证缩放后仍清晰。

import type { FileType } from "../../types/materialList";

// ─── SVG 图标字符串 ───
// 每个 SVG 不含 XML 声明，可直接通过 data URL 或 Blob 加载到 Image。

// PDF 图标：红色文件 + 底部 "PDF" 标签。
const PDF_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M14 4h24l16 16v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#fff" stroke="#e74c3c" stroke-width="2"/>
  <path d="M38 4v16h16" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linejoin="round"/>
  <rect x="8" y="38" width="48" height="18" rx="3" fill="#e74c3c"/>
  <text x="32" y="51" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">PDF</text>
</svg>`;

// Word 图标：蓝色文件 + 底部 "W" 标签。
const WORD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M14 4h24l16 16v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#fff" stroke="#2b579a" stroke-width="2"/>
  <path d="M38 4v16h16" fill="none" stroke="#2b579a" stroke-width="2" stroke-linejoin="round"/>
  <rect x="8" y="38" width="48" height="18" rx="3" fill="#2b579a"/>
  <text x="32" y="51" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">W</text>
</svg>`;

// Excel 图标：绿色文件 + 底部 "X" 标签。
const EXCEL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M14 4h24l16 16v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#fff" stroke="#217346" stroke-width="2"/>
  <path d="M38 4v16h16" fill="none" stroke="#217346" stroke-width="2" stroke-linejoin="round"/>
  <rect x="8" y="38" width="48" height="18" rx="3" fill="#217346"/>
  <text x="32" y="51" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">X</text>
</svg>`;

// PPT 图标：橙色文件 + 底部 "P" 标签。
const PPT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M14 4h24l16 16v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#fff" stroke="#d24726" stroke-width="2"/>
  <path d="M38 4v16h16" fill="none" stroke="#d24726" stroke-width="2" stroke-linejoin="round"/>
  <rect x="8" y="38" width="48" height="18" rx="3" fill="#d24726"/>
  <text x="32" y="51" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle">P</text>
</svg>`;

// 文件夹图标：黄色文件夹形状。
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M6 16a4 4 0 0 1 4-4h14l6 6h22a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V16z" fill="#f5c542" stroke="#c99a1f" stroke-width="2" stroke-linejoin="round"/>
  <path d="M6 24h52v-2a4 4 0 0 0-4-4H10a4 4 0 0 0-4 4v2z" fill="#ffd966" stroke="none"/>
</svg>`;

// 通用文件图标：灰色文件形状。
const OTHER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M14 4h24l16 16v36a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#fff" stroke="#95a5a6" stroke-width="2"/>
  <path d="M38 4v16h16" fill="none" stroke="#95a5a6" stroke-width="2" stroke-linejoin="round"/>
  <line x1="18" y1="34" x2="42" y2="34" stroke="#bdc3c7" stroke-width="2" stroke-linecap="round"/>
  <line x1="18" y1="42" x2="42" y2="42" stroke="#bdc3c7" stroke-width="2" stroke-linecap="round"/>
  <line x1="18" y1="50" x2="34" y2="50" stroke="#bdc3c7" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// 图标映射表：FileType → SVG 字符串。
const ICON_MAP: Record<FileType, string> = {
  pdf: PDF_ICON_SVG,
  word: WORD_ICON_SVG,
  excel: EXCEL_ICON_SVG,
  ppt: PPT_ICON_SVG,
  folder: FOLDER_ICON_SVG,
  other: OTHER_ICON_SVG,
};

// 根据文件类型返回对应的 SVG 字符串。
// 未识别后缀（FileType.Other）回退到通用文件图标。
export function getIconForFileType(fileType: FileType): string {
  return ICON_MAP[fileType] ?? OTHER_ICON_SVG;
}

// 将 SVG 字符串转为可在 Canvas 绘制的 HTMLImageElement。
//
// 实现：通过 Blob URL 加载，避免 base64 编码开销与 data URL 在某些 WebView 下的
// 字符集问题。加载完成后 revoke URL 释放资源。
//
// 调用方通常在 renderLayoutPageToCanvas 中按需加载并缓存，避免每帧重复解码。
export function svgStringToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG 图标加载失败"));
    };
    img.src = url;
  });
}
