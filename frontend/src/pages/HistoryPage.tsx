import { useState, useCallback, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import { useTaskStore } from "../store/useTaskStore";
import { EmptyState } from "../components/common/EmptyState";
import { Tip } from "../components/common/Tip";
import { StatusBadge } from "../components/common/StatusBadge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../components/ui/table";
import InfiniteScrollSentinel from "../components/common/InfiniteScrollSentinel";
import { useInfiniteScroll } from "../lib/useInfiniteScroll";
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

  const rows = useMemo<HistoryTask[]>(() => {
    const completedInQueue: HistoryTask[] = queue
      .filter(
        (t) =>
          t.status === "completed" ||
          t.status === "completed_with_errors" ||
          t.status === "failed"
      )
      .filter((t) => !history.some((h) => h.config.taskId === t.taskId))
      .map((config) => ({ config }));
    return [...history, ...completedInQueue];
  }, [history, queue]);

  const { visibleItems: visibleRows, hasMore, sentinelRef } =
    useInfiniteScroll(rows, 20);

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
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>任务 ID</TableHead>
                  <TableHead>任务名</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>PDF 数</TableHead>
                  <TableHead>页数</TableHead>
                  <TableHead>成功 / 失败</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>输出目录</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const cfg = row.config;
                  const sum = row.summary;
                  return (
                    <TableRow key={cfg.taskId}>
                      <TableCell>
                        <Tip
                          label={<span className="font-mono">{cfg.taskId}</span>}
                          onlyOverflow
                        >
                          <button
                            type="button"
                            onClick={() => copyId(cfg.taskId)}
                            className="group inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary transition-colors"
                          >
                            <span className={cn(
                              "truncate max-w-[120px]",
                              copiedId === cfg.taskId && "text-primary"
                            )}>
                              {cfg.taskId}
                            </span>
                            {copiedId === cfg.taskId ? (
                              <Check className="h-3 w-3 shrink-0 text-primary" />
                            ) : (
                              <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </button>
                        </Tip>
                      </TableCell>
                      <TableCell className="font-medium">
                        <Tip label={cfg.taskName} onlyOverflow>
                          <span className="block max-w-40 truncate">{cfg.taskName}</span>
                        </Tip>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatTime(cfg.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sum ? sum.totalPdfCount : cfg.sourcePaths.length}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sum ? sum.totalPageCount : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sum
                          ? `${sum.successPageCount} / ${sum.failedPageCount}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={cfg.status} />
                      </TableCell>
                      <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                        <Tip label={cfg.outputDir} onlyOverflow>
                          <span className="block truncate">{cfg.outputDir}</span>
                        </Tip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <InfiniteScrollSentinel ref={sentinelRef} hasMore={hasMore} />
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
