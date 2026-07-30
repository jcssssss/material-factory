import { useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTaskStore } from "../store/useTaskStore";
import { EmptyState } from "../components/common/EmptyState";
import { ToneBadge } from "../components/common/StatusBadge";
import type { LogLevel, LogScope } from "../types/task";

const LEVEL_TONE: Record<LogLevel, "muted" | "success" | "warning" | "danger"> = {
  info: "muted",
  warn: "warning",
  error: "danger",
};

const SCOPE_LABEL: Record<LogScope, string> = {
  app: "应用",
  task: "任务",
  page: "页级",
};

type Filter = "all" | LogLevel;

export default function LogViewerPage() {
  const logs = useTaskStore((s) => s.logs);
  const clearLogs = useTaskStore((s) => s.clearLogs);
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState<Filter>("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | LogScope>("all");
  const [taskIdFilter, setTaskIdFilter] = useState(searchParams.get("taskId") || "");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyTaskId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* ignore */ }
  }, []);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (filter !== "all" && l.level !== filter) return false;
      if (scopeFilter !== "all" && l.scope !== scopeFilter) return false;
      if (taskIdFilter && l.taskId !== taskIdFilter) return false;
      return true;
    });
  }, [logs, filter, scopeFilter, taskIdFilter]);

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0 };
    for (const l of logs) c[l.level] += 1;
    return c;
  }, [logs]);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <FilterGroup
              value={filter}
              options={[
                { value: "all", label: "全部" },
                { value: "info", label: "信息" },
                { value: "warn", label: "警告" },
                { value: "error", label: "错误" },
              ]}
              onChange={(v) => setFilter(v as Filter)}
            />
            <FilterGroup
              value={scopeFilter}
              options={[
                { value: "all", label: "全部" },
                { value: "app", label: "应用" },
                { value: "task", label: "任务" },
                { value: "page", label: "页级" },
              ]}
              onChange={(v) => setScopeFilter(v as "all" | LogScope)}
            />
            <div className="flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-muted-foreground">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                placeholder="按任务 ID 筛选"
                value={taskIdFilter}
                onChange={(e) => {
                  setTaskIdFilter(e.target.value);
                  setSearchParams(e.target.value ? { taskId: e.target.value } : {});
                }}
                className="w-44 rounded-lg border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {taskIdFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setTaskIdFilter("");
                    setSearchParams({});
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            共 {logs.length} 条 · 信息 {counts.info} · 警告 {counts.warn} · 错误 {counts.error}
          </span>
          <button
            type="button"
            onClick={clearLogs}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
            </svg>
            清空
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden rounded-xl border bg-card shadow-card">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="暂无日志"
              description="任务执行或应用运行产生的日志会在此展示，并持久化到应用数据目录。"
            />
          </div>
        ) : (
          <ul className="h-full divide-y divide-border/40 overflow-auto">
            {filtered.map((log, idx) => (
              <li key={idx} className="flex items-start gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-muted/30">
                <span className="mt-0.5 shrink-0 font-mono text-muted-foreground">
                  {log.timestamp.slice(11, 19)}
                </span>
                <ToneBadge tone={LEVEL_TONE[log.level]}>
                  {log.level.toUpperCase()}
                </ToneBadge>
                <span className="shrink-0 text-muted-foreground">
                  {SCOPE_LABEL[log.scope]}
                </span>
                {log.taskId && (
                  <button
                    type="button"
                    onClick={() => copyTaskId(log.taskId!)}
                    className="shrink-0 font-mono text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                    title="点击复制任务 ID"
                  >
                    {copiedId === log.taskId ? "已复制" : `${log.taskId.slice(0, 8)}…`}
                  </button>
                )}
                <span className="min-w-0 flex-1 break-words font-mono text-foreground/80">
                  {log.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border bg-background p-0.5 text-xs shadow-sm">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            "rounded-md px-3 py-1.5 font-medium transition-all " +
            (value === opt.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
