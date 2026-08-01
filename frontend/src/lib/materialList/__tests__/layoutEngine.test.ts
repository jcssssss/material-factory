// layoutEngine 单元测试。
//
// 覆盖 SubTask 10.1 验证项：
//   - sortDirectoryChildren：文件夹优先 + 同类按名称升序（不区分大小写）
//   - paginateChildren：默认 19 项/页，超项自动拆分，空数组返回空
//   - stripLeadingNumber：去除资料名称前序号前缀（如 "1. 项目.pdf" → "项目.pdf"）
//   - formatImageFilename：< 100 两位零填充，≥ 100 升级三位零填充

import { describe, it, expect } from "vitest";
import {
  sortDirectoryChildren,
  paginateChildren,
  formatImageFilename,
  DEFAULT_MAX_ITEMS_PER_PAGE,
  stripLeadingNumber,
} from "../layoutEngine";
import type { FolderTreeNode } from "../../../types/materialList";

// ─── 测试辅助：构造 FolderTreeNode ───

function makeFile(
  name: string,
  fileType: FolderTreeNode["file_type"] = "other"
): FolderTreeNode {
  const ext = name.includes(".") ? name.split(".").pop() ?? null : null;
  return {
    name,
    path: `/${name}`,
    is_dir: false,
    extension: ext,
    file_type: fileType,
    empty: false,
    children: [],
  };
}

function makeDir(name: string, children: FolderTreeNode[] = []): FolderTreeNode {
  return {
    name,
    path: `/${name}`,
    is_dir: true,
    extension: null,
    file_type: "folder",
    empty: children.length === 0,
    children,
  };
}

// ─── stripLeadingNumber ───

describe("stripLeadingNumber", () => {
  it("去除 '1. ' 前缀", () => {
    expect(stripLeadingNumber("1. 项目计划书.pdf")).toBe("项目计划书.pdf");
  });

  it("去除 '01-' 前缀", () => {
    expect(stripLeadingNumber("01-项目计划书.pdf")).toBe("项目计划书.pdf");
  });

  it("去除 '1、' 前缀", () => {
    expect(stripLeadingNumber("1、项目计划书.pdf")).toBe("项目计划书.pdf");
  });

  it("去除 '01_ ' 前缀", () => {
    expect(stripLeadingNumber("01_项目计划书.pdf")).toBe("项目计划书.pdf");
  });

  it("无序号时保持不变", () => {
    expect(stripLeadingNumber("项目计划书.pdf")).toBe("项目计划书.pdf");
  });

  it("保留中间的数字（非前缀）", () => {
    expect(stripLeadingNumber("2024年报告.pdf")).toBe("2024年报告.pdf");
  });

  it("保留名称末尾的数字", () => {
    expect(stripLeadingNumber("文档v2.pdf")).toBe("文档v2.pdf");
  });

  it("处理 '1.' 无空格前缀", () => {
    expect(stripLeadingNumber("1.项目.pdf")).toBe("项目.pdf");
  });

  it("空字符串不报错", () => {
    expect(stripLeadingNumber("")).toBe("");
  });
});

// ─── sortDirectoryChildren ───

describe("sortDirectoryChildren", () => {
  it("文件夹排在文件之前", () => {
    const children = [
      makeFile("a.pdf", "pdf"),
      makeDir("zzz"),
      makeFile("b.pdf", "pdf"),
      makeDir("aaa"),
    ];
    const sorted = sortDirectoryChildren(children);
    const names = sorted.map((c) => c.name);
    expect(names).toEqual(["aaa", "zzz", "a.pdf", "b.pdf"]);
  });

  it("同类内部按名称升序（不区分大小写）", () => {
    const children = [
      makeFile("Charlie.pdf", "pdf"),
      makeFile("alpha.pdf", "pdf"),
      makeFile("Bravo.pdf", "pdf"),
    ];
    const sorted = sortDirectoryChildren(children);
    expect(sorted.map((c) => c.name)).toEqual([
      "alpha.pdf",
      "Bravo.pdf",
      "Charlie.pdf",
    ]);
  });

  it("文件夹与文件混合时文件夹在前，各自内部升序", () => {
    const children = [
      makeFile("2-file.pdf", "pdf"),
      makeDir("2-dir"),
      makeFile("1-file.pdf", "pdf"),
      makeDir("1-dir"),
    ];
    const sorted = sortDirectoryChildren(children);
    expect(sorted.map((c) => c.name)).toEqual([
      "1-dir",
      "2-dir",
      "1-file.pdf",
      "2-file.pdf",
    ]);
  });

  it("数字感知排序：file2 < file10", () => {
    const children = [
      makeFile("file10.pdf", "pdf"),
      makeFile("file2.pdf", "pdf"),
      makeFile("file1.pdf", "pdf"),
    ];
    const sorted = sortDirectoryChildren(children);
    expect(sorted.map((c) => c.name)).toEqual([
      "file1.pdf",
      "file2.pdf",
      "file10.pdf",
    ]);
  });

  it("不修改原数组", () => {
    const children = [
      makeFile("b.pdf", "pdf"),
      makeFile("a.pdf", "pdf"),
    ];
    const original = [...children];
    sortDirectoryChildren(children);
    expect(children.map((c) => c.name)).toEqual(original.map((c) => c.name));
  });

  it("空数组返回空数组", () => {
    expect(sortDirectoryChildren([])).toEqual([]);
  });

  it("全部是文件夹时按名称升序", () => {
    const children = [makeDir("gamma"), makeDir("alpha"), makeDir("beta")];
    const sorted = sortDirectoryChildren(children);
    expect(sorted.map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
  });
});

// ─── paginateChildren ───

describe("paginateChildren", () => {
  it("项数 ≤ 19 时返回单页", () => {
    const children = Array.from({ length: 10 }, (_, i) =>
      makeFile(`file${i}.pdf`, "pdf")
    );
    const pages = paginateChildren(children);
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(10);
  });

  it("项数 = 19 时返回单页（边界）", () => {
    const children = Array.from({ length: 19 }, (_, i) =>
      makeFile(`file${i}.pdf`, "pdf")
    );
    const pages = paginateChildren(children);
    expect(pages).toHaveLength(1);
    expect(pages[0].items).toHaveLength(19);
  });

  it("项数 = 20 时返回两页（19 + 1）", () => {
    const children = Array.from({ length: 20 }, (_, i) =>
      makeFile(`file${i}.pdf`, "pdf")
    );
    const pages = paginateChildren(children);
    expect(pages).toHaveLength(2);
    expect(pages[0].items).toHaveLength(19);
    expect(pages[1].items).toHaveLength(1);
  });

  it("项数 = 38 时返回两页（19 + 19）", () => {
    const children = Array.from({ length: 38 }, (_, i) =>
      makeFile(`file${i}.pdf`, "pdf")
    );
    const pages = paginateChildren(children);
    expect(pages).toHaveLength(2);
    expect(pages[0].items).toHaveLength(19);
    expect(pages[1].items).toHaveLength(19);
  });

  it("项数 = 75 时返回四页（19 + 19 + 19 + 18）", () => {
    const children = Array.from({ length: 75 }, (_, i) =>
      makeFile(`file${i}.pdf`, "pdf")
    );
    const pages = paginateChildren(children);
    expect(pages).toHaveLength(4);
    expect(pages.slice(0, 3).every((p) => p.items.length === 19)).toBe(true);
    expect(pages[3].items).toHaveLength(18);
  });

  it("自定义 maxItemsPerPage", () => {
    const children = Array.from({ length: 7 }, (_, i) =>
      makeFile(`file${i}.pdf`, "pdf")
    );
    const pages = paginateChildren(children, 3);
    expect(pages).toHaveLength(3);
    expect(pages[0].items).toHaveLength(3);
    expect(pages[1].items).toHaveLength(3);
    expect(pages[2].items).toHaveLength(1);
  });

  it("空数组返回空分页数组", () => {
    expect(paginateChildren([])).toEqual([]);
  });

  it("LayoutItem 正确映射 fileType / name / isDir", () => {
    const children = [
      makeDir("folder1"),
      makeFile("doc.pdf", "pdf"),
      makeFile("sheet.xlsx", "excel"),
    ];
    const pages = paginateChildren(children);
    expect(pages[0].items).toEqual([
      { fileType: "folder", name: "folder1", isDir: true },
      { fileType: "pdf", name: "doc.pdf", isDir: false },
      { fileType: "excel", name: "sheet.xlsx", isDir: false },
    ]);
  });

  it("名称前的序号被去除", () => {
    const children = [
      makeFile("1. 第一章.pdf", "pdf"),
      makeFile("2. 第二章.pdf", "pdf"),
    ];
    const pages = paginateChildren(children);
    expect(pages[0].items.map((i) => i.name)).toEqual([
      "第一章.pdf",
      "第二章.pdf",
    ]);
  });

  it("默认 maxItemsPerPage 为 19（与画布容量一致）", () => {
    expect(DEFAULT_MAX_ITEMS_PER_PAGE).toBe(19);
  });

  it("maxItemsPerPage = 0 时防御性处理为 1", () => {
    const children = [makeFile("a.pdf", "pdf"), makeFile("b.pdf", "pdf")];
    const pages = paginateChildren(children, 0);
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.items.length === 1)).toBe(true);
  });
});

// ─── formatImageFilename ───

describe("formatImageFilename", () => {
  it("编号 < 99 时两位零填充", () => {
    expect(formatImageFilename(0, 10)).toBe("资料列表_01.jpg");
    expect(formatImageFilename(1, 10)).toBe("资料列表_02.jpg");
    expect(formatImageFilename(9, 10)).toBe("资料列表_10.jpg");
  });

  it("编号 = 98（total=99）时仍为两位", () => {
    expect(formatImageFilename(98, 99)).toBe("资料列表_99.jpg");
  });

  it("total ≥ 100 时升级为三位零填充", () => {
    expect(formatImageFilename(0, 100)).toBe("资料列表_001.jpg");
    expect(formatImageFilename(1, 100)).toBe("资料列表_002.jpg");
    expect(formatImageFilename(99, 100)).toBe("资料列表_100.jpg");
    expect(formatImageFilename(100, 101)).toBe("资料列表_101.jpg");
  });

  it("total = 200 时三位零填充", () => {
    expect(formatImageFilename(0, 200)).toBe("资料列表_001.jpg");
    expect(formatImageFilename(199, 200)).toBe("资料列表_200.jpg");
  });

  it("index 从 0 开始，内部 +1 转为 1-based", () => {
    expect(formatImageFilename(0, 5)).toBe("资料列表_01.jpg");
    expect(formatImageFilename(4, 5)).toBe("资料列表_05.jpg");
  });

  it("扩展名固定为 .jpg", () => {
    expect(formatImageFilename(0, 10)).toMatch(/\.jpg$/);
    expect(formatImageFilename(0, 100)).toMatch(/\.jpg$/);
  });
});
