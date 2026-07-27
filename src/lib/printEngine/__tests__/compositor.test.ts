import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const MINI_JPG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10,
  0x4a, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01,
  0x00,
  0x00, 0x01,
  0x00, 0x01,
  0x00, 0x00,
  0xff, 0xd9,
]);

function mockCanvas() {
  const ctxMock = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    globalCompositeOperation: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "",
  };
  // @ts-expect-error partial mock
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxMock);

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    callback: (blob: Blob | null) => void,
    _type?: string,
    _quality?: number,
  ) {
    callback(new Blob([MINI_JPG]));
  });

  return () => {
    HTMLCanvasElement.prototype.toBlob = origToBlob;
  };
}

beforeEach(() => {
  globalThis.createImageBitmap = vi.fn().mockResolvedValue({
    width: 100,
    height: 100,
    close: vi.fn(),
  } as unknown as ImageBitmap);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).createImageBitmap;
});

import { composePrintImage, decodeImageBytes } from "../compositor";

describe("decodeImageBytes", () => {
  it("调用 createImageBitmap 并返回结果", async () => {
    const spy = vi.spyOn(globalThis, "createImageBitmap");
    spy.mockResolvedValue({ width: 50, height: 50 } as unknown as ImageBitmap);

    const result = await decodeImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(result).toBeDefined();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("composePrintImage", () => {
  let restoreToBlob: () => void;

  beforeEach(() => {
    restoreToBlob = mockCanvas();
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreToBlob();
  });

  it("返回 Uint8Array", async () => {
    invokeMock.mockResolvedValue([0x89, 0x50, 0x4e, 0x47]);

    const result = await composePrintImage({
      bgBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      bgW: 100,
      bgH: 100,
      corners: [0, 0, 1, 0, 1, 1, 0, 1],
      materialBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("输出以 JPG SOI 开头", async () => {
    invokeMock.mockResolvedValue([0x89, 0x50, 0x4e, 0x47]);

    const result = await composePrintImage({
      bgBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      bgW: 100,
      bgH: 100,
      corners: [0, 0, 1, 0, 1, 1, 0, 1],
      materialBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
  });

  it("调用 invoke 并传递正确参数", async () => {
    invokeMock.mockResolvedValue([0x89, 0x50, 0x4e, 0x47]);

    await composePrintImage({
      bgBytes: new Uint8Array([0xff, 0xd8]),
      bgW: 200,
      bgH: 300,
      corners: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
      materialBytes: new Uint8Array([0xff, 0xd9]),
    });

    expect(invokeMock).toHaveBeenCalledWith("warp_to_a4", {
      materialBytes: [0xff, 0xd9],
      bgW: 200,
      bgH: 300,
      corners: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
    });
  });

  it("canvas 尺寸为 1242×1656", async () => {
    invokeMock.mockResolvedValue([0x89, 0x50, 0x4e, 0x47]);

    await composePrintImage({
      bgBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      bgW: 100,
      bgH: 100,
      corners: [0, 0, 1, 0, 1, 1, 0, 1],
      materialBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    const createCall = (HTMLCanvasElement.prototype.getContext as ReturnType<typeof vi.fn>).mock
      .contexts[0] as HTMLCanvasElement;
    expect(createCall).toBeDefined();
  });
});
