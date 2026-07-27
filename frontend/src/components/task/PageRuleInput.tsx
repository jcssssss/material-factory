import { useMemo } from "react";
import { useTaskStore } from "../../store/useTaskStore";
import type { PageRuleMode } from "../../types/task";
import { validateFirstN, validateCustomPagesFormat } from "../../lib/pageRule";

export function PageRuleInput() {
  const draft = useTaskStore((s) => s.draft);
  const setDraft = useTaskStore((s) => s.setDraft);

  const mode: PageRuleMode = draft.pageRuleMode ?? "firstN";

  function setMode(next: PageRuleMode) {
    setDraft({ pageRuleMode: next });
  }

  const firstNValue =
    draft.firstN === undefined ? "" : String(draft.firstN);
  const customValue = draft.customPages ?? "";

  const firstNFeedback = useMemo(() => {
    if (mode !== "firstN" && mode !== "combined") return null;
    if (firstNValue === "") return null;
    const result = validateFirstN(firstNValue);
    return result.error ?? null;
  }, [firstNValue, mode]);

  const customFeedback = useMemo(() => {
    if (mode !== "custom" && mode !== "combined") return null;
    if (customValue.trim() === "") return null;
    const result = validateCustomPagesFormat(customValue);
    return result.ok ? null : result.error ?? null;
  }, [customValue, mode]);

  function handleFirstNChange(raw: string) {
    if (raw === "") {
      setDraft({ firstN: undefined });
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      setDraft({ firstN: undefined });
      return;
    }
    setDraft({ firstN: parsed });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-workspace-fg-secondary">页码规则</span>
        <div className="flex rounded-lg border border-workspace-border/60 bg-white p-0.5 text-xs shadow-sm">
          {(
            [
              { key: "firstN", label: "前 N 页" },
              { key: "custom", label: "自定义" },
              { key: "combined", label: "混合" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              className={
                "rounded-md px-2.5 py-1 font-medium transition-all " +
                (mode === opt.key
                  ? "bg-workspace-accent text-white shadow-sm"
                  : "text-workspace-fg-secondary hover:text-workspace-fg")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {(mode === "firstN" || mode === "combined") && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-workspace-fg-secondary">前 N 页</span>
            {firstNFeedback ? (
              <span className="text-xs text-workspace-danger">
                {firstNFeedback}
              </span>
            ) : null}
          </span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="例如：5"
            value={firstNValue}
            onChange={(e) => handleFirstNChange(e.target.value)}
            className={
              "w-32 rounded-lg border bg-white px-2 py-2 text-sm transition focus:outline-none " +
              (firstNFeedback
                ? "border-workspace-danger focus:border-workspace-danger focus:ring-2 focus:ring-workspace-danger/10"
                : "border-workspace-border focus:border-workspace-accent focus:ring-2 focus:ring-workspace-accent/10")
            }
          />
        </label>
      )}

      {(mode === "custom" || mode === "combined") && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-2">
            <span className="text-xs font-medium text-workspace-fg-secondary">自定义页码</span>
            <span className="text-xs text-workspace-muted">
              支持单页与范围，例如：1,3,5-8
            </span>
            {customFeedback ? (
              <span className="text-xs text-workspace-danger">
                {customFeedback}
              </span>
            ) : null}
          </span>
          <input
            type="text"
            placeholder="例如：1,3,5-8"
            value={customValue}
            onChange={(e) =>
              setDraft({ customPages: e.target.value })
            }
            className={
              "w-full max-w-md rounded-lg border bg-white px-3 py-2 font-mono text-sm transition focus:outline-none " +
              (customFeedback
                ? "border-workspace-danger focus:border-workspace-danger focus:ring-2 focus:ring-workspace-danger/10"
                : "border-workspace-border focus:border-workspace-accent focus:ring-2 focus:ring-workspace-accent/10")
            }
          />
        </label>
      )}

      <div className="rounded-lg bg-workspace-accent-light px-3 py-2 text-xs text-workspace-fg-secondary">
        {mode === "firstN"
          ? "仅按前 N 页导出。"
          : mode === "custom"
          ? "按自定义页码导出。"
          : "合并前 N 页与自定义页码后去重并升序执行。"}
      </div>
    </div>
  );
}
