import { useState, useCallback } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { EmptyState } from "../components/common/EmptyState";
import { StatusBadge } from "../components/common/StatusBadge";
import type { HistoryTask } from "../types/task";
import { cn } from "@/lib/utils";

export default function HistoryPage() {
  const history = useTaskStore((s) => s.history);
  const queue = useTaskStore((s) => s.queue);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* ignore */ }
  }, []);

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
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
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
        <div className="overflow-hidden rounded-xl border bg-card shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3 font-medium">任务 ID</th>
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
                    className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => copyId(cfg.taskId)}
                        className="group inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                        title="点击复制任务 ID"
                      >
                        <span className={cn(
                          "truncate max-w-[120px]",
                          copiedId === cfg.taskId && "text-primary"
                        )}>
                          {cfg.taskId}
                        </span>
                        {copiedId === cfg.taskId ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 shrink-0 text-primary">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12a1.5 1.5 0 01.439 1.061V13.5A1.5 1.5 0 0115.5 15H9a1.5 1.5 0 01-1.5-1.5v-1A.75.75 0 017 12h6a.75.75 0 01.75.75v1A1.5 1.5 0 0112.25 15h-3.75A1.5 1.5 0 017 13.5V3.5z" />
                            <path d="M4.5 5A1.5 1.5 0 003 6.5v10A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-.75A.75.75 0 0012 15h-1.5a.75.75 0 01-.75-.75v-.75A.75.75 0 009 12.75H6.75a.75.75 0 01-.75-.75V6.5A1.5 1.5 0 007.5 5h4.5a.75.75 0 01.75.75V8a.75.75 0 01-.75.75H9.75a.75.75 0 00-.75.75v1.5a.75.75 0 01-.75.75H6a.75.75 0 01-.75-.75V6.5A1.5 1.5 0 016.75 5h2.25A.75.75 0 019 5.75V6h1.5v-.25A1.5 1.5 0 009 4.25H6.75A1.5 1.5 0 005.25 5.5v6.75a.75.75 0 01-.75.75H4.5A1.5 1.5 0 013 11.5v-5A1.5 1.5 0 014.5 5h2.25A.75.75 0 017 5.75V6h1.5v-.25A1.5 1.5 0 007 4.25H4.5z" />
                          </svg>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium">{cfg.taskName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatTime(cfg.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sum ? sum.totalPdfCount : cfg.sourcePaths.length}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sum ? sum.totalPageCount : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {sum
                        ? `${sum.successPageCount} / ${sum.failedPageCount}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={cfg.status} />
                    </td>
                    <td
                      className="max-w-[280px] truncate px-4 py-3 text-xs text-muted-foreground"
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
