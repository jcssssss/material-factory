import { useEffect, useRef, useState, useCallback } from "react";
import type { CalibrationCorners } from "../../types/background";

type Props = {
  imageUrl: string;
  imgWidth: number;
  imgHeight: number;
  initialCorners: CalibrationCorners | null;
  onCornersChange: (corners: CalibrationCorners) => void;
};

const CORNER_RADIUS = 8;
const HIT_RADIUS = 14;
const CORNER_LABELS = ["①", "②", "③", "④"];

export function computeDefaultCorners(): CalibrationCorners {
  const rw = Math.min(0.6, (0.8 / Math.SQRT2));
  const rh = rw * Math.SQRT2;
  const cx = (1 - rw) / 2;
  const cy = (1 - rh) / 2;
  return [
    cx, cy,
    cx + rw, cy,
    cx + rw, cy + rh,
    cx, cy + rh,
  ];
}

function validateCorners(corners: CalibrationCorners): string | null {
  for (let i = 0; i < 4; i++) {
    const ni = (i + 1) % 4;
    const dx = corners[ni * 2] - corners[i * 2];
    const dy = corners[ni * 2 + 1] - corners[i * 2 + 1];
    if (dx * dx + dy * dy < 0.0004) {
      return `角点 ${CORNER_LABELS[i]} 与 ${CORNER_LABELS[ni]} 距离过近`;
    }
  }
  const cross = (corners[2] - corners[0]) * (corners[5] - corners[1])
    - (corners[3] - corners[1]) * (corners[4] - corners[0]);
  if (Math.abs(cross) < 0.001) {
    return "四点近似共线，请调整角点位置";
  }
  return null;
}

export default function CornerCalibrator({
  imageUrl,
  imgWidth,
  imgHeight,
  initialCorners,
  onCornersChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [corners, setCorners] = useState<CalibrationCorners>(() =>
    initialCorners ?? computeDefaultCorners(),
  );
  const dragRef = useRef<{ idx: number; mx: number; my: number } | null>(null);

  const img = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (initialCorners) {
      setCorners(initialCorners);
    }
  }, [initialCorners]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // 观察画布容器而非根节点：canvasSize 应基于图片实际绘制区域计算，
    // 若基于根节点会把底部工具条高度也计入，导致图片底部被裁切。
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      const maxW = rect.width - 32;
      const maxH = rect.height - 32;
      const scale = Math.min(maxW / imgWidth, maxH / imgHeight, 1);
      setCanvasSize({
        w: Math.round(imgWidth * scale),
        h: Math.round(imgHeight * scale),
      });
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [imgWidth, imgHeight]);

  const normToCanvas = useCallback(
    (nx: number, ny: number): [number, number] => [
      nx * canvasSize.w,
      ny * canvasSize.h,
    ],
    [canvasSize],
  );

  const canvasToNorm = useCallback(
    (cx: number, cy: number): [number, number] => [
      cx / canvasSize.w,
      cy / canvasSize.h,
    ],
    [canvasSize],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;

    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);

    if (imageUrl) {
      const existing = img.current;
      if (existing && existing.src === imageUrl && existing.complete) {
        ctx.drawImage(existing, 0, 0, canvasSize.w, canvasSize.h);
        drawOverlay(ctx, corners, canvasSize);
      } else {
        const newImg = new Image();
        newImg.onload = () => {
          img.current = newImg;
          ctx.drawImage(newImg, 0, 0, canvasSize.w, canvasSize.h);
          drawOverlay(ctx, corners, canvasSize);
        };
        newImg.src = imageUrl;
      }
    }
  }, [imageUrl, corners, canvasSize]);

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (let i = 0; i < 4; i++) {
      const [cx, cy] = normToCanvas(corners[i * 2], corners[i * 2 + 1]);
      const dx = mx - cx;
      const dy = my - cy;
      if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) {
        dragRef.current = { idx: i, mx, my };
        e.preventDefault();
        return;
      }
    }
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const [nx, ny] = canvasToNorm(
      Math.max(0, Math.min(canvasSize.w, mx)),
      Math.max(0, Math.min(canvasSize.h, my)),
    );
    const next = [...corners] as CalibrationCorners;
    next[drag.idx * 2] = nx;
    next[drag.idx * 2 + 1] = ny;
    setCorners(next);
    onCornersChange(next);
  }

  function handleUp() {
    dragRef.current = null;
  }

  const validationError = validateCorners(corners);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-workspace-border/60 bg-slate-100"
      >
        <canvas
          ref={canvasRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
          style={{ width: canvasSize.w, height: canvasSize.h }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerLeave={handleUp}
        />
      </div>

      {validationError && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-workspace-danger">{validationError}</span>
        </div>
      )}
    </div>
  );
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  corners: CalibrationCorners,
  size: { w: number; h: number },
) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    pts.push([corners[i * 2] * size.w, corners[i * 2 + 1] * size.h]);
  }

  ctx.save();
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
  ctx.fill();

  for (let i = 0; i < 4; i++) {
    const [x, y] = pts[i];
    ctx.beginPath();
    ctx.arc(x, y, CORNER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(CORNER_LABELS[i], x, y - CORNER_RADIUS - 4);
  }

  ctx.restore();
}
