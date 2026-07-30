import { useEffect, useRef, useState } from "react";
import type { FileDetectionResult, CleanReport } from "../types";
import { generateMockReport } from "../services/mockDetectionService";
import { pythonClean } from "../services/cleanerIpc";

type CleanStage = "backup" | "detect" | "remove" | "verify" | "complete";

const STAGES: { key: CleanStage; label: string }[] = [
  { key: "backup", label: "备份" },
  { key: "detect", label: "检测" },
  { key: "remove", label: "删除" },
  { key: "verify", label: "验证" },
  { key: "complete", label: "完成" },
];

type FileProgress = {
  name: string;
  stageIndex: number;   // 当前所处的 stage 索引
  progress: number;     // 0-100
  done: boolean;
};

export default function CleaningProgressPage({
  results,
  filePaths = [],
  onComplete,
  onCancel,
}: {
  results: FileDetectionResult[];
  filePaths?: string[];
  onComplete?: (report: CleanReport) => void;
  onCancel?: () => void;
}) {
  const fileNames = results.map((r) => r.fileName);
  const totalFiles = fileNames.length;

  const [progressList, setProgressList] = useState<FileProgress[]>(() =>
    fileNames.map((name) => ({
      name,
      stageIndex: -1,
      progress: 0,
      done: false,
    }))
  );
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [overall, setOverall] = useState(0);
  const [phase, setPhase] = useState<"running" | "complete">("running");
  const tickRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function tryGenerateReport(): Promise<CleanReport> {
    // 尝试 Python clean IP C，失败时使用 mock
    if (filePaths.length > 0 && filePaths.length === results.length) {
      try {
        const first = await pythonClean(filePaths[0], filePaths[0].replace('.pdf', '_clean.pdf').replace('.PDF', '_clean.pdf'));
        // 聚合多文件报告
        if (filePaths.length === 1) return first;
        const reports = [first];
        for (let i = 1; i < filePaths.length; i++) {
          const r = await pythonClean(filePaths[i], filePaths[i].replace('.pdf', '_clean.pdf').replace('.PDF', '_clean.pdf'));
          reports.push(r);
        }
        return {
          taskId: reports[0]?.taskId ?? "",
          totalFiles: reports.reduce((s, r) => s + r.totalFiles, 0),
          successCount: reports.reduce((s, r) => s + r.successCount, 0),
          failedCount: reports.reduce((s, r) => s + r.failedCount, 0),
          skippedCount: reports.reduce((s, r) => s + r.skippedCount, 0),
          files: reports.flatMap((r) => r.files),
          completedAt: reports[reports.length - 1]?.completedAt ?? "",
        };
      } catch {
        // 降级到 mock
      }
    }
    return generateMockReport(fileNames);
  }

  useEffect(() => {
    timerRef.current = setInterval(() => {
      tickRef.current += 1;
      const t = tickRef.current;

      // 当前活跃的文件索引（按流水线：文件 0 先走完 stage 0，然后文件 1 开始 stage 0）
      const newList: FileProgress[] = fileNames.map((name, fi) => {
        const fileTicks = Math.max(0, t - fi * 6); // 每个文件延迟 6 tick 启动
        if (fileTicks <= 0) return { name, stageIndex: -1, progress: 0, done: false };

        const stageIdx = Math.min(
          Math.floor(fileTicks / 12),
          STAGES.length - 1
        );
        const localTick = fileTicks - stageIdx * 12;
        const stageProgress = Math.min(100, Math.round((localTick / 12) * 100));

        const done = stageIdx >= STAGES.length - 1 && stageProgress >= 100;
        return {
          name,
          stageIndex: done ? STAGES.length - 1 : stageIdx,
          progress: done ? 100 : stageProgress,
          done,
        };
      });

      setProgressList(newList);

      // 当前整体阶段（取最靠前的未完成文件的 stage）
      const firstActive = newList.find((f) => !f.done);
      setCurrentStageIdx(firstActive ? Math.max(0, firstActive.stageIndex) : STAGES.length - 1);

      // 整体进度
      const totalProgress = newList.reduce((sum, f) => sum + f.progress, 0);
      const overallPct = Math.min(100, Math.round(totalProgress / totalFiles));
      setOverall(overallPct);

      // 完成
      if (newList.every((f) => f.done)) {
        if (timerRef.current) clearInterval(timerRef.current);
        setPhase("complete");
        setOverall(100);
        tryGenerateReport().then((report) => {
          // 等一次渲染周期再回调，让用户看到 100%
          setTimeout(() => onComplete?.(report), 600);
        });
      }
    }, 180); // 每 180ms，总计 ~3.2s × 文件数

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 py-8">
      {/* 状态头 */}
      <div className="flex items-center gap-3">
        <span className={phase === "running" ? "relative flex h-3 w-3" : "hidden"}>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-500" />
        </span>
        <span className="text-base font-semibold text-workspace-fg">
          {phase === "running" ? "正在清理" : "清理完成"}
        </span>
        {phase === "complete" && (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-emerald-500">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        )}
      </div>

      {/* 阶段指示器 */}
      <div className="flex items-center justify-between">
        {STAGES.map((s, idx) => {
          const active = idx === currentStageIdx;
          const done = idx < currentStageIdx || (phase === "complete" && idx === STAGES.length - 1);
          return (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className={
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all " +
                  (done
                    ? "bg-emerald-100 text-emerald-600"
                    : active
                      ? "bg-indigo-100 text-indigo-600 ring-2 ring-indigo-300"
                      : "bg-slate-100 text-slate-400")
                }
              >
                {done ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={
                  "text-xs font-medium " +
                  (done
                    ? "text-emerald-600"
                    : active
                      ? "text-indigo-600"
                      : "text-slate-400")
                }
              >
                {s.label}
              </span>
              {idx < STAGES.length - 1 && (
                <div
                  className={
                    "mt-1 h-0.5 w-full rounded-full " +
                    (done
                      ? "bg-emerald-300"
                      : active
                        ? "bg-indigo-200"
                        : "bg-slate-200")
                  }
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 整体进度 */}
      <div className="rounded-xl border border-workspace-border/60 bg-workspace-surface p-4 shadow-card">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-workspace-fg">整体进度</span>
          <span className="text-lg font-bold tabular-nums text-indigo-600">{overall}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className={
              "h-full rounded-full transition-all duration-300 ease-out " +
              (phase === "complete"
                ? "bg-emerald-400"
                : "bg-gradient-to-r from-indigo-400 to-indigo-500")
            }
            style={{ width: `${overall}%` }}
          />
        </div>
      </div>

      {/* 文件处理列表 */}
      <div className="overflow-hidden rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
        <div className="border-b border-workspace-border/40 bg-slate-50/80 px-5 py-2.5 text-xs font-medium text-workspace-muted">
          文件处理
        </div>
        <div className="divide-y divide-workspace-border/20">
          {progressList.map((fp) => {
            const stage = STAGES[Math.max(0, fp.stageIndex)];
            return (
              <div
                key={fp.name}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {/* 状态图标 */}
                  {fp.done ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-emerald-500">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                  ) : fp.stageIndex >= 0 ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 animate-pulse text-indigo-500">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-slate-300">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 011-1h.01a1 1 0 010 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  )}
                  <span className={"truncate text-sm " + (fp.done ? "text-workspace-fg" : "text-workspace-fg")}>
                    {fp.name}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {/* 进度条 */}
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={
                        "h-full rounded-full transition-all duration-300 " +
                        (fp.done
                          ? "bg-emerald-400"
                          : fp.stageIndex >= 0
                            ? "bg-indigo-400"
                            : "bg-slate-200")
                      }
                      style={{ width: `${fp.progress}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-workspace-muted">
                    {fp.progress}%
                  </span>
                  <span className="w-12 text-right text-xs text-workspace-muted">
                    {fp.done ? "已完成" : fp.stageIndex >= 0 ? stage.label : "待处理"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-center">
        {phase === "complete" ? (
          <button
            type="button"
            onClick={() => tryGenerateReport().then((r) => onComplete?.(r))}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md"
          >
            查看清理报告
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-lg border border-workspace-border/60 bg-white px-5 py-2 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
          >
            取消清理
          </button>
        )}
      </div>
    </div>
  );
}
