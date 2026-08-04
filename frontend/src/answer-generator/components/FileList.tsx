// 右侧「资料文件列表」：每个文件一行（文件名 + 状态徽标 + 进度条）。
// 点击已完成文件可在下方预览区查看/打印；全部完成后显示「打开文件」按钮。

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../../components/ui/button";
import { Progress } from "../../components/ui/progress";
import { Tip } from "../../components/common/Tip";
import { useAnswerStore } from "../store/useAnswerStore";
import type { AnswerFileItem, FileItemStatus } from "../types";

const STATUS_META: Record<FileItemStatus, { label: string; className: string }> = {
  pending: { label: "待处理", className: "bg-slate-100 text-slate-500" },
  extracting: { label: "提取中", className: "bg-indigo-50 text-indigo-600" },
  ocr: { label: "OCR 识别", className: "bg-amber-50 text-amber-600" },
  generating: { label: "生成中", className: "bg-indigo-50 text-indigo-600" },
  converting: { label: "转换中", className: "bg-indigo-50 text-indigo-600" },
  done: { label: "完成", className: "bg-emerald-50 text-emerald-600" },
  error: { label: "失败", className: "bg-red-50 text-red-600" },
};

function FileRow({
  item,
  index,
  selected,
  onSelect,
}: {
  item: AnswerFileItem;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
}) {
  const meta = STATUS_META[item.status];
  const clickable = item.status === "done" && !!item.resultHtml;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (clickable) onSelect(index);
        }}
        disabled={!clickable}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          clickable
            ? "cursor-pointer hover:bg-workspace-accent-light/50"
            : "cursor-default",
          selected && "bg-workspace-accent-light"
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-workspace-muted" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tip label={item.name} onlyOverflow>
              <span className="truncate text-xs font-medium text-workspace-fg">
                {item.name}
              </span>
            </Tip>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                meta.className
              )}
            >
              {meta.label}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={item.progress} className="h-1.5 flex-1" />
            <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-workspace-muted">
              {item.progress}%
            </span>
          </div>
        </div>
        {item.status === "error" && item.error && (
          <Tip label={item.error} side="left">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          </Tip>
        )}
        {clickable && <ChevronRight className="h-4 w-4 shrink-0 text-workspace-muted" />}
      </button>
    </li>
  );
}

export function FileList() {
  const files = useAnswerStore((s) => s.files);
  const status = useAnswerStore((s) => s.status);
  const selectedIndex = useAnswerStore((s) => s.selectedIndex);
  const selectFile = useAnswerStore((s) => s.selectFile);
  const openOutputFolder = useAnswerStore((s) => s.openOutputFolder);

  const doneCount = files.filter((f) => f.status === "done").length;
  const errCount = files.filter((f) => f.status === "error").length;
  const running = status === "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-workspace-border/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-workspace-fg">资料文件列表</span>
          <span className="text-xs text-workspace-muted">共 {files.length} 个</span>
          {running && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-workspace-accent" />
          )}
        </div>
        {status === "done" && files.length > 0 && (
          <Button size="sm" onClick={() => void openOutputFolder()}>
            <FolderOpen className="h-4 w-4" />
            打开文件
          </Button>
        )}
      </div>

      {/* 文件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs leading-relaxed text-workspace-muted">
            请在左侧选择试卷 PDF
            <br />
            支持一次选择多份
          </p>
        ) : (
          <ul className="divide-y divide-workspace-border/50">
            {files.map((f, i) => (
              <FileRow
                key={f.path}
                item={f}
                index={i}
                selected={i === selectedIndex}
                onSelect={selectFile}
              />
            ))}
          </ul>
        )}
      </div>

      {/* footer 汇总 */}
      {(doneCount > 0 || errCount > 0) && (
        <div className="flex shrink-0 items-center gap-3 border-t border-workspace-border/60 px-4 py-2 text-xs text-workspace-muted">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            成功 {doneCount}
          </span>
          {errCount > 0 && (
            <span className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-red-500" />
              失败 {errCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
