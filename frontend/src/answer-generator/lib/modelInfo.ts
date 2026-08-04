// 模型 → 接口协议推断。OpenCode Go 的模型分两种协议：
//   - OpenAI 兼容（/chat/completions）：Grok、GLM、Kimi、DeepSeek、MiMo、Hy3 等
//   - Anthropic 兼容（/v1/messages）：Qwen3.x、MiniMax 系列
// 依据官方文档的端点表；新增模型默认按 OpenAI 兼容处理。

import type { ApiFormat } from "../types";

const ANTHROPIC_MODEL_PREFIXES = ["qwen3", "minimax-m"];

export function protocolForModel(model: string): ApiFormat {
  const m = model.toLowerCase();
  if (ANTHROPIC_MODEL_PREFIXES.some((p) => m.startsWith(p))) {
    return "anthropic";
  }
  return "openai";
}
