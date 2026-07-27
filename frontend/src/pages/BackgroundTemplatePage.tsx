import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { logger } from "../lib/logger";
import type { BackgroundTemplate } from "../types/background";
import {
  listTemplates,
  deleteTemplate,
  batchDeleteTemplates,
  ensureBackgroundThumbnails,
} from "../lib/printEngine/backgroundDb";
import TemplateGrid from "../components/background/TemplateGrid";
import UploadDialog from "../components/background/UploadDialog";
import BatchDeleteBar from "../components/background/BatchDeleteBar";
import { EmptyState } from "../components/common/EmptyState";

export default function BackgroundTemplatePage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<BackgroundTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTemplates();
      setTemplates(list);
      // 首次进入时批量补齐旧模板的缩略图（后续进入瞬时完成）
      if (list.length > 0) {
        await ensureBackgroundThumbnails();
      }
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = search.trim()
    ? templates.filter((t) =>
        t.file_name.toLowerCase().includes(search.toLowerCase()),
      )
    : templates;

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("确定删除此背景模板？");
    if (!confirmed) return;
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      logger.appError(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(
      `确定删除选中的 ${selectedIds.size} 个背景模板？`,
    );
    if (!confirmed) return;
    try {
      await batchDeleteTemplates(Array.from(selectedIds));
      setTemplates((prev) => prev.filter((t) => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
    } catch (err) {
      logger.appError(`批量删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleClick(id: string) {
    navigate(`/calibrate/${id}`);
  }

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-workspace-fg">背景模板</h2>
          <span className="text-xs text-workspace-muted">
            {templates.length} 个模板
            {templates.filter((t) => t.calibrated).length > 0 &&
              ` · ${templates.filter((t) => t.calibrated).length} 个已标定`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-workspace-muted"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                clipRule="evenodd"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索…"
              className="w-40 rounded-lg border border-workspace-border/60 bg-white py-1.5 pl-8 pr-3 text-xs text-workspace-fg placeholder-workspace-muted/50 shadow-sm outline-none transition focus:border-workspace-accent focus:ring-1 focus:ring-workspace-accent/20"
            />
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-workspace-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 2.955a.75.75 0 101.06-1.06l-4.25-4.25a.75.75 0 00-1.06 0l-4.25 4.25a.75.75 0 101.06 1.06L9.25 4.636V13.25z" />
              <path
                fillRule="evenodd"
                d="M2.5 16.5a.75.75 0 01.75-.75h13.5a.75.75 0 010 1.5H3.25a.75.75 0 01-.75-.75z"
                clipRule="evenodd"
              />
            </svg>
            上传
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={handleBatchDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                  clipRule="evenodd"
                />
              </svg>
              删除选中
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-workspace-muted">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            <span className="text-xs">加载中…</span>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title={search ? "无匹配结果" : "暂无背景模板"}
            description={
              search
                ? "尝试其他搜索关键词"
                : "上传背景图片开始制作资料展示图"
            }
            action={
              !search ? (
                <button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700"
                >
                  上传第一个模板
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <TemplateGrid
            templates={filtered}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDelete}
            onClick={handleClick}
          />
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
      />

      <BatchDeleteBar
        selectedCount={selectedIds.size}
        onDelete={handleBatchDelete}
        onCancel={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
