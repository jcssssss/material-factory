// taskNaming 单元测试：任务名自动推导 + 同名冲突去重。
import { describe, it, expect } from "vitest";
import { deriveTaskName, resolveUniqueTaskName } from "../taskNaming";

describe("deriveTaskName", () => {
  it("取资料文件夹名（folder 模式 sourcePaths[0]）", () => {
    expect(deriveTaskName(["/Users/a/夏凉被系列 A"])).toBe("夏凉被系列 A");
  });

  it("兼容 Windows 反斜杠路径", () => {
    expect(deriveTaskName(["C:\\data\\素材\\images"])).toBe("images");
  });

  it("忽略末尾分隔符", () => {
    expect(deriveTaskName(["/data/素材/"])).toBe("素材");
  });

  it("空数组 fallback「未命名任务」", () => {
    expect(deriveTaskName([])).toBe("未命名任务");
  });

  it("空路径 fallback「未命名任务」", () => {
    expect(deriveTaskName([""])).toBe("未命名任务");
  });
});

describe("resolveUniqueTaskName", () => {
  const mk = (overrides: Partial<{
    outputDir: string;
    taskName: string;
    sourcePaths: string[];
  }> = {}) => ({
    outputDir: "/out",
    taskName: "images",
    sourcePaths: ["/a/images"],
    ...overrides,
  });

  it("重跑同一批（同 outputDir + 同输入路径）→ 允许同名覆盖", () => {
    const existing = [mk()];
    expect(resolveUniqueTaskName("images", "/out", "/a/images", existing)).toBe(
      "images",
    );
  });

  it("不同输入占用同名 → 追加 -2", () => {
    const existing = [mk({ sourcePaths: ["/b/images"] })];
    expect(resolveUniqueTaskName("images", "/out", "/a/images", existing)).toBe(
      "images-2",
    );
  });

  it("-2 也被占 → 追加 -3", () => {
    const existing = [
      mk({ sourcePaths: ["/b/images"] }),
      mk({ sourcePaths: ["/c/images"], taskName: "images-2" }),
    ];
    expect(resolveUniqueTaskName("images", "/out", "/a/images", existing)).toBe(
      "images-3",
    );
  });

  it("不同 outputDir 同名 → 直接使用", () => {
    const existing = [mk({ outputDir: "/out2" })];
    expect(resolveUniqueTaskName("images", "/out", "/a/images", existing)).toBe(
      "images",
    );
  });

  it("无冲突 → 直接使用", () => {
    expect(resolveUniqueTaskName("images", "/out", "/a/images", [])).toBe(
      "images",
    );
  });
});
