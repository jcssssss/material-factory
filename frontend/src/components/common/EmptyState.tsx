import type { ReactNode } from "react";
import { Search, Check, LoaderCircle } from "lucide-react";

const ICONS: Record<string, ReactNode> = {
  search: <Search className="h-5 w-5 text-primary/60" />,
  check: <Check className="h-5 w-5 text-emerald-500" />,
  spinner: <LoaderCircle className="h-5 w-5 animate-spin text-primary" />,
};

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        {icon ? ICONS[icon] ?? ICONS.search : ICONS.search}
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {description ? (
        <div className="max-w-md text-xs text-muted-foreground leading-relaxed">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
