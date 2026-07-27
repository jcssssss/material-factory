// inputValidation 单元测试。
//
// 覆盖验证项：
//   - 不支持的输入类型阻止（仅允许 PDF / Word）
//   - 空输入阻止
//   - 空文件夹阻止（执行级）
//   - 缺少任务名 / 输出目录阻止

import { describe, it, expect } from "vitest";
import {
  isPdfPath,
  isWordPath,
  validateTaskInput,
  validateExpandedPdfs,
} from "../inputValidation";

describe("isPdfPath", () => {
  it("识别 .pdf 扩展名（不区分大小写）", () => {
    expect(isPdfPath("a.pdf")).toBe(true);
    expect(isPdfPath("a.PDF")).toBe(true);
    expect(isPdfPath("a.Pdf")).toBe(true);
    expect(isPdfPath("/path/to/file.pdf")).toBe(true);
  });

  it("拒绝非 PDF 文件", () => {
    expect(isPdfPath("a.docx")).toBe(false);
    expect(isPdfPath("a.png")).toBe(false);
    expect(isPdfPath("a.pdf.txt")).toBe(false);
    expect(isPdfPath("")).toBe(false);
  });
});

describe("isWordPath", () => {
  it("识别 .docx/.doc 扩展名（不区分大小写）", () => {
    expect(isWordPath("a.docx")).toBe(true);
    expect(isWordPath("a.doc")).toBe(true);
    expect(isWordPath("a.DOCX")).toBe(true);
    expect(isWordPath("a.Doc")).toBe(true);
    expect(isWordPath("/path/to/file.docx")).toBe(true);
  });

  it("拒绝非 Word 文件", () => {
    expect(isWordPath("a.pdf")).toBe(false);
    expect(isWordPath("a.png")).toBe(false);
    expect(isWordPath("a.doc.txt")).toBe(false);
    expect(isWordPath("")).toBe(false);
  });
});

describe("validateTaskInput", () => {
  it("缺少任务名", () => {
    const r = validateTaskInput({
      taskName: "",
      sourceType: "files",
      sourcePaths: ["a.pdf"],
      outputDir: "/out",
    });
    expect(r).toMatch(/任务名/);
  });

  it("缺少输入路径", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "files",
      sourcePaths: [],
      outputDir: "/out",
    });
    expect(r).toMatch(/PDF/);
  });

  it("files 模式：包含不支持的文件 → 阻止", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "files",
      sourcePaths: ["a.pdf", "b.png"],
      outputDir: "/out",
    });
    expect(r).toMatch(/仅支持 PDF 与 Word/);
  });

  it("files 模式：全部 PDF → 通过", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "files",
      sourcePaths: ["a.pdf", "b.pdf"],
      outputDir: "/out",
    });
    expect(r).toBeNull();
  });

  it("files 模式：PDF + Word 混合 → 通过", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "files",
      sourcePaths: ["a.pdf", "b.docx"],
      outputDir: "/out",
    });
    expect(r).toBeNull();
  });

  it("files 模式：仅 Word → 通过", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "files",
      sourcePaths: ["a.docx", "b.doc"],
      outputDir: "/out",
    });
    expect(r).toBeNull();
  });

  it("folder 模式：不检查 sourcePaths 是否 PDF（扫描在执行时）", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "folder",
      sourcePaths: ["/some/folder"],
      outputDir: "/out",
    });
    expect(r).toBeNull();
  });

  it("缺少输出目录", () => {
    const r = validateTaskInput({
      taskName: "t",
      sourceType: "files",
      sourcePaths: ["a.pdf"],
      outputDir: "",
    });
    expect(r).toMatch(/输出目录/);
  });
});

describe("validateExpandedPdfs", () => {
  it("folder 模式无 PDF → 阻止", () => {
    const r = validateExpandedPdfs([], {
      taskName: "t",
      sourceType: "folder",
    });
    expect(r).toMatch(/文件夹中未找到任何 PDF 或 Word/);
  });

  it("files 模式无 PDF → 阻止", () => {
    const r = validateExpandedPdfs([], {
      taskName: "t",
      sourceType: "files",
    });
    expect(r).toMatch(/无可处理的 PDF 或 Word/);
  });

  it("有 PDF → 通过", () => {
    const r = validateExpandedPdfs(["a.pdf"], {
      taskName: "t",
      sourceType: "files",
    });
    expect(r).toBeNull();
  });
});
