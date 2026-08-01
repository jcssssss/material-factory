import { useTaskStore } from "../../store/useTaskStore";
import { StatusBadge } from "../common/StatusBadge";
import { EmptyState } from "../common/EmptyState";
import { Button } from "../ui/button";
import { useNavigate } from "react-router-dom";
import { ArrowRightFromLine, Play } from "lucide-react";
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
            <Button variant="outline" size="sm" onClick={clearQueue}>
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
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs font-medium text-muted-foreground">
                <th className="w-24 px-4 py-3 font-medium">任务 ID</th>
                <th className="px-4 py-3 font-medium">任务名</th>
                <th className="px-4 py-3 font-medium">来源</th>
                <th className="px-4 py-3 font-medium">页数</th>
                <th className="px-4 py-3 font-medium">页码规则</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((task, _idx) => (
                <tr
                  key={task.taskId}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => copyTaskId(task.taskId)}
                      className="group inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="点击复制任务 ID"
                    >
                      <span className={cn(
                        "truncate max-w-[60px]",
                        copiedId === task.taskId && "text-primary"
                      )}>
                        {task.taskId}
                      </span>
                      {copiedId === task.taskId ? (
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
                  <td className="px-4 py-3 font-medium">{task.taskName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {task.sourceType === "folder" ? "文件夹" : "文件"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {task.totalPages ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {formatPageRule(task)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-3">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
