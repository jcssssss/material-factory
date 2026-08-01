// 背景模板图片压缩工具。
// 上传前对超 5MB 的图片压缩到 5MB 以内，
// 避免上传 IPC 传输大字节、以及后端解码超大原图导致的卡顿。

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOAD_MAX_DIM = 4096; // 上传压缩的长边上限

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解码失败"));
    };
    img.src = url;
  });
}

function drawScaled(
  img: HTMLImageElement,
  maxDim: number,
): HTMLCanvasElement {
  const scale = Math.min(
    1,
    maxDim / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("JPEG 编码失败"))),
      "image/jpeg",
      quality,
    );
  });
}

// 超过 maxBytes 的图片压缩到 maxBytes 以内，返回压缩产物；未超限返回 null。
// 策略：等比缩放到长边上限 + 迭代降低 JPEG 质量；仍超限再逐档缩小尺寸。
export async function compressImageToMaxSize(
  file: File,
  maxBytes = UPLOAD_MAX_BYTES,
): Promise<Blob | null> {
  if (file.size <= maxBytes) return null;
  const img = await loadImage(file);
  let maxDim = UPLOAD_MAX_DIM;
  let lastBlob: Blob | null = null;
  for (let round = 0; round < 4; round++) {
    const canvas = drawScaled(img, maxDim);
    let quality = 0.85;
    let blob = await canvasToBlob(canvas, quality);
    while (blob.size > maxBytes && quality > 0.5) {
      quality -= 0.1;
      blob = await canvasToBlob(canvas, quality);
    }
    lastBlob = blob;
    if (blob.size <= maxBytes) return blob;
    maxDim = Math.round(maxDim * 0.8);
  }
  // 极端大图：多轮降质缩小后仍超限，返回当前最小产物（不再强求 ≤maxBytes）
  return (
    lastBlob ?? (await canvasToBlob(drawScaled(img, UPLOAD_MAX_DIM), 0.5))
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
