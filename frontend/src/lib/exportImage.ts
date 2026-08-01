// 3:4 竖版画布合成 + JPG 导出。
//
// 与 spec.md Requirement: 固定输出规格与目录命名 对齐：
//   - 固定 3:4 竖版 JPG，质量 100%，目标 300 DPI
//   - 页面比例不匹配时：等比缩放、居中放置、背景补边，不裁切主体内容
//
// 与技术架构文档 §5.3 导出链路对齐：
//   渲染高分辨率 Canvas → 计算 3:4 目标画布 → 等比缩放并居中放置 →
//   导出 JPG Blob → 写入磁盘

import { invoke } from "@tauri-apps/api/core";

// 3:4 目标画布像素尺寸。
// 2475 x 3300 = 8.25" x 11" @ 300 DPI，正好 3:4，覆盖 A4 / Letter 等常见尺寸。
export const OUTPUT_WIDTH = 2475;
export const OUTPUT_HEIGHT = 3300;

// JPG 导出质量：spec 要求 100%。canvas.toBlob quality 取值 0~1，1 即 100%。
export const JPEG_QUALITY = 1.0;

// 目标 DPI：用于 JFIF 元数据嵌入。
export const TARGET_DPI = 300;

// 画布背景色：补边使用纯白，与 PDF 默认背景一致。
export const BACKGROUND_COLOR = "#ffffff";

// 计算 PDF 页面渲染到目标画布所需的缩放比例。
//
// 策略：取 min(targetW/pageW, targetH/pageH)，使页面等比缩放后完整放入画布，
// 不会裁切主体；剩余区域用背景色补边。
export function calculateFitScale(
  pageWidth: number,
  pageHeight: number,
  targetWidth: number = OUTPUT_WIDTH,
  targetHeight: number = OUTPUT_HEIGHT
): number {
  if (pageWidth <= 0 || pageHeight <= 0) {
    throw new Error(`非法的页面尺寸：${pageWidth}x${pageHeight}`);
  }
  return Math.min(targetWidth / pageWidth, targetHeight / pageHeight);
}

// 将源 Canvas 等比缩放并居中绘制到 3:4 目标 Canvas。
// 返回目标 Canvas，调用方进一步导出为 JPG。
export function composeToPortraitCanvas(
  sourceCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const target = document.createElement("canvas");
  target.width = OUTPUT_WIDTH;
  target.height = OUTPUT_HEIGHT;

  const ctx = target.getContext("2d");
  if (!ctx) {
    throw new Error("无法获取目标 Canvas 2D 上下文");
  }

  // 背景补边：先填充整张画布。
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

  // 等比缩放并居中放置。
  const scale = calculateFitScale(
    sourceCanvas.width,
    sourceCanvas.height
  );
  const drawWidth = Math.round(sourceCanvas.width * scale);
  const drawHeight = Math.round(sourceCanvas.height * scale);
  const offsetX = Math.floor((OUTPUT_WIDTH - drawWidth) / 2);
  const offsetY = Math.floor((OUTPUT_HEIGHT - drawHeight) / 2);

  // imageSmoothingQuality = "high" 让缩放更平滑。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    sourceCanvas,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight
  );

  return target;
}

// 将 Canvas 导出为 JPG Blob，质量 100%。
export function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas 导出 JPG Blob 失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

// 在 JPG 字节流中注入 300 DPI 的 JFIF APP0 段。
//
// canvas.toBlob 产出的 JPG 通常包含一个默认的 JFIF APP0 段（density=0/1），
// 我们需要替换其 density 字段为 300 DPI，使图片在 Photoshop / 看图软件中
// 显示为 300 DPI（满足 spec 的「目标 300 DPI」要求）。
//
// JFIF APP0 段结构（共 16 字节）：
//   FF E0          APP0 marker
//   00 10          段长度 = 16
//   4A 46 49 46 00 "JFIF\0"
//   01 01          版本 1.1
//   01             密度单位：1 = DPI
//   01 2C          X 密度 = 300
//   01 2C          Y 密度 = 300
//   00 00          无缩略图
export function embedJfif300Dpi(jpegBytes: Uint8Array): Uint8Array {
  // 构造 300 DPI 的 JFIF APP0 段。
  const jfifSegment = new Uint8Array([
    0xff, 0xe0, // APP0 marker
    0x00, 0x10, // 段长度 = 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // 版本 1.1
    0x01, // 密度单位 = DPI
    0x01, 0x2c, // X 密度 = 300
    0x01, 0x2c, // Y 密度 = 300
    0x00, 0x00, // 无缩略图
  ]);

  // 校验 SOI marker。
  if (jpegBytes.length < 2 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    throw new Error("非法的 JPG 数据：缺少 SOI marker");
  }

  // 检查是否已存在 APP0 段。
  const hasApp0 =
    jpegBytes.length >= 4 &&
    jpegBytes[2] === 0xff &&
    jpegBytes[3] === 0xe0;

  if (hasApp0) {
    // 读取现有 APP0 段长度（大端 16 位）。
    const existingLen = (jpegBytes[4] << 8) | jpegBytes[5];
    const afterSegment = 4 + existingLen; // 跳过 FF E0 + 2 字节长度 + 段内容
    // 用我们的 300 DPI JFIF 段替换原 APP0 段。
    const tail = jpegBytes.slice(afterSegment);
    const result = new Uint8Array(2 + jfifSegment.length + tail.length);
    result.set(jpegBytes.subarray(0, 2), 0); // SOI
    result.set(jfifSegment, 2);
    result.set(tail, 2 + jfifSegment.length);
    return result;
  }

  // 不存在 APP0 段：在 SOI 之后插入新的 JFIF APP0 段。
  const result = new Uint8Array(
    2 + jfifSegment.length + (jpegBytes.length - 2)
  );
  result.set(jpegBytes.subarray(0, 2), 0); // SOI
  result.set(jfifSegment, 2);
  result.set(jpegBytes.subarray(2), 2 + jfifSegment.length);
  return result;
}

// 主入口：把源 Canvas 合成为 3:4 300 DPI JPG 字节流。
//
// 流程：
//   1. composeToPortraitCanvas → 等比缩放 + 居中 + 补边
//   2. canvasToJpegBlob → 导出 JPG Blob（质量 100%）
//   3. embedJfif300Dpi → 注入 300 DPI 元数据
//   4. 返回 Uint8Array，由调用方通过 Tauri 命令写入磁盘
export async function exportPageAsJpegBytes(
  sourceCanvas: HTMLCanvasElement
): Promise<Uint8Array> {
  // Tauri WebView 在长任务/高内存下偶发 getContext 返回 null，重试防御。
  let targetCanvas: HTMLCanvasElement | null = null;
  for (let attempt = 0; attempt < 3 && !targetCanvas; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
    try {
      targetCanvas = composeToPortraitCanvas(sourceCanvas);
    } catch {
      targetCanvas = null;
    }
  }
  if (!targetCanvas) {
    throw new Error("无法获取目标 Canvas 2D 上下文");
  }
  const blob = await canvasToJpegBlob(targetCanvas);
  const rawBytes = new Uint8Array(await blob.arrayBuffer());
  // 释放目标 canvas 显存（2475×3300 大画布），避免逐页累积耗尽 WebView GPU 显存。
  targetCanvas.width = 0;
  targetCanvas.height = 0;
  return embedJfif300Dpi(rawBytes);
}

// 输出文件名生成：{pdfBaseName}_p{页码三位}.jpg
// 与 spec.md "Scenario: 图片命名稳定可追踪" 对齐。
export function buildPageImageFileName(
  pdfBaseName: string,
  pageNumber: number
): string {
  const padded = String(pageNumber).padStart(3, "0");
  // 替换文件系统不友好字符，保证跨平台稳定。
  const safeName = pdfBaseName.replace(/[\\/:*?"<>|]/g, "_");
  return `${safeName}_p${padded}.jpg`;
}

// 判断文件名是否为资料预览图（匹配 buildPageImageFileName 的命名规则）。
// 预览图格式：{pdfName}_p{至少三位页码}.jpg，如 "咨询报告_p001.jpg"。
const PREVIEW_IMAGE_RE = /_p\d+\.jpg$/;

export function isPreviewImage(filename: string): boolean {
  return PREVIEW_IMAGE_RE.test(filename);
}

// 零序列化写盘：路径作为二进制前缀编码，通过 invoke 顶层 Uint8Array
// → Tauri 走 octet-stream，避免主线程 JSON 序列化卡顿。
//
// body 格式（LE）：[4 字节 u32 path_len][UTF-8 path bytes][JPEG data]
export async function writeImageToDisk(
  outPath: string,
  jpegBytes: Uint8Array,
): Promise<void> {
  const encoder = new TextEncoder();
  const pathBytes = encoder.encode(outPath);
  const len = pathBytes.length;
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, len, true); // little-endian
  const combined = new Uint8Array(4 + len + jpegBytes.length);
  combined.set(header, 0);
  combined.set(pathBytes, 4);
  combined.set(jpegBytes, 4 + len);
  await invoke<void>("write_image_binary", combined);
}
