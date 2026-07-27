// 资料列表展示图生成器：目录树扫描封装。
//
// 与 v1.2.0 spec.md "Requirement: 商品资料文件夹递归扫描" 对齐：
//   - 调用 Rust 命令 scan_folder_tree 递归扫描商品资料文件夹
//   - Rust 侧已过滤系统文件（.DS_Store / Thumbs.db / desktop.ini / __MACOSX / ._）
//   - Rust 侧对无法读取元数据的文件跳过，不中断扫描
//   - 返回类型化的 FolderTreeNode 树供后续布局与渲染使用
//
// 与 backend/src/lib.rs `scan_folder_tree` 命令一一对应。

import { invoke } from "@tauri-apps/api/core";
import type { FolderTreeNode } from "../../types/materialList";

// 扫描商品资料文件夹，返回递归目录树。
//
// 商品根目录作为扫描入口，其节点本身不展示在图片中（由调用方在遍历时
// 跳过根节点名称，仅处理其 children）。
//
// 参数 folder 应为绝对路径，由前端文件选择器提供。
// 失败时抛出 Error，由调用方（taskRunner.generateMaterialListImages）捕获并记 warn 日志，
// 跳过该文件夹但不影响任务整体流程。
export async function scanFolderTree(folder: string): Promise<FolderTreeNode> {
  return invoke<FolderTreeNode>("scan_folder_tree", { folder });
}
