import { useTaskStore } from "../../store/useTaskStore";
import { StatusBadge } from "../common/StatusBadge";
import { Tip } from "../common/Tip";
import { EmptyState } from "../common/EmptyState";
import { Button } from "../ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { useNavigate } from "react-router-dom";
import { ArrowRightFromLine, Copy, Check, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useCallback } from "react";

export function TaskQueueTable({ onStart, blockStart, isRunning, hasPending }: {
  onStart?: () => void;
  blockStart?: boolean;
  isRunning?: boolean;
  hasPending?: boolean;
}) {
  const queue = useTaskStore((s) => s.queue);
  const removeTask = useTaskStore((s) => s.removeTask);
  const clearQueue = useTaskStore((s) => s.clearQueue);
  const pauseTask = useTaskStore((s) => s.pauseTask);
  const resumeTask = useTaskStore((s) => s.resumeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyTaskId = useCallback(async (taskId: string) => {
    try {
      await navigator.clipboard.writeText(taskId);
      setCopiedId(taskId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // clipboard not available
    }
  }, []);

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-primary">
              <path d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" />
              <path d="M19 10a.75.75 0 00-.75-.75H8.56l2.22-2.22a.75.75 0 00-1.06-1.06l-3.5 3.5a.75.75 0 000 1.06l3.5 3.5a.75.75 0 001.06-1.06L8.56 10.75h9.69A.75.75 0 0019 10z" />
            </svg>
            任务队列
          </h2>
        </div>
        <EmptyState
          title="队列暂无任务"
          description="在左侧表单中创建任务并加入队列后，可在此查看顺序与状态。"
        />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ArrowRightFromLine className="h-4 w-4 text-primary" />
            任务队列
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              共 {queue.length} 个
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={clearQueue}
              disabled={isRunning}
              title={isRunning ? "任务执行中不可清空队列" : undefined}
            >
              清空
            </Button>
            <Button
              onClick={onStart}
              disabled={!hasPending || isRunning || blockStart}
              title={blockStart ? "未检测到 LibreOffice，含 Word 任务无法启动" : undefined}
              size="sm"
            >
              {isRunning ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  执行中…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  启动队列
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-24">任务 ID</TableHead>
                <TableHead className="w-40">任务名</TableHead>
                <TableHead>页数</TableHead>
                <TableHead>页码规则</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((task) => (
                <TableRow key={task.taskId}>
                  <TableCell>
                    <Tip
                      label={<span className="font-mono">{task.taskId}</span>}
                      onlyOverflow
                    >
                      <button
                        type="button"
                        onClick={() => copyTaskId(task.taskId)}
                        className="group inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        <span className={cn(
                          "truncate max-w-[60px]",
                          copiedId === task.taskId && "text-primary"
                        )}>
                          {task.taskId}
                        </span>
                        {copiedId === task.taskId ? (
                          <Check className="h-3 w-3 shrink-0 text-primary" />
                        ) : (
                          <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </button>
                    </Tip>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Tip label={task.taskName} onlyOverflow>
                      <span className="block max-w-40 truncate">{task.taskName}</span>
                    </Tip>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.totalPages ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatPageRule(task)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={task.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ActionButton
                        onClick={() => navigate(`/logs?taskId=${task.taskId}`)}
                        className="text-muted-foreground"
                      >
                        日志
                      </ActionButton>
                      {task.status === "running" && (
                        <ActionButton onClick={() => pauseTask(task.taskId)}>
                          暂停
                        </ActionButton>
                      )}
                      {task.status === "paused" && (
                        <ActionButton onClick={() => resumeTask(task.taskId)} className="text-primary">
                          继续
                        </ActionButton>
                      )}
                      {(task.status === "running" || task.status === "paused") && (
                        <ActionButton onClick={() => cancelTask(task.taskId)} className="text-destructive">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );


}

function ActionButton({
  onClick,
  className = "text-muted-foreground",
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
      className={cn("text-xs font-medium transition hover:opacity-80", className)}
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
