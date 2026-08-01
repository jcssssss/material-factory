import { useEffect, useState, useMemo, useRef } from "react";
import { useLocation, useNavigate, matchPath } from "react-router-dom";
import type { BackgroundTemplate, CalibrationCorners } from "../types/background";
import { getTemplate, saveCalibration, readBackgroundFile } from "../lib/printEngine/backgroundDb";
import CornerCalibrator, { computeDefaultCorners } from "../components/background/CornerCalibrator";
import { cn } from "@/lib/utils";

export default function CalibratePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const id = useMemo(() => {
    const match = matchPath("/calibrate/:id", location.pathname);
    return match?.params?.id;
  }, [location.pathname]);
  // 批量标定队列（由上传页经 ?ids=id1,id2,... 传入）
  const queueIds = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get("ids")?.split(",") ?? []).filter(Boolean);
  }, [location.search]);
  const queueIndex = queueIds.indexOf(id ?? "");
  const hasNext = queueIndex >= 0 && queueIndex < queueIds.length - 1;
  const [template, setTemplate] = useState<BackgroundTemplate | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corners, setCorners] = useState<CalibrationCorners | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // 切换 id（保存并下一张 / 上一步）时进入加载态，但保留旧内容做平滑过渡，避免闪烁
    setLoading(true);
    setCorners(null);
    setError(null);

    if (!id) {
      setError("缺少模板 ID，请从背景模板页重新进入");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const t = await getTemplate(id!);
        if (cancelled) return;

        setTemplate(t);

        const buffer = await readBackgroundFile(t.file_name);
        if (cancelled) return;

        const ext = t.file_name.split(".").pop()?.toLowerCase();
        const mime = ext === "png" ? "image/png" : "image/jpeg";
        const blob = new Blob([buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        imageUrlRef.current = url;
        setImageUrl(url);

        if (t.calibrated && t.a4_x1 !== null) {
          setCorners([
            t.a4_x1, t.a4_y1!,
            t.a4_x2!, t.a4_y2!,
            t.a4_x3!, t.a4_y3!,
            t.a4_x4!, t.a4_y4!,
          ] as CalibrationCorners);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = null;
      }
    };
  }, [id]);

  function handleBack() {
    if (queueIndex > 0) {
      // 批量标定：还有上一张 → 跳转上一张并重新加载
      navigate(`/calibrate/${queueIds[queueIndex - 1]}?ids=${queueIds.join(",")}`);
    } else {
      // 第一张或无队列 → 返回背景模板列表
      navigate("/backgrounds");
    }
  }

  function handleReset() {
    setCorners(computeDefaultCorners());
  }

  async function handleSave() {
    if (!id || !corners) return;
    setSaving(true);
    setError(null);
    try {
      await saveCalibration(id, corners);
      if (hasNext) {
        // 批量标定：保存后自动进入下一张
        navigate(`/calibrate/${queueIds[queueIndex + 1]}?ids=${queueIds.join(",")}`);
      } else {
        navigate("/backgrounds");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !template) {
    // 仅首次进入时显示全屏加载；切换模板时保留旧内容做平滑过渡
    return (
      <div className="flex h-full items-center justify-center text-workspace-muted">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <span className="text-xs">加载模板…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-workspace-danger">{error}</p>
        <button
          type="button"
          onClick={() => navigate("/backgrounds")}
          className="rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white"
        >
          返回背景模板
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1 rounded-lg border border-workspace-border bg-white px-2.5 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
            上一步
          </button>
          <div className="text-xs text-workspace-muted">
            {template && (
              <>
                <span className="font-medium text-workspace-fg">{template.file_name}</span>
                <span className="ml-2">
                  {template.width}×{template.height}
                </span>
              </>
            )}
            {queueIds.length > 1 && queueIndex >= 0 && (
              <span className="ml-3 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                第 {queueIndex + 1}/{queueIds.length} 张
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-workspace-danger">{error}</span>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-lg border border-workspace-border bg-white px-3 py-2 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50"
          >
            重置
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !corners}
            className="inline-flex items-center gap-1.5 rounded-lg bg-workspace-accent px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                保存中…
              </>
            ) : (
              hasNext ? "保存并下一张" : "保存标定"
            )}
          </button>
        </div>
      </div>

      {imageUrl && template && (
        <div
          className={cn(
            // 图片区须是 flex 容器，CornerCalibrator 根节点的 flex-1 才能拉伸高度；
            // 否则高度链断裂，canvas 容器高度坍缩为 0，图片无法显示。
            "relative flex flex-1 transition-opacity duration-300",
            loading ? "opacity-40" : "opacity-100",
          )}
        >
          <CornerCalibrator
            imageUrl={imageUrl}
            imgWidth={template.width}
            imgHeight={template.height}
            initialCorners={corners}
            onCornersChange={setCorners}
          />
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <span className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs text-workspace-muted shadow">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                加载中…
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
