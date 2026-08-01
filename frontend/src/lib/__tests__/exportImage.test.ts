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
  embedJfifDpi,
  buildPageImageFileName,
  isPreviewImage,
} from "../exportImage";

describe("输出规格常量", () => {
  it("OUTPUT_WIDTH / OUTPUT_HEIGHT 比例为 3:4", () => {
    // 1242 / 1656 = 0.75 = 3/4
    expect(OUTPUT_WIDTH / OUTPUT_HEIGHT).toBe(3 / 4);
    expect(OUTPUT_WIDTH).toBe(1242);
    expect(OUTPUT_HEIGHT).toBe(1656);
  });

  it("JPEG_QUALITY = 1.0（100%）", () => {
    expect(JPEG_QUALITY).toBe(1.0);
  });

  it("TARGET_DPI = 150", () => {
    expect(TARGET_DPI).toBe(150);
  });

  it("BACKGROUND_COLOR = #ffffff（白底补边）", () => {
    expect(BACKGROUND_COLOR).toBe("#ffffff");
  });
});

describe("calculateFitScale", () => {
  it("纵向页面（3:4）：scale 使其刚好填满目标", () => {
    // 3:4 源图正好匹配 3:4 目标
    const scale = calculateFitScale(1242, 1656);
    expect(scale).toBeCloseTo(1, 5);
  });

  it("横向页面：取 min(scale_x, scale_y)，保证完整放入", () => {
    // 4:3 横向页面 4000x3000 → 目标 1242x1656
    // scale_x = 1242/4000 = 0.3105
    // scale_y = 1656/3000 = 0.552
    // min = 0.3105（按宽度缩放，高度方向留白）
    const scale = calculateFitScale(4000, 3000);
    expect(scale).toBeCloseTo(0.3105, 5);
  });

  it("正方形页面：按高度缩放，左右留白", () => {
    // 3000x3000 → scale_x = 1242/3000 = 0.414, scale_y = 1656/3000 = 0.552
    // min = 0.414
    const scale = calculateFitScale(3000, 3000);
    expect(scale).toBeCloseTo(0.414, 5);
  });

  it("小尺寸页面：放大到目标", () => {
    // 100x100 → scale = min(12.42, 16.56) = 12.42
    const scale = calculateFitScale(100, 100);
    expect(scale).toBeCloseTo(12.42, 5);
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

describe("isPreviewImage", () => {
  it("匹配 buildPageImageFileName 生成的命名", () => {
    expect(isPreviewImage("report_p001.jpg")).toBe(true);
    expect(isPreviewImage("report_p010.jpg")).toBe(true);
    expect(isPreviewImage("report_p999.jpg")).toBe(true);
  });

  it("匹配含中文字符的预览图名", () => {
    expect(isPreviewImage("咨询报告_p001.jpg")).toBe(true);
  });

  it("拒绝资料列表文件名", () => {
    expect(isPreviewImage("资料列表_01.jpg")).toBe(false);
    expect(isPreviewImage("资料列表_99.jpg")).toBe(false);
    expect(isPreviewImage("资料列表_001.jpg")).toBe(false);
  });

  it("拒绝任意 JPG 文件名", () => {
    expect(isPreviewImage("photo.jpg")).toBe(false);
    expect(isPreviewImage("IMG_2024.jpg")).toBe(false);
  });

  it("拒绝 _p 后无数字的文件", () => {
    expect(isPreviewImage("report_p.jpg")).toBe(false);
    expect(isPreviewImage("report_pabc.jpg")).toBe(false);
  });

  it("buildPageImageFileName 输出始终返回 true（不变量）", () => {
    expect(isPreviewImage(buildPageImageFileName("any", 1))).toBe(true);
    expect(isPreviewImage(buildPageImageFileName("any", 999))).toBe(true);
    expect(isPreviewImage(buildPageImageFileName("foo/bar", 42))).toBe(true);
  });
});

describe("embedJfifDpi", () => {
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

  it("替换已有 APP0 段为 150 DPI", () => {
    const input = makeJpegWithDefaultApp0();
    const output = embedJfifDpi(input, 150);

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

    // X 密度 = 150 (0x0096)
    expect(output[14]).toBe(0x00);
    expect(output[15]).toBe(0x96);

    // Y 密度 = 150 (0x0096)
    expect(output[16]).toBe(0x00);
    expect(output[17]).toBe(0x96);

    // EOI 保留在末尾
    expect(output[output.length - 2]).toBe(0xff);
    expect(output[output.length - 1]).toBe(0xd9);
  });

  it("无 APP0 段时插入新的 150 DPI JFIF 段", () => {
    const input = makeJpegWithoutApp0();
    const output = embedJfifDpi(input, 150);

    // SOI 保留
    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0xd8);

    // 紧随插入 APP0
    expect(output[2]).toBe(0xff);
    expect(output[3]).toBe(0xe0);

    // 密度 = 150 DPI
    expect(output[14]).toBe(0x00);
    expect(output[15]).toBe(0x96);
    expect(output[16]).toBe(0x00);
    expect(output[17]).toBe(0x96);

    // EOI 保留
    expect(output[output.length - 2]).toBe(0xff);
    expect(output[output.length - 1]).toBe(0xd9);
  });

  it("非法 JPG（缺少 SOI）抛异常", () => {
    const bad = new Uint8Array([0x00, 0x00]);
    expect(() => embedJfifDpi(bad, 150)).toThrow(/SOI/);
  });

  it("非法 DPI 值抛异常", () => {
    const input = makeJpegWithDefaultApp0();
    expect(() => embedJfifDpi(input, 0)).toThrow(/DPI/);
    expect(() => embedJfifDpi(input, -1)).toThrow(/DPI/);
    expect(() => embedJfifDpi(input, 1.5)).toThrow(/DPI/);
  });

  it("DPI 数值正确（0x0096 = 150，0x012C = 300）", () => {
    const input = makeJpegWithDefaultApp0();
    const output150 = embedJfifDpi(input, 150);
    const x150 = (output150[14] << 8) | output150[15];
    const y150 = (output150[16] << 8) | output150[17];
    expect(x150).toBe(150);
    expect(y150).toBe(150);

    const output300 = embedJfifDpi(input, 300);
    const x300 = (output300[14] << 8) | output300[15];
    expect(x300).toBe(300);
  });
});

describe("composeToPortraitCanvas", () => {
  // jsdom 不实现 Canvas 2D 渲染，通过 mock 验证：
  //   1. 目标画布尺寸 = 1242 x 1656
  //   2. 背景填充调用 fillRect(0, 0, 1242, 1656)
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

  it("目标画布尺寸为 3:4 (1242x1656)", () => {
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
    // 1000x1000 源图 → scale = min(1.242, 1.656) = 1.242
    // drawW = 1242, drawH = 1242
    // offsetX = (1242 - 1242) / 2 = 0
    // offsetY = (1656 - 1242) / 2 = 207
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
    expect(args[6]).toBe(207); // dy = offsetY
    expect(args[7]).toBe(1242); // dw
    expect(args[8]).toBe(1242); // dh
  });

  it("横向源图居中放置（上下留白）", () => {
    // 2000x1000 横向源图 → scale = min(0.621, 1.656) = 0.621
    // drawW = round(2000 * 0.621) = 1242
    // drawH = round(1000 * 0.621) = 621
    // offsetX = (1242 - 1242) / 2 = 0
    // offsetY = (1656 - 621) / 2 = 517
    const source = document.createElement("canvas");
    source.width = 2000;
    source.height = 1000;
    const target = composeToPortraitCanvas(source);
    const ctx = target.getContext("2d")!;
    const args = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[5]).toBe(0); // offsetX
    expect(args[6]).toBe(517); // offsetY
    expect(args[7]).toBe(1242); // drawW
    expect(args[8]).toBe(621); // drawH
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
