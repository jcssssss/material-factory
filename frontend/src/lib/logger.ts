// 前端日志收集器。
// Task 6 起：
//   - 内存：写入 store.logs，供日志页与进度面板实时展示
//   - 落盘：异步调用 Rust append_log_line 写入 {app_data_dir}/logs/app.log
//
// 日志规范：
//   - 应用级 (scope=app)：应用启动、队列开始/结束、异常
//   - 任务级 (scope=task)：任务开始/结束、PDF 开始/结束、状态变更、资料列表生成
//   - 页级 (scope=page)：单页成功/失败、页码超范围警告

import { useTaskStore } from "../store/useTaskStore";
import { appendLogToDisk } from "./persistence";
import type { LogLevel, LogScope, LogEntry } from "../types/task";

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 日志批量缓冲：避免每页处理时多次 appendLog 触发 store 更新导致 UI 全量重渲染。
// 之前每页 PDF 处理会触发 3-5 次 appendLog（taskInfo/pageInfo/pageError），
// 每次 appendLog 都同步更新 store.logs 数组并触发所有订阅组件重渲染。
// 当 logs 累积到几百条时，每页处理都触发 O(n) 重渲染，主线程被 React 占满。
//
// 优化：用 microtask 合并同一事件循环内的多次 append 为一次 store 更新。
let pendingEntries: LogEntry[] = [];
let flushScheduled = false;

function flushPendingEntries(): void {
  flushScheduled = false;
  if (pendingEntries.length === 0) return;
  const entries = pendingEntries;
  pendingEntries = [];
  useTaskStore.getState().appendLogs(entries);
  for (const entry of entries) {
    void appendLogToDisk(entry);
  }
}

function append(
  level: LogLevel,
  scope: LogScope,
  message: string,
  ctx?: {
    taskId?: string;
    pdfPath?: string;
    pageNumber?: number;
  }
): void {
  const entry: LogEntry = {
    timestamp: now(),
    level,
    scope,
    message,
    ...ctx,
  };

  // 写入缓冲队列，microtask 内合并刷新到 store（避免每条日志都触发重渲染）。
  pendingEntries.push(entry);
  if (!flushScheduled) {
    flushScheduled = true;
    // queueMicrotask 在当前同步代码全部执行完毕后、下一个事件循环之前执行，
    // 合并同一事件循环内的所有日志为一次 store 更新。
    queueMicrotask(flushPendingEntries);
  }
}

export const logger = {
  appInfo(message: string) {
    append("info", "app", message);
  },
  appWarn(message: string) {
    append("warn", "app", message);
  },
  appError(message: string) {
    append("error", "app", message);
  },

  taskInfo(taskId: string, message: string) {
    append("info", "task", message, { taskId });
  },
  taskWarn(taskId: string, message: string) {
    append("warn", "task", message, { taskId });
  },
  taskError(taskId: string, message: string) {
    append("error", "task", message, { taskId });
  },

  pageInfo(taskId: string, pdfPath: string, pageNumber: number, message: string) {
    append("info", "page", message, { taskId, pdfPath, pageNumber });
  },
  pageWarn(taskId: string, pdfPath: string, pageNumber: number, message: string) {
    append("warn", "page", message, { taskId, pdfPath, pageNumber });
  },
  pageError(taskId: string, pdfPath: string, pageNumber: number, message: string) {
    append("error", "page", message, { taskId, pdfPath, pageNumber });
  },
};
