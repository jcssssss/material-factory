// pageRule 单元测试。
//
// 覆盖 SubTask 7.3 验证项：
//   - 前 N 页配置与合法性校验
//   - 自定义页码与页码范围表达式解析
//   - 两类规则合并、去重、升序
//   - 超范围页码告警（不阻断）
//   - 非法表达式、空页集合阻断

import { describe, it, expect } from "vitest";
import {
  validateFirstN,
  validateCustomPagesFormat,
  parseCustomPages,
  resolvePageRule,
  validateFormPageRule,
} from "../pageRule";

describe("validateFirstN", () => {
  it("接受正整数", () => {
    expect(validateFirstN(5)).toEqual({ value: 5 });
    expect(validateFirstN("3")).toEqual({ value: 3 });
    expect(validateFirstN(1)).toEqual({ value: 1 });
  });

  it("拒绝 0 和负数", () => {
    expect(validateFirstN(0).error).toMatch(/≥ 1/);
    expect(validateFirstN(-3).error).toMatch(/≥ 1/);
  });

  it("拒绝非整数", () => {
    expect(validateFirstN(2.5).error).toMatch(/整数/);
    expect(validateFirstN("abc").error).toMatch(/数字/);
  });

  it("空值返回 undefined（未配置）", () => {
    expect(validateFirstN(undefined)).toEqual({ value: undefined });
    expect(validateFirstN("")).toEqual({ value: undefined });
  });
});

describe("validateCustomPagesFormat", () => {
  it("接受单页码", () => {
    expect(validateCustomPagesFormat("1").ok).toBe(true);
    expect(validateCustomPagesFormat("5").ok).toBe(true);
  });

  it("接受逗号分隔页码", () => {
    expect(validateCustomPagesFormat("1,3,5").ok).toBe(true);
    expect(validateCustomPagesFormat("1, 3, 5").ok).toBe(true);
  });

  it("接受页码范围", () => {
    expect(validateCustomPagesFormat("1-5").ok).toBe(true);
    expect(validateCustomPagesFormat("1-3,7-9").ok).toBe(true);
  });

  it("接受混合表达式", () => {
    expect(validateCustomPagesFormat("1,3,5-8,10").ok).toBe(true);
  });

  it("拒绝非法字符", () => {
    expect(validateCustomPagesFormat("1;a").ok).toBe(false);
    expect(validateCustomPagesFormat("abc").ok).toBe(false);
    expect(validateCustomPagesFormat("1.5").ok).toBe(false);
  });

  it("拒绝范围起始大于结束", () => {
    const r = validateCustomPagesFormat("5-3");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/起始大于结束/);
  });

  it("拒绝空表达式", () => {
    expect(validateCustomPagesFormat("").ok).toBe(false);
    expect(validateCustomPagesFormat("   ").ok).toBe(false);
  });
});

describe("parseCustomPages", () => {
  it("解析单页码", () => {
    expect(parseCustomPages("1")).toEqual([1]);
  });

  it("解析逗号分隔页码", () => {
    expect(parseCustomPages("1,3,5")).toEqual([1, 3, 5]);
  });

  it("解析页码范围", () => {
    expect(parseCustomPages("1-5")).toEqual([1, 2, 3, 4, 5]);
  });

  it("解析混合表达式（不去重）", () => {
    expect(parseCustomPages("1,3,5-7,2")).toEqual([1, 3, 5, 6, 7, 2]);
  });

  it("空表达式返回空数组", () => {
    expect(parseCustomPages("")).toEqual([]);
    expect(parseCustomPages("   ")).toEqual([]);
  });
});

describe("resolvePageRule", () => {
  it("前 N 页：取前 N 页", () => {
    const r = resolvePageRule({ firstN: 3 }, 10);
    expect(r.pages).toEqual([1, 2, 3]);
    expect(r.error).toBeUndefined();
  });

  it("前 N 页超过总页数：截断并告警", () => {
    const r = resolvePageRule({ firstN: 15 }, 10);
    expect(r.pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.warnings.some((w) => w.includes("超过总页数"))).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("自定义页码：解析为升序去重", () => {
    const r = resolvePageRule({ customPages: "1,3,5-8" }, 10);
    expect(r.pages).toEqual([1, 3, 5, 6, 7, 8]);
  });

  it("合并前 N 页与自定义页码：去重升序", () => {
    const r = resolvePageRule({ firstN: 3, customPages: "2,4,5-7" }, 10);
    // 前 3 页 = [1,2,3] + 自定义 [2,4,5,6,7] → 合并去重 [1,2,3,4,5,6,7]
    expect(r.pages).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("超范围页码：忽略并告警，不阻断", () => {
    const r = resolvePageRule({ customPages: "1,8,15,20" }, 10);
    expect(r.pages).toEqual([1, 8]);
    expect(r.warnings.some((w) => w.includes("15") && w.includes("20"))).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it("非法表达式：返回 error 阻断", () => {
    const r = resolvePageRule({ customPages: "1;3" }, 10);
    expect(r.pages).toEqual([]);
    expect(r.error).toBeDefined();
  });

  it("空页集合：返回 error 阻断", () => {
    // 所有页码都超范围 → 无合法页码
    const r = resolvePageRule({ customPages: "15,20" }, 10);
    expect(r.pages).toEqual([]);
    expect(r.error).toMatch(/无合法页码/);
  });

  it("firstN 非法：返回 error", () => {
    const r = resolvePageRule({ firstN: -1 }, 10);
    expect(r.error).toBeDefined();
  });

  it("未配置任何规则：返回空页集合（不阻断，由调用方处理）", () => {
    const r = resolvePageRule({}, 10);
    expect(r.pages).toEqual([]);
    // 既无 firstN 也无 customPages → 无合法页码 error
    expect(r.error).toMatch(/无合法页码/);
  });
});

describe("validateFormPageRule", () => {
  it("至少配置一项", () => {
    expect(validateFormPageRule({})).toMatch(/至少配置/);
    expect(validateFormPageRule({ firstN: 3 })).toBeNull();
    expect(validateFormPageRule({ customPages: "1,3" })).toBeNull();
    expect(validateFormPageRule({ firstN: 3, customPages: "1,3" })).toBeNull();
  });

  it("firstN 非法时报具体错误", () => {
    expect(validateFormPageRule({ firstN: -1 })).toMatch(/≥ 1/);
  });

  it("customPages 格式非法时报具体错误", () => {
    expect(validateFormPageRule({ customPages: "1;3" })).toMatch(/仅允许/);
  });
});
