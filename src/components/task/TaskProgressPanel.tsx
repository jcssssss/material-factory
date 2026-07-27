import { useTaskStore } from "../../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";
import { EmptyState } from "../common/EmptyState";
import type { LogEntry } from "../../types/task";

export function TaskProgressPanel() {
  const progress = useTaskStore((s) => s.progress);
  const currentTaskId = useTaskStore((s) => s.currentTaskId);
  const queue = useTaskStore((s) => s.queue);
  const recentLogs = useTaskStore(
    useShallow((s) => s.logs.slice(-5) as LogEntry[])
  );
  const pauseTask = useTaskStore((s) => s.pauseTask);
  const resumeTask = useTaskStore((s) => s.resumeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const hasLogs = useTaskStore((s) => s.logs.length > 0);

  const currentTask = currentTaskId
    ? queue.find((t) => t.taskId === currentTaskId)
    : null;

  if (!currentTask || !progress) {
    return (
      <div className="rounded-xl border border-workspace-border/60 bg-workspace-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-workspace-fg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-workspace-accent">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
          </svg>
          执行进度
        </h2>
        <EmptyState
          title="暂无执行中的任务"
          description="加入队列后点击「启动队列」开始串行执行。"
        />
      </div>
    );
  }

  const totalPages = progress.totalPages ?? 0;
  const processed = progress.successPages + progress.failedPages;
  const percent =
    totalPages > 0
      ? Math.min(100, Math.round((processed / totalPages) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-workspace-border/60 bg-workspace-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-workspace-fg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-workspace-accent">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
          </svg>
          执行进度
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-workspace-accent-light px-2.5 py-0.5 text-xs font-medium text-workspace-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-workspace-accent" />
          {currentTask.taskName}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="当前 PDF" value={progress.currentPdfName ?? "—"} />
        <Metric
          label="当前页"
          value={
            progress.currentPage
              ? `${progress.currentPage} / ${totalPages || "?"}`
              : "—"
          }
        />
        <Metric
          label="成功页"
          value={String(progress.successPages)}
          tone="success"
        />
        <Metric
          label="失败页"
          value={String(progress.failedPages)}
          tone="danger"
        />
      </div>

      {progress.printTotal != null && (
        <div className="-mt-1 flex items-center gap-2 rounded-lg border border-workspace-border/50 bg-slate-50/50 px-3.5 py-2.5 shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-indigo-500">
            <path fillRule="evenodd" d="M4 2.5a.5.5 0 01.5-.5h11a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-1zM4 6.5a.5.5 0 01.5-.5h11a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-1zM4 10.5a.5.5 0 01.5-.5h7a.5.5 0 01.5.5v1a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-1zM14.5 10a.5.5 0 01.5.5v3a.5.5 0 01-.5.5h-2a.5.5 0 01-.5-.5v-3a.5.5 0 01.5-.5h2z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-workspace-fg-secondary">仿打印</span>
          <span className="ml-auto text-xs text-workspace-fg">
            {progress.printDone} / {progress.printTotal}
          </span>
          {progress.printDone === progress.printTotal ? (
            <span className="text-xs text-emerald-600">已完成</span>
          ) : (
            <span className="text-xs text-workspace-accent">生成中…</span>
          )}
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-workspace-muted">
          <span>任务进度</span>
          <span className="font-medium text-workspace-fg-secondary">{percent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {(currentTask.status === "running" || currentTask.status === "paused") && (
        <div className="flex items-center gap-2">
          {currentTask.status === "running" && (
            <button
              type="button"
              onClick={() => pauseTask(currentTask.taskId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
              </svg>
              暂停
            </button>
          )}
          {currentTask.status === "paused" && (
            <button
              type="button"
              onClick={() => resumeTask(currentTask.taskId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-workspace-accent shadow-sm transition hover:bg-indigo-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
              继续
            </button>
          )}
          <button
            type="button"
            onClick={() => cancelTask(currentTask.taskId)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-workspace-danger shadow-sm transition hover:bg-red-100"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
            取消
          </button>
        </div>
      )}

      <div className="border-t border-workspace-border/40 pt-3">
        <div className="mb-1.5 text-xs font-medium text-workspace-muted">最近事件</div>
        <ul className="max-h-32 overflow-auto rounded-lg bg-slate-50/60 p-2 text-xs">
          {recentLogs.slice().reverse().map((log, idx) => (
            <li key={idx} className="flex items-center gap-1.5 truncate py-0.5 font-mono text-workspace-fg-secondary" title={log.message}>
              <span className="shrink-0 text-workspace-muted">
                {log.timestamp.slice(11, 19)}
              </span>
              {log.message}
            </li>
          ))}
          {!hasLogs ? (
            <li className="py-0.5 text-workspace-muted">尚未产生日志</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "danger"
      ? "text-red-600"
      : "text-workspace-fg";
  return (
    <div className="rounded-lg border border-workspace-border/50 bg-slate-50/50 px-3.5 py-2.5 shadow-sm">
      <div className="text-xs text-workspace-muted">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold ${valueClass}`} title={value}>
        {value}
      </div>
    </div>
  );
}
