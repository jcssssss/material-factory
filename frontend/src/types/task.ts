// 任务领域类型定义。
// 与技术架构文档 §7.1 对齐。任务状态机本身在 Task 3 实现执行语义，
// 这里仅给出 UI 渲染所需的类型骨架。

export type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

export type SourceType = "files" | "folder";

export type PageRuleMode = "firstN" | "custom" | "combined";

// 任务配置（表单输入与队列展示共用）。
export type TaskConfig = {
  taskId: string;
  taskName: string;
  sourceType: SourceType;
  sourcePaths: string[];
  outputDir: string;
  firstN?: number;
  customPages?: string;
  pageRuleMode: PageRuleMode;
  status: TaskStatus;
  createdAt: string;
  // v1.2.0：是否在 PDF 处理完成后生成资料列表展示图。
  // 勾选后，任务流程末尾对 sourcePaths 对应的文件夹生成资料列表图。
  // 仅 sourceType=folder 时有意义；files 模式下忽略此选项。
  generateMaterialList?: boolean;
  // v1.3.0：是否在 PDF 处理完成后合成仿打印效果的图片。
  // 透视贴合 A4 纸 + Multiply 正片叠底 + 随机匹配背景模板。
  // 需要至少一个已标定的背景模板才能生效。
  generatePrintImages?: boolean;
};

// PDF 工作项执行状态。
export type PdfWorkItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "skipped";

// PDF 工作项：执行时由 taskRunner 生成，UI 用于展示进度。
export type PdfWorkItem = {
  taskId: string;
  pdfPath: string;
  pdfName: string;
  totalPages: number;
  selectedPages: number[];
  status: PdfWorkItemStatus;
  errorMessage?: string;
};

// 页级结果。
export type PageResult = {
  taskId: string;
  pdfPath: string;
  pageNumber: number;
  status: "success" | "failed" | "skipped";
  outputPath?: string;
  errorMessage?: string;
};

// 任务摘要：执行结束后生成，用于历史页与汇总。
export type TaskSummary = {
  taskId: string;
  totalPdfCount: number;
  totalPageCount: number;
  successPageCount: number;
  failedPageCount: number;
  startedAt: string;
  finishedAt?: string;
};

// 任务执行结果：taskRunner 处理完一个任务后返回。
// status 为最终状态（completed / completed_with_errors / failed / cancelled）。
export type TaskRunResult = {
  taskId: string;
  status: TaskStatus;
  summary: TaskSummary;
  pageResults: PageResult[];
};

// 历史任务记录：TaskConfig + TaskSummary 合并视图。
export type HistoryTask = {
  config: TaskConfig;
  summary?: TaskSummary;
};

// 日志条目：用于日志查看页。Task 6 中接入 Rust 落盘结果。
export type LogLevel = "info" | "warn" | "error";
export type LogScope = "app" | "task" | "page";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  scope: LogScope;
  message: string;
  taskId?: string;
  pdfPath?: string;
  pageNumber?: number;
};

// 执行阶段标识。
export type StageKind = "pdf_convert" | "material_list" | "print_compose";

// 单个阶段的执行进度。
export type StageProgress = {
  stage: StageKind;
  done: number;
  total: number;
  detail?: string;
};

// 当前执行进度：TaskProgressPanel 展示用。
// 采用阶段管线模型：任务执行拆分为有序阶段，每个阶段独立上报 done/total。
export type ExecutionProgress = {
  taskId: string;
  // 预计算：任务实际会执行的阶段列表（按顺序）
  plannedStages: StageKind[];
  // 当前活跃阶段
  currentStage: StageProgress | null;
  // 已完成阶段
  completedStages: StageKind[];
  // 汇总统计（历史/日志展示用）
  successPages: number;
  failedPages: number;
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待执行",
  running: "执行中",
  paused: "已暂停",
  completed: "已完成",
  completed_with_errors: "部分失败",
  failed: "失败",
  cancelled: "已取消",
};

export const TASK_STATUS_TONE: Record<
  TaskStatus,
  "muted" | "accent" | "success" | "warning" | "danger"
> = {
  pending: "muted",
  running: "accent",
  paused: "warning",
  completed: "success",
  completed_with_errors: "warning",
  failed: "danger",
  cancelled: "muted",
};

// 任务状态迁移规则（spec.md "Requirement: 任务状态机"）。
// - pending → running, cancelled
// - running → paused, cancelled, completed, completed_with_errors, failed
// - paused → running, cancelled
// - completed / completed_with_errors / failed / cancelled → 终态，不再迁移
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
    pending: ["running", "cancelled"],
    running: ["paused", "cancelled", "completed", "completed_with_errors", "failed"],
    paused: ["running", "cancelled"],
    completed: [],
    completed_with_errors: [],
    failed: [],
    cancelled: [],
  };
  return transitions[from].includes(to);
}
