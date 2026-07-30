import { create } from "zustand";
import type {
  TaskConfig,
  ExecutionProgress,
  HistoryTask,
  LogEntry,
  TaskStatus,
} from "../types/task";
import {
  saveHistory,
  clearPersistedHistory,
  clearPersistedLogs,
  removePersistedBreakpoint,
} from "../lib/persistence";
import type { TaskBreakpoint } from "../lib/persistence";
import { TaskController } from "../lib/taskController";
import { canTransition } from "../types/task";

// 任务队列 UI Store。
// Task 2 提供 UI 操作；Task 3 接入 taskRunner 执行器；Task 6 接入持久化：
//   - history：localStorage 持久化（应用重启后保留）
//   - logs：内存 + Rust 文件双写；clearLogs 同步清盘
//   - queue：不持久化，应用重启后为空（v1.0 约束；v1.1.0 已放宽为提供恢复入口，但 queue 本身仍不持久化，恢复逻辑通过 Task 3 的断点持久化实现）

type TaskStoreState = {
  // 当前队列
  queue: TaskConfig[];
  // 当前执行任务（由 taskRunner 设置）
  currentTaskId: string | null;
  progress: ExecutionProgress | null;
  // 当前任务控制器（运行时信号桥接，不持久化）
  currentController: TaskController | null;
  // 历史任务（Task 6 接入 localStorage 持久化）
  history: HistoryTask[];
  // 日志（Task 6 接入 Rust 落盘；内存用于 UI 实时展示）
  logs: LogEntry[];
  // 日志是否已完成首次磁盘加载（避免重复加载）
  logsLoaded: boolean;
  // 表单草稿（TaskForm 编辑中、尚未加入队列的任务）
  draft: Partial<TaskConfig>;
  // PDF 级断点（运行时 + localStorage 持久化）
  // key 为 taskId，便于 O(1) 查找。应用启动时从 localStorage 加载。
  breakpoints: Record<string, TaskBreakpoint>;

  // 表单草稿操作
  setDraft: (patch: Partial<TaskConfig>) => void;
  resetDraft: () => void;

  // 队列操作
  enqueueTask: (task: TaskConfig) => void;
  removeTask: (taskId: string) => void;
  clearQueue: () => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;

  // 执行占位（Task 3 中由 taskRunner 接管）
  setProgress: (progress: ExecutionProgress | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  // 运行时控制
  setController: (controller: TaskController | null) => void;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  appendLog: (entry: LogEntry) => void;
  appendLogs: (entries: LogEntry[]) => void;
  // 用磁盘加载的日志覆盖内存（应用启动时调用）。
  setLogs: (entries: LogEntry[]) => void;
  clearLogs: () => void;

  // 历史
  addHistory: (task: HistoryTask) => void;
  // 用 localStorage 加载的历史覆盖内存（应用启动时调用）。
  setHistory: (history: HistoryTask[]) => void;
  clearHistory: () => void;

  // 断点恢复操作
  setBreakpoints: (breakpoints: Record<string, TaskBreakpoint>) => void;
  removeBreakpoint: (taskId: string) => void;
  resumeTaskFromBreakpoint: (taskId: string) => void;
  abandonTask: (taskId: string) => void;
};

function nextId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  queue: [],
  currentTaskId: null,
  progress: null,
  currentController: null,
  history: [],
  logs: [],
  logsLoaded: false,
  draft: {
    taskName: "",
    sourceType: "folder",
    sourcePaths: [],
    outputDir: "",
    pageRuleMode: "firstN",
    firstN: 2,
    customPages: "",
    generateMaterialList: true,
    generatePrintImages: true,
  },
  breakpoints: {},

  setDraft: (patch) =>
    set((s) => ({ draft: { ...s.draft, ...patch } })),

  resetDraft: () =>
    set((s) => ({
      draft: {
        ...s.draft,
        taskName: "",
        sourcePaths: [],
      },
    })),

  enqueueTask: (task) => set((s) => ({ queue: [...s.queue, task] })),

  removeTask: (taskId) =>
    set((s) => ({ queue: s.queue.filter((t) => t.taskId !== taskId) })),

  clearQueue: () => set({ queue: [] }),

  updateTaskStatus: (taskId, status) =>
    set((s) => ({
      queue: s.queue.map((t) =>
        t.taskId === taskId ? { ...t, status } : t
      ),
    })),

  setProgress: (progress) => set({ progress }),

  setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),

  setController: (controller) => set({ currentController: controller }),

  pauseTask: (taskId) => {
    const { currentController, currentTaskId, queue } = get();
    if (!currentController || currentTaskId !== taskId) return;
    const task = queue.find((t) => t.taskId === taskId);
    if (!task || !canTransition(task.status, "paused")) return;
    currentController.pause();
    set((s) => ({
      queue: s.queue.map((t) =>
        t.taskId === taskId ? { ...t, status: "paused" } : t
      ),
    }));
  },

  resumeTask: (taskId) => {
    const { currentController, currentTaskId, queue } = get();
    if (!currentController || currentTaskId !== taskId) return;
    const task = queue.find((t) => t.taskId === taskId);
    if (!task || !canTransition(task.status, "running")) return;
    currentController.resume();
    set((s) => ({
      queue: s.queue.map((t) =>
        t.taskId === taskId ? { ...t, status: "running" } : t
      ),
    }));
  },

  cancelTask: (taskId) => {
    const { currentController, currentTaskId, queue } = get();
    if (!currentController || currentTaskId !== taskId) return;
    const task = queue.find((t) => t.taskId === taskId);
    if (!task || !canTransition(task.status, "cancelled")) return;
    currentController.cancel();
    // 立即更新队列状态，提供即时反馈。
    // taskRunner 检测到 cancel 后也会通过 runTask 返回值更新状态，
    // 但会与这里的值一致，无竞争风险。
    set((s) => ({
      queue: s.queue.map((t) =>
        t.taskId === taskId ? { ...t, status: "cancelled" as TaskStatus } : t
      ),
    }));
  },

  appendLog: (entry) =>
    set((s) => ({ logs: [...s.logs, entry] })),

  appendLogs: (entries) =>
    set((s) => ({ logs: [...s.logs, ...entries] })),

  setLogs: (entries) => set({ logs: entries, logsLoaded: true }),

  clearLogs: () => {
    set({ logs: [] });
    // 同步清空磁盘日志文件，保证 UI 与磁盘一致。
    void clearPersistedLogs();
  },

  addHistory: (task) => {
    const next = [task, ...get().history].slice(0, 200);
    set({ history: next });
    // 同步写入 localStorage，保证应用重启后可恢复。
    saveHistory(next);
  },

  setHistory: (history) => set({ history }),

  clearHistory: () => {
    set({ history: [] });
    clearPersistedHistory();
  },

  setBreakpoints: (breakpoints) => set({ breakpoints }),

  // 从 store 和 localStorage 中删除断点（任务终态时调用）。
  removeBreakpoint: (taskId) => {
    removePersistedBreakpoint(taskId);
    set((s) => {
      const next = { ...s.breakpoints };
      delete next[taskId];
      return { breakpoints: next };
    });
  },

  // 继续未完成任务：将任务以 pending 状态加入队列，断点保留供 runQueue 使用。
  // 断点在任务到达终态后由 runQueue 自动清理。
  // 注意：与运行时 resumeTask（恢复 paused→running，走 TaskController）区分，
  // 本 action 专用于应用重启后从 PDF 级断点继续。
  resumeTaskFromBreakpoint: (taskId) => {
    const bp = get().breakpoints[taskId];
    if (!bp) return;
    set((s) => ({
      queue: [...s.queue, { ...bp.taskConfig, status: "pending" as TaskStatus }],
    }));
  },

  // 放弃未完成任务：标记为 cancelled，写入历史，清理断点。
  // 已导出的文件保留在输出目录，不回滚（spec.md "放弃未完成任务"）。
  abandonTask: (taskId) => {
    const bp = get().breakpoints[taskId];
    if (!bp) return;

    // 汇总所有 PDF 的页结果
    const allPageResults = bp.pdfs.flatMap((p) => p.pageResults);
    const successCount = allPageResults.filter((r) => r.status === "success").length;
    const failedCount = allPageResults.filter((r) => r.status === "failed").length;

    get().addHistory({
      config: { ...bp.taskConfig, status: "cancelled" },
      summary: {
        taskId,
        totalPdfCount: bp.pdfs.length,
        totalPageCount: allPageResults.filter(
          (r) => r.status !== "skipped" || r.pageNumber > 0
        ).length,
        successPageCount: successCount,
        failedPageCount: failedCount,
        startedAt: bp.startedAt,
        finishedAt: new Date().toISOString(),
      },
    });

    get().removeBreakpoint(taskId);
  },
}));

// 创建新任务时分配稳定 ID 的工具函数。
export function createTaskId(): string {
  return nextId();
}
