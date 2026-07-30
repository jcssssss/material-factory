import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTaskStore, createTaskId } from "../../store/useTaskStore";
import type { TaskConfig } from "../../types/task";
import { FilePickerButton } from "../common/FilePickerButton";
import { PageRuleInput } from "./PageRuleInput";
import {
  isSupportedInputPath,
} from "../../lib/inputValidation";
import { validateFormPageRule } from "../../lib/pageRule";
import { listTemplates } from "../../lib/printEngine/backgroundDb";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Button } from "../ui/button";
import { Box, FolderOpen, AlertTriangle, Info, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { cn } from "@/lib/utils";

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

type FieldErrors = {
  taskName?: string;
  sourcePaths?: string;
  outputDir?: string;
};

function computeFieldErrors(draft: {
  taskName?: string;
  sourceType?: "files" | "folder";
  sourcePaths?: string[];
  outputDir?: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.taskName || draft.taskName.trim() === "") {
    errors.taskName = "请填写任务名";
  }

  if (!draft.sourcePaths || draft.sourcePaths.length === 0) {
    errors.sourcePaths =
      draft.sourceType === "folder"
        ? "请选择包含 PDF 的文件夹"
        : "请选择 PDF 文件";
  } else if (draft.sourceType === "files") {
    const nonSupported = draft.sourcePaths.filter(
      (p) => !isSupportedInputPath(p)
    );
    if (nonSupported.length > 0) {
      errors.sourcePaths = `仅支持 PDF 与 Word，包含不支持的文件：${basename(nonSupported[0])}`;
    }
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

  const fieldErrors = useMemo(() => computeFieldErrors({
    taskName: draft.taskName,
    sourceType: draft.sourceType,
    sourcePaths: draft.sourcePaths,
    outputDir: draft.outputDir,
  }), [draft.taskName, draft.sourceType, draft.sourcePaths, draft.outputDir]);

  const pageRuleError = useMemo(() => validateFormPageRule({
    firstN: draft.pageRuleMode === "custom" ? undefined : draft.firstN,
    customPages: draft.pageRuleMode === "firstN" ? undefined : draft.customPages,
  }), [draft.pageRuleMode, draft.firstN, draft.customPages]);

  const validationOk = useMemo(() =>
    !fieldErrors.taskName && !fieldErrors.sourcePaths && !fieldErrors.outputDir && !pageRuleError
  , [fieldErrors, pageRuleError]);

  function handleAddToQueue() {
    if (!validationOk || !draft.taskName || !draft.outputDir) return;
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
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Box className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-sm font-semibold">新建任务</h2>
      </div>

      {/* 任务名 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted-foreground">任务名</Label>
        <Input
          placeholder="例如：夏凉被系列 A"
          value={draft.taskName ?? ""}
          onChange={(e) => setDraft({ taskName: e.target.value })}
          className={cn("h-9", fieldErrors.taskName && "border-destructive")}
        />
        {fieldErrors.taskName && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {fieldErrors.taskName}
          </span>
        )}
      </div>

      {/* 输入来源 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium text-muted-foreground">输入来源</Label>
        <div className="flex rounded-lg border bg-background p-0.5 text-xs shadow-sm w-fit">
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
        </div>

        <div className="flex items-center gap-3">
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
          <span className="truncate text-xs text-muted-foreground">{sourceLabel}</span>
        </div>

        {draft.sourcePaths && draft.sourcePaths.length > 0 && (
          <div className="max-h-24 overflow-auto rounded-lg border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground leading-relaxed">
            {draft.sourcePaths.slice(0, 12).map((p, idx) => (
              <span key={`${p}-${idx}`} title={p} className="mr-3 inline-flex items-center gap-1">
                <span className="text-muted-foreground/60">{idx + 1}.</span>
                <span className={isSupportedInputPath(p) ? "" : "text-destructive"}>
                  {basename(p)}
                </span>
              </span>
            ))}
            {draft.sourcePaths.length > 12 && (
              <span className="text-muted-foreground">…还有 {draft.sourcePaths.length - 12} 个</span>
            )}
          </div>
        )}
        {fieldErrors.sourcePaths && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {fieldErrors.sourcePaths}
          </span>
        )}
      </div>

      {/* 页码规则 */}
      <PageRuleInput />
      {pageRuleError && (
        <span className="flex items-center gap-1 text-xs text-destructive -mt-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          {pageRuleError}
        </span>
      )}

      {/* 生成资料列表展示图 */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="generate-material-list"
          checked={draft.generateMaterialList ?? false}
          onCheckedChange={(checked) =>
            setDraft({ generateMaterialList: checked === true })
          }
        />
        <Label htmlFor="generate-material-list" className="text-xs font-normal text-muted-foreground cursor-pointer">
          同时生成资料列表展示图
        </Label>
        {draft.sourceType !== "folder" && (
          <span className="text-xs text-muted-foreground">（仅文件夹模式生效）</span>
        )}
      </div>

      {/* 图片合成 */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="generate-print-images"
          checked={draft.generatePrintImages ?? false}
          onCheckedChange={(checked) =>
            handlePrintImagesToggle(checked === true)
          }
        />
        <Label htmlFor="generate-print-images" className="text-xs font-normal text-muted-foreground cursor-pointer">
          图片合成（仿打印效果）
        </Label>
        <a
          href="#/backgrounds"
          className="text-xs font-medium text-primary underline transition hover:text-primary/80"
        >
          [背景模板]
        </a>
      </div>

      {/* 输出根目录 */}
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs font-medium text-foreground">输出根目录</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex">
                    <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed bg-white text-foreground border shadow-md">
                  固定规格：3:4 竖版 · JPG 100% · 300 DPI · 按 <code className="font-mono">{`{任务名}/{PDF 文件名}/{pdfBaseName}_p{页码三位}.jpg`}</code> 组织
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <FilePickerButton
            mode="outputDir"
            label="选择输出目录"
            onPick={(paths) => setDraft({ outputDir: paths[0] })}
          />
        </div>
          {draft.outputDir ? (
            <span className="mt-2 flex items-center gap-2 truncate rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground font-mono">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              {draft.outputDir}
            </span>
          ) : (
            <span className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              尚未选择输出目录
            </span>
          )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex justify-end border-t pt-4">
        <Button onClick={handleAddToQueue} disabled={!validationOk} size="sm">
          <Plus className="h-4 w-4" />
          加入队列
        </Button>
      </div>

      {showCalibrationAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">背景模板未标定</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              背景模板库为空或未标定，请先上传并标定背景模板。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowCalibrationAlert(false)}>
                取消
              </Button>
              <Button size="sm" onClick={() => { setShowCalibrationAlert(false); navigate("/backgrounds"); }}>
                去上传
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
