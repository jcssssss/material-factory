import { useTaskStore } from "../../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";
import { EmptyState } from "../common/EmptyState";
import type { LogEntry, StageKind } from "../../types/task";

const STAGE_LABELS: Record<StageKind, string> = {
  pdf_convert: "PDF 转换",
  material_list: "资料列表图",
  print_compose: "仿打印合成",
};

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

  if (!progress) {
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

  // 通过 progress.taskId 查找对应任务，而非依赖 currentTaskId。
  // 这样在任务间过渡时（currentTaskId 已清空但终态 progress 仍在）不会留白。
  const task = queue.find((t) => t.taskId === progress.taskId) ?? null;
  const isComplete =
    !progress.currentStage &&
    progress.completedStages.length === progress.plannedStages.length;

  const overallPercent = progress.plannedStages.length > 0
    ? Math.round(
        (progress.completedStages.length +
          (progress.currentStage
            ? progress.currentStage.done / Math.max(1, progress.currentStage.total)
            : 0)
        ) / progress.plannedStages.length * 100
      )
    : 0;

  // 是否有下一个待执行任务（用于完成态提示）
  const hasNextPending = currentTaskId === null && queue.some((t) => t.status === "pending");

  const isRunning = task?.status === "running";
  const isPaused = task?.status === "paused";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-workspace-border/60 bg-workspace-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-workspace-fg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-workspace-accent">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
          </svg>
          执行进度
        </h2>
        {task ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isComplete
              ? "bg-emerald-50 text-emerald-700"
              : "bg-workspace-accent-light text-workspace-accent"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              isComplete ? "bg-emerald-500" : "bg-workspace-accent"
            }`} />
            {task.taskName}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
            {progress.taskId}
          </span>
        )}
      </div>

      {/* 阶段管线指示器 */}
      <div className="flex items-center gap-2 overflow-x-auto">
        {progress.plannedStages.map((stage, i) => {
          const isStageCompleted = progress.completedStages.includes(stage);
          const isCurrent = progress.currentStage?.stage === stage;
          return (
            <div key={stage} className="flex items-center gap-2">
              {i > 0 && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-workspace-muted/50">
                  <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
              )}
              <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shrink-0 ${
                isStageCompleted
                  ? "bg-emerald-50 text-emerald-700"
                  : isCurrent
                  ? "bg-indigo-50 text-indigo-700"
                  : "bg-slate-100 text-slate-400"
              }`}>
                {isStageCompleted ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-emerald-500">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                ) : isCurrent ? (
                  <span className="h-2 w-2 rounded-full bg-indigo-500" />
                ) : (
                  <span className="h-2 w-2 rounded-full border border-current" />
                )}
                <span>{STAGE_LABELS[stage]}</span>
                {isCurrent && progress.currentStage && progress.currentStage.total > 0 && (
                  <span className="text-indigo-500">
                    {progress.currentStage.done}/{progress.currentStage.total}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 当前阶段详情 / 完成提示 */}
      {isComplete ? (
        <div className="-mt-1 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-emerald-500">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          <span className="font-medium text-emerald-700">任务完成</span>
          <span className="text-emerald-600">
            {hasNextPending ? "— 正在准备下一个任务…" : "— 队列空闲"}
          </span>
        </div>
      ) : progress.currentStage?.detail ? (
        <div className="-mt-1 text-xs text-workspace-muted">
          {progress.currentStage.detail}
        </div>
      ) : null}

      {/* 整体进度条 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-workspace-muted">
          <span>整体进度</span>
          <span className="font-medium text-workspace-fg-secondary">{overallPercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isComplete
                ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                : "bg-gradient-to-r from-indigo-500 to-indigo-400"
            }`}
            style={{ width: `${overallPercent}%` }}
          />
        </div>
      </div>

      {/* 汇总统计（PDF 转换完成后展示） */}
      {progress.completedStages.includes("pdf_convert") && (
        <div className="-mt-2 grid grid-cols-2 gap-2 text-sm">
          <span className="text-xs text-workspace-muted">
            成功 <span className="font-semibold text-emerald-600">{progress.successPages}</span> 页
          </span>
          <span className="text-xs text-workspace-muted">
            失败 <span className={`font-semibold ${progress.failedPages > 0 ? "text-red-600" : "text-slate-400"}`}>{progress.failedPages}</span> 页
          </span>
        </div>
      )}

      {(isRunning || isPaused) && task && !isComplete && (
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              type="button"
              onClick={() => pauseTask(task.taskId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
              </svg>
              暂停
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              onClick={() => resumeTask(task.taskId)}
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
            onClick={() => cancelTask(task.taskId)}
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
