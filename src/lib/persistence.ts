// 本地持久化层：历史任务走 localStorage，日志走 Rust 文件落盘。
//
// 与 spec.md Requirement: 本地持久化与日志 对齐：
//   - 完全在本地保存最近任务、任务输入参数、输出目录、执行状态、应用级日志和任务级错误日志
//   - Scenario: 应用重启后查看历史 → 保留最近任务元数据和日志，但不自动恢复未完成执行
//
// 设计：
//   - 历史任务（TaskConfig + TaskSummary）：localStorage 单键存储，最多 200 条
//   - 日志（LogEntry）：JSONL 写入 {app_data_dir}/logs/app.log，由 Rust 命令管理
//   - 队列：不持久化，应用重启后队列为空；v1.1.0 通过 PDF 级断点（breakpoints）提供恢复入口，由用户确认后从断点继续。

import { invoke } from "@tauri-apps/api/core";
import type { HistoryTask, LogEntry } from "../types/task";
import type { PageResult, TaskConfig } from "../types/task";

const HISTORY_KEY = "xhs-pic:history";
const MAX_HISTORY = 200;
// 内存与磁盘加载时最多保留最近 N 条日志，避免长时间运行后内存爆炸。
const MAX_LOGS_TO_LOAD = 2000;

// ─── PDF 级断点（localStorage）───

// 单个 PDF 的断点记录。
// - completed=true 表示该 PDF 全部页已处理完毕（含转换失败），恢复时跳过
// - completed=false 表示该 PDF 尚未完成，恢复时从起始页重新处理
// - pageResults 存储该 PDF 已产生的页结果
export type PdfBreakpoint = {
  // 展示路径（Word 原路径或 PDF 路径，用于日志和历史）
  originalPath: string;
  // 实际处理路径（Word 转换后的缓存路径或 PDF 路径；转换失败时为空字符串）
  resolvedPdfPath: string;
  // 该 PDF 是否已全部处理完毕
  completed: boolean;
  // 该 PDF 的页结果（成功/失败/跳过）
  pageResults: PageResult[];
};

// 任务级断点：包含完整任务配置 + 各 PDF 进度。
export type TaskBreakpoint = {
  taskId: string;
  // 任务配置快照（恢复时用于重建任务）
  taskConfig: TaskConfig;
  // 任务开始时间（恢复时沿用，使历史记录显示完整时长）
  startedAt: string;
  // 断点最后更新时间
  lastUpdatedAt: string;
  // 各 PDF 的断点记录（按任务内顺序排列）
  pdfs: PdfBreakpoint[];
};

// ─── 历史任务（localStorage）───

export function loadPersistedHistory(): HistoryTask[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 简单结构校验：每条至少要有 config.taskId。
    return parsed.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        item.config &&
        typeof item.config.taskId === "string"
    ) as HistoryTask[];
  } catch {
    return [];
  }
}

export function saveHistory(history: HistoryTask[]): void {
  try {
    const trimmed = history.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage 不可用（隐私模式 / 配额超限）时静默忽略，不阻断 UI。
  }
}

export function clearPersistedHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* 静默忽略 */
  }
}

// ─── PDF 级断点（localStorage）───

const BREAKPOINTS_KEY = "xhs-pic:breakpoints";

// 加载所有持久化断点。损坏数据静默跳过。
export function loadBreakpoints(): TaskBreakpoint[] {
  try {
    const raw = localStorage.getItem(BREAKPOINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is TaskBreakpoint =>
        item &&
        typeof item === "object" &&
        typeof item.taskId === "string" &&
        item.taskConfig &&
        typeof item.taskConfig.taskId === "string" &&
        Array.isArray(item.pdfs)
    );
  } catch {
    return [];
  }
}

// 保存或更新单个断点（按 taskId 去重）。
export function saveBreakpoint(bp: TaskBreakpoint): void {
  try {
    const all = loadBreakpoints();
    const idx = all.findIndex((b) => b.taskId === bp.taskId);
    if (idx >= 0) {
      all[idx] = bp;
    } else {
      all.push(bp);
    }
    localStorage.setItem(BREAKPOINTS_KEY, JSON.stringify(all));
  } catch {
    // localStorage 不可用时静默忽略，不阻断任务执行。
  }
}

// 从磁盘删除指定任务的断点。
export function removePersistedBreakpoint(taskId: string): void {
  try {
    const all = loadBreakpoints();
    const filtered = all.filter((b) => b.taskId !== taskId);
    localStorage.setItem(BREAKPOINTS_KEY, JSON.stringify(filtered));
  } catch {
    /* 静默忽略 */
  }
}

// ─── 日志（Rust 文件落盘）───

// 异步追加单条日志到 Rust 文件。失败时静默，不阻断 UI 与任务执行。
export async function appendLogToDisk(entry: LogEntry): Promise<void> {
  try {
    await invoke<void>("append_log_line", {
      line: JSON.stringify(entry),
    });
  } catch {
    // 落盘失败不阻断；内存日志仍可展示当前会话事件。
  }
}

// 加载磁盘日志为 LogEntry[]。
// 按行解析 JSONL，跳过损坏行；最多返回最近 MAX_LOGS_TO_LOAD 条。
export async function loadPersistedLogs(): Promise<LogEntry[]> {
  try {
    const content = await invoke<string>("read_log_file");
    if (!content) return [];
    const lines = content.split("\n").filter(Boolean);
    const tail = lines.slice(-MAX_LOGS_TO_LOAD);
    const entries: LogEntry[] = [];
    for (const line of tail) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (
          entry &&
          typeof entry.timestamp === "string" &&
          typeof entry.level === "string" &&
          typeof entry.scope === "string"
        ) {
          entries.push(entry);
        }
      } catch {
        // 跳过损坏行。
      }
    }
    return entries;
  } catch {
    // Rust 命令不可用（如非 Tauri 环境）时返回空。
    return [];
  }
}

// 清空磁盘日志文件。与 store.clearLogs 配合。
export async function clearPersistedLogs(): Promise<void> {
  try {
    await invoke<void>("clear_log_file");
  } catch {
    /* 清空失败不阻断 UI */
  }
}
