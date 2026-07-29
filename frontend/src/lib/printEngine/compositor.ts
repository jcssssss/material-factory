import { invoke } from "@tauri-apps/api/core";
import { embedJfif300Dpi, isPreviewImage } from "../exportImage";
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

self.onmessage = async function(e) {
  var msg = e.data;

  if (msg.type === 'init') {
    var bufs = msg.bgBufs;
    var bitmaps = [];
    for (var i = 0; i < bufs.length; i++) {
      bitmaps.push(await createImageBitmap(new Blob([bufs[i]])));
    }
    bgCache = { bitmaps: bitmaps, widths: msg.bgWidths, heights: msg.bgHeights };
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'compose') {
    try {
      var bgIdx = msg.bgIdx;
      var bg = bgCache.bitmaps[bgIdx];
      var bgW = bgCache.widths[bgIdx];
      var bgH = bgCache.heights[bgIdx];

      var warped = await createImageBitmap(
        new ImageData(new Uint8ClampedArray(msg.warpedBuf), bgW, bgH)
      );
      var canvas = new OffscreenCanvas(W, H);
      var ctx = canvas.getContext('2d');

      var scale = Math.min(W / bgW, H / bgH);
      var dw = Math.round(bgW * scale);
      var dh = Math.round(bgH * scale);
      var ox = Math.floor((W - dw) / 2);
      var oy = Math.floor((H - dh) / 2);

      ctx.fillStyle = '#ffffff';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(bg, ox, oy, dw, dh);

      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(warped, 0, 0, W, H);

      var blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });
      var buf = await blob.arrayBuffer();
      self.postMessage({ type: 'result', buffer: buf }, [buf]);
      warped.close();
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message || String(err) });
    }
  }
};
`;

let _workerBlobUrl: string | null = null;

function createComposeWorker(
  bgBufs: ArrayBuffer[],
  bgWidths: number[],
  bgHeights: number[],
): Promise<Worker> {
  return new Promise((resolve, reject) => {
    if (!_workerBlobUrl) {
      _workerBlobUrl = URL.createObjectURL(
        new Blob([COMPOSE_WORKER_CODE], { type: "application/javascript" }),
      );
    }
    const worker = new Worker(_workerBlobUrl);

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === "ready") {
        worker.onmessage = null; // 清除 init 监听，后续由调用方接管 onmessage
        resolve(worker);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(`Worker 启动失败：${err.message}`));
    };

    // 转移所有背景 buffer 所有权到 Worker（零拷贝）
    worker.postMessage(
      { type: "init", bgBufs, bgWidths, bgHeights },
      bgBufs,
    );
  });
}

function composeInWorker(
  worker: Worker,
  warpedBuffer: ArrayBuffer,
  bgIndex: number,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === "result") {
        resolve(e.data.buffer as ArrayBuffer);
      } else if (e.data.type === "error") {
        reject(new Error(e.data.message));
      }
    };

    worker.onerror = (err) => {
      reject(new Error(`Worker 合成失败：${err.message}`));
    };

    // 转移 warp 数据所有权到 Worker（零拷贝）
    worker.postMessage(
      { type: "compose", warpedBuf: warpedBuffer, bgIdx: bgIndex },
      [warpedBuffer],
    );
  });
}

// ─── 对外 API ───

export async function composePrintImage(params: {
  worker: Worker;
  bgIndex: number;
  bgW: number;
  bgH: number;
  corners: CalibrationCorners;
  materialBytes: Uint8Array;
}): Promise<Uint8Array> {
  const { worker, bgIndex, bgW, bgH, corners, materialBytes } = params;

  const warpedBuffer = await invoke<ArrayBuffer>("warp_to_a4", {
    materialBytes,
    bgW,
    bgH,
    corners,
  });

  // Canvas 合成 + JPEG 编码：在 Worker 中执行，主线程不阻塞。
  const jpegBuffer = await composeInWorker(worker, warpedBuffer, bgIndex);

  return embedJfif300Dpi(new Uint8Array(jpegBuffer));
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

// 将路径编码到二进制 body 前缀：4 字节 LE 路径长度 + UTF-8 路径 + JPEG。
// invoke 顶层传 Uint8Array → Tauri 走 octet-stream 零序列化，避免主线程 JSON 卡顿。
async function writeImageToDisk(outPath: string, jpegBytes: Uint8Array): Promise<void> {
  const encoder = new TextEncoder();
  const pathBytes = encoder.encode(outPath);
  const len = pathBytes.length;
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, len, true); // LE
  const combined = new Uint8Array(4 + len + jpegBytes.length);
  combined.set(header, 0);
  combined.set(pathBytes, 4);
  combined.set(jpegBytes, 4 + len);
  await invoke<void>("write_image_binary", combined);
}

export async function generatePrintImages(
  taskOutputDir: string,
  backgrounds: BackgroundTemplate[],
  onProgress?: (done: number, total: number) => void,
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
