// Document Cleaner 任务状态
export type CleanerTaskStatus =
  | "created"
  | "scanning"
  | "waiting"
  | "running"
  | "completed"
  | "completed_with_error"
  | "cancelled";

// 清理任务数据模型
export type CleanerTask = {
  id: string;
  name: string;
  status: CleanerTaskStatus;
  filesCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
};

export const CLEANER_TASK_STATUS_LABELS: Record<CleanerTaskStatus, string> = {
  created: "已创建",
  scanning: "扫描中",
  waiting: "排队中",
  running: "清理中",
  completed: "已完成",
  completed_with_error: "部分失败",
  cancelled: "已取消",
};

export const CLEANER_TASK_STATUS_TONE: Record<
  CleanerTaskStatus,
  "muted" | "accent" | "success" | "warning" | "danger"
> = {
  created: "muted",
  scanning: "accent",
  waiting: "muted",
  running: "accent",
  completed: "success",
  completed_with_error: "warning",
  cancelled: "muted",
};

// 检测结果类型
export type DetectionType = "watermark" | "header" | "footer";

// 单项检测结果
export type DetectionItem = {
  id: string;
  type: DetectionType;
  subType: string;        // 如 "文字水印"、"图片水印"、"线条页眉"
  name: string;           // 显示名称，如 "水印01"、"页眉01"
  page: number;
  location: string;
  confidence: number;     // 0-100
  markedForDeletion: boolean; // 是否标记清除
};

// 单个文件的检测结果
export type FileDetectionResult = {
  fileName: string;
  items: DetectionItem[];
};

export const DETECTION_LABELS: Record<DetectionType, string> = {
  watermark: "水印",
  header: "页眉",
  footer: "页脚",
};

export const DETECTION_ICON_COLORS: Record<DetectionType, string> = {
  watermark: "text-amber-500",
  header: "text-blue-500",
  footer: "text-green-500",
};

// 文件级清理结果
export type FileCleanResult = {
  fileName: string;
  status: "success" | "failed" | "skipped";
  error?: string;
};

// 清理报告
export type CleanReport = {
  taskId: string;
  totalFiles: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  files: FileCleanResult[];
  completedAt: string;
};
