import { useState } from "react";
import { getTasks, deleteTask } from "../services/mockCleanerService";
import { CleanerStatusBadge } from "../components/CleanerStatusBadge";
import { EmptyState } from "../../components/common/EmptyState";
import type { CleanerTask } from "../types";

export default function TaskCenterPage() {
  const [tasks, setTasks] = useState<CleanerTask[]>(() => getTasks());

  function handleDelete(id: string) {
    deleteTask(id);
    setTasks(getTasks());
  }

  // 进度列：completedCount / filesCount
  function renderProgress(task: CleanerTask) {
    if (task.filesCount === 0) return <span className="text-xs text-workspace-muted">—</span>;
    const pct = Math.round((task.completedCount / task.filesCount) * 100);
    const isFinished = task.status === "completed" || task.status === "completed_with_error" || task.status === "cancelled";
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all ${
              isFinished ? "bg-emerald-400" : "bg-indigo-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-workspace-muted">
          {task.completedCount}/{task.filesCount}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-workspace-muted">
          共 {tasks.length} 条记录
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon="search"
            title="暂无任务"
            description="创建一个清理任务，完成后将在此显示。"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-workspace-border/40 bg-slate-50/80 text-xs font-medium text-workspace-muted">
                <th className="px-4 py-3 font-medium">任务名称</th>
                <th className="px-4 py-3 font-medium">文件数</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">进度</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-workspace-border/20 transition-colors last:border-0 hover:bg-slate-50/60"
                >
                  <td className="px-4 py-3 font-medium text-workspace-fg">{task.name}</td>
                  <td className="px-4 py-3 text-workspace-fg-secondary">{task.filesCount}</td>
                  <td className="px-4 py-3">
                    <CleanerStatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-3">{renderProgress(task)}</td>
                  <td className="px-4 py-3">
                    {task.status === "running" || task.status === "waiting" || task.status === "scanning" ? (
                      <button
                        type="button"
                        className="rounded-md border border-workspace-border bg-white px-2.5 py-1 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50"
                      >
                        取消
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        className="rounded-md border border-workspace-border bg-white px-2.5 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50"
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
