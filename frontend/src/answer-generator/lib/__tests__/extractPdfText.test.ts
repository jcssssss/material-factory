// sortTextItemsToLines 单元测试：乱序 y/x 的 pdf.js 文本项还原阅读顺序。

import { describe, expect, it } from "vitest";
import { sortTextItemsToLines, type TextItemLike } from "../extractPdfText";

function item(str: string, x: number, y: number): TextItemLike {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

describe("sortTextItemsToLines", () => {
  it("把乱序 y/x 的文本项按阅读顺序拼成多行", () => {
    const items: TextItemLike[] = [
      item("CD", 30, 100), // 第一行（上）右侧
      item("EF", 5, 80), // 第二行（下）
      item("AB", 10, 100), // 第一行（上）左侧
    ];
    expect(sortTextItemsToLines(items)).toBe("ABCD\nEF");
  });

  it("空数组返回空字符串", () => {
    expect(sortTextItemsToLines([])).toBe("");
  });

  it("过滤空字符串项", () => {
    const items: TextItemLike[] = [item("", 0, 0), item("你好", 0, 100)];
    expect(sortTextItemsToLines(items)).toBe("你好");
  });

  it("同一行忽略 y 微小误差（≤4），不同行分开", () => {
    const items: TextItemLike[] = [
      item("A", 0, 100),
      item("B", 5, 98.5), // 与 A 同一行（误差 < 4）
      item("C", 0, 90), // 不同行
    ];
    expect(sortTextItemsToLines(items)).toBe("AB\nC");
  });
});
