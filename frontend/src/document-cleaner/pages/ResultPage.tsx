import { useState } from "react";
import type { FileDetectionResult, DetectionItem, DetectionType } from "../types";
import { DETECTION_LABELS } from "../types";

export default function ResultPage({
  results,
  onStartClean,
  onBackToTasks,
  onViewDetail,
}: {
  results: FileDetectionResult[];
  onStartClean?: () => void;
  onBackToTasks?: () => void;
  onViewDetail?: (fileName: string) => void;
}) {
  // 默认选中第一个文件的结果
  const [activeFile, setActiveFile] = useState<string>(
    results[0]?.fileName ?? ""
  );
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const current = results.find((r) => r.fileName === activeFile);

  const visibleItems = current?.items.filter((i) => !ignored.has(i.id)) ?? [];

  function toggleIgnore(item: DetectionItem) {
    setIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }

  // 汇总统计（所有文件）
  const totalByType: Record<DetectionType, number> = { watermark: 0, header: 0, footer: 0 };
  let totalCleanable = 0;
  for (const r of results) {
    for (const item of r.items) {
      totalByType[item.type] = (totalByType[item.type] ?? 0) + 1;
      if (!ignored.has(item.id)) totalCleanable += 1;
    }
  }

  // 当前文件统计
  const countByType: Record<DetectionType, number> = { watermark: 0, header: 0, footer: 0 };
  for (const item of current?.items ?? []) {
    countByType[item.type] = (countByType[item.type] ?? 0) + 1;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* 检测完成头 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-emerald-600">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-workspace-fg">检测完成</h1>
            <p className="text-xs text-workspace-muted">共扫描 {results.length} 个文件</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onStartClean}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 5.25a.75.75 0 00-.75.75v8a.75.75 0 001.28.53l6.25-6.25a.75.75 0 000-1.06L7.28 5.22a.75.75 0 00-.53-.22z" clipRule="evenodd" />
            </svg>
            开始清理
          </button>
          <button
            type="button"
            onClick={onBackToTasks}
            className="inline-flex items-center gap-1.5 rounded-lg border border-workspace-border/60 bg-white px-3.5 py-2 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
          >
            返回任务中心
          </button>
        </div>
      </div>

      {/* 汇总统计卡片 */}
      <div className="flex gap-4">
        {(["watermark", "header", "footer"] as DetectionType[]).map((t) => (
          <div
            key={t}
            className="flex flex-1 items-center gap-3 rounded-xl border border-workspace-border/60 bg-workspace-surface p-4 shadow-card"
          >
            <div
              className={
                "flex h-10 w-10 items-center justify-center rounded-lg " +
                (t === "watermark"
                  ? "bg-amber-50 text-amber-600"
                  : t === "header"
                    ? "bg-blue-50 text-blue-600"
                    : "bg-green-50 text-green-600")
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path fillRule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5z" />
              </svg>
            </div>
            <div>
              <div className="text-xs text-workspace-muted">{DETECTION_LABELS[t]}</div>
              <div className="text-xl font-bold text-workspace-fg">
                {totalByType[t]}
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-1 items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-card">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <div className="text-xs text-indigo-600">可清理</div>
            <div className="text-xl font-bold text-indigo-700">
              {totalCleanable}
            </div>
          </div>
        </div>
      </div>

      {/* 文件切换 */}
      {results.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {results.map((r) => (
            <button
              key={r.fileName}
              type="button"
              onClick={() => setActiveFile(r.fileName)}
              onDoubleClick={() => onViewDetail?.(r.fileName)}
              title="双击查看详情"
              className={
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition " +
                (activeFile === r.fileName
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-workspace-border/60 bg-workspace-surface text-workspace-muted hover:border-workspace-border")
              }
            >
              {r.fileName}
            </button>
          ))}
        </div>
      ) : null}
      {current && results.length <= 1 ? (
        <button
          type="button"
          onClick={() => onViewDetail?.(current.fileName)}
          className="group flex items-center gap-2 text-sm text-workspace-fg-secondary transition hover:text-indigo-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-indigo-500">
            <path d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5z" />
          </svg>
          {current.fileName}
          <span className="text-workspace-muted/60">
            · {current.items.length} 处疑似内容
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="ml-1 h-3.5 w-3.5 text-workspace-muted/40 transition group-hover:text-indigo-400">
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        </button>
      ) : null}

      {/* 检测明细表格 */}
      {current && (
        <div className="overflow-hidden rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-workspace-border/40 bg-slate-50/80 text-xs font-medium text-workspace-muted">
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">页码</th>
                <th className="px-4 py-3 font-medium">位置</th>
                <th className="px-4 py-3 font-medium">置信度</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {current.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-workspace-muted">
                    未检测到需要清理的内容
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-workspace-border/20 transition-colors last:border-0 hover:bg-slate-50/60"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium " +
                          (item.type === "watermark"
                            ? "bg-amber-50 text-amber-700"
                            : item.type === "header"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-green-50 text-green-700")
                        }
                      >
                        {DETECTION_LABELS[item.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-workspace-fg-secondary tabular-nums">
                      第 {item.page} 页
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-workspace-fg-secondary" title={item.location}>
                      {item.location}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "text-xs font-medium " +
                          (item.confidence >= 90
                            ? "text-emerald-600"
                            : item.confidence >= 75
                              ? "text-amber-600"
                              : "text-slate-500")
                        }
                      >
                        {item.confidence}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewDetail?.(current.fileName)}
                          className="rounded-md px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
                        >
                          详情
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleIgnore(item)}
                          className={
                            "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                            (ignored.has(item.id)
                              ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                              : "border border-workspace-border/60 bg-white text-workspace-muted hover:bg-slate-50")
                          }
                        >
                          {ignored.has(item.id) ? "恢复" : "忽略"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
