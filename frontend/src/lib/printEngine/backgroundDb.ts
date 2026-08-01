import { invoke } from "@tauri-apps/api/core";
import type { BackgroundTemplate, CalibrationCorners } from "../../types/background";

export async function listTemplates(): Promise<BackgroundTemplate[]> {
  return invoke<BackgroundTemplate[]>("list_background_templates");
}

export async function addTemplate(
  file_name: string,
  width: number,
  height: number,
  file_size: number,
): Promise<string> {
  return invoke<string>("add_background_template", {
    fileName: file_name,
    width,
    height,
    fileSize: file_size,
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  return invoke<void>("delete_background_template", { id });
}

export async function batchDeleteTemplates(ids: string[]): Promise<void> {
  return invoke<void>("batch_delete_background_templates", { ids });
}

export async function getTemplate(id: string): Promise<BackgroundTemplate> {
  return invoke<BackgroundTemplate>("get_background_template", { id });
}

export async function randomTemplate(): Promise<BackgroundTemplate> {
  return invoke<BackgroundTemplate>("random_background_template");
}

export async function saveCalibration(
  id: string,
  corners: CalibrationCorners,
): Promise<void> {
  return invoke<void>("save_calibration", { id, corners });
}

/** 上传并处理为 1242×1656 JPEG。字节走二进制通道（octet-stream，顶层 Uint8Array），
 * 避免嵌套 JSON 序列化大字节。返回最终文件名和尺寸。 */
export async function saveBackgroundFile(
  bytes: Uint8Array,
): Promise<{ file_name: string; width: number; height: number }> {
  return invoke<{ file_name: string; width: number; height: number }>(
    "save_background_file",
    bytes,
  );
}

export function getBackgroundFilePath(file_name: string): Promise<string> {
  return invoke<string>("get_background_file_path", { fileName: file_name });
}

/** 读取背景原图，走二进制通道返回 ArrayBuffer（零拷贝），用于标定页。 */
export async function readBackgroundFile(
  file_name: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_background_file", { fileName: file_name });
}

/** 读取背景文件的缩略图（最长边 600px JPEG），走二进制通道，专用于列表快速预览。 */
export async function readBackgroundThumbnail(
  file_name: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_background_thumbnail", { fileName: file_name });
}

/** 批量补齐所有缺失的缩略图（页面首次进入时调用一次）。返回实际生成数。 */
export async function ensureBackgroundThumbnails(): Promise<number> {
  return invoke<number>("ensure_background_thumbnails");
}

export async function deleteBackgroundFile(file_name: string): Promise<void> {
  return invoke<void>("delete_background_file", { fileName: file_name });
}
