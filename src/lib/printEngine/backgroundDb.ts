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

export async function saveBackgroundFile(
  bytes: number[],
  ext: string,
): Promise<string> {
  return invoke<string>("save_background_file", { bytes, ext });
}

export function getBackgroundFilePath(file_name: string): Promise<string> {
  return invoke<string>("get_background_file_path", { fileName: file_name });
}

export async function readBackgroundFile(
  file_name: string,
): Promise<number[]> {
  return invoke<number[]>("read_background_file", { fileName: file_name });
}

export async function deleteBackgroundFile(file_name: string): Promise<void> {
  return invoke<void>("delete_background_file", { fileName: file_name });
}
