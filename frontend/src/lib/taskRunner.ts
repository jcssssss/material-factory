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
  StageKind,
  TaskConfig,
  TaskRunResult,
  TaskStatus,
  TaskSummary,
} from "../types/task";
import type { PageProcessor, PageProcessContext } from "./pageProcessor";
import { logger } from "./logger";
import { useTaskStore } from "../store/useTaskStore";
import { isWordPath } from "./inputValidation";
import { convertWordFilesToPdf } from "./wordConverter";
import { createProgressThrottle } from "./progressThrottle";
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
  MATERIAL_IMAGE_WIDTH,
  MATERIAL_IMAGE_HEIGHT,
  MAX_ITEMS_PER_PAGE,
} from "./materialList/imageRenderer";
import type { FolderTreeNode } from "../types/materialList";
import { invoke } from "@tauri-apps/api/core";
import { generatePrintImages } from "./printEngine/compositor";
import { listTemplates } from "./printEngine/backgroundDb";
import { writeImageToDisk } from "./exportImage";
import {
  createEncodeWorker,
  encodeBitmapInWorker,
  terminateEncodeWorker,
} from "./encodeWorker";

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

// 预计算阶段管线：根据任务配置决定实际执行的阶段列表。
// includeWordConvert 表示任务输入含 Word 文件（首次执行且存在 Word 输入），
// 此时 word_convert 阶段排在 pdf_convert 之前；断点恢复模式跳过该阶段。
function buildPlannedStages(
  task: TaskConfig,
  includeWordConvert: boolean
): StageKind[] {
  const stages: StageKind[] = [];
  if (includeWordConvert) stages.push("word_convert");
  stages.push("pdf_convert");
  if (task.generateMaterialList) stages.push("material_list");
  if (task.generatePrintImages) stages.push("print_compose");
  return stages;
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
  taskOutputDir: string,
  onProgress?: (done: number, total: number) => void,
  controller?: TaskController,
): Promise<void> {
  logger.taskInfo(task.taskId, `开始生成资料列表展示图`);

  // 资料列表图片统一输出到 {taskOutputDir}/资料列表/ 子文件夹。
  const materialListDir = joinPath(taskOutputDir, "资料列表");

  // 共享编码 Worker：把资料列表 toBlob 编码移出主线程，任务内复用。
  const encodeWorker = await createEncodeWorker();

  try {
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
        totalPages += paginateChildren(sorted, MAX_ITEMS_PER_PAGE).length;
      }

      // 确保子文件夹存在（write_image_file 要求父目录已存在）。
      await invoke<void>("ensure_output_dir", { path: materialListDir });

      let currentIndex = 0;
      for (const dir of dirsToRender) {
        try {
          const sorted = sortDirectoryChildren(dir.children);
          const pages = paginateChildren(sorted, MAX_ITEMS_PER_PAGE);
          for (const page of pages) {
            // 图片边界：检查暂停/取消信号（资料列表阶段支持尽快取消）。
            if (controller) {
              const shouldContinue = await controller.checkAndAwait();
              if (!shouldContinue) {
                logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
                return;
              }
            }
            const canvas = await renderLayoutPageToCanvas(page);
            // JPEG 编码移入 Worker（主线程只做一次 GPU 位图提交，不再被 toBlob 阻塞）。
            const bitmap = await createImageBitmap(canvas);
            const rawJpeg = await encodeBitmapInWorker(
              encodeWorker,
              bitmap,
              MATERIAL_IMAGE_WIDTH,
              MATERIAL_IMAGE_HEIGHT,
            );
            // 释放源 canvas 显存：宽高归零强制 WebKit 回收 GPU 位图（对齐 pdfPageProcessor 做法）。
            canvas.width = 0;
            canvas.height = 0;
            const bytes = new Uint8Array(rawJpeg);
            const filename = formatImageFilename(currentIndex, totalPages);
            const outputPath = joinPath(materialListDir, filename);
            // 走 write_image_binary 顶层二进制通道，避免 Array.from(bytes) → JSON 数字数组
            // 在主线程序列化阻塞（每张 15 万~60 万 number、2~7MB JSON）。
            await writeImageToDisk(outputPath, bytes);
            currentIndex += 1;
            onProgress?.(currentIndex, totalPages);
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
  } finally {
    terminateEncodeWorker(encodeWorker);
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

  // 预计算阶段管线：根据任务配置决定实际执行的阶段列表。
  // 默认不含 word_convert（断点恢复模式 / 任务级失败时均无 Word 转换阶段）；
  // 首次执行且存在 Word 输入时在下方重新计算，使 Word 转换进度能进入整体进度。
  let plannedStages: StageKind[] = buildPlannedStages(task, false);
  // 已完成阶段（按执行顺序累积），供 setProgress 的 completedStages 使用。
  // 相比硬编码阶段列表，能自然适配 word_convert 的插入。
  const completedStages: StageKind[] = [];

  // 进度节流：高频页级进度合并到 ~10Hz，避免 2000 页触发 2000 次 React 渲染；
  // 阶段切换/终态点先 flush 落地 pending，再直接 setProgress 新值。
  const progressThrottle = createProgressThrottle(100);

  logger.taskInfo(task.taskId, `任务${breakpoint ? "恢复" : "开始"}：${task.taskName}`);

  // 初始进度：expandPdfs/预扫描可能耗时数秒，先推送 0% 进度，让面板立即从
  // 「暂无执行中的任务」切到当前任务、显示阶段管线。直接 setProgress 绕过节流
  // （一次性低频率事件，throttle 尚无 pending）。
  useTaskStore.getState().setProgress({
    taskId: task.taskId,
    plannedStages,
    currentStage: null,
    completedStages: [],
    successPages: 0,
    failedPages: 0,
  });

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
      logger.taskInfo(task.taskId, "正在扫描输入文件…");
      inputPaths = await processor.expandPdfs(task);
      logger.taskInfo(
        task.taskId,
        `扫描完成：找到 ${inputPaths.length} 个 PDF/Word 文件`
      );
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
      const wordInputs = inputPaths.filter((p) => isWordPath(p));
      const pdfInputs = inputPaths.filter((p) => !isWordPath(p));

      // 存在 Word 输入时，将 word_convert 阶段纳入整体进度（位于 PDF 转换之前）。
      plannedStages = buildPlannedStages(task, wordInputs.length > 0);

      // PDF 直接入列
      for (const inputPath of pdfInputs) {
        resolvedPdfs.push({ pdfPath: inputPath, originalPath: inputPath });
        pdfPaths.push(inputPath);
        breakpointPdfs.push({
          originalPath: inputPath,
          resolvedPdfPath: inputPath,
          completed: false,
          pageResults: [],
        });
      }

      // Word 文件分批转换：每批一次 LibreOffice 调用（避免逐文件启动 soffice），
      // 分批让进度可见、单个坏文件卡住只影响所在批。单文件失败仅记录，不影响其余。
      // Rust 侧复用共享 profile（word_cache/shared_lo_profile），第二次起 warm start
      // ~1-3s；因此必须串行逐批执行——多路 soffice 并发会争抢同一共享 profile 锁。
      // 转换进度同时写入整体进度（word_convert 阶段），并记录对应日志。
      if (wordInputs.length > 0) {
        const BATCH = 6;
        logger.taskInfo(task.taskId, `开始转换 ${wordInputs.length} 个 Word 文件…`);
        let processed = 0;
        // 上报 word_convert 阶段进度（含 success/failed 汇总，Word 转换失败会写入 pageResults）。
        const reportWordProgress = () => {
          const wordSuccess = pageResults.filter((r) => r.status === "success").length;
          const wordFailed = pageResults.filter((r) => r.status === "failed").length;
          progressThrottle.push({
            taskId: task.taskId,
            plannedStages,
            currentStage: {
              stage: "word_convert",
              done: processed,
              total: wordInputs.length,
              detail: `Word 转换 ${Math.min(processed, wordInputs.length)}/${wordInputs.length}`,
            },
            completedStages: [...completedStages],
            successPages: wordSuccess,
            failedPages: wordFailed,
          });
        };

        // 分片：每批 BATCH 个文件（一次 LibreOffice 调用）。
        const batches: string[][] = [];
        for (let start = 0; start < wordInputs.length; start += BATCH) {
          batches.push(wordInputs.slice(start, start + BATCH));
        }

        reportWordProgress(); // 初始 0/N，立即进入整体进度

        // 串行逐批转换：共享 profile 下并发 soffice 会撞锁，顺序执行最稳。
        // 单批失败仅记录（批级 try/catch），不影响其余批次。
        for (const batch of batches) {
          // 批次边界：检查暂停/取消信号。Word 转换是串行多批（每批一次 soffice），
          // 无此检查点则取消/暂停要等全部 Word 转换完才生效。
          if (controller) {
            const shouldContinue = await controller.checkAndAwait();
            if (!shouldContinue) {
              logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
              return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
            }
          }
          try {
            const results = await convertWordFilesToPdf(batch, task.taskId);
            processed += batch.length;
            logger.taskInfo(
              task.taskId,
              `Word 转换进度 ${Math.min(processed, wordInputs.length)}/${wordInputs.length}`
            );
            for (const r of results) {
              if (r.pdfPath) {
                logger.taskInfo(
                  task.taskId,
                  `Word 转换完成：${basename(r.wordPath)} → ${basename(r.pdfPath)}`
                );
                resolvedPdfs.push({ pdfPath: r.pdfPath, originalPath: r.wordPath });
                pdfPaths.push(r.pdfPath);
                breakpointPdfs.push({
                  originalPath: r.wordPath,
                  resolvedPdfPath: r.pdfPath,
                  completed: false,
                  pageResults: [],
                });
              } else {
                const msg = r.error ?? "未知错误";
                logger.taskError(task.taskId, `Word 转换失败：${basename(r.wordPath)} - ${msg}`);
                pageResults.push({
                  taskId: task.taskId,
                  pdfPath: r.wordPath,
                  pageNumber: 0,
                  status: "failed",
                  errorMessage: `Word 转换失败：${msg}`,
                });
                // Word 转换失败也记入断点（标记为已完成，恢复时跳过不重试）
                breakpointPdfs.push({
                  originalPath: r.wordPath,
                  resolvedPdfPath: "",
                  completed: true,
                  pageResults: [
                    {
                      taskId: task.taskId,
                      pdfPath: r.wordPath,
                      pageNumber: 0,
                      status: "failed",
                      errorMessage: `Word 转换失败：${msg}`,
                    },
                  ],
                });
              }
            }
          } catch (err) {
            // 该批整体失败（如超时/后台异常）：批内所有 Word 记失败，不中断
            processed += batch.length;
            const msg = err instanceof Error ? err.message : String(err);
            for (const inputPath of batch) {
              logger.taskError(task.taskId, `Word 转换失败：${basename(inputPath)} - ${msg}`);
              pageResults.push({
                taskId: task.taskId,
                pdfPath: inputPath,
                pageNumber: 0,
                status: "failed",
                errorMessage: `Word 转换失败：${msg}`,
              });
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
            }
          }
          reportWordProgress(); // 每批完成后更新整体进度
        }
        // Word 转换阶段完成，标记为已完成阶段。
        completedStages.push("word_convert");
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
    // ── 预扫描：收集所有待处理 PDF 的工作项，计算阶段总页数 ──
    type PreparedPdf = {
      resolved: (typeof resolvedPdfs)[number];
      workItem: PdfWorkItem;
      bpPdf: (typeof breakpointPdfs)[number] | undefined;
    };
    const preparedPdfs: PreparedPdf[] = [];
    let stagePdfPages = 0;

    for (const resolved of resolvedPdfs) {
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

      try {
        const workItem = await processor.prepareWorkItem(task, resolved.pdfPath);
        if (workItem.selectedPages.length === 0) {
          logger.taskWarn(task.taskId, `PDF 无合法页码，跳过：${workItem.pdfName}`);
          pageResults.push({
            taskId: task.taskId,
            pdfPath: resolved.originalPath,
            pageNumber: 0,
            status: "skipped",
            errorMessage: "无合法页码",
          });
          continue;
        }
        stagePdfPages += workItem.selectedPages.length;
        preparedPdfs.push({ resolved, workItem, bpPdf });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.taskError(task.taskId, `PDF 准备失败：${basename(resolved.originalPath)} - ${msg}`);
        pageResults.push({
          taskId: task.taskId,
          pdfPath: resolved.originalPath,
          pageNumber: 0,
          status: "failed",
          errorMessage: `PDF 准备失败：${msg}`,
        });
      }
    }

    // 预扫描完成，把要处理的页数写回队列任务，供"页数"列展示。
    useTaskStore.getState().updateTaskPages(task.taskId, stagePdfPages);

    // 设置阶段初始进度。
    const initSuccess = pageResults.filter((r) => r.status === "success").length;
    const initFailed = pageResults.filter((r) => r.status === "failed").length;
    progressThrottle.flush(); // 落地 Word 转换阶段 pending 进度
    useTaskStore.getState().setProgress({
      taskId: task.taskId,
      plannedStages,
      currentStage: stagePdfPages > 0
        ? { stage: "pdf_convert", done: 0, total: stagePdfPages, detail: "准备开始…" }
        : null,
      completedStages: [...completedStages],
      successPages: initSuccess,
      failedPages: initFailed,
    });

    // ── 逐 PDF 处理 ──
    let cumulativePages = 0;
    // 递增计数器替代逐页 pageResults.filter（消除 O(n²)），初始为预扫描完成时的累计值。
    let runningSuccess = initSuccess;
    let runningFailed = initFailed;
    for (const { resolved, workItem, bpPdf } of preparedPdfs) {
      const displayPath = resolved.originalPath;

      // PDF 边界：检查暂停/取消信号。
      if (controller) {
        const shouldContinue = await controller.checkAndAwait();
        if (!shouldContinue) {
          logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
          return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
        }
      }

      logger.taskInfo(
        task.taskId,
        `PDF 开始：${workItem.pdfName}（${workItem.selectedPages.length} 页）`
      );

      // 按需加载该 PDF 文档（预扫描不缓存 doc，渲染前重新加载，末页自动销毁）。
      // 加载失败记 PDF 级失败并跳过，不中断同任务其他 PDF。
      try {
        await processor.openDocument(resolved.pdfPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.taskError(task.taskId, `PDF 加载失败：${basename(displayPath)} - ${msg}`);
        pageResults.push({
          taskId: task.taskId,
          pdfPath: displayPath,
          pageNumber: 0,
          status: "failed",
          errorMessage: `PDF 加载失败：${msg}`,
        });
        runningFailed += 1;
        continue;
      }

      const pdfOutputDir = joinPath(taskOutputDir, workItem.pdfName);

      // 逐页处理。单页失败不中断同 PDF 下一页。
      for (const pageNumber of workItem.selectedPages) {
        // 页边界：检查暂停/取消信号。
        if (controller) {
          const shouldContinue = await controller.checkAndAwait();
          if (!shouldContinue) {
            logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
            return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
          }
        }
        // 更新执行进度（当前页）。用递增计数器替代每页 filter（消除 O(n²)）。
        cumulativePages += 1;
        progressThrottle.push({
          taskId: task.taskId,
          plannedStages,
          currentStage: {
            stage: "pdf_convert",
            done: cumulativePages,
            total: stagePdfPages,
            detail: `${workItem.pdfName} 第 ${pageNumber}/${workItem.selectedPages.length} 页`,
          },
          completedStages: [...completedStages],
          successPages: runningSuccess,
          failedPages: runningFailed,
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
            runningSuccess += 1;
            logger.pageInfo(
              task.taskId,
              displayPath,
              pageNumber,
              `导出成功 → ${result.outputPath ?? ""}`
            );
          } else if (result.status === "failed") {
            runningFailed += 1;
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
          runningFailed += 1;
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

  // PDF 转换阶段完成，标记为已完成。
  completedStages.push("pdf_convert");
  const pdfSuccess = pageResults.filter((r) => r.status === "success").length;
  const pdfFailed = pageResults.filter((r) => r.status === "failed").length;
  progressThrottle.flush(); // 落地逐页 pending 进度
  useTaskStore.getState().setProgress({
    taskId: task.taskId,
    plannedStages,
    currentStage: null,
    completedStages: [...completedStages],
    successPages: pdfSuccess,
    failedPages: pdfFailed,
  });

  // 资料列表展示图生成：PDF 处理完成后，若任务勾选了 generateMaterialList，
  // 对 sourcePaths 中的文件夹生成资料列表图，输出到 taskOutputDir。
  // 失败不中断任务（记 warn 日志），不影响任务最终状态。
  if (task.generateMaterialList && !hasFatalError) {
    // 阶段入口：检查暂停/取消信号，避免取消时仍进入资料列表阶段。
    if (controller) {
      const shouldContinue = await controller.checkAndAwait();
      if (!shouldContinue) {
        logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
        return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
      }
    }
    // 进入资料列表阶段。
    progressThrottle.flush();
    useTaskStore.getState().setProgress({
      taskId: task.taskId,
      plannedStages,
      currentStage: { stage: "material_list", done: 0, total: 0, detail: "扫描文件夹…" },
      completedStages: [...completedStages],
      successPages: pdfSuccess,
      failedPages: pdfFailed,
    });

    try {
      await generateMaterialListImages(
        task,
        taskOutputDir,
        (done, total) => {
          progressThrottle.push({
            taskId: task.taskId,
            plannedStages,
            currentStage: { stage: "material_list", done, total, detail: `生成中 ${done}/${total}` },
            completedStages: [...completedStages],
            successPages: pdfSuccess,
            failedPages: pdfFailed,
          });
        },
        controller,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskWarn(task.taskId, `资料列表生成异常：${msg}`);
    }
  }

  // 资料列表阶段完成。
  if (task.generateMaterialList && !hasFatalError) {
    completedStages.push("material_list");
    progressThrottle.flush();
    useTaskStore.getState().setProgress({
      taskId: task.taskId,
      plannedStages,
      currentStage: null,
      completedStages: [...completedStages],
      successPages: pdfSuccess,
      failedPages: pdfFailed,
    });
  }

  // 仿打印图片合成：PDF 处理完成后，若任务勾选了 generatePrintImages，
  // 对 taskOutputDir 中的 JPG 逐张与背景模板合成仿打印效果图。
  // 失败不中断任务（记 warn 日志），不影响任务最终状态。
  if (task.generatePrintImages && !hasFatalError) {
    // 阶段入口：检查暂停/取消信号，避免取消时仍进入仿打印合成。
    if (controller) {
      const shouldContinue = await controller.checkAndAwait();
      if (!shouldContinue) {
        logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
        return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
      }
    }
    try {
      const allTemplates = await listTemplates();
      const calibrated = allTemplates.filter((t) => t.calibrated);
      // 指定了模板则只用选中的，否则用全部已标定；选中项若已删除则回退全部。
      const selected = task.backgroundTemplateIds?.length
        ? calibrated.filter((t) => task.backgroundTemplateIds!.includes(t.id))
        : calibrated;
      const backgrounds = selected.length > 0 ? selected : calibrated;
      if (backgrounds.length === 0) {
        logger.taskWarn(task.taskId, "无已标定的背景模板，跳过仿打印");
      } else {
        logger.taskInfo(
          task.taskId,
          `开始仿打印合成（${backgrounds.length} 个背景模板）`,
        );
        progressThrottle.flush();
        useTaskStore.getState().setProgress({
          taskId: task.taskId,
          plannedStages,
          currentStage: { stage: "print_compose", done: 0, total: 0, detail: "准备合成…" },
          completedStages: [...completedStages],
          successPages: pdfSuccess,
          failedPages: pdfFailed,
        });
        const count = await generatePrintImages(
          taskOutputDir,
          backgrounds,
          (done, total) => {
            progressThrottle.push({
              taskId: task.taskId,
              plannedStages,
              currentStage: { stage: "print_compose", done, total, detail: `合成中 ${done}/${total}` },
              completedStages: [...completedStages],
              successPages: pdfSuccess,
              failedPages: pdfFailed,
            });
          },
          // 仿打印流水线逐帧写盘后检查取消，及时中断后续合成。
          () => controller?.currentState === "cancelled",
        );
        logger.taskInfo(task.taskId, `仿打印合成完成，共生成 ${count} 张`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.taskWarn(task.taskId, `仿打印生成异常：${msg}`);
    }
  }

  // 终态前最后一次取消检查：覆盖在最后阶段中途点取消的场景，
  // 避免已导出的文件被误判为 completed、状态被 runQueue 覆盖回"取消前"。
  if (controller) {
    const shouldContinue = await controller.checkAndAwait();
    if (!shouldContinue) {
      logger.taskInfo(task.taskId, `任务已取消：${task.taskName}`);
      return buildCancelledResult(task, pageResults, pdfPaths, startedAt);
    }
  }

  const finishedAt = new Date().toISOString();
  const status = resolveTaskStatus(pageResults, hasFatalError);
  const successCount = pageResults.filter((r) => r.status === "success").length;
  const failedCount = pageResults.filter((r) => r.status === "failed").length;

  // 设置终态进度：所有阶段已完成，供 UI 展示完成过渡，避免任务间留白。
  // 下一个任务的 setProgress 会自然覆盖此状态。
  progressThrottle.flush(); // 落地最后的 pending 进度并取消未触发定时器
  useTaskStore.getState().setProgress({
    taskId: task.taskId,
    plannedStages,
    currentStage: null,
    completedStages: [...plannedStages],
    successPages: successCount,
    failedPages: failedCount,
  });

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

    // 清除当前任务运行时状态。progress 保留终态供 UI 展示过渡，
    // 下一个任务的 setProgress 会自然覆盖。
    useTaskStore.getState().setCurrentTaskId(null);
    useTaskStore.getState().setController(null);

    // 自动调度下一个任务（循环继续）。
  }

  logger.appInfo("队列结束");
}
