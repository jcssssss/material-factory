// 手写下拉选择组件：触发器对齐 Input 视觉，面板用 workspace 配色。
// 支持点击外部 / Esc 关闭、选中打勾、「手动输入…」尾部动作。

import * as React from "react";
import { Check, ChevronDown, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
  /** 点击「手动输入…」触发（切换到自由输入模式） */
  onManualInput?: () => void;
}

export function Select({
  value,
  options,
  placeholder,
  disabled,
  className,
  onChange,
  onManualInput,
}: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // 选项列表：当前值不在列表里时，固定置顶展示「自定义：xxx」。
  const items: SelectOption[] = React.useMemo(() => {
    const list: SelectOption[] = [];
    if (value.trim() !== "" && !options.includes(value)) {
      list.push({ value, label: `自定义：${value}` });
    }
    for (const o of options) {
      list.push({ value: o, label: o });
    }
    return list;
  }, [value, options]);

  // 点击外部关闭
  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = items.find((i) => i.value === value);
  const selectedLabel = selected ? selected.label : value || placeholder || "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-ring ring-2 ring-ring/25"
        )}
      >
        <span
          className={cn(
            "truncate",
            !selected && !value && "text-muted-foreground"
          )}
        >
          {selectedLabel}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1.5 max-h-72 overflow-auto rounded-lg border border-workspace-border bg-workspace-surface py-1 shadow-lg shadow-black/5"
        >
          {items.map((item) => {
            const active = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-workspace-accent-light text-workspace-accent"
                    : "text-workspace-fg hover:bg-workspace-accent-light/60"
                )}
              >
                <span className="truncate">{item.label}</span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
          {onManualInput && (
            <>
              <div className="my-1 h-px bg-workspace-border" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onManualInput();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-workspace-muted transition-colors hover:bg-workspace-accent-light/60 hover:text-workspace-fg"
              >
                <PenLine className="h-3.5 w-3.5 shrink-0" />
                手动输入…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
