import type { FileDetectionResult, CleanReport } from "../types";
import { generateMockResultsForFiles } from "./mockDetectionService";

export type CleanRequest = {
  inputPath: string;
  outputDir: string;
  itemsToRemove: FileDetectionResult["items"];
};

let _tauriInvoke: typeof import("@tauri-apps/api/core").invoke | null = null;

async function getInvoke(): Promise<typeof import("@tauri-apps/api/core").invoke | null> {
  if (_tauriInvoke !== null) return _tauriInvoke;
  try {
    const mod = await import("@tauri-apps/api/core");
    _tauriInvoke = mod.invoke;
    return _tauriInvoke;
  } catch {
    _tauriInvoke = null as never;
    return null;
  }
}

function isTauri(): boolean {
  return _tauriInvoke !== null;
}

/** 扫描单个 PDF 文件 */
export async function scanDocument(filePath: string): Promise<FileDetectionResult> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  return invoke("scan_document", { filePath });
}

/** 批量扫描多个 PDF 文件 */
export async function scanDocuments(filePaths: string[]): Promise<FileDetectionResult[]> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  return invoke("scan_documents", { filePaths });
}

/** 执行单个文件的清理操作 */
export async function executeClean(request: CleanRequest): Promise<CleanReport> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  const result = await invoke<{
    taskId: string;
    totalFiles: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    files: { fileName: string; status: string; error?: string }[];
    completedAt: string;
  }>("execute_clean", { request });
  return {
    taskId: result.taskId,
    totalFiles: result.totalFiles,
    successCount: result.successCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    files: result.files.map((f) => ({
      fileName: f.fileName,
      status: f.status as "success" | "failed" | "skipped",
      error: f.error,
    })),
    completedAt: result.completedAt,
  };
}

/** 批量清理多个文件 */
export async function executeBatchClean(
  requests: CleanRequest[]
): Promise<CleanReport[]> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  const results = await invoke<
    {
      taskId: string;
      totalFiles: number;
      successCount: number;
      failedCount: number;
      skippedCount: number;
      files: { fileName: string; status: string; error?: string }[];
      completedAt: string;
    }[]
  >("execute_batch_clean", { requests });
  return results.map((r) => ({
    taskId: r.taskId,
    totalFiles: r.totalFiles,
    successCount: r.successCount,
    failedCount: r.failedCount,
    skippedCount: r.skippedCount,
    files: r.files.map((f) => ({
      fileName: f.fileName,
      status: f.status as "success" | "failed" | "skipped",
      error: f.error,
    })),
    completedAt: r.completedAt,
  }));
}

/** 汇总清理报告 */
export async function generateCleanReport(
  taskId: string,
  results: CleanReport[]
): Promise<CleanReport> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  return invoke("generate_clean_report", { taskId, results });
}

/** 检查是否在 Tauri 环境中 */
export function isTauriEnv(): boolean {
  return isTauri();
}

// ─── Python 引擎 IPC ───

/** 使用 Python 引擎检测单个 PDF */
export async function pythonDetect(pdfPath: string): Promise<FileDetectionResult> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  return invoke("python_detect", { pdfPath });
}

/** 使用 Python 引擎执行清理 */
export async function pythonClean(
  pdfPath: string,
  outputPath: string
): Promise<CleanReport> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  const result = await invoke<{
    taskId: string;
    totalFiles: number;
    successCount: number;
    failedCount: number;
    skippedCount: number;
    files: { fileName: string; status: string; error?: string }[];
    completedAt: string;
  }>("python_clean", { pdfPath, outputPath });
  return {
    taskId: result.taskId,
    totalFiles: result.totalFiles,
    successCount: result.successCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    files: result.files.map((f) => ({
      fileName: f.fileName,
      status: f.status as "success" | "failed" | "skipped",
      error: f.error,
    })),
    completedAt: result.completedAt,
  };
}

/** 使用 Python 引擎验证清理结果 */
export async function pythonValidate(
  originalPath: string,
  cleanedPath: string
): Promise<Record<string, unknown>> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("not in Tauri environment");
  return invoke("python_validate", { originalPath, cleanedPath });
}

// ─── 统一级联调用 ───

type Backend = "python" | "rust" | "mock";

let _preferredBackend: Backend | null = null;

/** 检测最优可用后端。首次调用后缓存结果。 */
async function detectBackend(): Promise<Backend> {
  if (_preferredBackend) return _preferredBackend;

  const invoke = await getInvoke();
  if (!invoke) {
    _preferredBackend = "mock";
    return "mock";
  }

  // 先试 Python 引擎
  try {
    await invoke("python_detect", { pdfPath: "/dev/null" });
    _preferredBackend = "python";
    return "python";
  } catch {
    _preferredBackend = "rust";
    return "rust";
  }
}

/** 批量检测文件：Python → Rust → mock 级联回退 */
export async function tryDetect(
  fileNames: string[],
  filePaths: string[]
): Promise<FileDetectionResult[]> {
  const backend = await detectBackend();

  if (backend === "python") {
    try {
      const results = await Promise.all(filePaths.map((p) => pythonDetect(p)));
      return results;
    } catch {
      // 降级到 Rust
    }
  }

  if (backend === "python" || backend === "rust") {
    try {
      const invoke = await getInvoke();
      if (invoke) {
        const results = await invoke<FileDetectionResult[]>(
          "scan_documents",
          { filePaths }
        );
        return results;
      }
    } catch {
      // 降级到 mock
    }
  }

  return generateMockResultsForFiles(fileNames);
}
