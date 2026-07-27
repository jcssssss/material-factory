// 资料列表展示图生成器：布局引擎。
//
// 与 v1.2.0 spec.md 对齐：
//   - "Requirement: 文件夹优先排序"：文件夹在前，文件在后，同类按名称升序（不区分大小写）
//   - "Requirement: 自动分页"：当当前目录内容超过单张图片承载范围（默认 25 项）时自动拆分
//   - "Requirement: 统一编号输出"：资料列表_NN.jpg，≥99 升级三位零填充
//
// 本模块为纯函数模块，无副作用，便于单元测试。

import type { FileType, FolderTreeNode } from "../../types/materialList";

// 单个布局项：图标类型 + 显示名称 + 是否文件夹。
// 由 FolderTreeNode 映射而来，剥离路径等渲染不需要的字段。
export type LayoutItem = {
  fileType: FileType;
  name: string;
  isDir: boolean;
};

// 单张图片承载的布局页：一组 LayoutItem。
// 一页对应一张输出图片。
export type LayoutPage = {
  items: LayoutItem[];
};

// 默认每页最大项数。
// 与 spec.md "自动分页规则" 一致：单张图片承载 25 项。
export const DEFAULT_MAX_ITEMS_PER_PAGE = 25;

// 名称比较函数：不区分大小写的升序比较。
// 使用 localeCompare 处理中文与数字混合排序，避免纯字节比较导致中文乱序。
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

// 排序目录的直接子项。
//
// 规则（与 spec.md "文件排序规则" 对齐）：
//   1. 文件夹优先：is_dir=true 的节点排列在前
//   2. 同类内部按名称升序（不区分大小写，数字按数值感知比较）
//
// 返回新数组，不修改入参。
export function sortDirectoryChildren(
  children: FolderTreeNode[]
): FolderTreeNode[] {
  return [...children].sort((a, b) => {
    // 文件夹优先
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }
    // 同类按名称升序
    return compareNames(a.name, b.name);
  });
}

// 将排序后的子项分配到多个分页。
//
// 当子项数量超过 maxItemsPerPage 时自动拆分为多张图片。
// 空数组返回空分页数组（由调用方决定是否记 warn 日志跳过）。
//
// 参数：
//   children - 已排序的目录子项
//   maxItemsPerPage - 每页最大项数，默认 25
//
// 返回：LayoutPage 数组，每页 items 长度 ≤ maxItemsPerPage
export function paginateChildren(
  children: FolderTreeNode[],
  maxItemsPerPage: number = DEFAULT_MAX_ITEMS_PER_PAGE
): LayoutPage[] {
  if (children.length === 0) {
    return [];
  }

  // 防御性处理：maxItemsPerPage 至少为 1，避免无限循环
  const pageSize = Math.max(1, maxItemsPerPage);

  const pages: LayoutPage[] = [];
  for (let i = 0; i < children.length; i += pageSize) {
    const slice = children.slice(i, i + pageSize);
    const items: LayoutItem[] = slice.map((node) => ({
      fileType: node.file_type,
      name: node.name,
      isDir: node.is_dir,
    }));
    pages.push({ items });
  }
  return pages;
}

// 格式化输出图片文件名。
//
// 规则（与 spec.md "统一编号输出" 对齐）：
//   - 格式：资料列表_NN.jpg
//   - 编号从 1 开始递增（index 为 0-based，内部 +1）
//   - 默认两位零填充：01、02、...、98、99
//   - 当 total ≥ 100 时升级为三位零填充：001、002、...、100、101
//
// 参数：
//   index - 0-based 索引
//   total - 该商品范围内图片总数，用于决定填充位数
//
// 返回：如 "资料列表_01.jpg" 或 "资料列表_001.jpg"
export function formatImageFilename(index: number, total: number): string {
  const sequence = index + 1; // 1-based
  const width = total >= 100 ? 3 : 2;
  const padded = String(sequence).padStart(width, "0");
  return `资料列表_${padded}.jpg`;
}
