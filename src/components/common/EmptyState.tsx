export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-workspace-accent-light">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-workspace-accent/60">
          <path fillRule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 100 12 6 6 0 000-12zm-.75 4a.75.75 0 011.5 0v2.5a.75.75 0 01-1.5 0V8zm0 4.5a.75.75 0 011.5 0v.5a.75.75 0 01-1.5 0v-.5z" clipRule="evenodd" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-workspace-fg">{title}</div>
      {description ? (
        <div className="max-w-md text-xs text-workspace-muted leading-relaxed">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
