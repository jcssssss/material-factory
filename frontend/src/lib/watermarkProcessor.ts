// 去水印处理编排逻辑。
// 封装 Tauri IPC 调用，提供单文件检测/移除和批量处理能力。

import { invoke } from "@tauri-apps/api/core";
import type {
  WatermarkReport,
  WatermarkRemovalResult,
  WatermarkRequest,
  WatermarkResult,
  BatchItem,
  FileProcessStatus,
} from "../types/watermark";

/** 检测 PDF 文件中的水印/页眉/页脚 */
export async function detectWatermarks(
  pdfPath: string,
): Promise<WatermarkReport> {
  return invoke<WatermarkReport>("detect_watermark_info", { pdfPath });
}

/** 移除 PDF 中的水印/页眉/页脚 */
export async function removeWatermarks(
  pdfPath: string,
  outputPath: string,
): Promise<WatermarkRemovalResult> {
  return invoke<WatermarkRemovalResult>("remove_watermarks", {
    pdfPath,
    outputPath,
  });
}

/** 批量移除水印 */
export async function batchRemoveWatermarks(
  requests: WatermarkRequest[],
): Promise<WatermarkResult[]> {
  return invoke<WatermarkResult[]>("batch_remove_watermarks", { requests });
}

/** 处理单个文件的回调类型 */
export type ProcessCallback = (
  itemId: string,
  status: FileProcessStatus,
  report?: WatermarkReport | null,
  removal?: WatermarkRemovalResult | null,
  error?: string | null,
) => void;

/**
 * 按批次串行处理文件列表。
 * 每个文件依次检测 → 有结果则移除，无结果则标记为无水印。
 * 单个文件失败不中断后续文件的处理。
 */
export async function processBatch(
  items: BatchItem[],
  outputDir: string,
  onProgress: ProcessCallback,
): Promise<void> {
  for (const item of items) {
    const stem = item.name.replace(/\.[^.]+$/, "");
    const relDir =
      item.groupName && item.groupName !== "默认文件夹" ? item.groupName : "";
    const outputPath = joinPath(outputDir, relDir, `${stem}_clean.pdf`);

    try {
      onProgress(item.id, "detecting");
      const report = await detectWatermarks(item.path);

      if (report.hasWatermark || report.hasHeader || report.hasFooter) {
        onProgress(item.id, "removing");
        const removal = await removeWatermarks(item.path, outputPath);
        onProgress(item.id, "done", report, removal);
      } else {
        await invoke("copy_file", { src: item.path, dst: outputPath });
        onProgress(item.id, "no_watermark", report);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress(item.id, "failed", null, null, message);
    }
  }
}

/** 简单的跨平台路径拼接 */
function joinPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/\/+$/, ""))
    .filter(Boolean)
    .join("/");
}
