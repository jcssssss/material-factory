import type { TaskStatus } from "../../types/task";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_TONE,
} from "../../types/task";
import { Badge } from "../ui/badge";
import { cn } from "@/lib/utils";

type Tone = "muted" | "accent" | "success" | "warning" | "danger";

const DOT_CLASSES: Record<Tone, string> = {
  muted: "bg-slate-400",
  accent: "bg-primary",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
};

const BADGE_VARIANTS: Record<Tone, string> = {
  muted: "bg-slate-100 text-slate-600 hover:bg-slate-100 border-0",
  accent: "bg-primary/10 text-primary hover:bg-primary/10 border-0",
  success: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-0",
  warning: "bg-amber-50 text-amber-700 hover:bg-amber-50 border-0",
  danger: "bg-destructive/10 text-destructive hover:bg-destructive/10 border-0",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const tone = TASK_STATUS_TONE[status];
  return (
    <Badge className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 font-medium", BADGE_VARIANTS[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[tone])} />
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <Badge className={cn("px-2.5 py-0.5 font-medium", BADGE_VARIANTS[tone])}>
      {children}
    </Badge>
  );
}
