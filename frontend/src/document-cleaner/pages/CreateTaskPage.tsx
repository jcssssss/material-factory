import { useState } from "react";
import { FileSelector } from "../components/FileSelector";
import type { FileItem } from "../components/FileSelector";
import { createTask } from "../services/mockCleanerService";

type CleanMode = "watermark" | "header" | "footer";

const ALL_MODES: { key: CleanMode; label: string }[] = [
  { key: "watermark", label: "去水印" },
  { key: "header", label: "去页眉" },
  { key: "footer", label: "去页脚" },
];

export default function CreateTaskPage({
  onBack,
  onStartScan,
}: {
  onBack?: () => void;
  onStartScan?: (taskId: string, files: FileItem[]) => void;
}) {
  const [taskName, setTaskName] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [modes, setModes] = useState<CleanMode[]>(["watermark", "header", "footer"]);

  function toggleMode(m: CleanMode) {
    setModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  }

  function handleStartAnalysis() {
    if (!taskName.trim()) return;
    const task = createTask(taskName.trim(), files.length);
    onStartScan?.(task.id, files);
  }

  const ready = taskName.trim().length > 0 && files.length > 0 && modes.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-workspace-fg">新建清理任务</h1>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-workspace-muted underline underline-offset-2 hover:text-workspace-fg"
        >
          返回
        </button>
      </div>

      {/* 任务名称 */}
      <section>
        <label className="mb-1.5 block text-xs font-medium text-workspace-fg-secondary">
          任务名称
        </label>
        <input
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          placeholder="例如：2024 年度报告清理"
          className="w-full rounded-lg border border-workspace-border/60 bg-workspace-surface px-3.5 py-2 text-sm text-workspace-fg placeholder:text-workspace-muted/50 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30"
        />
      </section>

      {/* 文件选择 */}
      <section>
        <label className="mb-1.5 block text-xs font-medium text-workspace-fg-secondary">
          待清理文件
        </label>
        <FileSelector files={files} onChange={setFiles} />
      </section>

      {/* 输出目录 */}
      <section>
        <label className="mb-1.5 block text-xs font-medium text-workspace-fg-secondary">
          输出目录
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="~/Documents/cleaned_output"
            className="w-full rounded-lg border border-workspace-border/60 bg-workspace-surface px-3.5 py-2 text-sm text-workspace-fg placeholder:text-workspace-muted/50 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30"
          />
          <button
            type="button"
            className="shrink-0 rounded-lg border border-workspace-border/60 bg-workspace-surface px-3 text-xs text-workspace-muted transition hover:bg-workspace-sidebar-hover hover:text-workspace-fg"
          >
            浏览
          </button>
        </div>
      </section>

      {/* 清理模式 */}
      <section>
        <label className="mb-1.5 block text-xs font-medium text-workspace-fg-secondary">
          清理模式
        </label>
        <div className="flex gap-3">
          {ALL_MODES.map((m) => {
            const active = modes.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggleMode(m.key)}
                className={
                  "flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm transition " +
                  (active
                    ? "border-indigo-400 bg-indigo-50/40 text-indigo-700 font-medium"
                    : "border-workspace-border/60 bg-workspace-surface text-workspace-muted hover:border-workspace-border")
                }
              >
                <div
                  className={
                    "flex h-4 w-4 items-center justify-center rounded border transition " +
                    (active
                      ? "border-indigo-500 bg-indigo-500 text-white"
                      : "border-workspace-border bg-white")
                  }
                >
                  {active ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  ) : null}
                </div>
                {m.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* 开始分析按钮 */}
      <button
        type="button"
        disabled={!ready}
        onClick={handleStartAnalysis}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M10.362 1.093a.75.75 0 00-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925zM18 6.443l-7.25 4v8.25l6.862-3.786A.75.75 0 0018 14.25V6.443zm-8.75 12.25v-8.25l-7.25-4v7.807a.75.75 0 00.388.657l6.862 3.786z" />
        </svg>
        开始分析
      </button>
      {!ready && (
        <p className="-mt-4 text-center text-xs text-workspace-muted/60">
          {!taskName.trim()
            ? "请输入任务名称"
            : files.length === 0
              ? "请选择待清理文件"
              : "请选择至少一种清理模式"}
        </p>
      )}
    </div>
  );
}
