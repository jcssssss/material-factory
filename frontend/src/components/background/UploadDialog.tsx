import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  saveBackgroundFile,
  addTemplate,
} from "../../lib/printEngine/backgroundDb";
import {
  compressImageToMaxSize,
  UPLOAD_MAX_BYTES,
  formatBytes,
} from "../../lib/backgroundImage";

type Props = {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
};

type UploadStatus = "pending" | "uploading" | "success" | "failed" | "skipped";

type UploadItem = {
  file: File;
  uploadBlob: Blob | null;
  compressing: boolean;
  displaySize: number;
  status: UploadStatus;
  error?: string;
  order: number;
};

type Phase = "idle" | "preparing" | "uploading" | "stopping" | "done";

const CONCURRENCY = 4;

export default function UploadDialog({ open, onClose, onUploaded }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [compressedCount, setCompressedCount] = useState(0);
  const [results, setResults] = useState<{
    ok: string[];
    failed: { name: string; reason: string }[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  // 并发 worker 读取最新 items，避免闭包陈旧
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  if (!open) return null;

  function setStatus(index: number, status: UploadStatus, error?: string) {
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], status, error };
      return copy;
    });
  }

  function handleClose() {
    cancelledRef.current = true;
    setItems([]);
    setResults(null);
    setDone(0);
    setCompressedCount(0);
    setPhase("idle");
    onClose();
  }

  function stopUpload() {
    cancelledRef.current = true;
    if (phase === "preparing") {
      // 压缩阶段停止 → 立即结束（未上传任何图）
      finishWithStop();
    } else if (phase === "uploading") {
      // 上传阶段 → 立即反馈"正在停止"，当前 1-4 张完成后进入 done
      setPhase("stopping");
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    cancelledRef.current = false;
    const next: UploadItem[] = files.map((file, idx) => ({
      file,
      uploadBlob: null,
      compressing: false,
      displaySize: file.size,
      status: "pending",
      order: idx,
    }));
    setItems(next);
    setDone(0);
    setCompressedCount(0);
    setResults(null);
    e.target.value = "";
    void prepare(next);
  }

  // 压缩阶段：超 5MB 的图先压缩，全部就绪后进入上传
  async function prepare(list: UploadItem[]) {
    setPhase("preparing");
    const toCompress = list.filter((i) => i.file.size > UPLOAD_MAX_BYTES);
    // 无需压缩的项从一开始就计入已处理，进度基于所有模板
    setCompressedCount(list.length - toCompress.length);
    if (toCompress.length === 0) {
      if (!cancelledRef.current) {
        setPhase("uploading");
        void startUpload();
      } else {
        finishWithStop();
      }
      return;
    }
    let remain = toCompress.length;
    const tasks = toCompress.map(async (item) => {
      const idx = list.indexOf(item);
      setItems((prev) => {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], compressing: true };
        return copy;
      });
      try {
        const blob = await compressImageToMaxSize(item.file);
        setItems((prev) => {
          const copy = [...prev];
          copy[idx] = blob
            ? { ...copy[idx], uploadBlob: blob, displaySize: blob.size, compressing: false }
            : { ...copy[idx], compressing: false };
          return copy;
        });
      } catch {
        // 压缩失败回退用原始文件上传
        setItems((prev) => {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], compressing: false };
          return copy;
        });
      } finally {
        remain -= 1;
        setCompressedCount((c) => c + 1);
        if (remain === 0) {
          // 压缩全部完成：若未停止则开始上传，否则直接结束
          if (!cancelledRef.current) {
            setPhase("uploading");
            void startUpload();
          } else {
            finishWithStop();
          }
        }
      }
    });
    await Promise.all(tasks);
  }

  function finishWithStop() {
    setItems((prev) =>
      prev.map((it) =>
        it.status === "pending" ? { ...it, status: "skipped" as UploadStatus } : it,
      ),
    );
    setPhase("done");
    setResults({ ok: [], failed: [] });
  }

  // 并行上传（小并发），单张失败仅记录不中断
  async function startUpload() {
    const ok: { id: string; order: number }[] = [];
    const failed: { name: string; reason: string }[] = [];
    let completed = 0;
    let next = 0;
    const total = itemsRef.current.length;

    const worker = async () => {
      while (!cancelledRef.current && next < total) {
        const i = next++;
        const item = itemsRef.current[i];
        setStatus(i, "uploading");
        try {
          const src = item.uploadBlob ?? item.file;
          const buffer = await src.arrayBuffer();
          const saved = await saveBackgroundFile(new Uint8Array(buffer));
          const id = await addTemplate(
            saved.file_name,
            saved.width,
            saved.height,
            item.displaySize,
          );
          setStatus(i, "success");
          ok.push({ id, order: item.order });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          setStatus(i, "failed", reason);
          failed.push({ name: item.file.name, reason });
        }
        completed += 1;
        setDone(completed);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    );

    // 停止后未处理项标 skipped
    setItems((prev) =>
      prev.map((it) =>
        it.status === "pending" ? { ...it, status: "skipped" as UploadStatus } : it,
      ),
    );

    // 按用户选择顺序排列成功 id，供依次标定
    const orderedIds = [...ok].sort((a, b) => a.order - b.order).map((x) => x.id);

    setPhase("done");
    setResults({ ok: orderedIds, failed });
    if (orderedIds.length > 0) onUploaded();

    // 单张成功且无失败 → 自动进入标定（停止场景不自动跳转）
    if (orderedIds.length === 1 && failed.length === 0 && !cancelledRef.current) {
      handleClose();
      navigate(`/calibrate/${orderedIds[0]}?ids=${orderedIds.join(",")}`);
    }
  }

  const total = items.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const preparePercent =
    total > 0 ? Math.round((compressedCount / total) * 100) : 0;
  const compressingCount = items.filter((i) => i.compressing).length;
  const busy = phase === "preparing" || phase === "uploading";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-workspace-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-workspace-fg">
            上传背景模板
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="text-workspace-muted transition hover:text-workspace-fg disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {items.length === 0 ? (
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-workspace-border/60 p-10 transition hover:border-workspace-accent/50 hover:bg-slate-50"
            onClick={() => inputRef.current?.click()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mb-2 h-8 w-8 text-workspace-muted/50"
            >
              <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 2.955a.75.75 0 101.06-1.06l-4.25-4.25a.75.75 0 00-1.06 0l-4.25 4.25a.75.75 0 101.06 1.06L9.25 4.636V13.25z" />
              <path
                fillRule="evenodd"
                d="M2.5 16.5a.75.75 0 01.75-.75h13.5a.75.75 0 010 1.5H3.25a.75.75 0 01-.75-.75z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-xs text-workspace-muted">点击选择图片</p>
            <p className="text-[10px] text-workspace-muted/60">
              支持 JPG / PNG · 可一次选择多张
            </p>
            <p className="mt-1 text-[10px] text-workspace-muted/50">
              要求尺寸 3:4 竖版（1242 × 1656 px），其他比例将等比缩放并白底补齐
            </p>
            <p className="text-[10px] text-workspace-muted/50">
              建议单张图片 ≤ 5MB，超出将自动压缩
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="hidden"
              onChange={handleFilePick}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {/* 文件列表 + 状态 */}
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.file.name}
                  className="flex items-center gap-2 rounded-lg border border-workspace-border/60 px-2 py-1.5"
                >
                  <StatusIcon status={item.status} />
                  <span className="min-w-0 flex-1 truncate text-xs text-workspace-fg-secondary">
                    {item.file.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-workspace-muted">
                    {item.compressing
                      ? "压缩中…"
                      : formatBytes(item.displaySize)}
                  </span>
                </div>
              ))}
            </div>

            {/* 进度 / 结果 */}
            {phase === "preparing" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-workspace-fg-secondary">
                  <span>
                    {compressingCount > 0
                      ? `正在压缩 ${compressingCount} 张…`
                      : "准备上传…"}
                  </span>
                  <button
                    type="button"
                    onClick={stopUpload}
                    className="rounded-lg border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50"
                  >
                    停止
                  </button>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-300"
                    style={{ width: `${preparePercent}%` }}
                  />
                </div>
              </div>
            ) : phase === "uploading" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-workspace-fg-secondary">
                  <span>
                    正在上传（{done}/{total}）
                  </span>
                  <button
                    type="button"
                    onClick={stopUpload}
                    disabled={cancelledRef.current}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelledRef.current ? "停止中…" : "停止上传"}
                  </button>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ) : phase === "stopping" ? (
              <div className="flex items-center gap-2 text-xs text-workspace-fg-secondary">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-workspace-accent border-t-transparent" />
                正在停止，等待当前上传完成…
              </div>
            ) : results ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-workspace-fg">
                  {results.failed.length > 0 || results.ok.length === 0
                    ? "上传完成"
                    : "全部上传成功"}
                </p>
                <div className="flex items-center gap-2 text-xs text-workspace-fg-secondary">
                  <span className="text-green-600">
                    成功 {results.ok.length} 张
                  </span>
                  {results.failed.length > 0 && (
                    <span className="text-red-600">
                      失败 {results.failed.length} 张
                    </span>
                  )}
                </div>
                {results.failed.length > 0 && (
                  <div className="max-h-24 overflow-y-auto rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    {results.failed.map((f) => (
                      <div key={f.name} title={f.reason}>
                        {f.name}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  {results.ok.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        handleClose();
                        navigate(`/calibrate/${results.ok[0]}?ids=${results.ok.join(",")}`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700"
                    >
                      去标定
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-lg border border-workspace-border bg-white px-4 py-2 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50"
                  >
                    完成
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: UploadStatus }) {
  switch (status) {
    case "uploading":
      return (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-workspace-accent border-t-transparent" />
      );
    case "success":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-100 text-[10px] font-bold text-green-600">
          ✓
        </span>
      );
    case "failed":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-600">
          ✕
        </span>
      );
    case "skipped":
      return (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500">
          −
        </span>
      );
    default:
      return (
        <span className="h-4 w-4 shrink-0 rounded-full border border-workspace-border" />
      );
  }
}
