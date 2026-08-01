// encodeWorker 单元测试。
//
// jsdom 无 Worker/URL.createObjectURL，用 mock Worker 手动路由 postMessage，
// 验证：init→ready、reqId 路由、尺寸/质量透传、transfer 零拷贝、错误路径、
// terminate。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createEncodeWorker,
  encodeBitmapInWorker,
  terminateEncodeWorker,
} from "../encodeWorker";

class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate = vi.fn();

  constructor(_url: string | URL, _options?: WorkerOptions) {
    this.postMessage = vi.fn((msg: unknown, _transfer?: unknown[]) => {
      const m = msg as { type: string; reqId: number };
      if (m.type === "init") {
        setTimeout(
          () => this.onmessage?.({ data: { type: "ready", reqId: m.reqId } } as MessageEvent),
          0,
        );
      }
      if (m.type === "encode") {
        setTimeout(
          () =>
            this.onmessage?.({
              data: { type: "result", reqId: m.reqId, buffer: new ArrayBuffer(4) },
            } as MessageEvent),
          0,
        );
      }
    });
  }
}

describe("encodeWorker", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", MockWorker);
    vi.stubGlobal("URL", {
      ...globalThis.URL,
      createObjectURL: vi.fn(() => "blob:mock-encode-worker"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createEncodeWorker 返回可用的 Worker（init → ready）", async () => {
    const worker = await createEncodeWorker();
    expect(worker).toBeInstanceOf(MockWorker);
  });

  it("encodeBitmapInWorker 返回编码后的 ArrayBuffer", async () => {
    const worker = await createEncodeWorker();
    const bitmap = { width: 100, height: 200 } as unknown as ImageBitmap;
    const buf = await encodeBitmapInWorker(worker, bitmap, 1242, 1656);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(4);
  });

  it("postMessage 携带尺寸/质量参数并 transfer bitmap（零拷贝）", async () => {
    const worker = await createEncodeWorker();
    const bitmap = { width: 100, height: 200 } as unknown as ImageBitmap;
    await encodeBitmapInWorker(worker, bitmap, 1242, 1656);

    const mock = (worker as unknown as MockWorker).postMessage;
    const call = mock.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === "encode",
    );
    expect(call).toBeDefined();
    const msg = call![0] as { w: number; h: number; quality: number };
    expect(msg.w).toBe(1242);
    expect(msg.h).toBe(1656);
    expect(msg.quality).toBe(1.0);
    // transfer 列表包含 bitmap（所有权零拷贝转移）
    expect(call![1]).toContain(bitmap);
  });

  it("terminateEncodeWorker 终止 Worker 并释放", async () => {
    const worker = await createEncodeWorker();
    terminateEncodeWorker(worker);
    expect((worker as unknown as MockWorker).terminate).toHaveBeenCalled();
    // 再次 terminate 不抛错（幂等）
    terminateEncodeWorker(worker);
  });

  it("terminateEncodeWorker(null) 是 no-op", () => {
    expect(() => terminateEncodeWorker(null)).not.toThrow();
  });

  it("Worker 返回 error 时 reject", async () => {
    const worker = await createEncodeWorker();
    const mock = worker as unknown as MockWorker;
    // 覆盖 postMessage：encode 请求返回 error。
    mock.postMessage.mockImplementation((msg: unknown) => {
      const m = msg as { type: string; reqId: number };
      setTimeout(
        () =>
          mock.onmessage?.({
            data: {
              type: m.type === "init" ? "ready" : "error",
              reqId: m.reqId,
              message: "编码失败",
            },
          } as MessageEvent),
        0,
      );
    });

    const bitmap = { width: 10, height: 10 } as unknown as ImageBitmap;
    await expect(encodeBitmapInWorker(worker, bitmap, 100, 100)).rejects.toThrow(
      "编码失败",
    );
  });
});
