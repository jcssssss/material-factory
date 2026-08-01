import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTaskStore, createTaskId } from "../../store/useTaskStore";
import type { TaskConfig } from "../../types/task";
import type { BackgroundTemplate } from "../../types/background";
import { FilePickerButton } from "../common/FilePickerButton";
import { PageRuleInput } from "./PageRuleInput";
import { isSupportedInputPath } from "../../lib/inputValidation";
import { deriveTaskName, resolveUniqueTaskName } from "../../lib/taskNaming";
import { validateFormPageRule } from "../../lib/pageRule";
import { listTemplates, readBackgroundThumbnail } from "../../lib/printEngine/backgroundDb";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Box, FolderOpen, AlertTriangle, Info, Plus } from "lucide-react";
import { Tip } from "../common/Tip";

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

type FieldErrors = {
  sourcePaths?: string;
  outputDir?: string;
};

function computeFieldErrors(draft: {
  sourceType?: "files" | "folder";
  sourcePaths?: string[];
  outputDir?: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  // 任务名已由资料文件夹名自动推导（见 taskNaming.ts），无需校验。
  // 文件模式暂时注释（只允许上传文件夹），sourcePaths 校验只保留文件夹分支。
  if (!draft.sourcePaths || draft.sourcePaths.length === 0) {
    errors.sourcePaths = "请选择包含 PDF 的文件夹";
  }

  if (!draft.outputDir || draft.outputDir.trim() === "") {
    errors.outputDir = "请选择输出目录";
  }

  return errors;
}

export function TaskForm() {
  const draft = useTaskStore((s) => s.draft);
  const setDraft = useTaskStore((s) => s.setDraft);
  const resetDraft = useTaskStore((s) => s.resetDraft);
  const enqueueTask = useTaskStore((s) => s.enqueueTask);
  const navigate = useNavigate();
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);
  const [calibratedTemplates, setCalibratedTemplates] = useState<BackgroundTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<BackgroundTemplate | null>(null);
  const [selectedThumb, setSelectedThumb] = useState<string | null>(null);
  const selectedThumbRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listTemplates()
      .then((all) => {
        if (!cancelled) setCalibratedTemplates(all.filter((t) => t.calibrated));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中模板展示：随 draft.backgroundTemplateIds 变化，加载名称与缩略图
  useEffect(() => {
    const ids = draft.backgroundTemplateIds ?? [];
    const t = ids.length > 0 ? (calibratedTemplates.find((x) => x.id === ids[0]) ?? null) : null;
    setSelectedTemplate(t);
    if (selectedThumbRef.current) {
      URL.revokeObjectURL(selectedThumbRef.current);
      selectedThumbRef.current = null;
    }
    setSelectedThumb(null);
    if (!t) return;
    let cancelled = false;
    void readBackgroundThumbnail(t.file_name)
      .then((buf) => {
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        selectedThumbRef.current = url;
        setSelectedThumb(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draft.backgroundTemplateIds, calibratedTemplates]);

  const fieldErrors = useMemo(
    () =>
      computeFieldErrors({
        sourceType: draft.sourceType,
        sourcePaths: draft.sourcePaths,
        outputDir: draft.outputDir,
      }),
    [draft.sourceType, draft.sourcePaths, draft.outputDir],
  );

  const pageRuleError = useMemo(
    () =>
      validateFormPageRule({
        firstN: draft.pageRuleMode === "custom" ? undefined : draft.firstN,
        customPages: draft.pageRuleMode === "firstN" ? undefined : draft.customPages,
      }),
    [draft.pageRuleMode, draft.firstN, draft.customPages],
  );

  const validationOk = useMemo(
    () => !fieldErrors.sourcePaths && !fieldErrors.outputDir && !pageRuleError,
    [fieldErrors, pageRuleError],
  );

  function handleAddToQueue() {
    if (!validationOk || !draft.outputDir) return;
    const sourcePaths = draft.sourcePaths ?? [];
    const outputDir = draft.outputDir.trim();
    const inputPath = sourcePaths[0] ?? "";
    // 任务名由资料文件夹名自动推导；同名冲突（不同文件夹同名）追加序号，
    // 重跑同一批允许同名覆盖（见 taskNaming.ts）。
    const { queue, history, breakpoints } = useTaskStore.getState();
    const existing = [
      ...queue.map((q) => ({
        outputDir: q.outputDir,
        taskName: q.taskName,
        sourcePaths: q.sourcePaths,
      })),
      ...history.map((h) => ({
        outputDir: h.config.outputDir,
        taskName: h.config.taskName,
        sourcePaths: h.config.sourcePaths,
      })),
      ...Object.values(breakpoints).map((bp) => ({
        outputDir: bp.taskConfig.outputDir,
        taskName: bp.taskConfig.taskName,
        sourcePaths: bp.taskConfig.sourcePaths,
      })),
    ];
    const task: TaskConfig = {
      taskId: createTaskId(),
      taskName: resolveUniqueTaskName(deriveTaskName(sourcePaths), outputDir, inputPath, existing),
      sourceType: "folder",
      sourcePaths,
      outputDir,
      firstN: draft.firstN,
      customPages: draft.customPages?.trim() || undefined,
      pageRuleMode: draft.pageRuleMode ?? "firstN",
      status: "pending",
      createdAt: new Date().toISOString(),
      generateMaterialList: draft.generateMaterialList,
      generatePrintImages: draft.generatePrintImages,
      backgroundTemplateIds: draft.backgroundTemplateIds,
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
    const calibrated = templates.filter((t) => t.calibrated);
    setCalibratedTemplates(calibrated);
    if (calibrated.length === 0) {
      setShowCalibrationAlert(true);
      return;
    }
    setDraft({ generatePrintImages: true });
  }

  const sourceLabel = draft.sourcePaths && draft.sourcePaths.length > 0 ? "已选文件夹" : "尚未选择";

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      {/* 标题 */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-workspace-accent text-white shadow-sm">
          <Box className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold text-workspace-fg">新建任务</h2>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* 块：单个商品 */}
        <section className="flex flex-col gap-2">
          <Label className="text-xs font-semibold text-workspace-fg-secondary">单个商品</Label>
          {/* 暂时只支持文件夹选择：来源切换按钮（文件夹/文件）一并注释。
            恢复文件模式时取消本注释，并恢复下方「选择文件夹」按钮的 sourceType 三目。 */}
          {/* <div className="flex rounded-lg border bg-background p-0.5 text-xs shadow-sm w-fit">
          <button
            type="button"
            onClick={() => setDraft({ sourceType: "folder", sourcePaths: [] })}
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-all",
              draft.sourceType === "folder"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            文件夹
          </button>
          <button
            type="button"
            onClick={() => setDraft({ sourceType: "files", sourcePaths: [] })}
            className={cn(
              "rounded-md px-2.5 py-1 font-medium transition-all",
              draft.sourceType === "files"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            文件
          </button>
        </div> */}

          <div className="flex items-center gap-3 rounded-lg border border-workspace-border/70 bg-workspace-bg/40 px-3 py-2.5">
            {draft.sourceType === "folder" ? (
              <FilePickerButton
                mode="folder"
                label="选择文件夹"
                onPick={(paths) => setDraft({ sourcePaths: paths })}
              />
            ) : null}
            {/* 文件模式暂时注释：只允许上传文件夹。 */}
            {/* (
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
          ) */}
            <span className="truncate text-xs text-workspace-muted">{sourceLabel}</span>
          </div>

          {draft.sourcePaths && draft.sourcePaths.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-workspace-muted">
              任务名：
              <span className="font-medium text-workspace-fg">
                {deriveTaskName(draft.sourcePaths)}
              </span>
            </span>
          )}

          {draft.sourcePaths && draft.sourcePaths.length > 0 && (
            <div className="max-h-24 overflow-auto rounded-lg border border-workspace-border bg-workspace-bg/50 px-3 py-1.5 text-xs text-workspace-fg-secondary leading-relaxed">
              {draft.sourcePaths.slice(0, 12).map((p, idx) => (
                <Tip key={`${p}-${idx}`} label={p}>
                  <span className="mr-3 inline-flex items-center gap-1">
                    <span className="text-workspace-muted/60">{idx + 1}.</span>
                    <span className={isSupportedInputPath(p) ? "" : "text-workspace-danger"}>
                      {basename(p)}
                    </span>
                  </span>
                </Tip>
              ))}
              {draft.sourcePaths.length > 12 && (
                <span className="text-workspace-muted">
                  …还有 {draft.sourcePaths.length - 12} 个
                </span>
              )}
            </div>
          )}
          {fieldErrors.sourcePaths && (
            <span className="flex items-center gap-1.5 text-xs text-workspace-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {fieldErrors.sourcePaths}
            </span>
          )}
        </section>

        {/* 块：页码规则 */}
        <section className="flex flex-col gap-2">
          <PageRuleInput />
          {pageRuleError && (
            <span className="flex items-center gap-1.5 text-xs text-workspace-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {pageRuleError}
            </span>
          )}
        </section>

        {/* 块：输出选项 */}
        <section className="flex flex-col gap-2">
          <Label className="text-xs font-semibold text-workspace-fg-secondary">输出选项</Label>
          {/* 生成资料列表展示图 */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="generate-material-list"
              checked={draft.generateMaterialList ?? false}
              onCheckedChange={(checked) => setDraft({ generateMaterialList: checked === true })}
              className="border-workspace-accent data-[state=checked]:bg-workspace-accent data-[state=checked]:text-white"
            />
            <Label
              htmlFor="generate-material-list"
              className="text-xs font-normal text-workspace-fg-secondary cursor-pointer"
            >
              同时生成资料列表展示图
            </Label>
            {draft.sourceType !== "folder" && (
              <span className="text-xs text-workspace-muted">（仅文件夹模式生效）</span>
            )}
          </div>

          {/* 图片合成 */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="generate-print-images"
              checked={draft.generatePrintImages ?? false}
              onCheckedChange={(checked) => handlePrintImagesToggle(checked === true)}
              className="border-workspace-accent data-[state=checked]:bg-workspace-accent data-[state=checked]:text-white"
            />
            <Label
              htmlFor="generate-print-images"
              className="text-xs font-normal text-workspace-fg-secondary cursor-pointer"
            >
              图片合成（仿打印效果）
            </Label>
            <a
              href="#/backgrounds"
              className="text-xs font-medium text-workspace-accent underline transition hover:text-workspace-accent/80"
            >
              [背景模板]
            </a>
          </div>

          {/* 选择合成模板 */}
          {draft.generatePrintImages && (
            <div className="space-y-1.5 rounded-lg border border-workspace-border bg-workspace-surface p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-workspace-fg">合成背景模板</span>
                {selectedTemplate && (
                  <button
                    type="button"
                    onClick={() => setDraft({ backgroundTemplateIds: [] })}
                    className="text-[10px] font-medium text-workspace-muted underline transition hover:text-workspace-fg"
                  >
                    清除选择
                  </button>
                )}
              </div>
              {selectedTemplate ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-workspace-border bg-workspace-bg/50 p-2">
                  <div className="h-11 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100">
                    {selectedThumb ? (
                      <img
                        src={selectedThumb}
                        alt={selectedTemplate.file_name}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-workspace-fg">
                      {selectedTemplate.file_name}
                    </p>
                    <p className="text-[10px] text-workspace-muted">
                      {selectedTemplate.width}×{selectedTemplate.height} · 已标定
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate("/backgrounds?select=1")}
                    className="shrink-0 text-[10px] font-medium text-workspace-accent underline transition hover:text-workspace-accent/80"
                  >
                    更换
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate("/backgrounds?select=1")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-workspace-accent/30 bg-workspace-accent/5 px-3 py-1.5 text-xs font-medium text-workspace-accent transition hover:bg-workspace-accent/10"
                >
                  选择模板
                </button>
              )}
              {!selectedTemplate && (
                <p className="text-[10px] text-workspace-muted">
                  未选择将使用全部已标定模板随机轮换
                </p>
              )}
            </div>
          )}
        </section>

        {/* 块：输出根目录 */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium text-workspace-fg">输出根目录</Label>
              <Tip
                side="right"
                label={
                  <span className="block max-w-xs leading-relaxed">
                    固定规格：3:4 竖版 · JPG 100% · 300 DPI · 按{" "}
                    <code className="font-mono">{`{文件夹名}/{PDF 文件名}/{pdfBaseName}_p{页码三位}.jpg`}</code>{" "}
                    组织
                  </span>
                }
              >
                <button type="button" className="inline-flex">
                  <Info className="h-3 w-3 text-workspace-muted/50 hover:text-workspace-muted transition-colors" />
                </button>
              </Tip>
            </div>
            <FilePickerButton
              mode="outputDir"
              label="选择输出目录"
              onPick={(paths) => setDraft({ outputDir: paths[0] })}
            />
          </div>
          {draft.outputDir ? (
            <div className="flex items-center gap-2 rounded-lg border border-workspace-border/70 bg-workspace-bg/40 px-3 py-2 font-mono text-xs text-workspace-fg-secondary">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-workspace-muted/60" />
              <span className="truncate">{draft.outputDir}</span>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-workspace-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              尚未选择输出目录
            </span>
          )}
        </section>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-[11px] text-workspace-muted">支持 PDF / Word 资料</span>
          <Button
            onClick={handleAddToQueue}
            disabled={!validationOk}
            size="sm"
            className="bg-workspace-accent text-white hover:bg-workspace-accent/90"
          >
            <Plus className="h-4 w-4" />
            加入队列
          </Button>
        </div>
      </div>

      {showCalibrationAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-workspace-surface p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-workspace-danger/10 text-workspace-danger">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold text-workspace-fg">背景模板未标定</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-workspace-fg-secondary">
              背景模板库为空或未标定，请先上传并标定背景模板。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCalibrationAlert(false)}
                className="border-workspace-border bg-white text-workspace-fg-secondary hover:bg-slate-50 hover:text-workspace-fg"
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowCalibrationAlert(false);
                  navigate("/backgrounds");
                }}
                className="bg-workspace-accent text-white hover:bg-workspace-accent/90"
              >
                去上传
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
