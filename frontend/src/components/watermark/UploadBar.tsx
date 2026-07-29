import type { FC } from "react";

interface UploadBarProps {
  hasItems: boolean;
  isProcessing: boolean;
  outputDir: string;
  onAddFolder: () => void;
  onAddFiles: () => void;
  onClear: () => void;
  onStart: () => void;
  onSelectOutputDir: () => void;
}

const UploadBar: FC<UploadBarProps> = ({
  hasItems,
  isProcessing,
  outputDir,
  onAddFolder,
  onAddFiles,
  onClear,
  onStart,
  onSelectOutputDir,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <button
      onClick={onAddFolder}
      disabled={isProcessing}
      className="rounded-lg border border-workspace-border/60 bg-workspace-surface px-3 py-1.5 text-xs font-medium text-workspace-fg hover:bg-workspace-sidebar-hover disabled:opacity-40"
    >
      📁 添加文件夹
    </button>
    <button
      onClick={onAddFiles}
      disabled={isProcessing}
      className="rounded-lg border border-workspace-border/60 bg-workspace-surface px-3 py-1.5 text-xs font-medium text-workspace-fg hover:bg-workspace-sidebar-hover disabled:opacity-40"
    >
      📄 添加文件
    </button>
    <button
      onClick={onSelectOutputDir}
      disabled={isProcessing}
      className="rounded-lg border border-workspace-border/60 bg-workspace-surface px-3 py-1.5 text-xs font-medium text-workspace-fg hover:bg-workspace-sidebar-hover disabled:opacity-40"
    >
      📂 输出目录{outputDir ? " ✓" : ""}
    </button>
    {hasItems && (
      <>
        <span className="mx-1 h-4 w-px bg-workspace-border/40" />
        <button
          onClick={onStart}
          disabled={isProcessing || !outputDir}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {isProcessing ? "处理中…" : "开始处理"}
        </button>
        <button
          onClick={onClear}
          disabled={isProcessing}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-40"
        >
          清空列表
        </button>
      </>
    )}
  </div>
);

export default UploadBar;
