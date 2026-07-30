import { useState } from "react";
import type { FileDetectionResult, DetectionItem, DetectionType } from "../types";
import { DETECTION_LABELS } from "../types";

export default function DetailPage({
  result,
  onBack,
}: {
  result: FileDetectionResult;
  onBack?: () => void;
}) {
  const [items, setItems] = useState<DetectionItem[]>(result.items);

  function toggleDeletion(id: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, markedForDeletion: !item.markedForDeletion } : item
      )
    );
  }

  // 按类型分组排序
  const typeOrder: DetectionType[] = ["watermark", "header", "footer"];
  const sorted = [...items].sort(
    (a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type)
  );

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="mb-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-1 text-workspace-muted transition hover:bg-slate-100 hover:text-workspace-fg"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
          </button>
          <div>
            <h1 className="text-base font-semibold text-workspace-fg">{result.fileName}</h1>
            <p className="text-xs text-workspace-muted">
              {items.filter((i) => i.markedForDeletion).length}/{items.length} 项标记清除
            </p>
          </div>
        </div>
      </div>

      {/* 双栏内容 */}
      <div className="flex flex-1 gap-6 overflow-hidden">
        {/* 左栏：文档预览 */}
        <div className="flex w-[280px] shrink-0 flex-col items-center justify-center rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="mb-4 h-24 w-24 text-slate-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
            {result.fileName}
          </span>
          <span className="mt-1 text-xs text-workspace-muted">
            {items.length} 处检测结果
          </span>
        </div>

        {/* 右栏：检测对象列表 */}
        <div className="flex flex-1 flex-col gap-3 overflow-auto pr-1">
          <h2 className="text-xs font-semibold text-workspace-fg-secondary">检测对象列表</h2>
          {sorted.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-workspace-muted">
              无检测结果
            </div>
          ) : (
            sorted.map((item) => {
              return (
                <div
                  key={item.id}
                  className={
                    "flex items-start gap-4 rounded-xl border px-4 py-3.5 shadow-sm transition " +
                    (item.markedForDeletion
                      ? item.type === "watermark"
                        ? "border-amber-300 bg-amber-50/40"
                        : item.type === "header"
                          ? "border-blue-300 bg-blue-50/40"
                          : "border-green-300 bg-green-50/40"
                      : "border-workspace-border/60 bg-workspace-surface")
                  }
                >
                  {/* 勾选框 */}
                  <button
                    type="button"
                    onClick={() => toggleDeletion(item.id)}
                    className={
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition " +
                      (item.markedForDeletion
                        ? "border-indigo-500 bg-indigo-500 text-white"
                        : "border-workspace-border bg-white")
                    }
                  >
                    {item.markedForDeletion && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>

                  {/* 内容 */}
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {/* 标题行 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
                            (item.type === "watermark"
                              ? "bg-amber-50 text-amber-700"
                              : item.type === "header"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-green-50 text-green-700")
                          }
                        >
                          {DETECTION_LABELS[item.type]}
                        </span>
                        <span className="text-sm font-medium text-workspace-fg">
                          {item.name}
                        </span>
                      </div>
                      {/* 删除开关 */}
                      <label className="flex items-center gap-1.5 text-xs text-workspace-muted">
                        <span>删除</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.markedForDeletion}
                          onClick={() => toggleDeletion(item.id)}
                          className={
                            "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none " +
                            (item.markedForDeletion ? "bg-indigo-500" : "bg-slate-300")
                          }
                        >
                          <span
                            className={
                              "pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out " +
                              (item.markedForDeletion ? "translate-x-3" : "translate-x-0")
                            }
                          />
                        </button>
                      </label>
                    </div>

                    {/* 详情行 */}
                    <div className="flex gap-6 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-workspace-muted">类型:</span>
                        <span className="font-medium text-workspace-fg-secondary">{item.subType}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-workspace-muted">页码:</span>
                        <span className="font-medium text-workspace-fg-secondary tabular-nums">
                          第 {item.page} 页
                        </span>
                      </div>
                    </div>

                    {/* 位置 + 置信度行 */}
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs text-workspace-muted" title={item.location}>
                        {item.location}
                      </span>
                      <span
                        className={
                          "shrink-0 text-xs font-semibold tabular-nums " +
                          (item.confidence >= 90
                            ? "text-emerald-600"
                            : item.confidence >= 75
                              ? "text-amber-600"
                              : "text-slate-500")
                        }
                      >
                        {item.confidence}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
