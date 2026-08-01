// isCanvasBlank 单元测试。
//
// jsdom 不实现 Canvas 2D 渲染，通过 mock getContext.getImageData 注入像素数据，
// 验证空白判定逻辑与阈值（非白像素占比 < 0.5% 判定为空白）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCanvasBlank } from "../pdf";

// 构造 mock ctx：drawImage 空操作，getImageData 返回指定 RGBA 像素。
function mockSampleContext(pixelData: Uint8ClampedArray): void {
  const ctxMock = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: pixelData })),
    willReadFrequently: true,
  };
  // @ts-expect-error 部分实现即可
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxMock);
}

// 全白画布像素（64×64×4，RGBA 全 255）。
function allWhitePixels(): Uint8ClampedArray {
  const size = 64 * 64 * 4;
  const arr = new Uint8ClampedArray(size);
  arr.fill(255);
  return arr;
}

// 从全白像素中把前 n 个像素（前 4n 字节）置为深色。
function withDarkPixels(n: number): Uint8ClampedArray {
  const arr = allWhitePixels();
  for (let i = 0; i < n; i++) {
    arr[i * 4] = 0; // R
    arr[i * 4 + 1] = 0; // G
    arr[i * 4 + 2] = 0; // B
  }
  return arr;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("isCanvasBlank", () => {
  it("全白画布判定为空白", () => {
    mockSampleContext(allWhitePixels());
    const canvas = document.createElement("canvas");
    expect(isCanvasBlank(canvas)).toBe(true);
  });

  it("含足够内容（>0.5%）的画布判定为非空白", () => {
    // 64×64=4096 像素，200 个深色像素 ≈ 4.9%，远高于 0.5% 阈值。
    mockSampleContext(withDarkPixels(200));
    const canvas = document.createElement("canvas");
    expect(isCanvasBlank(canvas)).toBe(false);
  });

  it("仅极少量非白像素（低于阈值）仍判定为空白", () => {
    // 10 / 4096 ≈ 0.24%，低于 0.5% 阈值，容忍单像素级噪声。
    mockSampleContext(withDarkPixels(10));
    const canvas = document.createElement("canvas");
    expect(isCanvasBlank(canvas)).toBe(true);
  });

  it("无法获取 canvas 上下文时保守判定为非空白", () => {
    // @ts-expect-error 部分实现即可
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    const canvas = document.createElement("canvas");
    expect(isCanvasBlank(canvas)).toBe(false);
  });
});
