// 串行任务队列执行器。
//
// 设计要点：
//   - 任务按队列顺序串行执行，一个任务结束后自动调度下一个。
//   - 三级失败隔离：
//       单页失败 → 记录页级错误，继续同 PDF 下一页
//       单 PDF 失败 → 记录 PDF 错误，继续同任务其他 PDF
//       单任务失败 → 记录任务错误，继续队列下一任务
//   - 任务最终状态：
//       completed：所有页成功
//       completed_with_errors：部分页或 PDF 失败，但任务有产出
//       failed：任务级致命错误（如输出目录不可写、无合法 PDF）
//       cancelled：用户取消，已导出文件保留不回滚
//   - PDF 级断点：每个 PDF 完成后写入断点（localStorage），应用重启后可从断点恢复
//
// 通过注入 PageProcessor 与具体的 PDF 处理逻辑解耦：
//   - Task 4 实现 pageRule 解析
//   - Task 5 实现 pdf.js 渲染与图片导出

import type {
  PageResult,
  PdfWorkItem,
  TaskConfig,
  TaskRunResult,
  TaskStatus,
  TaskSummary,
} from "../types/task";
import type { PageProcessor, PageProcessContext } from "./pageProcessor";
import { logger } from "./logger";
import { useTaskStore } from "../store/useTaskStore";
import { isWordPath } from "./inputValidation";
import { convertWordToPdf } from "./wordConverter";
import { TaskController } from "./taskController";
import {
  saveBreakpoint,
  type TaskBreakpoint,
  type PdfBreakpoint,
} from "./persistence";
import { scanFolderTree } from "./materialList/folderScanner";
import {
  sortDirectoryChildren,
  paginateChildren,
  formatImageFilename,
} from "./materialList/layoutEngine";
import {
  renderLayoutPageToCanvas,
  canvasToJpegBlob,
} from "./materialList/imageRenderer";
import type { FolderTreeNode } from "../types/materialList";
import { invoke } from "@tauri-apps/api/core";
import { generatePrintImages } from "./printEngine/compositor";
import { listTemplates } from "./printEngine/backgroundDb";

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? p;
  return last.replace(/\.pdf$/i, "");
}

function joinPath(...segments: string[]): string {
  // 简单的跨平台路径拼接，实际路径处理在 Task 5 中通过 Tauri path API 完善。
  return segments
    .map((s) => s.replace(/\/+$/, ""))
    .filter(Boolean)
    .join("/");
}

// 判定任务最终状态。
function resolveTaskStatus(
  pageResults: PageResult[],
  hasFatalError: boolean
): TaskStatus {
  if (hasFatalError) return "failed";
  const failed = pageResults.filter((r) => r.status === "failed").length;
  if (failed === 0) return "completed";
  return "completed_with_errors";
}

// 构建取消状态的任务结果。
// 已导出的页结果保留在 pageResults 中，不回滚（spec.md "取消时已导出文件保留不回滚"）。
function buildCancelledResult(
  task: TaskConfig,
  pageResults: PageResult[],
  pdfPaths: string[],
  startedAt: string
): TaskRunResult {
  const finishedAt = new Date().toISOString();
  const successCount = pageResults.filter((r) => r.status === "success").length;
  const failedCount = pageResults.filter((r) => r.status === "failed").length;
  return {
    taskId: task.taskId,
    status: "cancelled",
    summary: {
      taskId: task.taskId,
      totalPdfCount: pdfPaths.length,
      totalPageCount: pageResults.filter(
        (r) => r.status !== "skipped" || r.pageNumber > 0
      ).length,
      successPageCount: successCount,
      failedPageCount: failedCount,
      startedAt,
      finishedAt,
    },
    pageResults,
  };
}

// 深度优先遍历目录树，收集所有非空目录节点。
// 复用 materialList 模块的遍历逻辑，但不使用独立的 runner（适配工作台流程）。
function collectNonEmptyDirectories(root: FolderTreeNode): FolderTreeNode[] {
  const result: FolderTreeNode[] = [];

  function dfs(node: FolderTreeNode) {
    if (!node.is_dir || node.empty) return;
    result.push(node);
    for (const child of node.children) {
      if (child.is_dir) dfs(child);
    }
  }

  if (!root.empty) result.push(root);
  for (const child of root.children) {
    if (child.is_dir) dfs(child);
  }
  return result;
}

// 为工作台任务生成资料列表展示图。
//
// 与独立资料列表模块的区别：
//   - 图片输出到 taskOutputDir（而非商品文件夹本身）
//   - 复用 materialList 的扫描/排序/分页/渲染能力
//   - 失败不中断任务（记 warn 日志，任务状态不受影响）
//
// 流程：
//   1. 对 sourcePaths 中的每个文件夹：scanFolderTree → collectNonEmptyDirectories
//   2. 预扫描计算总页数（决定编号位数）
//   3. 逐目录渲染 Canvas → JPG → 写盘到 taskOutputDir
async function generateMaterialListImages(
  task: TaskConfig,
  taskOutputDir: string
): Promise<void> {
  logger.taskInfo(task.taskId, `开始生成资料列表展示图`);

  for (const folderPath of task.sourcePaths) {
    let root: FolderTreeNode;
    try {
      root = await scanFolderTree(folderPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskWarn(task.taskId, `资料列表扫描失败，跳过：${basename(folderPath)} - ${msg}`);
      continue;
    }

    const dirsToRender = collectNonEmptyDirectories(root);
    if (dirsToRender.length === 0) {
      logger.taskWarn(task.taskId, `资料列表无有效内容，跳过：${basename(folderPath)}`);
      continue;
    }

    // 预扫描计算总页数
    let totalPages = 0;
    for (const dir of dirsToRender) {
      const sorted = sortDirectoryChildren(dir.children);
      totalPages += paginateChildren(sorted).length;
    }

    let currentIndex = 0;
    for (const dir of dirsToRender) {
      try {
        const sorted = sortDirectoryChildren(dir.children);
        const pages = paginateChildren(sorted);
        for (const page of pages) {
          const canvas = await renderLayoutPageToCanvas(page);
          const blob = await canvasToJpegBlob(canvas);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const filename = formatImageFilename(currentIndex, totalPages);
          const outputPath = joinPath(taskOutputDir, filename);
          await invoke<void>("write_image_file", {
            path: outputPath,
            bytes: Array.from(bytes),
          });
          currentIndex += 1;
          logger.taskInfo(task.taskId, `资料列表图已生成 → ${outputPath}`);
          // 让渡主线程：避免连续 Canvas 渲染 + IPC 写盘阻塞 UI。
          // setTimeout(0) 让事件循环有机会处理 UI 交互和重绘。
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.taskWarn(task.taskId, `资料列表目录渲染失败，跳过：${dir.name} - ${msg}`);
      }
    }

    logger.taskInfo(
      task.taskId,
      `资料列表完成：${basename(folderPath)}，共 ${currentIndex} 张图片`
    );
  }
}

// 执行单个任务。
// 抛出异常表示任务级致命错误（如输出目录不可写），由上层捕获。
export async function runTask(
  task: TaskConfig,
  processor: PageProcessor,
  controller?: TaskController,
  breakpoint?: TaskBreakpoint
): Promise<TaskRunResult> {
  const startedAt = breakpoint?.startedAt ?? new Date().toISOString();
  const pageResults: PageResult[] = [];
  let hasFatalError = false;

  logger.taskInfo(task.taskId, `任务${breakpoint ? "恢复" : "开始"}：${task.taskName}`);

  // 断点 PDF 列表（用于每个 PDF 完成后更新断点）
  let breakpointPdfs: PdfBreakpoint[] = [];

  // 任务输出目录（架构文档 §输出组织规则）。
  // 实际目录创建在 Task 5 中通过 Tauri 命令完成。
  const taskOutputDir = joinPath(task.outputDir, task.taskName);

  // Word → PDF 预处理：将 Word 文件转换为 PDF 后替换原路径。
  // 转换失败时记录为 failed PageResult，继续同任务其他文件（PDF 级失败隔离）。
  type ResolvedPdf = {
    pdfPath: string; // 实际处理的 PDF 路径（Word 转换后的缓存路径）
    originalPath: string; // 用于日志和结果的原始路径（Word 原路径，PDF 则同 pdfPath）
  };

  const resolvedPdfs: ResolvedPdf[] = [];
  const pdfPaths: string[] = []; // 用于 summary 统计

  if (breakpoint) {
    // ── 断点恢复模式 ──
    // 使用存储的解析路径，跳过 expandPdfs 和 Word→PDF 转换。
    breakpointPdfs = breakpoint.pdfs.map((p) => ({
      ...p,
      pageResults: [...p.pageResults],
    }));
    for (const bp of breakpointPdfs) {
      if (bp.completed) {
        // 已完成的 PDF：将其页结果直接加入 pageResults
        pageResults.push(...bp.pageResults);
      }
      if (bp.resolvedPdfPath) {
        // 有有效路径的 PDF 加入待处理列表
        resolvedPdfs.push({
          pdfPath: bp.resolvedPdfPath,
          originalPath: bp.originalPath,
        });
        pdfPaths.push(bp.resolvedPdfPath);
      }
    }
    logger.taskInfo(
      task.taskId,
      `断点恢复：${breakpointPdfs.filter((p) => p.completed).length}/${breakpointPdfs.length} 个 PDF 已完成`
    );
  } else {
    // ── 首次执行模式 ──
    // 展开任务输入为 PDF/Word 文件路径列表。
    let inputPaths: string[] = [];
    try {
      inputPaths = await processor.expandPdfs(task);
      if (inputPaths.length === 0) {
        hasFatalError = true;
        logger.taskError(
          task.taskId,
          task.sourceType === "folder"
            ? "文件夹中未找到任何 PDF 或 Word 文件"
            : "无可处理的 PDF 或 Word 输入"
        );
      }
    } catch (err) {
      hasFatalError = true;
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskError(task.taskId, `输入扫描失败：${msg}`);
    }

    if (!hasFatalError) {
      for (const inputPath of inputPaths) {
        if (!isWordPath(inputPath)) {
          resolvedPdfs.push({ pdfPath: inputPath, originalPath: inputPath });
          pdfPaths.push(inputPath);
          breakpointPdfs.push({
            originalPath: inputPath,
            resolvedPdfPath: inputPath,
            completed: false,
            pageResults: [],
          });
          continue;
        }
        // Word 文件：调用 LibreOffice 转 PDF。
        try {
          const convertedPdf = await convertWordToPdf(inputPath, task.taskId);
          logger.taskInfo(
            task.taskId,
            `Word 转换完成：${basename(inputPath)} → ${basename(convertedPdf)}`
          );
          resolvedPdfs.push({ pdfPath: convertedPdf, originalPath: inputPath });
          pdfPaths.push(convertedPdf);
          breakpointPdfs.push({
            originalPath: inputPath,
            resolvedPdfPath: convertedPdf,
            completed: false,
            pageResults: [],
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.taskError(task.taskId, `Word 转换失败：${basename(inputPath)} - ${msg}`);
          pageResults.push({
            taskId: task.taskId,
            pdfPath: inputPath,
            pageNumber: 0,
            status: "failed",
            errorMessage: `Word 转换失败：${msg}`,
          });
          // Word 转换失败也记入断点（标记为已完成，恢复时跳过不重试）
          breakpointPdfs.push({
            originalPath: inputPath,
            resolvedPdfPath: "",
            completed: true,
            pageResults: [
              {
                taskId: task.taskId,
                pdfPath: inputPath,
                pageNumber: 0,
                status: "failed",
                errorMessage: `Word 转换失败：${msg}`,
              },
            ],
          });
          // 不中断，继续下一个文件
        }
      }
    }

    // 首次执行：保存初始断点（所有 PDF 未完成）
    const initialBreakpoint: TaskBreakpoint = {
      taskId: task.taskId,
      taskConfig: task,
      startedAt,
      lastUpdatedAt: new Date().toISOString(),
      pdfs: breakpointPdfs,
    };
    saveBreakpoint(initialBreakpoint);
  }

  // Word 预处理完成后、进入 PDF 处理循环前，检查取消信号。
  if (controller && !hasFatalError) {
    const shouldContinue = await controller.checkAndAwait();
    if (!shouldContinue) {
      logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
      return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
    }
  }

  if (!hasFatalError) {
    // 逐个 PDF 处理。单 PDF 失败不中断同任务其他 PDF。
    for (const resolved of resolvedPdfs) {
      // 断点恢复：跳过已完成的 PDF
      const bpPdf = breakpointPdfs.find(
        (bp) => bp.originalPath === resolved.originalPath
      );
      if (bpPdf?.completed) {
        logger.taskInfo(task.taskId, `PDF 已完成（跳过）：${basename(resolved.originalPath)}`);
        continue;
      }

      // PDF 边界：检查暂停/取消信号。
      if (controller) {
        const shouldContinue = await controller.checkAndAwait();
        if (!shouldContinue) {
          logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
          return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
        }
      }
      const actualPdfPath = resolved.pdfPath;
      const displayPath = resolved.originalPath;
      let workItem: PdfWorkItem;

      // ---- 单 PDF 失败隔离 ----
      try {
        workItem = await processor.prepareWorkItem(task, actualPdfPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.taskError(task.taskId, `PDF 准备失败：${basename(displayPath)} - ${msg}`);
        pageResults.push({
          taskId: task.taskId,
          pdfPath: displayPath,
          pageNumber: 0,
          status: "failed",
          errorMessage: `PDF 准备失败：${msg}`,
        });
        continue; // 继续下一个 PDF
      }

      // PDF 无合法页码：跳过并记录。
      if (workItem.selectedPages.length === 0) {
        logger.taskWarn(
          task.taskId,
          `PDF 无合法页码，跳过：${workItem.pdfName}`
        );
        pageResults.push({
          taskId: task.taskId,
          pdfPath: displayPath,
          pageNumber: 0,
          status: "skipped",
          errorMessage: "无合法页码",
        });
        continue;
      }

      logger.taskInfo(
        task.taskId,
        `PDF 开始：${workItem.pdfName}（${workItem.selectedPages.length} 页）`
      );

      const pdfOutputDir = joinPath(taskOutputDir, workItem.pdfName);

      // 更新执行进度（当前 PDF）。
      useTaskStore.getState().setProgress({
        taskId: task.taskId,
        currentPdfName: workItem.pdfName,
        currentPage: workItem.selectedPages[0],
        totalPages: workItem.selectedPages.length,
        successPages: pageResults.filter(
          (r) => r.status === "success"
        ).length,
        failedPages: pageResults.filter((r) => r.status === "failed").length,
      });

      // 逐页处理。单页失败不中断同 PDF 下一页。
      for (const pageNumber of workItem.selectedPages) {
        // 页边界：检查暂停/取消信号。
        // 暂停时阻塞直到 resume；取消时退出循环。
        // 当前页已经完成（上一轮的 renderAndExportPage 已返回），
        // 这里检查的是"是否应该开始下一页"。
        if (controller) {
          const shouldContinue = await controller.checkAndAwait();
          if (!shouldContinue) {
            logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
            return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
          }
        }
        // 更新执行进度（当前页）。
        const currentSuccess = pageResults.filter(
          (r) => r.status === "success"
        ).length;
        const currentFailed = pageResults.filter(
          (r) => r.status === "failed"
        ).length;
        useTaskStore.getState().setProgress({
          taskId: task.taskId,
          currentPdfName: workItem.pdfName,
          currentPage: pageNumber,
          totalPages: workItem.selectedPages.length,
          successPages: currentSuccess,
          failedPages: currentFailed,
        });

        const ctx: PageProcessContext = {
          task,
          workItem,
          pageNumber,
          taskOutputDir,
          pdfOutputDir,
        };

        // ---- 单页失败隔离 ----
        try {
          const result = await processor.renderAndExportPage(ctx);
          // 用原始路径覆盖结果中的 pdfPath，保证日志和历史展示用户选的文件路径。
          result.pdfPath = displayPath;
          pageResults.push(result);
          if (result.status === "success") {
            logger.pageInfo(
              task.taskId,
              displayPath,
              pageNumber,
              `导出成功 → ${result.outputPath ?? ""}`
            );
          } else if (result.status === "failed") {
            logger.pageError(
              task.taskId,
              displayPath,
              pageNumber,
              `导出失败：${result.errorMessage ?? "未知错误"}`
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const failedResult: PageResult = {
            taskId: task.taskId,
            pdfPath: displayPath,
            pageNumber,
            status: "failed",
            errorMessage: msg,
          };
          pageResults.push(failedResult);
          logger.pageError(
            task.taskId,
            displayPath,
            pageNumber,
            `渲染异常：${msg}`
          );
          // 不中断，继续下一页
        }

        // 让渡主线程：PDF 渲染是密集 CPU 操作，
        // 每页处理后让事件循环有机会响应 UI 交互和重绘。
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      logger.taskInfo(task.taskId, `PDF 完成：${workItem.pdfName}`);

      // 更新断点：标记该 PDF 为已完成
      if (bpPdf) {
        bpPdf.completed = true;
        bpPdf.pageResults = pageResults.filter(
          (r) => r.pdfPath === resolved.originalPath
        );
        const updatedBreakpoint: TaskBreakpoint = {
          taskId: task.taskId,
          taskConfig: task,
          startedAt,
          lastUpdatedAt: new Date().toISOString(),
          pdfs: breakpointPdfs,
        };
        saveBreakpoint(updatedBreakpoint);
      }
    }
  }

  // 资料列表展示图生成：PDF 处理完成后，若任务勾选了 generateMaterialList，
  // 对 sourcePaths 中的文件夹生成资料列表图，输出到 taskOutputDir。
  // 失败不中断任务（记 warn 日志），不影响任务最终状态。
  if (task.generateMaterialList && !hasFatalError) {
    try {
      await generateMaterialListImages(task, taskOutputDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskWarn(task.taskId, `资料列表生成异常：${msg}`);
    }
  }

  // 仿打印图片合成：PDF 处理完成后，若任务勾选了 generatePrintImages，
  // 对 taskOutputDir 中的 JPG 逐张与背景模板合成仿打印效果图。
  // 失败不中断任务（记 warn 日志），不影响任务最终状态。
  if (task.generatePrintImages && !hasFatalError) {
    try {
      const allTemplates = await listTemplates();
      const calibrated = allTemplates.filter((t) => t.calibrated);
      if (calibrated.length === 0) {
        logger.taskWarn(task.taskId, "无已标定的背景模板，跳过仿打印");
      } else {
        logger.taskInfo(
          task.taskId,
          `开始仿打印合成（${calibrated.length} 个背景模板）`,
        );
        const count = await generatePrintImages(
          taskOutputDir,
          calibrated,
          (done, total) => {
            const prev = useTaskStore.getState().progress;
            useTaskStore.getState().setProgress({
              taskId: task.taskId,
              successPages: prev?.successPages ?? 0,
              failedPages: prev?.failedPages ?? 0,
              currentPdfName: prev?.currentPdfName,
              currentPage: prev?.currentPage,
              totalPages: prev?.totalPages,
              printDone: done,
              printTotal: total,
            });
          },
        );
        logger.taskInfo(task.taskId, `仿打印合成完成，共生成 ${count} 张`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskWarn(task.taskId, `仿打印生成异常：${msg}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const status = resolveTaskStatus(pageResults, hasFatalError);
  const successCount = pageResults.filter((r) => r.status === "success").length;
  const failedCount = pageResults.filter((r) => r.status === "failed").length;

  const summary: TaskSummary = {
    taskId: task.taskId,
    totalPdfCount: pdfPaths.length,
    totalPageCount: pageResults.filter(
      (r) => r.status !== "skipped" || r.pageNumber > 0
    ).length,
    successPageCount: successCount,
    failedPageCount: failedCount,
    startedAt,
    finishedAt,
  };

  logger.taskInfo(
    task.taskId,
    `任务结束：${task.taskName} → ${status}（成功 ${successCount} / 失败 ${failedCount}）`
  );

  return { taskId: task.taskId, status, summary, pageResults };
}

// 队列执行器：从 store 中按顺序取出 pending 任务并执行。
// 一个任务结束后自动调度下一个，直到队列中无 pending 任务。
//
// 使用方式：
//   import { runQueue } from "./lib/taskRunner";
//   await runQueue(processor);
//
// 注意：此函数不会自动重试失败任务；如需重试由 UI 触发重新入队。
export async function runQueue(
  processor: PageProcessor,
  options?: { signal?: AbortSignal }
): Promise<void> {
  logger.appInfo("队列启动");

  while (true) {
    if (options?.signal?.aborted) {
      logger.appWarn("队列被中止");
      break;
    }

    // 重新获取最新状态（任务可能被 UI 移除）。
    const current = useTaskStore.getState();
    const nextTask = current.queue.find((t) => t.status === "pending");

    if (!nextTask) {
      logger.appInfo("队列完成：无待执行任务");
      break;
    }

    // ---- 单任务失败隔离 ----
    // 为当前任务创建运行时控制器，供 UI 暂停/继续/取消使用。
    const controller = new TaskController();
    useTaskStore.getState().setController(controller);
    useTaskStore.getState().setCurrentTaskId(nextTask.taskId);
    useTaskStore.getState().updateTaskStatus(nextTask.taskId, "running");

    let result: TaskRunResult | null = null;
    try {
      // 检查是否有断点（恢复模式）
      const bp = useTaskStore.getState().breakpoints[nextTask.taskId];
      result = await runTask(nextTask, processor, controller, bp);
    } catch (err) {
      // runTask 内部已经处理了 PDF 级和页级失败，
      // 这里捕获的是任务级未预期异常（理论上不应到达）。
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskError(nextTask.taskId, `任务未预期异常：${msg}`);
      result = {
        taskId: nextTask.taskId,
        status: "failed",
        summary: {
          taskId: nextTask.taskId,
          totalPdfCount: nextTask.sourcePaths.length,
          totalPageCount: 0,
          successPageCount: 0,
          failedPageCount: 0,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
        pageResults: [],
      };
    }

    // 更新任务状态与历史。
    if (result) {
      useTaskStore.getState().updateTaskStatus(nextTask.taskId, result.status);
      useTaskStore.getState().addHistory({
        config: { ...nextTask, status: result.status },
        summary: result.summary,
      });
      // 任务到达终态（completed / completed_with_errors / failed / cancelled）：
      // 清理断点，不再可恢复。
      // 注意：paused 状态不会走到这里——暂停时 runTask 被阻塞，不会返回。
      useTaskStore.getState().removeBreakpoint(nextTask.taskId);
    }

    // 清除当前任务进度。
    useTaskStore.getState().setProgress(null);
    useTaskStore.getState().setCurrentTaskId(null);
    useTaskStore.getState().setController(null);

    // 自动调度下一个任务（循环继续）。
  }

  logger.appInfo("队列结束");
}
