import { invoke } from "@tauri-apps/api/core";
import { embedJfifDpi, isPreviewImage, TARGET_DPI, writeImageToDisk } from "../exportImage";
import type { CalibrationCorners, BackgroundTemplate } from "../../types/background";
import type { FolderTreeNode } from "../../types/materialList";
import { readBackgroundFile } from "./backgroundDb";

export const COMPOSE_WIDTH = 1242;
export const COMPOSE_HEIGHT = 1656;

// ─── Web Worker：Canvas 合成 + JPEG 编码 ───
//
// 将耗时最长的画布合成与 JPEG 编码移出主线程。
// 单 Worker 持久复用：初始化时预加载所有背景，后续每张图只发送 warp 后的 PNG 数据。

const COMPOSE_WORKER_CODE = `
var W = 1242;
var H = 1656;
var bgCache = null;  // { bitmaps: ImageBitmap[], widths: number[], heights: number[] }
// 一次性分配的复用对象（init 时创建，后续 compose 复用，避免每帧重建大对象）：
var mainCanvas = null;   // OffscreenCanvas(W, H)，合成目标
var mainCtx = null;      // mainCanvas 的 2D 上下文
var scratchCanvas = null; // OffscreenCanvas(bgW, bgH)，承载 warp 像素，参与 multiply
var scratchCtx = null;    // scratchCanvas 的 2D 上下文
var warpData = null;      // ImageData(bgW, bgH)，持久缓冲，每帧 data.set 复用

self.onmessage = async function(e) {
  var msg = e.data;
  var reqId = msg.reqId;

  if (msg.type === 'init') {
    try {
      var bufs = msg.bgBufs;
      var bitmaps = [];
      for (var i = 0; i < bufs.length; i++) {
        bitmaps.push(await createImageBitmap(new Blob([bufs[i]])));
      }
      bgCache = { bitmaps: bitmaps, widths: msg.bgWidths, heights: msg.bgHeights };
      mainCanvas = new OffscreenCanvas(W, H);
      mainCtx = mainCanvas.getContext('2d');
      if (!mainCtx) {
        throw new Error('无法获取 2D Canvas 上下文');
      }
      self.postMessage({ type: 'ready', reqId: reqId });
    } catch (err) {
      self.postMessage({ type: 'error', reqId: reqId, message: err.message || String(err) });
    }
    return;
  }

  if (msg.type === 'compose') {
    try {
      var bgIdx = msg.bgIndex;
      var bg = bgCache.bitmaps[bgIdx];
      var bgW = bgCache.widths[bgIdx];
      var bgH = bgCache.heights[bgIdx];

      // 防御：主画布异常被回收时重建（WebView 内存紧张时 getContext 可能返回 null）。
      if (mainCanvas === null || mainCtx === null) {
        mainCanvas = new OffscreenCanvas(W, H);
        mainCtx = mainCanvas.getContext('2d');
        if (!mainCtx) {
          throw new Error('无法获取 2D Canvas 上下文');
        }
      }

      // warp 像素按需持久化：尺寸未变时复用 ImageData 与 scratch 画布，
      // 省掉每帧 new ImageData（8.2MB 拷贝）+ createImageBitmap（GPU 上传）+ 画布分配。
      if (scratchCanvas === null || scratchCanvas.width !== bgW || scratchCanvas.height !== bgH) {
        scratchCanvas = new OffscreenCanvas(bgW, bgH);
        scratchCtx = scratchCanvas.getContext('2d');
        warpData = new ImageData(bgW, bgH);
        if (!scratchCtx) {
          throw new Error('无法获取 scratch 2D Canvas 上下文');
        }
      }
      warpData.data.set(new Uint8ClampedArray(msg.warpedBuf));
      scratchCtx.putImageData(warpData, 0, 0);

      var scale = Math.min(W / bgW, H / bgH);
      var dw = Math.round(bgW * scale);
      var dh = Math.round(bgH * scale);
      var ox = Math.floor((W - dw) / 2);
      var oy = Math.floor((H - dh) / 2);

      // 每帧从干净状态开始：显式复位合成模式，避免上一帧 multiply 残留串色。
      mainCtx.globalCompositeOperation = 'source-over';
      mainCtx.fillStyle = '#ffffff';
      mainCtx.imageSmoothingEnabled = true;
      mainCtx.imageSmoothingQuality = 'high';
      mainCtx.fillRect(0, 0, W, H);
      mainCtx.drawImage(bg, ox, oy, dw, dh);

      mainCtx.globalCompositeOperation = 'multiply';
      mainCtx.drawImage(scratchCanvas, 0, 0, W, H);
      mainCtx.globalCompositeOperation = 'source-over'; // 复位，防串帧

      var blob = await mainCanvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });
      var buf = await blob.arrayBuffer();
      self.postMessage({ type: 'result', reqId: reqId, buffer: buf }, [buf]);
    } catch (err) {
      self.postMessage({ type: 'error', reqId: reqId, message: err.message || String(err) });
    }
  }
};
`;

let _workerBlobUrl: string | null = null;
// reqId → { resolve, reject }，按 Worker 实例隔离；composeInWorker 注册、
// worker.onmessage 路由、onerror 统一 reject。
const _workerPending = new WeakMap<Worker, Map<number, {
  resolve: (buf: ArrayBuffer) => void;
  reject: (err: Error) => void;
}>>();
let _nextReqId = 1;

// 主线程到 Worker 的请求分发器。CONCURRENCY>1 时多个 compose 请求并发在途，
// 若每帧重设 worker.onmessage，后设的 handler 会覆盖前一个，导致早前帧的
// promise 永远收不到结果而卡死。改用单一持久 handler，按 reqId 路由回对应 promise。
function createComposeWorker(
  bgBufs: ArrayBuffer[],
  bgWidths: number[],
  bgHeights: number[],
): Promise<Worker> {
  return new Promise<Worker>((resolve) => {
    if (!_workerBlobUrl) {
      _workerBlobUrl = URL.createObjectURL(
        new Blob([COMPOSE_WORKER_CODE], { type: "application/javascript" }),
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
        h.reject(new Error(`Worker 合成失败：${err.message}`));
      }
      pending.clear();
      worker.terminate();
    };

    // 转移所有背景 buffer 所有权到 Worker（零拷贝）
    worker.postMessage(
      { type: "init", reqId: 0, bgBufs, bgWidths, bgHeights },
      bgBufs,
    );
  });
}

function composeInWorker(
  worker: Worker,
  warpedBuffer: ArrayBuffer,
  bgIndex: number,
): Promise<ArrayBuffer> {
  let pending = _workerPending.get(worker);
  if (!pending) {
    // 未注册的 worker（如测试直接 new 的 mock）：安装最小分发器。
    // 生产路径始终经过 createComposeWorker，此处仅兜底。
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
      } else if (pending!.size > 0) {
        // 无 reqId（测试 mock）：路由给最近的请求
        const last = [...pending!.values()].pop()!;
        pending!.clear();
        if (data.type === "result") last.resolve(data.buffer as ArrayBuffer);
        else last.reject(new Error(data.message));
      }
    };
  }
  const reqId = _nextReqId++;
  return new Promise((resolve, reject) => {
    pending!.set(reqId, { resolve, reject });
    // 转移 warp 数据所有权到 Worker（零拷贝）
    worker.postMessage(
      { type: "compose", reqId, warpedBuf: warpedBuffer, bgIndex },
      [warpedBuffer],
    );
  });
}

// ─── 对外 API ───

// 构造 warp_to_a4 二进制请求 body（LE，与 Rust parse_warp_request 对账）：
//   [4B u32 material_len][material_bytes][4B u32 bgW][4B u32 bgH][8×f64 corners]
export function buildWarpRequestBody(
  materialBytes: Uint8Array,
  bgW: number,
  bgH: number,
  corners: CalibrationCorners,
): Uint8Array {
  const body = new Uint8Array(4 + materialBytes.length + 8 + 64);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, materialBytes.length, true);
  body.set(materialBytes, 4);
  dv.setUint32(4 + materialBytes.length, bgW, true);
  dv.setUint32(8 + materialBytes.length, bgH, true);
  for (let i = 0; i < 8; i++) {
    dv.setFloat64(12 + materialBytes.length + i * 8, corners[i], true);
  }
  return body;
}

export async function composePrintImage(params: {
  worker: Worker;
  bgIndex: number;
  bgW: number;
  bgH: number;
  corners: CalibrationCorners;
  materialBytes: Uint8Array;
}): Promise<Uint8Array> {
  const { worker, bgIndex, bgW, bgH, corners, materialBytes } = params;

  // 素材字节走顶层二进制 body，避免嵌套 Uint8Array 被 Tauri 转 JSON 数字数组
  // 在主线程同步序列化（每张 4~8MB JSON，阻塞数百毫秒）。
  const body = buildWarpRequestBody(materialBytes, bgW, bgH, corners);
  const warpedBuffer = await invoke<ArrayBuffer>("warp_to_a4", body);

  // Canvas 合成 + JPEG 编码：在 Worker 中执行，主线程不阻塞。
  const jpegBuffer = await composeInWorker(worker, warpedBuffer, bgIndex);

  return embedJfifDpi(new Uint8Array(jpegBuffer), TARGET_DPI);
}

function joinPath(...segments: string[]): string {
  return segments.map((s) => s.replace(/\/+$/, "")).filter(Boolean).join("/");
}

export function collectJpgFiles(node: FolderTreeNode): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = [];
  for (const child of node.children) {
    if (child.is_dir) {
      if (child.name !== "仿打印") {
        result.push(...collectJpgFiles(child));
      }
    } else if (child.extension?.toLowerCase() === "jpg" && isPreviewImage(child.name)) {
      result.push({ name: child.name, path: child.path });
    }
  }
  return result;
}

// 写盘复用 exportImage 的 writeImageToDisk（同一二进制 body 方案）。
// 之前此处有私有副本，与 exportImage.ts 完全重复，统一收口避免漂移。

export async function generatePrintImages(
  taskOutputDir: string,
  backgrounds: BackgroundTemplate[],
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): Promise<number> {
  const tree = await invoke<FolderTreeNode>("scan_folder_tree", { folder: taskOutputDir });
  const materialFiles = collectJpgFiles(tree);
  if (materialFiles.length === 0) return 0;

  const shuffled = [...backgrounds].sort(() => Math.random() - 0.5);
  const printDir = joinPath(taskOutputDir, "仿打印");
  await invoke<void>("ensure_output_dir", { path: printDir });

  // 预取所有背景原始字节，按 file_name 去重。bgIndexMap 负责 file_name → bgMeta 索引。
  const bgMeta: { buf: ArrayBuffer; width: number; height: number }[] = [];
  const bgIndexMap = new Map<string, number>();
  for (const bg of backgrounds) {
    if (bgIndexMap.has(bg.file_name)) continue;
    bgIndexMap.set(bg.file_name, bgMeta.length);
    // readBackgroundFile 已返回新分配的 ArrayBuffer，直接复用，省一次整图拷贝。
    const raw = await readBackgroundFile(bg.file_name);
    bgMeta.push({ buf: raw, width: bg.width, height: bg.height });
  }
  const worker = await createComposeWorker(
    bgMeta.map((m) => m.buf),
    bgMeta.map((m) => m.width),
    bgMeta.map((m) => m.height),
  );

  // K 路流水线：让「第 i+1 张 read_pdf_bytes + warp_to_a4（Rust，CPU 密集）」
  // 与「第 i 张 composeInWorker（Worker，multiply 合成 + JPEG 编码）+ write_image_file」并行重叠，
  // 榨干 Rust 多核与 Worker 异步管线。Worker 仍然单实例顺序处理（Canvas 不可并发），
  // 但 Rust warp 与 Worker 编码可错峰，单张不再全程阻塞主线程等待下一张 warp。
  const CONCURRENCY = 2;

  try {
    // 预读并启动首批 warp，填满流水线窗口。
    type Frame = {
      index: number;
      outPath: string;
      promise: Promise<Uint8Array>;
    };

    const frameFor = async (i: number): Promise<Frame> => {
      const file = materialFiles[i];
      const bg = shuffled[i % shuffled.length];
      const corners: CalibrationCorners = [
        bg.a4_x1!, bg.a4_y1!,
        bg.a4_x2!, bg.a4_y2!,
        bg.a4_x3!, bg.a4_y3!,
        bg.a4_x4!, bg.a4_y4!,
      ];
      const materialBuffer = await invoke<ArrayBuffer>("read_pdf_bytes", { path: file.path });
      const outputBytes = composePrintImage({
        worker,
        bgIndex: bgIndexMap.get(bg.file_name)!,
        bgW: bg.width,
        bgH: bg.height,
        corners,
        materialBytes: new Uint8Array(materialBuffer),
      });
      const outPath = joinPath(printDir, `${String(i + 1).padStart(3, "0")}.jpg`);
      return { index: i, outPath, promise: outputBytes };
    };

    // 窗口：未完成帧的有序队列。按 index 严格顺序回收写盘，保证 001/002… 命名稳定。
    const window: Frame[] = [];
    let nextStart = 0;
    let nextWrite = 0;

    for (let i = 0; i < Math.min(CONCURRENCY, materialFiles.length); i++) {
      window.push(await frameFor(nextStart++));
    }

    while (window.length > 0) {
      // 等当前待写帧（队首）完成；其它窗口内帧的 warp/compose 可同步推进。
      const frame = window[0];
      const bytes = await frame.promise;
      await writeImageToDisk(frame.outPath, bytes);
      onProgress?.(++nextWrite, materialFiles.length);

      window.shift();
      // 取消检查：不再生成后续帧，并让在途帧 settle，避免 unhandled rejection。
      if (shouldStop?.()) {
        await Promise.allSettled(window.map((f) => f.promise));
        break;
      }
      // 补一张新帧进窗口，直到素材用完。
      if (nextStart < materialFiles.length) {
        window.push(await frameFor(nextStart++));
      }
    }
  } finally {
    worker.terminate();
  }

  return materialFiles.length;
}
