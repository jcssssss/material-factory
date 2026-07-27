import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  saveBackgroundFile,
  addTemplate,
} from "../../lib/printEngine/backgroundDb";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function UploadDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setShowConfirm(false);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  }

  function handleStartUpload() {
    setShowConfirm(true);
    setError(null);
  }

  async function handleConfirm() {
    if (!file) return;
    setShowConfirm(false);
    setLoading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop() || "png";
      const buffer = await file.arrayBuffer();
      const result = await saveBackgroundFile(new Uint8Array(buffer), ext);
      const id = await addTemplate(
        result.file_name,
        result.width,
        result.height,
        file.size,
      );
      onClose();
      navigate(`/calibrate/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setError(null);
    setShowConfirm(false);
    onClose();
  }

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
            className="text-workspace-muted transition hover:text-workspace-fg"
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

        {!previewUrl ? (
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
              支持 JPG / PNG · 要求尺寸 3:4 竖版（1242 × 1656 px）
            </p>
            <p className="mt-1 text-[10px] text-workspace-muted/50">
              非 3:4 比例将自动等比缩放并白底补齐
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleFilePick}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-workspace-border/60 bg-slate-100">
              <img
                src={previewUrl}
                alt="预览"
                className="mx-auto max-h-64 object-contain"
              />
            </div>
            <p className="text-xs text-workspace-fg-secondary">{file?.name}</p>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                  setFile(null);
                }}
                disabled={loading}
                className="rounded-lg border border-workspace-border bg-white px-4 py-2 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50 disabled:opacity-50"
              >
                重新选择
              </button>
              <button
                type="button"
                onClick={handleStartUpload}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                确认上传
              </button>
            </div>
          </div>
        )}

        {/* 尺寸确认弹窗 */}
        {showConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-workspace-surface p-6 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-workspace-fg">
                  尺寸要求确认
                </h3>
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-workspace-fg-secondary">
                <p>
                  背景模板要求尺寸为{" "}
                  <span className="font-medium text-workspace-fg">
                    3:4 竖版（1242 × 1656 px）
                  </span>
                  。
                </p>
                <ul className="mt-2 list-inside list-disc space-y-0.5">
                  <li>接近 3:4 的比例将直接缩放至目标尺寸</li>
                  <li>其他比例将等比缩放后居中放置，白底补齐</li>
                </ul>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="rounded-lg border border-workspace-border bg-white px-4 py-2 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700"
                >
                  {loading ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      上传中…
                    </span>
                  ) : (
                    "确认上传"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
