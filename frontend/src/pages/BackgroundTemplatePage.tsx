import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Image as ImageIcon, CheckCheck, X, Filter } from "lucide-react";
import { logger } from "../lib/logger";
import { useTaskStore } from "../store/useTaskStore";
import { Tip } from "../components/common/Tip";
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
import InfiniteScrollSentinel from "../components/common/InfiniteScrollSentinel";
import { useInfiniteScroll } from "../lib/useInfiniteScroll";

export default function BackgroundTemplatePage() {
  const navigate = useNavigate();
  const setDraft = useTaskStore((s) => s.setDraft);
  const [searchParams] = useSearchParams();
  // 从工作台跳转 ?select=1 进入"选择模板"模式：屏蔽操作，单选已标定模板返回
  const selectMode = searchParams.get("select") === "1";
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
      // 立即渲染列表；缺失缩略图后台补齐，由卡片重试机制自动显示
      if (list.length > 0) {
        void ensureBackgroundThumbnails().catch(() => {});
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

  const filtered = useMemo(
    () =>
      search.trim()
        ? templates.filter((t) =>
            t.file_name.toLowerCase().includes(search.toLowerCase()),
          )
        : templates,
    [templates, search],
  );

  const {
    visibleItems: visibleTemplates,
    hasMore,
    sentinelRef,
  } = useInfiniteScroll(filtered, 12);

  function handleToggleSelect(id: string) {
    if (selectMode) {
      // 选择模式：单选，仅已标定模板可选
      const t = templates.find((x) => x.id === id);
      if (!t || !t.calibrated) return;
      setSelectedIds((prev) => (prev.has(id) ? new Set() : new Set([id])));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    setSelectedIds(new Set(filtered.map((t) => t.id)));
  }

  function handleSelectUncalibrated() {
    setSelectedIds(
      new Set(filtered.filter((t) => !t.calibrated).map((t) => t.id)),
    );
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
  }

  function handleConfirmSelect() {
    const selected = Array.from(selectedIds);
    if (selected.length === 0) return;
    // 将选中模板 id 写回工作台草稿，返回工作台
    setDraft({ backgroundTemplateIds: selected });
    navigate("/");
  }

  async function handleDelete(id: string) {
    // Tauri v2 WKWebView 下 window.confirm 会触发不存在的 dialog.confirm 命令，
    // 必须改用 plugin-dialog 的 confirm()（capability 已允许 dialog:allow-confirm）。
    const confirmed = await confirm("确定删除此背景模板？", {
      title: "删除背景模板",
      kind: "warning",
    });
    if (!confirmed) return;
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      logger.appError(
        `删除失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm(
      `确定删除选中的 ${selectedIds.size} 个背景模板？`,
      { title: "批量删除背景模板", kind: "warning" },
    );
    if (!confirmed) return;
    try {
      await batchDeleteTemplates(Array.from(selectedIds));
      setTemplates((prev) => prev.filter((t) => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
    } catch (err) {
      logger.appError(
        `批量删除失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function handleClick(id: string) {
    navigate(`/calibrate/${id}`);
  }

  function handleBatchCalibrate() {
    const ids = templates.filter((t) => selectedIds.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    navigate(`/calibrate/${ids[0]}?ids=${ids.join(",")}`);
    setSelectedIds(new Set());
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* 顶部 card：标题 + 统计 + 搜索/上传 */}
      <div className="shrink-0 rounded-xl border bg-card px-5 py-4 shadow-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-workspace-accent/10">
              <ImageIcon className="h-4 w-4 text-workspace-accent" />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-workspace-fg">
                  {selectMode ? "选择背景模板" : "背景模板"}
                </h2>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {templates.length} 个模板
                </span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  {templates.filter((t) => t.calibrated).length} 个已标定
                </span>
              </div>
              <p className="text-[11px] text-workspace-muted">
                {selectMode
                  ? "选择用于仿打印合成的背景图"
                  : "上传并标定用于仿打印合成的背景图"}
              </p>
            </div>
          </div>
          {!selectMode && (
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
                  className="w-40 rounded-lg border border-workspace-border/60 bg-white py-1.5 pl-8 pr-7 text-xs text-workspace-fg placeholder-workspace-muted/50 shadow-sm outline-none transition focus:border-workspace-accent focus:ring-1 focus:ring-workspace-accent/20"
                />
                {search && (
                  <Tip label="清除搜索">
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-workspace-muted transition hover:text-workspace-fg"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                      </svg>
                    </button>
                  </Tip>
                )}
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
            </div>
          )}
        </div>
      </div>

      {/* 底部列表 card：工具栏 + 模板网格 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-card">
        {!selectMode && (
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <button
              type="button"
              onClick={handleSelectAll}
              className="inline-flex items-center gap-1 rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:border-workspace-accent/40 hover:text-workspace-accent"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              全选
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              className="inline-flex items-center gap-1 rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:border-workspace-accent/40 hover:text-workspace-accent"
            >
              <X className="h-3.5 w-3.5" />
              取消
            </button>
            <button
              type="button"
              onClick={handleSelectUncalibrated}
              className="inline-flex items-center gap-1 rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:border-workspace-accent/40 hover:text-workspace-accent"
            >
              <Filter className="h-3.5 w-3.5" />
              选择未标定
            </button>
            <span className="ml-auto">
              {selectedIds.size > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-workspace-accent/10 px-2.5 py-1 text-xs font-medium text-workspace-accent">
                  已选择 {selectedIds.size} 项
                </span>
              )}
            </span>
          </div>
        )}

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
                search ? "尝试其他搜索关键词" : "上传背景图片开始制作资料展示图"
              }
              action={
                !search && !selectMode ? (
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
          <div className="flex-1 overflow-auto p-4">
            <TemplateGrid
              templates={visibleTemplates}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onDelete={handleDelete}
              onClick={handleClick}
              selectMode={selectMode}
            />
            <InfiniteScrollSentinel ref={sentinelRef} hasMore={hasMore} />
          </div>
        )}
      </div>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => void load()}
      />

      {!selectMode && (
        <BatchDeleteBar
          selectedCount={selectedIds.size}
          onDelete={handleBatchDelete}
          onCancel={() => setSelectedIds(new Set())}
          onCalibrate={handleBatchCalibrate}
        />
      )}

      {selectMode && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="flex items-center gap-4 rounded-xl border border-indigo-200 bg-white px-5 py-3 shadow-lg">
            <span className="text-sm text-workspace-fg">
              {selectedIds.size > 0
                ? "已选择 1 个模板"
                : "请选择已标定的背景模板"}
            </span>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmSelect}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-1 rounded-lg bg-workspace-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
