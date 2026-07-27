// 页码规则解析与校验。
//
// 支持两类规则：
//   1. 前 N 页：firstN=N → [1, 2, ..., min(N, totalPages)]
//   2. 自定义页码：表达式 "1,3,5-8" → [1, 3, 5, 6, 7, 8]
//   3. 合并：同时配置时合并去重并升序
//
// 校验规则：
//   - 前 N 页：N 必须 ≥ 1
//   - 自定义表达式：仅允许数字、逗号、连字符；范围 a-b 必须 a ≤ b
//   - 超范围页码：忽略并返回 warnings（不阻断，记录警告日志）
//   - 空页集合：返回 error（阻断执行）
//
// 与 spec.md Requirement: 页码规则解析 对齐：
//   - WHEN 用户设置导出前 N 页 → 系统选择每个 PDF 的前 N 个合法页码
//   - WHEN 用户输入 1,3,5-8 → 解析为去重且升序的合法页码集合
//   - WHEN 同时配置 → 合并去重
//   - WHEN 部分页码超范围 → 忽略非法页码并记录警告
//   - WHEN 页码输入非法 → 阻止任务开始

export type PageRuleInput = {
  firstN?: number;
  customPages?: string;
};

// 解析结果：合法页码集合（升序、去重）+ 警告 + 错误。
export type PageRuleResult = {
  pages: number[];
  warnings: string[];
  error?: string;
};

// 校验前 N 页输入。
// 返回 [合法值, 错误消息]。
export function validateFirstN(raw: string | number | undefined): {
  value?: number;
  error?: string;
} {
  if (raw === undefined || raw === null || raw === "") {
    return { value: undefined };
  }
  const n =
    typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (Number.isNaN(n)) {
    return { error: "前 N 页必须是数字" };
  }
  if (n < 1) {
    return { error: "前 N 页必须 ≥ 1" };
  }
  if (!Number.isInteger(n)) {
    return { error: "前 N 页必须是整数" };
  }
  return { value: n };
}

// 校验自定义页码表达式格式（不检查范围）。
// 仅检查语法：数字、逗号、连字符；范围 a-b 必须 a ≤ b。
export function validateCustomPagesFormat(expr: string): {
  ok: boolean;
  error?: string;
} {
  const trimmed = expr.trim();
  if (trimmed === "") {
    return { ok: false, error: "自定义页码不能为空" };
  }
  // 整体字符集校验：仅允许数字、逗号、连字符、空白。
  if (!/^[\d,\s-]+$/.test(trimmed)) {
    return {
      ok: false,
      error: "页码表达式仅允许数字、逗号和连字符",
    };
  }
  // 逐段校验。
  const segments = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, error: "页码表达式为空" };
  }
  for (const seg of segments) {
    const rangeMatch = seg.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);
      if (a < 1 || b < 1) {
        return { ok: false, error: `页码必须 ≥ 1：${seg}` };
      }
      if (a > b) {
        return {
          ok: false,
          error: `页码范围起始大于结束：${seg}`,
        };
      }
    } else if (/^\d+$/.test(seg)) {
      const n = parseInt(seg, 10);
      if (n < 1) {
        return { ok: false, error: `页码必须 ≥ 1：${seg}` };
      }
    } else {
      return { ok: false, error: `无法解析的页码段：${seg}` };
    }
  }
  return { ok: true };
}

// 解析自定义页码表达式为页码数组（不检查范围，仅语法解析）。
// 调用前应先用 validateCustomPagesFormat 校验。
export function parseCustomPages(expr: string): number[] {
  const trimmed = expr.trim();
  if (trimmed === "") return [];
  const result: number[] = [];
  for (const seg of trimmed.split(",").map((s) => s.trim()).filter(Boolean)) {
    const rangeMatch = seg.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = parseInt(rangeMatch[2], 10);
      for (let i = a; i <= b; i++) result.push(i);
    } else if (/^\d+$/.test(seg)) {
      result.push(parseInt(seg, 10));
    }
  }
  return result;
}

// 解析页码规则（前 N 页 + 自定义），合并、去重、升序，并按 totalPages 过滤。
//
// 参数：
//   input: { firstN?, customPages? }
//   totalPages: PDF 总页数（来自 pdf.js）
//
// 返回：
//   pages: 合法页码集合（升序、去重）
//   warnings: 超范围页码警告（不阻断）
//   error: 阻断性错误（非法表达式或最终无合法页码）
export function resolvePageRule(
  input: PageRuleInput,
  totalPages: number
): PageRuleResult {
  const warnings: string[] = [];
  const rawPages: number[] = [];

  // 前 N 页
  if (input.firstN !== undefined) {
    const fn = validateFirstN(input.firstN);
    if (fn.error) {
      return { pages: [], warnings, error: fn.error };
    }
    if (fn.value !== undefined) {
      const limit = Math.min(fn.value, totalPages);
      for (let i = 1; i <= limit; i++) rawPages.push(i);
      if (fn.value > totalPages) {
        warnings.push(
          `前 ${fn.value} 页超过总页数 ${totalPages}，仅取前 ${limit} 页`
        );
      }
    }
  }

  // 自定义页码
  if (input.customPages && input.customPages.trim() !== "") {
    const fmt = validateCustomPagesFormat(input.customPages);
    if (!fmt.ok) {
      return { pages: [], warnings, error: fmt.error };
    }
    const custom = parseCustomPages(input.customPages);
    for (const p of custom) {
      rawPages.push(p);
    }
  }

  // 去重 + 升序
  const unique = Array.from(new Set(rawPages)).sort((a, b) => a - b);

  // 超范围过滤
  const inRange = unique.filter((p) => p >= 1 && p <= totalPages);
  const outOfRange = unique.filter((p) => p > totalPages);
  if (outOfRange.length > 0) {
    warnings.push(
      `页码超出 PDF 总页数 ${totalPages}，已忽略：${outOfRange.join(", ")}`
    );
  }

  // 空页集合：阻断
  if (inRange.length === 0) {
    return {
      pages: [],
      warnings,
      error: "解析后无合法页码，请检查页码规则",
    };
  }

  return { pages: inRange, warnings };
}

// 表单级综合校验（不依赖 totalPages，用于加入队列前的阻断检查）。
// 返回 null 表示通过，否则返回错误消息。
export function validateFormPageRule(input: PageRuleInput): string | null {
  // firstN 已定义但非法时，优先报具体错误（而非"未配置"）。
  if (input.firstN !== undefined) {
    const fn = validateFirstN(input.firstN);
    if (fn.error) return fn.error;
  }

  const hasFirstN = input.firstN !== undefined && input.firstN >= 1;
  const hasCustom =
    input.customPages !== undefined && input.customPages.trim() !== "";

  if (!hasFirstN && !hasCustom) {
    return "请至少配置前 N 页或自定义页码之一";
  }

  if (hasCustom && input.customPages) {
    const fmt = validateCustomPagesFormat(input.customPages);
    if (!fmt.ok) return fmt.error ?? "页码表达式格式错误";
  }

  return null;
}
