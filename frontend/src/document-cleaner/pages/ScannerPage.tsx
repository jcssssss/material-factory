import { useEffect, useRef, useState } from "react";
import { updateTaskStatus } from "../services/mockCleanerService";
import { tryDetect } from "../services/cleanerIpc";
import type { FileItem } from "../components/FileSelector";
import type { FileDetectionResult } from "../types";

type StageKey = "scan" | "pdf_parse" | "watermark" | "header" | "footer";

type StageState = {
  key: StageKey;
  label: string;
  progress: number; // 0-100
};

const ALL_STAGES: StageState[] = [
  { key: "scan", label: "文件扫描", progress: 0 },
  { key: "pdf_parse", label: "PDF 解析", progress: 0 },
  { key: "watermark", label: "水印检测", progress: 0 },
  { key: "header", label: "页眉检测", progress: 0 },
  { key: "footer", label: "页脚检测", progress: 0 },
];

function simulateAdvance(
  stages: StageState[],
  files: FileItem[],
  tick: number
): { stages: StageState[]; currentFile: string | null; overall: number; done: boolean } {
  const totalTicks = 60; // 总共模拟 60 tick
  const tickPerStage = Math.floor(totalTicks / stages.length);
  const stageIdx = Math.min(Math.floor(tick / tickPerStage), stages.length - 1);
  const localTick = tick - stageIdx * tickPerStage;
  const localMax = tickPerStage;

  const newStages = stages.map((s, i) => {
    if (i < stageIdx) return { ...s, progress: 100 };
    if (i > stageIdx) return { ...s, progress: 0 };
    // 当前阶段
    const p = Math.min(100, Math.round((localTick / localMax) * 100));
    return { ...s, progress: p };
  });

  // 当前文件（每个阶段切换不同的文件）
  const fileIdx = Math.min(stageIdx, files.length - 1);
  const currentFile = tick < totalTicks ? (files[fileIdx]?.name ?? "加载中...") : null;

  const done = tick >= totalTicks;
  const overall = Math.min(100, Math.round((tick / totalTicks) * 100));

  return { stages: newStages, currentFile, overall, done };
}

export default function ScannerPage({
  taskId,
  files,
  onComplete,
  onCancel,
}: {
  taskId: string;
  files: FileItem[];
  onComplete: (results: FileDetectionResult[]) => void;
  onCancel: () => void;
}) {
  const [stages, setStages] = useState<StageState[]>(ALL_STAGES.map((s) => ({ ...s })));
  const [currentFile, setCurrentFile] = useState<string | null>(files[0]?.name ?? null);
  const [overall, setOverall] = useState(0);
  const [phase, setPhase] = useState<"scanning" | "complete">("scanning");
  const resultsRef = useRef<FileDetectionResult[] | null>(null);
  const tickRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 更新任务状态为 scanning
    updateTaskStatus(taskId, "scanning");

    timerRef.current = setInterval(() => {
      tickRef.current += 1;
      const t = tickRef.current;
      const result = simulateAdvance(stages, files, t);
      setStages(result.stages);
      setCurrentFile(result.currentFile);
      setOverall(result.overall);

      if (result.done) {
        if (timerRef.current) clearInterval(timerRef.current);
        const fileNames = files.map((f) => f.name);
        const filePaths = files.map((f) => f.path);
        tryDetect(fileNames, filePaths)
          .then((detectionResults) => {
            resultsRef.current = detectionResults;
            updateTaskStatus(taskId, "waiting");
            setPhase("complete");
          });
      }
    }, 150); // 每 150ms 推进一次，总计 ~9s

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-7 py-10">
      {/* 状态头 */}
      <div className="flex items-center gap-3">
        <span
          className={
            "relative flex h-3 w-3 " +
            (phase === "scanning" ? "" : "hidden")
          }
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-500" />
        </span>
        <span className="text-base font-semibold text-workspace-fg">
          {phase === "scanning" ? "正在分析" : "分析完成"}
        </span>
        {phase === "complete" && (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-emerald-500">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        )}
      </div>

      {/* 当前文件 */}
      {phase === "scanning" && currentFile && (
        <div className="flex items-center gap-2 rounded-full bg-indigo-50/60 px-4 py-1.5 text-sm text-indigo-700">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5z" />
          </svg>
          当前文件：<span className="font-medium">{currentFile}</span>
        </div>
      )}

      {/* 阶段列表 */}
      <div className="w-full space-y-3">
        {stages.map((s) => (
          <div key={s.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span
                className={
                  s.progress === 100
                    ? "font-medium text-emerald-600"
                    : s.progress > 0
                      ? "font-medium text-indigo-600"
                      : "text-workspace-muted"
                }
              >
                {s.progress === 100 && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="-mt-0.5 mr-1 inline h-3.5 w-3.5">
                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                  </svg>
                )}
                {s.label}
              </span>
              <span className="tabular-nums text-workspace-muted">{s.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className={
                  "h-full rounded-full transition-all duration-300 ease-out " +
                  (s.progress === 100
                    ? "bg-emerald-400"
                    : s.progress > 0
                      ? "bg-indigo-400"
                      : "bg-slate-200")
                }
                style={{ width: `${s.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 整体进度 */}
      <div className="w-full rounded-xl border border-workspace-border/60 bg-workspace-surface p-4 shadow-card">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-workspace-fg">整体进度</span>
          <span className="text-lg font-bold tabular-nums text-indigo-600">{overall}%</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className={
              "h-full rounded-full transition-all duration-300 ease-out " +
              (phase === "complete" ? "bg-emerald-400" : "bg-gradient-to-r from-indigo-400 to-indigo-500")
            }
            style={{ width: `${overall}%` }}
          />
        </div>
      </div>

      {/* 操作按钮 */}
      {phase === "complete" ? (
        <button
          type="button"
          onClick={() => onComplete(resultsRef.current ?? [])}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md"
        >
          查看检测结果
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (timerRef.current) clearInterval(timerRef.current);
            updateTaskStatus(taskId, "cancelled");
            onCancel();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-workspace-border/60 bg-white px-5 py-2 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
        >
          取消分析
        </button>
      )}
    </div>
  );
}
