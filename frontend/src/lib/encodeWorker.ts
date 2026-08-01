// 共享图片编码 Worker：把「3:4 合成 + JPEG 编码」从主线程移出。
//
// 背景：主 PDF→JPG 链路中 canvas.toBlob("image/jpeg", 1.0) 在主线程同步编码
// 1242×1656（2.06M 像素），是单页最重的主线程阻塞点（旧 2475×3300 时 0.5~2s/页）。
// 本模块复用 printEngine/compositor 的 worker 模式（内嵌 worker 代码 + reqId 路由
// + transfer 零拷贝），把合成与编码放后台线程，主线程仅做 pdf.js 光栅化与提交。
//
// 设计：
//   - 尺寸/质量作为消息参数传入，同一 Worker 服务主输出（1242×1656）与资料列表图。
//   - Worker 返回原始 JPEG（不嵌 DPI）；DPI 注入由调用方决定
//     （主 PDF 输出嵌 TARGET_DPI，资料列表按 spec 不嵌），Worker 保持通用。
//   - OffscreenCanvas 按 W×H 缓存复用，避免每页新建 GPU surface。

import { JPEG_QUALITY } from "./exportImage";

// ─── Web Worker：Canvas 合成 + JPEG 编码 ───
const ENCODE_WORKER_CODE = `
var canvasCache = {};  // 按 "WxH" 缓存 OffscreenCanvas，逐帧复用

self.onmessage = async function(e) {
  var msg = e.data;
  var reqId = msg.reqId;

  if (msg.type === 'init') {
    self.postMessage({ type: 'ready', reqId: reqId });
    return;
  }

  if (msg.type === 'encode') {
    try {
      var bmp = msg.bitmap;
      var W = msg.w;
      var H = msg.h;
      var quality = msg.quality;

      var key = W + 'x' + H;
      var canvas = canvasCache[key];
      if (!canvas) {
        canvas = new OffscreenCanvas(W, H);
        canvasCache[key] = canvas;
      }

      var ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('无法获取 OffscreenCanvas 2D 上下文');
      }

      // 与 exportImage.calculateFitScale 一致：等比缩放、居中放置、白底补边。
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var scale = Math.min(W / bmp.width, H / bmp.height);
      var dw = Math.round(bmp.width * scale);
      var dh = Math.round(bmp.height * scale);
      var ox = Math.floor((W - dw) / 2);
      var oy = Math.floor((H - dh) / 2);
      ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, ox, oy, dw, dh);

      var blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
      var buf = await blob.arrayBuffer();
      self.postMessage({ type: 'result', reqId: reqId, buffer: buf }, [buf]);
      if (bmp && typeof bmp.close === 'function') bmp.close();
    } catch (err) {
      self.postMessage({ type: 'error', reqId: reqId, message: err.message || String(err) });
    }
  }
};
`;

let _workerBlobUrl: string | null = null;

// reqId → { resolve, reject }，按 Worker 实例隔离。
// 单一持久 handler 按 reqId 路由，避免并发请求下重设 onmessage 覆盖先前的 promise。
const _workerPending = new WeakMap<
  Worker,
  Map<number, { resolve: (buf: ArrayBuffer) => void; reject: (err: Error) => void }>
>();
let _nextReqId = 1;

export function createEncodeWorker(): Promise<Worker> {
  return new Promise<Worker>((resolve, reject) => {
    if (!_workerBlobUrl) {
      _workerBlobUrl = URL.createObjectURL(
        new Blob([ENCODE_WORKER_CODE], { type: "application/javascript" }),
      );
    }
    const worker = new Worker(_workerBlobUrl);
    const pending = new Map<number, {
      resolve: (buf: ArrayBuffer) => void;
      reject: (err: Error) => void;
    }>();
    _workerPending.set(worker, pending);

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "ready") {
        resolve(worker);
        return;
      }
      const handler = pending.get(data.reqId);
      if (!handler) return;
      pending.delete(data.reqId);
      if (data.type === "result") {
        handler.resolve(data.buffer as ArrayBuffer);
      } else {
        handler.reject(new Error(data.message));
      }
    };

    worker.onerror = (err) => {
      for (const h of pending.values()) {
        h.reject(new Error(`编码 Worker 失败：${err.message}`));
      }
      pending.clear();
      worker.terminate();
      reject(new Error(`编码 Worker 启动失败：${err.message}`));
    };

    worker.postMessage({ type: "init", reqId: 0 });
  });
}

// 把 ImageBitmap（已 transfer 零拷贝所有权）编码为原始 JPEG（不嵌 DPI）。
export function encodeBitmapInWorker(
  worker: Worker,
  bitmap: ImageBitmap,
  w: number,
  h: number,
  quality: number = JPEG_QUALITY,
): Promise<ArrayBuffer> {
  let pending = _workerPending.get(worker);
  if (!pending) {
    // 未注册的 worker（如测试直接 new 的 mock）：安装最小分发器兜底。
    pending = new Map();
    _workerPending.set(worker, pending);
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.reqId !== undefined) {
        const h = pending!.get(data.reqId);
        if (!h) return;
        pending!.delete(data.reqId);
        if (data.type === "result") h.resolve(data.buffer as ArrayBuffer);
        else h.reject(new Error(data.message));
      }
    };
  }
  const reqId = _nextReqId++;
  return new Promise((resolve, reject) => {
    pending!.set(reqId, { resolve, reject });
    // transfer bitmap 所有权到 Worker（零拷贝）。
    worker.postMessage(
      { type: "encode", reqId, bitmap, w, h, quality },
      [bitmap],
    );
  });
}

export function terminateEncodeWorker(worker: Worker | null): void {
  if (!worker) return;
  try {
    worker.terminate();
  } catch {
    /* terminate 失败不阻断 */
  }
  _workerPending.delete(worker);
}
