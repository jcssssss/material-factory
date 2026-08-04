// 答案生成器配置持久化：localStorage 单键存储，沿用 persistence.ts 的
// try/catch 静默降级模式（损坏数据 / localStorage 不可用不阻断 UI）。

import { DEFAULT_ANSWER_PROMPT } from "./prompt";
import type { AnswerConfig, ApiFormat } from "../types";

const ANSWER_CONFIG_KEY = "xhs-pic:answer-config";

export const DEFAULT_ANSWER_CONFIG: AnswerConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  format: "openai",
  customPrompt: DEFAULT_ANSWER_PROMPT,
  outputDir: "",
};

// 结构校验：核心字段缺失/类型不符时回退默认。format 单独校验（旧版本数据无此字段）。
// outputDir 单独兜底：旧数据缺失时由外层 merge 补成空串。
function isConfig(v: unknown): v is AnswerConfig {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.baseUrl === "string" &&
    typeof c.apiKey === "string" &&
    typeof c.model === "string" &&
    typeof c.customPrompt === "string"
  );
}

export function loadAnswerConfig(): AnswerConfig {
  try {
    const raw = localStorage.getItem(ANSWER_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_ANSWER_CONFIG };
    const parsed = JSON.parse(raw);
    if (!isConfig(parsed)) return { ...DEFAULT_ANSWER_CONFIG };
    // 旧数据无 format 字段时回退 openai，保留已保存的 key / 地址 / Prompt
    const format: ApiFormat = parsed.format === "anthropic" ? "anthropic" : "openai";
    return { ...DEFAULT_ANSWER_CONFIG, ...parsed, format };
  } catch {
    // localStorage 不可用（隐私模式 / 配额超限）或数据损坏时回退默认。
    return { ...DEFAULT_ANSWER_CONFIG };
  }
}

export function saveAnswerConfig(cfg: AnswerConfig): void {
  try {
    localStorage.setItem(ANSWER_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // 保存失败静默忽略，不阻断生成。
  }
}
