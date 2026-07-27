import type { TaskStatus } from "../../types/task";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_TONE,
} from "../../types/task";

type Tone = "muted" | "accent" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<Tone, string> = {
  muted: "bg-slate-100 text-slate-600",
  accent: "bg-indigo-50 text-indigo-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
};

const DOT_CLASSES: Record<Tone, string> = {
  muted: "bg-slate-400",
  accent: "bg-indigo-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

export function StatusBadge({
  status,
}: {
  status: TaskStatus;
}) {
  const tone = TASK_STATUS_TONE[status];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium " +
        TONE_CLASSES[tone]
      }
    >
      <span className={"h-1.5 w-1.5 rounded-full " + DOT_CLASSES[tone]} />
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

export function ToneBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
        TONE_CLASSES[tone]
      }
    >
      {children}
    </span>
  );
}
