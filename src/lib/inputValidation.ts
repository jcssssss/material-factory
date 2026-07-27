// 输入校验：不支持的文件类型阻止、空文件夹阻止。
//
// 与 spec.md 对齐：
//   - Requirement: 支持 PDF 与 Word（.docx/.doc），Word 走 LibreOffice 转换中转
//   - Scenario: 文件夹中无 PDF 或 Word → 阻止任务开始执行，提示无可处理文件
//
// 这些检查在表单层（加入队列前）与执行层（expandPdfs 时）双重落实。

import type { TaskConfig } from "../types/task";

// 判断路径是否为 PDF（不区分大小写）。
export function isPdfPath(p: string): boolean {
  return p.toLowerCase().endsWith(".pdf");
}

// 判断路径是否为 Word 文档（.docx/.doc，不区分大小写）。
export function isWordPath(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith(".docx") || lower.endsWith(".doc");
}

// 判断路径是否为受支持的输入（PDF 或 Word，不区分大小写）。
export function isSupportedInputPath(p: string): boolean {
  return isPdfPath(p) || isWordPath(p);
}

// 表单级输入校验：在加入队列前阻断非法输入。
// 返回 null 表示通过，否则返回错误消息。
export function validateTaskInput(task: {
  taskName?: string;
  sourceType: "files" | "folder";
  sourcePaths: string[];
  outputDir?: string;
}): string | null {
  if (!task.taskName || task.taskName.trim() === "") {
    return "请填写任务名";
  }

  if (!task.sourcePaths || task.sourcePaths.length === 0) {
    return task.sourceType === "folder"
      ? "请选择包含 PDF 的文件夹"
      : "请选择 PDF 文件";
  }

  // files 模式：检查是否全部为受支持的输入（PDF 或 Word）。
  // 注意：folder 模式下 sourcePaths 是文件夹路径，具体文件扫描在执行时进行。
  if (task.sourceType === "files") {
    const nonSupported = task.sourcePaths.filter((p) => !isSupportedInputPath(p));
    if (nonSupported.length > 0) {
      const sample = basename(nonSupported[0]);
      return `仅支持 PDF 与 Word（.docx/.doc）文件，包含不支持的文件：${sample}`;
    }
  }

  if (!task.outputDir || task.outputDir.trim() === "") {
    return "请选择输出目录";
  }

  return null;
}

// 执行级输入校验：expandPdfs 后检查 PDF 列表非空。
// 用于 folder 模式下「文件夹中无 PDF」的阻断。
export function validateExpandedPdfs(
  pdfPaths: string[],
  task: Pick<TaskConfig, "taskName" | "sourceType">
): string | null {
  if (pdfPaths.length === 0) {
    return task.sourceType === "folder"
      ? `文件夹中未找到任何 PDF 或 Word 文件，任务「${task.taskName}」无法执行`
      : `无可处理的 PDF 或 Word 输入，任务「${task.taskName}」无法执行`;
  }
  return null;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
