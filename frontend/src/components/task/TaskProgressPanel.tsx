import { useTaskStore } from "../../store/useTaskStore";
import { useShallow } from "zustand/react/shallow";
import { EmptyState } from "../common/EmptyState";
import { Tip } from "../common/Tip";
import type { LogEntry, StageKind } from "../../types/task";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Circle, CircleCheck, ArrowRight, Play, Pause, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGE_LABELS: Record<StageKind, string> = {
  word_convert: "Word 转换",
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
      <div className="rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Circle className="h-4 w-4 text-primary" />
            执行进度
          </h2>
        </div>
        <EmptyState
          title="暂无执行中的任务"
          description="加入队列后点击「启动队列」开始串行执行。"
        />
      </div>
    );
  }

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

  const hasNextPending = currentTaskId === null && queue.some((t) => t.status === "pending");

  const isRunning = task?.status === "running";
  const isPaused = task?.status === "paused";

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Circle className="h-4 w-4 text-primary" />
          执行进度
        </h2>
        {task ? (
          <Badge className={cn(
            "gap-1.5 px-2.5 py-0.5 text-xs font-medium border-0",
            isComplete
              ? "bg-emerald-50 text-emerald-700"
              : "bg-primary/10 text-primary"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", isComplete ? "bg-emerald-500" : "bg-primary")} />
            {task.taskName}
          </Badge>
        ) : (
          <Badge variant="secondary" className="px-2.5 py-0.5 text-xs font-medium">
            {progress.taskId}
          </Badge>
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
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <div className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shrink-0",
                isStageCompleted && "bg-emerald-50 text-emerald-700",
                isCurrent && !isStageCompleted && "bg-primary/10 text-primary",
                !isStageCompleted && !isCurrent && "bg-muted text-muted-foreground"
              )}>
                {isStageCompleted ? (
                  <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
                ) : isCurrent ? (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                ) : (
                  <span className="h-2 w-2 rounded-full border border-current" />
                )}
                <span>{STAGE_LABELS[stage]}</span>
                {isCurrent && progress.currentStage && progress.currentStage.total > 0 && (
                  <span className="text-primary">
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
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          <span className="font-medium text-emerald-700">任务完成</span>
          <span className="text-emerald-600">
            {hasNextPending ? "— 正在准备下一个任务…" : "— 队列空闲"}
          </span>
        </div>
      ) : progress.currentStage?.detail ? (
        <div className="text-xs text-muted-foreground">
          {progress.currentStage.detail}
        </div>
      ) : null}

      {/* 整体进度条 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>整体进度</span>
          <span className="font-medium text-foreground/70">{overallPercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isComplete
                ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                : "bg-gradient-to-r from-primary to-primary/70"
            )}
            style={{ width: `${overallPercent}%` }}
          />
        </div>
      </div>

      {/* 汇总统计 */}
      {progress.completedStages.includes("pdf_convert") && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-xs text-muted-foreground">
            成功 <span className="font-semibold text-emerald-600">{progress.successPages}</span> 页
          </span>
          <span className="text-xs text-muted-foreground">
            失败 <span className={cn("font-semibold", progress.failedPages > 0 ? "text-destructive" : "text-muted-foreground/50")}>{progress.failedPages}</span> 页
          </span>
        </div>
      )}

      {(isRunning || isPaused) && task && !isComplete && (
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button variant="outline" size="sm" onClick={() => pauseTask(task.taskId)}>
              <Pause className="h-3.5 w-3.5" />
              暂停
            </Button>
          )}
          {isPaused && (
            <Button variant="outline" size="sm" onClick={() => resumeTask(task.taskId)} className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10">
              <Play className="h-3.5 w-3.5" />
              继续
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => cancelTask(task.taskId)} className="border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10">
            <XCircle className="h-3.5 w-3.5" />
            取消
          </Button>
        </div>
      )}

      <div className="border-t pt-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">最近事件</div>
        <ul className="max-h-32 overflow-auto rounded-lg bg-muted/30 p-2 text-xs">
          {recentLogs.slice().reverse().map((log, idx) => (
            <Tip key={idx} label={log.message} onlyOverflow>
              <li className="flex items-center gap-1.5 truncate py-0.5 font-mono text-muted-foreground">
                <span className="shrink-0 text-muted-foreground/50">
                  {log.timestamp}
                </span>
                {log.message}
              </li>
            </Tip>
          ))}
          {!hasLogs ? (
            <li className="py-0.5 text-muted-foreground">尚未产生日志</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
