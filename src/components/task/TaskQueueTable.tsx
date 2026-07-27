import { useTaskStore } from "../../store/useTaskStore";
import { StatusBadge } from "../common/StatusBadge";
import { EmptyState } from "../common/EmptyState";

export function TaskQueueTable() {
  const queue = useTaskStore((s) => s.queue);
  const removeTask = useTaskStore((s) => s.removeTask);
  const clearQueue = useTaskStore((s) => s.clearQueue);
  const pauseTask = useTaskStore((s) => s.pauseTask);
  const resumeTask = useTaskStore((s) => s.resumeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border border-workspace-border/60 bg-workspace-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-workspace-fg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-workspace-accent">
            <path d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" />
            <path d="M19 10a.75.75 0 00-.75-.75H8.56l2.22-2.22a.75.75 0 00-1.06-1.06l-3.5 3.5a.75.75 0 000 1.06l3.5 3.5a.75.75 0 001.06-1.06L8.56 10.75h9.69A.75.75 0 0019 10z" />
          </svg>
          任务队列
        </h2>
        <EmptyState
          title="队列暂无任务"
          description="在左侧表单中创建任务并加入队列后，可在此查看顺序与状态。"
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
      <div className="flex items-center justify-between border-b border-workspace-border/40 px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-workspace-fg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-workspace-accent">
            <path d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" />
            <path d="M19 10a.75.75 0 00-.75-.75H8.56l2.22-2.22a.75.75 0 00-1.06-1.06l-3.5 3.5a.75.75 0 000 1.06l3.5 3.5a.75.75 0 001.06-1.06L8.56 10.75h9.69A.75.75 0 0019 10z" />
          </svg>
          任务队列
          <span className="ml-1 text-xs font-normal text-workspace-muted">
            共 {queue.length} 个
          </span>
        </h2>
        <button
          type="button"
          onClick={clearQueue}
          className="inline-flex items-center gap-1 rounded-lg border border-workspace-border bg-white px-2.5 py-1 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
        >
          清空
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-xs font-medium text-workspace-muted">
            <tr>
              <th className="px-4 py-3 font-medium">序号</th>
              <th className="px-4 py-3 font-medium">任务名</th>
              <th className="px-4 py-3 font-medium">来源</th>
              <th className="px-4 py-3 font-medium">PDF 数</th>
              <th className="px-4 py-3 font-medium">页码规则</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((task, idx) => (
              <tr
                key={task.taskId}
                className="border-b border-workspace-border/20 transition-colors last:border-0 hover:bg-slate-50/60"
              >
                <td className="px-4 py-3 text-workspace-muted">{idx + 1}</td>
                <td className="px-4 py-3 font-medium text-workspace-fg">
                  {task.taskName}
                </td>
                <td className="px-4 py-3 text-workspace-fg-secondary">
                  {task.sourceType === "folder" ? "文件夹" : "文件"}
                </td>
                <td className="px-4 py-3 text-workspace-fg-secondary">
                  {task.sourcePaths.length}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-workspace-fg-secondary">
                  {formatPageRule(task)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={task.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {task.status === "running" && (
                      <ActionButton onClick={() => pauseTask(task.taskId)}>
                        暂停
                      </ActionButton>
                    )}
                    {task.status === "paused" && (
                      <ActionButton onClick={() => resumeTask(task.taskId)} className="text-workspace-accent">
                        继续
                      </ActionButton>
                    )}
                    {(task.status === "running" || task.status === "paused") && (
                      <ActionButton onClick={() => cancelTask(task.taskId)} className="text-workspace-danger">
                        取消
                      </ActionButton>
                    )}
                    {(task.status === "pending" ||
                      task.status === "completed" ||
                      task.status === "completed_with_errors" ||
                      task.status === "failed" ||
                      task.status === "cancelled") && (
                      <ActionButton onClick={() => removeTask(task.taskId)}>
                        移除
                      </ActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  className = "text-workspace-fg-secondary",
  children,
}: {
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium transition hover:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}

function formatPageRule(task: {
  pageRuleMode: string;
  firstN?: number;
  customPages?: string;
}): string {
  if (task.pageRuleMode === "firstN") {
    return task.firstN ? `前 ${task.firstN} 页` : "—";
  }
  if (task.pageRuleMode === "custom") {
    return task.customPages || "—";
  }
  return [
    task.firstN ? `前 ${task.firstN}` : null,
    task.customPages || null,
  ]
    .filter(Boolean)
    .join(" + ");
}
