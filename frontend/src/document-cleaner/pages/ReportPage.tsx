import type { CleanReport } from "../types";
import { EmptyState } from "../../components/common/EmptyState";

export default function ReportPage({
  report,
}: {
  report?: CleanReport | null;
}) {
  if (!report) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon="search"
          title="清理报告"
          description="任务执行完成后，此处将展示详细的清理报告。"
        />
      </div>
    );
  }

  const { totalFiles, successCount, failedCount, skippedCount } = report;

  const failedFiles = report.files.filter((f) => f.status !== "success");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* 完成头 */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-emerald-600">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-semibold text-workspace-fg">任务完成</h1>
          <p className="text-xs text-workspace-muted">
            {new Date(report.completedAt).toLocaleString("zh-CN")}
          </p>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-workspace-border/60 bg-workspace-surface p-4 shadow-card">
          <div className="text-xs text-workspace-muted">总文件</div>
          <div className="mt-1 text-2xl font-bold text-workspace-fg">{totalFiles}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-card">
          <div className="text-xs text-emerald-600">成功</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">{successCount}</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 shadow-card">
          <div className="text-xs text-red-600">失败</div>
          <div className="mt-1 text-2xl font-bold text-red-700">{failedCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-card">
          <div className="text-xs text-slate-500">跳过</div>
          <div className="mt-1 text-2xl font-bold text-slate-600">{skippedCount}</div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-workspace-border/60 bg-white px-4 py-2 text-sm font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clipRule="evenodd" />
          </svg>
          查看日志
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-workspace-border/60 bg-white px-4 py-2 text-sm font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M4.75 3A1.75 1.75 0 003 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM2 8.76v6.49A1.75 1.75 0 003.75 17h12.5A1.75 1.75 0 0018 15.25V8.76a3.235 3.235 0 00-1.75-.51H3.75c-.645 0-1.245.188-1.75.51z" />
          </svg>
          打开目录
        </button>
        <button
          type="button"
          disabled={failedCount === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clipRule="evenodd" />
          </svg>
          重新处理失败
        </button>
      </div>

      {/* 失败/跳过文件列表 */}
      {failedFiles.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
          <div className="border-b border-workspace-border/40 bg-slate-50/80 px-5 py-2.5 text-xs font-medium text-workspace-muted">
            异常文件
          </div>
          <div className="divide-y divide-workspace-border/20">
            {failedFiles.map((f) => (
              <div key={f.fileName} className="flex items-center justify-between px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium " +
                      (f.status === "failed"
                        ? "bg-red-50 text-red-700"
                        : "bg-slate-100 text-slate-600")
                    }
                  >
                    {f.status === "failed" ? "失败" : "跳过"}
                  </span>
                  <span className="truncate text-sm text-workspace-fg">{f.fileName}</span>
                </div>
                {f.error && (
                  <span className="shrink-0 text-xs text-workspace-muted">{f.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
