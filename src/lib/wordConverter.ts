// Word → PDF 转换桥接层。
// 调用 Rust 侧 LibreOffice 命令完成转换，转换后的 PDF 缓存在应用数据目录。
//
// 与 spec.md "Requirement: Word 文档输入与转换中转" 对齐：
//   - Word 文件先转 PDF 再复用 v1.0 PDF 处理链路
//   - LibreOffice 未安装时调用方应阻止含 Word 任务启动
//   - 转换失败时由 taskRunner 捕获并视为失败 PDF 工作项

import { invoke } from "@tauri-apps/api/core";

export type LibreOfficeStatus = {
  available: boolean;
  path: string | null;
};

// 检测 LibreOffice 是否安装。调用 Rust check_libreoffice 命令。
// 在非 Tauri 环境（如测试）中调用失败时返回 { available: false, path: null }。
export async function checkLibreOffice(): Promise<LibreOfficeStatus> {
  try {
    return await invoke<LibreOfficeStatus>("check_libreoffice");
  } catch {
    return { available: false, path: null };
  }
}

// 将单个 Word 文件转换为 PDF。
// 调用 Rust convert_word_to_pdf 命令，返回转换后 PDF 的完整路径。
// 抛出异常表示转换失败（LibreOffice 未安装、转换超时、文件损坏等），
// 由 taskRunner 捕获并记录为失败 PDF 工作项。
export async function convertWordToPdf(
  wordPath: string,
  taskId: string
): Promise<string> {
  return await invoke<string>("convert_word_to_pdf", {
    wordPath,
    taskId,
  });
}
