// iconAssets 单元测试。
//
// 覆盖 SubTask 10.2 验证项：
//   - getIconForFileType：PDF / Word / Excel / PPT / 文件夹 五类图标映射
//   - 未识别后缀（FileType.other）回退到通用文件图标
//   - 各类图标 SVG 字符串格式正确且互不相同

import { describe, it, expect } from "vitest";
import { getIconForFileType } from "../iconAssets";
import type { FileType } from "../../../types/materialList";

// ─── getIconForFileType 映射 ───

describe("getIconForFileType 图标映射", () => {
  it("pdf → 返回 PDF 图标 SVG", () => {
    const svg = getIconForFileType("pdf");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("PDF");
    expect(svg).toContain("</svg>");
  });

  it("word → 返回 Word 图标 SVG", () => {
    const svg = getIconForFileType("word");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain(">W<");
    expect(svg).toContain("</svg>");
  });

  it("excel → 返回 Excel 图标 SVG", () => {
    const svg = getIconForFileType("excel");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain(">X<");
    expect(svg).toContain("</svg>");
  });

  it("ppt → 返回 PPT 图标 SVG", () => {
    const svg = getIconForFileType("ppt");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain(">P<");
    expect(svg).toContain("</svg>");
  });

  it("folder → 返回文件夹图标 SVG", () => {
    const svg = getIconForFileType("folder");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("</svg>");
    // 文件夹图标不含文本标签，但含文件夹特有的填充色
    expect(svg).toContain("#f5c542");
  });
});

// ─── 未识别后缀回退 ───

describe("getIconForFileType 未识别后缀回退", () => {
  it("other → 返回通用文件图标 SVG", () => {
    const svg = getIconForFileType("other");
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain("</svg>");
    // 通用文件图标含灰色线条
    expect(svg).toContain("#95a5a6");
  });

  it("other 图标与其他 5 类图标不同", () => {
    const otherSvg = getIconForFileType("other");
    const types: FileType[] = ["pdf", "word", "excel", "ppt", "folder"];
    for (const t of types) {
      expect(getIconForFileType(t)).not.toBe(otherSvg);
    }
  });
});

// ─── SVG 格式与唯一性 ───

describe("getIconForFileType SVG 格式与唯一性", () => {
  const allTypes: FileType[] = [
    "pdf",
    "word",
    "excel",
    "ppt",
    "folder",
    "other",
  ];

  it("所有 6 类图标均为非空 SVG 字符串", () => {
    for (const t of allTypes) {
      const svg = getIconForFileType(t);
      expect(typeof svg).toBe("string");
      expect(svg.length).toBeGreaterThan(0);
      expect(svg).toMatch(/^<svg/);
      expect(svg).toContain("</svg>");
    }
  });

  it("所有 6 类图标互不相同", () => {
    const svgs = allTypes.map((t) => getIconForFileType(t));
    const unique = new Set(svgs);
    expect(unique.size).toBe(allTypes.length);
  });

  it("每个 SVG 含 viewBox 与 64×64 尺寸", () => {
    for (const t of allTypes) {
      const svg = getIconForFileType(t);
      expect(svg).toContain('viewBox="0 0 64 64"');
      expect(svg).toContain('width="64"');
      expect(svg).toContain('height="64"');
    }
  });

  it("相同 FileType 多次调用返回相同 SVG", () => {
    const first = getIconForFileType("pdf");
    const second = getIconForFileType("pdf");
    expect(first).toBe(second);
  });
});
