// 答案生成器 IPC 封装：camelCase 键 ↔ Rust snake_case 参数。

import { invoke } from "@tauri-apps/api/core";
import type { ApiFormat } from "../types";

export type GenerateAnswersRequest = {
  pdfText: string;
  customPrompt?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: ApiFormat;
  taskId: string;
};

/** 调 Rust 生成答案，返回完整 HTML；期间由 "answer-stream-chunk" 事件流式推送。 */
export function generateAnswers(req: GenerateAnswersRequest): Promise<string> {
  return invoke<string>("generate_answers", {
    pdfText: req.pdfText,
    customPrompt: req.customPrompt,
    baseUrl: req.baseUrl,
    apiKey: req.apiKey,
    model: req.model,
    protocol: req.protocol,
    taskId: req.taskId,
  });
}

/** 取消进行中的生成。 */
export function cancelAnswerGeneration(taskId: string): Promise<void> {
  return invoke<void>("cancel_answer_generation", { taskId });
}

/** 测试 API 连接：发一次最小请求验证 key / 地址 / 模型名。 */
export function testApiConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: ApiFormat
): Promise<string> {
  return invoke<string>("test_api_connection", { baseUrl, apiKey, model, protocol });
}

/** 拉取提供商可用模型列表（OpenAI 兼容 /models 端点），返回模型 ID。 */
export function listAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return invoke<string[]>("list_available_models", { baseUrl, apiKey });
}

/** HTML 转 PDF（Rust 写缓存 + LibreOffice 转换），返回缓存 PDF 路径。 */
export function convertAnswerHtmlToPdf(taskId: string, html: string): Promise<string> {
  return invoke<string>("convert_answer_html_to_pdf", { taskId, html });
}

/** 复制缓存产物到用户选择的目标路径。 */
export function copyFile(src: string, dst: string): Promise<void> {
  return invoke<void>("copy_file", { src, dst });
}

/** 在系统文件管理器中打开指定文件夹（批量完成后「打开文件」）。 */
export function openFolder(path: string): Promise<void> {
  return invoke<void>("open_folder", { path });
}
