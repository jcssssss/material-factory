import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { BackgroundTemplate } from "../../types/background";
import { getBackgroundFilePath } from "../../lib/printEngine/backgroundDb";

type Props = {
  template: BackgroundTemplate;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
};

export default function TemplateCard({
  template,
  selected,
  onToggleSelect,
  onDelete,
  onClick,
}: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getBackgroundFilePath(template.file_name).then((path) => {
      if (cancelled) return;
      setThumbUrl(convertFileSrc(path));
    });
    return () => {
      cancelled = true;
    };
  }, [template.file_name]);

  const sizeLabel =
    template.file_size < 1024 * 1024
      ? `${(template.file_size / 1024).toFixed(0)} KB`
      : `${(template.file_size / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div
      className={
        "group relative cursor-pointer overflow-hidden rounded-xl border bg-workspace-surface shadow-card transition-all hover:shadow-lg " +
        (selected
          ? "border-workspace-accent ring-2 ring-workspace-accent/30"
          : "border-workspace-border/60")
      }
      onClick={() => onClick(template.id)}
    >
      <div className="aspect-[4/3] overflow-hidden bg-slate-100">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={template.file_name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-workspace-muted">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-8 w-8 opacity-40"
            >
              <path d="M13.75 7.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z" />
              <path
                fillRule="evenodd"
                d="M1.5 4.5A2.5 2.5 0 014 2h12a2.5 2.5 0 012.5 2.5v8a2.5 2.5 0 01-2.5 2.5H4a2.5 2.5 0 01-2.5-2.5v-8zM4 3.5a1 1 0 00-1 1v5.19l2.76-2.2a1.25 1.25 0 011.58 0l3.11 2.49 1.1-1.1a1.25 1.25 0 011.77 0l2.68 2.68V4.5a1 1 0 00-1-1H4z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>

      <div className="space-y-1 p-3">
        <p className="truncate text-xs font-medium text-workspace-fg">
          {template.file_name}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-workspace-muted">
          <span>
            {template.width}×{template.height}
          </span>
          <span>·</span>
          <span>{sizeLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-workspace-muted">
            {new Date(template.created_at).toLocaleDateString("zh-CN")}
          </span>
          {template.calibrated ? (
            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              已标定
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              未标定
            </span>
          )}
        </div>
      </div>

      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between p-2 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(template.id)}
          className="h-4 w-4 rounded border-workspace-border text-workspace-accent focus:ring-workspace-accent"
        />
        <button
          type="button"
          onClick={() => onDelete(template.id)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-red-500 shadow-sm transition hover:bg-red-50"
          title="删除"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
          >
            <path
              fillRule="evenodd"
              d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
