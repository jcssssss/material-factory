// 页处理器接口。
//
// taskRunner 通过此接口与具体的 PDF 处理实现解耦：
//   - Task 4 实现 resolvePages（页码规则解析）+ expandPdfs（folder 模式 PDF 扫描）
//   - Task 5 实现 prepareWorkItem、renderAndExportPage
//
// 这样 Task 3 可以独立完成串行队列与失败隔离框架，
// 而真正的 PDF 解析与图片导出在 Task 4/5 注入。

import type { PageResult, PdfWorkItem, TaskConfig } from "../types/task";

// 单页渲染与导出的上下文。
export type PageProcessContext = {
  task: TaskConfig;
  workItem: PdfWorkItem;
  pageNumber: number;
  // 任务输出根目录 + 任务名拼接后的目录，例如 `{outputDir}/{taskName}/`。
  taskOutputDir: string;
  // 任务输出根目录 + 任务名 + PDF 文件名拼接后的目录，例如 `{outputDir}/{taskName}/{pdfName}/`。
  pdfOutputDir: string;
};

// 页处理器：由 Task 4/5 提供具体实现。
export interface PageProcessor {
  // 展开任务输入为 PDF 文件路径列表。
  // - files 模式：直接返回 sourcePaths（过滤掉非 PDF）。
  // - folder 模式：扫描文件夹返回其中的 PDF 文件列表（按文件名排序）。
  // 抛出异常表示无法访问文件夹或文件夹中无 PDF（taskRunner 会捕获并标记任务失败）。
  expandPdfs(task: TaskConfig): Promise<string[]>;

  // 为单个 PDF 创建工作项：读取总页数、根据页码规则生成 selectedPages。
  // Task 4 实现 pageRule 解析；Task 5 实现 pdf.js 读取总页数。
  // 失败时抛出异常，taskRunner 会捕获并标记该 PDF 失败。
  prepareWorkItem(task: TaskConfig, pdfPath: string): Promise<PdfWorkItem>;

  // 渲染前按需加载 PDF 文档（预扫描阶段不缓存 doc，渲染阶段逐 PDF 加载，
  // 避免整批 PDF 文档 + pdf.js worker 同时常驻内存）。
  // 加载失败抛出异常，taskRunner 会捕获并标记该 PDF 失败。
  openDocument(pdfPath: string): Promise<void>;

  // 渲染并导出单页图片。
  // 成功返回 PageResult（status: success, outputPath 已填写）。
  // 失败时抛出异常，taskRunner 会捕获并生成 PageResult（status: failed）。
  renderAndExportPage(ctx: PageProcessContext): Promise<PageResult>;
}
