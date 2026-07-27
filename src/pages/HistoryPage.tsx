import { useTaskStore } from "../store/useTaskStore";
import { EmptyState } from "../components/common/EmptyState";
import { StatusBadge } from "../components/common/StatusBadge";
import type { HistoryTask } from "../types/task";

export default function HistoryPage() {
  const history = useTaskStore((s) => s.history);
  const queue = useTaskStore((s) => s.queue);

  const completedInQueue: HistoryTask[] = queue
    .filter(
      (t) =>
        t.status === "completed" ||
        t.status === "completed_with_errors" ||
        t.status === "failed"
    )
    .filter((t) => !history.some((h) => h.config.taskId === t.taskId))
    .map((config) => ({ config }));

  const rows: HistoryTask[] = [...history, ...completedInQueue];

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-workspace-muted">
            共 {rows.length} 条记录
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="暂无历史任务"
            description="任务执行完成后会在此展示最近任务、输出目录与结果摘要。"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-workspace-border/40 bg-slate-50/80 text-xs font-medium text-workspace-muted">
                <th className="px-4 py-3 font-medium">任务名</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
                <th className="px-4 py-3 font-medium">PDF 数</th>
                <th className="px-4 py-3 font-medium">页数</th>
                <th className="px-4 py-3 font-medium">成功 / 失败</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">输出目录</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cfg = row.config;
                const sum = row.summary;
                return (
                  <tr
                    key={cfg.taskId}
                    className="border-b border-workspace-border/20 transition-colors last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-4 py-3 font-medium text-workspace-fg">
                      {cfg.taskName}
                    </td>
                    <td className="px-4 py-3 text-workspace-fg-secondary">
                      {formatTime(cfg.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-workspace-fg-secondary">
                      {sum ? sum.totalPdfCount : cfg.sourcePaths.length}
                    </td>
                    <td className="px-4 py-3 text-workspace-fg-secondary">
                      {sum ? sum.totalPageCount : "—"}
                    </td>
                    <td className="px-4 py-3 text-workspace-fg-secondary">
                      {sum
                        ? `${sum.successPageCount} / ${sum.failedPageCount}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={cfg.status} />
                    </td>
                    <td
                      className="max-w-[280px] truncate px-4 py-3 text-xs text-workspace-muted"
                      title={cfg.outputDir}
                    >
                      {cfg.outputDir}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
