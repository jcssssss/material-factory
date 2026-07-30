import { useMemo, useState } from "react";
import { useTaskStore } from "../../store/useTaskStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScrollText } from "lucide-react";
import type { LogLevel } from "../../types/task";
import { cn } from "@/lib/utils";

type LevelFilter = "all" | LogLevel;

const FILTER_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "info", label: "信息" },
  { value: "warn", label: "警告" },
  { value: "error", label: "错误" },
];

const LEVEL_COLOR: Record<string, string> = {
  info: "text-foreground",
  warn: "text-amber-600",
  error: "text-destructive",
};

export function TaskLogDialog({
  taskId,
  taskName,
  open,
  onOpenChange,
}: {
  taskId: string;
  taskName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const logs = useTaskStore((s) => s.logs);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");

  const taskLogs = useMemo(() => {
    return logs.filter((log) => log.taskId === taskId);
  }, [logs, taskId]);

  const filteredLogs = useMemo(() => {
    if (levelFilter === "all") return taskLogs;
    return taskLogs.filter((log) => log.level === levelFilter);
  }, [taskLogs, levelFilter]);

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0 };
    for (const l of taskLogs) c[l.level] += 1;
    return c;
  }, [taskLogs]);

  const hasLogs = taskLogs.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="h-4 w-4 text-primary" />
            {taskName} — 日志
          </DialogTitle>
        </DialogHeader>

        {/* 日志级别筛选 Tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5 self-start text-xs">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLevelFilter(opt.value)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-all",
                levelFilter === opt.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
              {opt.value !== "all" && (
                <span className="ml-1 text-muted-foreground/60">
                  {counts[opt.value]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 日志列表 */}
        <div className="flex-1 overflow-auto">
          {hasLogs && filteredLogs.length > 0 ? (
            <div className="space-y-1">
              {filteredLogs.map((log, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2 font-mono text-xs leading-relaxed"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {log.timestamp.slice(11, 19)}
                  </span>
                  <span className={cn("shrink-0 font-semibold text-[10px] uppercase tracking-wider", LEVEL_COLOR[log.level])}>
                    {log.level}
                  </span>
                  <span
                    className={LEVEL_COLOR[log.level]}
                  >
                    {log.message}
                  </span>
                  {log.pdfPath && (
                    <span className="shrink-0 text-muted-foreground truncate max-w-[200px]" title={log.pdfPath}>
                      [{log.pdfPath.split("/").pop()}]
                    </span>
                  )}
                  {log.pageNumber !== undefined && (
                    <span className="shrink-0 text-muted-foreground">
                      p{log.pageNumber}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ScrollText className="h-8 w-8 text-muted-foreground/30" />
              <span className="text-sm text-muted-foreground">
                {hasLogs ? "当前筛选条件下无匹配日志" : "暂无日志记录"}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
