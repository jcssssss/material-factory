import { useMemo } from "react";
import { useTaskStore } from "../../store/useTaskStore";
import type { PageRuleMode } from "../../types/task";
import { validateFirstN, validateCustomPagesFormat } from "../../lib/pageRule";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">页码规则</Label>
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border bg-background p-0.5 text-xs shadow-sm">
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
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-all",
                mode === opt.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {(mode === "firstN" || mode === "combined") && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">前 N 页</span>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            placeholder="2"
            value={firstNValue}
            onChange={(e) => handleFirstNChange(e.target.value)}
            className={cn("w-20 h-8", firstNFeedback && "border-destructive")}
          />
          {firstNFeedback ? (
            <span className="text-xs text-destructive">{firstNFeedback}</span>
          ) : null}
        </div>
      )}

      {(mode === "custom" || mode === "combined") && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">自定义页码</span>
          <Input
            type="text"
            placeholder="例如：1,3,5-8"
            value={customValue}
            onChange={(e) => setDraft({ customPages: e.target.value })}
            className={cn("flex-1 h-8 font-mono", customFeedback && "border-destructive")}
          />
          {customFeedback ? (
            <span className="shrink-0 text-xs text-destructive">{customFeedback}</span>
          ) : null}
        </div>
      )}

      <div className="rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground leading-snug">
        {mode === "firstN"
          ? "仅按前 N 页导出。"
          : mode === "custom"
          ? "按自定义页码导出。"
          : "合并前 N 页与自定义页码后去重并升序执行。"}
      </div>
    </div>
  );
}
