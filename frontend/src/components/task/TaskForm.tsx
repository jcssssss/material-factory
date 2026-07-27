import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTaskStore, createTaskId } from "../../store/useTaskStore";
import type { TaskConfig } from "../../types/task";
import { FilePickerButton } from "../common/FilePickerButton";
import { PageRuleInput } from "./PageRuleInput";
import {
  validateTaskInput,
  isSupportedInputPath,
} from "../../lib/inputValidation";
import { validateFormPageRule } from "../../lib/pageRule";
import { listTemplates } from "../../lib/printEngine/backgroundDb";

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function TaskForm() {
  const draft = useTaskStore((s) => s.draft);
  const setDraft = useTaskStore((s) => s.setDraft);
  const resetDraft = useTaskStore((s) => s.resetDraft);
  const enqueueTask = useTaskStore((s) => s.enqueueTask);
  const navigate = useNavigate();
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);

  const validation = useMemo(() => {
    const inputError = validateTaskInput({
      taskName: draft.taskName,
      sourceType: draft.sourceType ?? "files",
      sourcePaths: draft.sourcePaths ?? [],
      outputDir: draft.outputDir,
    });
    if (inputError) return { ok: false, message: inputError };

    const pageRuleError = validateFormPageRule({
      firstN:
        draft.pageRuleMode === "custom" ? undefined : draft.firstN,
      customPages:
        draft.pageRuleMode === "firstN" ? undefined : draft.customPages,
    });
    if (pageRuleError) return { ok: false, message: pageRuleError };

    return { ok: true, message: "" };
  }, [draft]);

  function handleAddToQueue() {
    if (!validation.ok || !draft.taskName || !draft.outputDir) return;
    const task: TaskConfig = {
      taskId: createTaskId(),
      taskName: draft.taskName.trim(),
      sourceType: draft.sourceType ?? "files",
      sourcePaths: draft.sourcePaths ?? [],
      outputDir: draft.outputDir.trim(),
      firstN: draft.firstN,
      customPages: draft.customPages?.trim() || undefined,
      pageRuleMode: draft.pageRuleMode ?? "firstN",
      status: "pending",
      createdAt: new Date().toISOString(),
      generateMaterialList:
        draft.sourceType === "folder" && draft.generateMaterialList,
      generatePrintImages: draft.generatePrintImages,
    };
    enqueueTask(task);
    resetDraft();
  }

  async function handlePrintImagesToggle(checked: boolean) {
    if (!checked) {
      setDraft({ generatePrintImages: false });
      return;
    }
    const templates = await listTemplates();
    const hasCalibrated = templates.some((t) => t.calibrated);
    if (!hasCalibrated) {
      setShowCalibrationAlert(true);
      return;
    }
    setDraft({ generatePrintImages: true });
  }

  const sourceLabel =
    draft.sourceType === "folder"
      ? "已选文件夹"
      : draft.sourcePaths && draft.sourcePaths.length > 0
      ? `已选 ${draft.sourcePaths.length} 个文件`
      : "尚未选择";

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-workspace-border/60 bg-workspace-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-workspace-fg">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-workspace-accent">
            <path d="M10.362 1.093a.75.75 0 00-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925zM18 6.443l-7.25 4v8.25l6.862-3.786A.75.75 0 0018 14.25V6.443zm-8.75 12.25v-8.25l-7.25-4v7.807a.75.75 0 00.388.657l6.862 3.786z" />
          </svg>
          新建任务
        </h2>
        <span className="text-[11px] text-workspace-muted">一个任务对应一个商品</span>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-xs font-medium text-workspace-fg-secondary">任务名</span>
        <input
          type="text"
          placeholder="例如：夏凉被系列 A"
          value={draft.taskName ?? ""}
          onChange={(e) => setDraft({ taskName: e.target.value })}
          className="w-full rounded-lg border border-workspace-border bg-white px-3 py-2 text-sm transition placeholder:text-workspace-muted/60 focus:border-workspace-accent focus:ring-2 focus:ring-workspace-accent/10 focus:outline-none"
        />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium text-workspace-fg-secondary">输入来源</span>
          <div className="flex rounded-lg border border-workspace-border/60 bg-white p-0.5 text-xs shadow-sm">
            <button
              type="button"
              onClick={() => setDraft({ sourceType: "folder", sourcePaths: [] })}
              className={
                "rounded-md px-2.5 py-1 font-medium transition-all " +
                (draft.sourceType === "folder"
                  ? "bg-workspace-accent text-white shadow-sm"
                  : "text-workspace-fg-secondary hover:text-workspace-fg")
              }
            >
              文件夹
            </button>
            <button
              type="button"
              onClick={() => setDraft({ sourceType: "files", sourcePaths: [] })}
              className={
                "rounded-md px-2.5 py-1 font-medium transition-all " +
                (draft.sourceType === "files"
                  ? "bg-workspace-accent text-white shadow-sm"
                  : "text-workspace-fg-secondary hover:text-workspace-fg")
              }
            >
              文件
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {draft.sourceType === "folder" ? (
            <FilePickerButton
              mode="folder"
              label="选择文件夹"
              onPick={(paths) => setDraft({ sourcePaths: paths })}
            />
          ) : (
            <>
              <FilePickerButton
                mode="singlePdf"
                label="选择单个文件"
                onPick={(paths) => setDraft({ sourcePaths: paths })}
              />
              <FilePickerButton
                mode="multiPdf"
                label="选择多个文件"
                onPick={(paths) => setDraft({ sourcePaths: paths })}
              />
            </>
          )}
          <span className="text-xs text-workspace-muted">{sourceLabel}</span>
        </div>

        {draft.sourcePaths && draft.sourcePaths.length > 0 ? (
          <ul className="max-h-32 overflow-auto rounded-lg border border-workspace-border/60 bg-slate-50/60 px-3 py-1.5 text-xs text-workspace-fg-secondary">
            {draft.sourcePaths.slice(0, 12).map((p, idx) => (
              <li key={`${p}-${idx}`} className="flex items-center gap-1.5 py-0.5" title={p}>
                <span className="text-workspace-muted">{idx + 1}.</span>
                <span className={isSupportedInputPath(p) ? "" : "text-workspace-danger"}>
                  {basename(p)}
                </span>
              </li>
            ))}
            {draft.sourcePaths.length > 12 ? (
              <li className="py-0.5 text-workspace-muted">
                …还有 {draft.sourcePaths.length - 12} 个
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <PageRuleInput />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.generateMaterialList ?? false}
          onChange={(e) => setDraft({ generateMaterialList: e.target.checked })}
          className="h-4 w-4 rounded border-workspace-border text-workspace-accent focus:ring-workspace-accent"
        />
        <span className="text-workspace-fg-secondary">同时生成资料列表展示图</span>
        {draft.sourceType !== "folder" ? (
          <span className="text-xs text-workspace-muted">（仅文件夹模式生效）</span>
        ) : null}
      </label>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.generatePrintImages ?? false}
            onChange={(e) => handlePrintImagesToggle(e.target.checked)}
            className="h-4 w-4 rounded border-workspace-border text-workspace-accent focus:ring-workspace-accent"
          />
          <span className="text-workspace-fg-secondary">图片合成（仿打印效果）</span>
          <a
            href="#/backgrounds"
            className="text-xs font-medium text-indigo-500 underline transition hover:text-indigo-700"
          >
            [背景模板]
          </a>
        </label>
        <p className="ml-6 text-xs text-workspace-muted">
          透视贴合 A4 纸 · Multiply 正片叠底 · 随机匹配背景
        </p>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-workspace-fg-secondary">输出根目录</span>
          <FilePickerButton
            mode="outputDir"
            label="选择输出目录"
            onPick={(paths) => setDraft({ outputDir: paths[0] })}
          />
        </div>
        {draft.outputDir ? (
          <div className="truncate rounded-lg border border-workspace-border/60 bg-slate-50/60 px-3 py-2 text-xs text-workspace-fg-secondary shadow-sm" title={draft.outputDir}>
            {draft.outputDir}
          </div>
        ) : null}
        <div className="rounded-lg bg-workspace-accent-light px-3 py-2 text-xs text-workspace-fg-secondary">
          固定规格：3:4 竖版 · JPG 质量 100% · 目标 300 DPI ·
          按 <code className="font-mono">{`{任务名}/{PDF 文件名}/{pdfBaseName}_p{页码三位}.jpg`}</code> 组织
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-workspace-border/60 pt-4">
        <span
          className={
            "text-xs " +
            (validation.ok ? "text-workspace-muted" : "text-workspace-danger")
          }
        >
          {validation.message || "配置已就绪"}
        </span>
        <button
          type="button"
          onClick={handleAddToQueue}
          disabled={!validation.ok}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
          </svg>
          加入队列
        </button>
      </div>

      {showCalibrationAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-workspace-surface p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-workspace-fg">背景模板未标定</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-workspace-fg-secondary">
              背景模板库为空或未标定，请先上传并标定背景模板。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCalibrationAlert(false)}
                className="rounded-lg border border-workspace-border bg-white px-4 py-2 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCalibrationAlert(false);
                  navigate("/backgrounds");
                }}
                className="rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700"
              >
                去上传
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
