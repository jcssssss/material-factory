// exportImage 单元测试。
//
// 覆盖 SubTask 7.4 验证项：
//   - 固定 3:4 竖版输出尺寸
//   - JPG 质量 100% 参数
//   - 300 DPI JFIF 元数据嵌入
//   - 等比缩放 + 居中 + 补边策略
//   - 稳定命名规则

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  JPEG_QUALITY,
  TARGET_DPI,
  BACKGROUND_COLOR,
  calculateFitScale,
  composeToPortraitCanvas,
  embedJfif300Dpi,
  buildPageImageFileName,
} from "../exportImage";

describe("输出规格常量", () => {
  it("OUTPUT_WIDTH / OUTPUT_HEIGHT 比例为 3:4", () => {
    // 2475 / 3300 = 0.75 = 3/4
    expect(OUTPUT_WIDTH / OUTPUT_HEIGHT).toBe(3 / 4);
    expect(OUTPUT_WIDTH).toBe(2475);
    expect(OUTPUT_HEIGHT).toBe(3300);
  });

  it("JPEG_QUALITY = 1.0（100%）", () => {
    expect(JPEG_QUALITY).toBe(1.0);
  });

  it("TARGET_DPI = 300", () => {
    expect(TARGET_DPI).toBe(300);
  });

  it("BACKGROUND_COLOR = #ffffff（白底补边）", () => {
    expect(BACKGROUND_COLOR).toBe("#ffffff");
  });
});

describe("calculateFitScale", () => {
  it("纵向页面（3:4）：scale 使其刚好填满目标", () => {
    // 3:4 源图正好匹配 3:4 目标
    const scale = calculateFitScale(2475, 3300);
    expect(scale).toBeCloseTo(1, 5);
  });

  it("横向页面：取 min(scale_x, scale_y)，保证完整放入", () => {
    // 4:3 横向页面 4000x3000 → 目标 2475x3300
    // scale_x = 2475/4000 = 0.61875
    // scale_y = 3300/3000 = 1.1
    // min = 0.61875（按宽度缩放，高度方向留白）
    const scale = calculateFitScale(4000, 3000);
    expect(scale).toBeCloseTo(0.61875, 5);
  });

  it("正方形页面：按高度缩放，左右留白", () => {
    // 3000x3000 → scale_x = 2475/3000 = 0.825, scale_y = 3300/3000 = 1.1
    // min = 0.825
    const scale = calculateFitScale(3000, 3000);
    expect(scale).toBeCloseTo(0.825, 5);
  });

  it("小尺寸页面：放大到目标", () => {
    // 100x100 → scale = min(24.75, 33) = 24.75
    const scale = calculateFitScale(100, 100);
    expect(scale).toBeCloseTo(24.75, 5);
  });

  it("非法尺寸抛异常", () => {
    expect(() => calculateFitScale(0, 100)).toThrow(/非法/);
    expect(() => calculateFitScale(100, -1)).toThrow(/非法/);
  });
});

describe("buildPageImageFileName", () => {
  it("生成 {pdfBaseName}_p{页码三位}.jpg 命名", () => {
    expect(buildPageImageFileName("report", 1)).toBe("report_p001.jpg");
    expect(buildPageImageFileName("report", 10)).toBe("report_p010.jpg");
    expect(buildPageImageFileName("report", 100)).toBe("report_p100.jpg");
    expect(buildPageImageFileName("report", 999)).toBe("report_p999.jpg");
  });

  it("替换文件系统不友好字符", () => {
    expect(buildPageImageFileName("a/b\\c:d*e?f<g>h|i", 1)).toBe(
      "a_b_c_d_e_f_g_h_i_p001.jpg"
    );
  });

  it("命名稳定可追踪：同输入同输出", () => {
    const a = buildPageImageFileName("catalog", 5);
    const b = buildPageImageFileName("catalog", 5);
    expect(a).toBe(b);
  });

  it("不同 PDF / 不同页码 → 不同文件名", () => {
    expect(buildPageImageFileName("a", 1)).not.toBe(buildPageImageFileName("b", 1));
    expect(buildPageImageFileName("a", 1)).not.toBe(buildPageImageFileName("a", 2));
  });
});

describe("embedJfif300Dpi", () => {
  // 构造一个最小合法 JPG：SOI + 默认 APP0（density=0）+ EOI
  function makeJpegWithDefaultApp0(): Uint8Array {
    // FF D8                          SOI
    // FF E0 00 10 4A 46 49 46 00 ...  APP0 JFIF (16 字节段，density=0)
    // FF D9                          EOI
    return new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe0, // APP0 marker
      0x00, 0x10, // 段长度 = 16
      0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x01, // 版本 1.1
      0x00, // 密度单位 = 0（无单位）
      0x00, 0x01, // X 密度 = 1
      0x00, 0x01, // Y 密度 = 1
      0x00, 0x00, // 无缩略图
      0xff, 0xd9, // EOI
    ]);
  }

  // 构造无 APP0 段的 JPG：SOI + EOI
  function makeJpegWithoutApp0(): Uint8Array {
    return new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xd9, // EOI
    ]);
  }

  it("替换已有 APP0 段为 300 DPI", () => {
    const input = makeJpegWithDefaultApp0();
    const output = embedJfif300Dpi(input);

    // SOI marker 保留
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);

    // APP0 marker 紧随 SOI
    expect(output[2]).toBe(0xff);
    expect(output[3]).toBe(0xe0);

    // 段长度 = 16
    expect(output[4]).toBe(0x00);
    expect(output[5]).toBe(0x10);

    // "JFIF\0"
    expect(output[6]).toBe(0x4a); // J
    expect(output[7]).toBe(0x46); // F
    expect(output[8]).toBe(0x49); // I
    expect(output[9]).toBe(0x46); // F
    expect(output[10]).toBe(0x00);

    // 密度单位 = 1（DPI）
    expect(output[13]).toBe(0x01);

    // X 密度 = 300 (0x012C)
    expect(output[14]).toBe(0x01);
    expect(output[15]).toBe(0x2c);

    // Y 密度 = 300 (0x012C)
    expect(output[16]).toBe(0x01);
    expect(output[17]).toBe(0x2c);

    // EOI 保留在末尾
    expect(output[output.length - 2]).toBe(0xff);
    expect(output[output.length - 1]).toBe(0xd9);
  });

  it("无 APP0 段时插入新的 300 DPI JFIF 段", () => {
    const input = makeJpegWithoutApp0();
    const output = embedJfif300Dpi(input);

    // SOI 保留
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);

    // 紧随插入 APP0
    expect(output[2]).toBe(0xff);
    expect(output[3]).toBe(0xe0);

    // 密度 = 300 DPI
    expect(output[14]).toBe(0x01);
    expect(output[15]).toBe(0x2c);
    expect(output[16]).toBe(0x01);
    expect(output[17]).toBe(0x2c);

    // EOI 保留
    expect(output[output.length - 2]).toBe(0xff);
    expect(output[output.length - 1]).toBe(0xd9);
  });

  it("非法 JPG（缺少 SOI）抛异常", () => {
    const bad = new Uint8Array([0x00, 0x00]);
    expect(() => embedJfif300Dpi(bad)).toThrow(/SOI/);
  });

  it("300 DPI 数值正确（0x012C = 300）", () => {
    const input = makeJpegWithDefaultApp0();
    const output = embedJfif300Dpi(input);
    const xDpi = (output[14] << 8) | output[15];
    const yDpi = (output[16] << 8) | output[17];
    expect(xDpi).toBe(300);
    expect(yDpi).toBe(300);
  });
});

describe("composeToPortraitCanvas", () => {
  // jsdom 不实现 Canvas 2D 渲染，通过 mock 验证：
  //   1. 目标画布尺寸 = 2475 x 3300
  //   2. 背景填充调用 fillRect(0, 0, 2475, 3300)
  //   3. drawImage 居中调用（offsetX = (W - drawW) / 2, offsetY = (H - drawH) / 2）

  beforeEach(() => {
    // mock HTMLCanvasElement.getContext 返回 mock ctx
    const ctxMock = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "",
    };
    // @ts-expect-error 部分实现即可
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxMock);
  });

  it("目标画布尺寸为 3:4 (2475x3300)", () => {
    const source = document.createElement("canvas");
    source.width = 1000;
    source.height = 1000;
    const target = composeToPortraitCanvas(source);
    expect(target.width).toBe(OUTPUT_WIDTH);
    expect(target.height).toBe(OUTPUT_HEIGHT);
    expect(target.width / target.height).toBe(3 / 4);
  });

  it("调用 fillRect 填充白色背景", () => {
    const source = document.createElement("canvas");
    source.width = 1000;
    source.height = 1000;
    const target = composeToPortraitCanvas(source);
    const ctx = target.getContext("2d")!;
    expect(ctx.fillStyle).toBe(BACKGROUND_COLOR);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  });

  it("正方形源图居中放置（左右留白）", () => {
    // 1000x1000 源图 → scale = min(2.475, 3.3) = 2.475
    // drawW = 2475, drawH = 2475
    // offsetX = (2475 - 2475) / 2 = 0
    // offsetY = (3300 - 2475) / 2 = 412.5 → floor = 412
    const source = document.createElement("canvas");
    source.width = 1000;
    source.height = 1000;
    const target = composeToPortraitCanvas(source);
    const ctx = target.getContext("2d")!;
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    const args = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    // drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
    expect(args[0]).toBe(source);
    expect(args[1]).toBe(0); // sx
    expect(args[2]).toBe(0); // sy
    expect(args[3]).toBe(1000); // sw
    expect(args[4]).toBe(1000); // sh
    expect(args[5]).toBe(0); // dx = offsetX
    expect(args[6]).toBe(412); // dy = offsetY
    expect(args[7]).toBe(2475); // dw
    expect(args[8]).toBe(2475); // dh
  });

  it("横向源图居中放置（上下留白）", () => {
    // 2000x1000 横向源图 → scale = min(1.2375, 3.3) = 1.2375
    // drawW = round(2000 * 1.2375) = 2475
    // drawH = round(1000 * 1.2375) = 1238
    // offsetX = (2475 - 2475) / 2 = 0
    // offsetY = (3300 - 1238) / 2 = 1031
    const source = document.createElement("canvas");
    source.width = 2000;
    source.height = 1000;
    const target = composeToPortraitCanvas(source);
    const ctx = target.getContext("2d")!;
    const args = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[5]).toBe(0); // offsetX
    expect(args[6]).toBe(1031); // offsetY
    expect(args[7]).toBe(2475); // drawW
    expect(args[8]).toBe(1238); // drawH
  });

  it("设置 imageSmoothingQuality = high（平滑缩放）", () => {
    const source = document.createElement("canvas");
    source.width = 1000;
    source.height = 1000;
    const target = composeToPortraitCanvas(source);
    const ctx = target.getContext("2d")!;
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe("high");
  });
});
