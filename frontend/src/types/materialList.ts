// 资料列表展示图生成器领域类型定义。
//
// 仅保留目录树节点类型，供工作台流程内资料列表图片生成模块使用
// （taskRunner.ts 的 generateMaterialListImages）。
// 与 backend/src/lib.rs 的 `FolderTreeNode` / `FileType` Rust 结构对齐，
// Rust 侧通过 serde 序列化为小写字符串，前端以字面量联合类型约束。

// 文件类型分类，与 Rust FileType 枚举（serde rename_all = "lowercase"）对齐。
export type FileType =
  | "pdf"
  | "word"
  | "excel"
  | "ppt"
  | "folder"
  | "other";

// 目录树节点。与 Rust `FolderTreeNode` 结构一一对应。
// - 文件节点：is_dir=false，children 为空数组，empty 固定 false
// - 文件夹节点：is_dir=true，extension 为 null，file_type="folder"
//   - empty=true 表示过滤系统文件后无有效子项，执行阶段不生成图片
export type FolderTreeNode = {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
  file_type: FileType;
  empty: boolean;
  children: FolderTreeNode[];
};
