import { logger } from "../../lib/logger";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

type PickMode = "singlePdf" | "multiPdf" | "folder" | "outputDir";

const PDF_FILTER = {
  name: "PDF",
  extensions: ["pdf"],
};
const WORD_FILTER = {
  name: "Word",
  extensions: ["docx", "doc"],
};
const INPUT_FILTERS = [PDF_FILTER, WORD_FILTER];

async function pickPaths(mode: PickMode): Promise<string[] | null> {
  switch (mode) {
    case "singlePdf":
      return open({
        multiple: false,
        filters: INPUT_FILTERS,
      }).then((r) => (r ? (Array.isArray(r) ? r : [r]) : null));
    case "multiPdf":
      return open({
        multiple: true,
        filters: INPUT_FILTERS,
      }).then((r) => (r ? (Array.isArray(r) ? r : [r]) : null));
    case "folder":
    case "outputDir":
      return open({
        directory: true,
        multiple: false,
      }).then((r) => (r ? (Array.isArray(r) ? r : [r]) : null));
    default:
      return null;
  }
}

export function FilePickerButton({
  mode,
  label,
  onPick,
  disabled,
  variant = "default",
}: {
  mode: PickMode;
  label: string;
  onPick: (paths: string[]) => void;
  disabled?: boolean;
  variant?: "default" | "primary";
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const result = await pickPaths(mode);
      if (result && result.length > 0) {
        onPick(result);
      }
    } catch (err) {
      logger.appWarn(`文件选择失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50";
  const tone =
    variant === "primary"
      ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-sm hover:shadow-md"
      : "border border-workspace-border/60 bg-white text-workspace-fg-secondary shadow-sm hover:bg-slate-50 hover:shadow";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || disabled}
      className={`${base} ${tone}`}
    >
      {busy ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {label}
    </button>
  );
}
