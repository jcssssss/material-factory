// 答案生成器领域类型。

/** LLM 接口协议：OpenAI 兼容 / Anthropic 兼容。 */
export type ApiFormat = "openai" | "anthropic";

/** LLM 接口配置 + 自定义 Prompt + 输出目录，整体持久化到 localStorage。 */
export type AnswerConfig = {
  /** OpenAI 兼容接口根地址，如 https://api.deepseek.com 或 https://opencode.ai/zen/go/v1 */
  baseUrl: string;
  apiKey: string;
  /** 模型名，如 deepseek-chat / deepseek-v4-flash / qwen3.8-max */
  model: string;
  /** 接口协议：openai（/chat/completions）或 anthropic（/v1/messages） */
  format: ApiFormat;
  /** 生效的 Prompt（默认初始化为核心默认 Prompt，可编辑覆盖） */
  customPrompt: string;
  /** 答案 PDF 输出文件夹；空表示未设置，选文件时自动填输入文件夹 */
  outputDir: string;
};

/** 顶层整体状态：批量队列运行中 / 全部处理完毕。失败按文件记录，不置整体 error。 */
export type BatchStatus = "idle" | "running" | "done";

/** 单个资料文件的处理状态。 */
export type FileItemStatus =
  | "pending"
  | "extracting"
  | "ocr"
  | "generating"
  | "converting"
  | "done"
  | "error";

/** 资料文件列表中的一行：独立进度条 + 状态 + 完成后缓存 HTML 供预览/打印。 */
export type AnswerFileItem = {
  path: string;
  /** 含扩展名的文件名（basename）。 */
  name: string;
  /** 去 .pdf 的文件名，用于输出命名「{baseName}-参考答案.pdf」。 */
  baseName: string;
  status: FileItemStatus;
  /** 0-100 */
  progress: number;
  /** 失败原因（status === "error" 时） */
  error?: string;
  /** 生成完成的答案 HTML，供预览/打印（其余状态无）。 */
  resultHtml?: string;
};

/** 扫描版 OCR 进度，供 UI 展示「第 x/y 页（渲染中/识别中）」。 */
export type OcrProgress = {
  page: number;
  total: number;
  detail: string;
};

/** 试卷文本提取结果摘要，用于 UI 展示与扫描版识别。 */
export type ExtractSummary = {
  pageCount: number;
  charCount: number;
  truncated: boolean;
};

export type ExtractResult = {
  text: string;
  summary: ExtractSummary;
};

/** Rust 侧 "answer-stream-chunk" 事件 payload。 */
export type AnswerStreamChunk = {
  taskId: string;
  delta: string;
};
