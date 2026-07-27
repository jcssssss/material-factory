// Mock 页处理器：用于 Task 3 验证串行队列与失败隔离。
//
// 不依赖真实 PDF 文件，通过路径中的标记模拟不同场景：
//   - 路径包含 "fail-pdf"：模拟整个 PDF 准备失败
//   - 路径包含 "fail-page-N"：模拟第 N 页渲染失败
//   - 路径包含 "empty"：模拟无合法页码
//   - 其他：模拟正常处理
//
// 页码规则解析使用 pageRule.ts（Task 4 实现）。
// Task 5 完成后替换为真实处理器。

import type { PageResult, PdfWorkItem, TaskConfig } from "../types/task";
import type { PageProcessor, PageProcessContext } from "./pageProcessor";
import { resolvePageRule } from "./pageRule";
import { logger } from "./logger";
import { isSupportedInputPath } from "./inputValidation";

const SIMULATED_TOTAL_PAGES = 10;

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function pdfBaseName(p: string): string {
  return basename(p).replace(/\.pdf$/i, "");
}

export class MockPageProcessor implements PageProcessor {
  async expandPdfs(task: TaskConfig): Promise<string[]> {
    if (task.sourceType === "files") {
      // files 模式：过滤出受支持的输入（PDF 或 Word）。
      return task.sourcePaths.filter((p) => isSupportedInputPath(p));
    }
    // folder 模式：mock 返回空（spec 要求无 PDF/Word 时阻止执行）。
    // 真实实现在 pdfPageProcessor 中通过 scan_input_files 扫描文件夹。
    return [];
  }

  async prepareWorkItem(
    task: TaskConfig,
    pdfPath: string
  ): Promise<PdfWorkItem> {
    // 模拟 PDF 准备失败
    if (pdfPath.includes("fail-pdf")) {
      throw new Error(`模拟 PDF 解析失败：${basename(pdfPath)}`);
    }

    // 模拟无合法页码
    if (pdfPath.includes("empty")) {
      return {
        taskId: task.taskId,
        pdfPath,
        pdfName: pdfBaseName(pdfPath),
        totalPages: SIMULATED_TOTAL_PAGES,
        selectedPages: [],
        status: "skipped",
        errorMessage: "无合法页码（模拟）",
      };
    }

    // 使用 pageRule.ts 解析页码规则。
    const result = resolvePageRule(
      {
        firstN:
          task.pageRuleMode === "custom" ? undefined : task.firstN,
        customPages:
          task.pageRuleMode === "firstN" ? undefined : task.customPages,
      },
      SIMULATED_TOTAL_PAGES
    );

    // 记录超范围页码警告。
    for (const w of result.warnings) {
      logger.taskWarn(task.taskId, w);
    }

    // 若解析失败（非法表达式或空页集），抛出异常让 taskRunner 捕获。
    if (result.error) {
      throw new Error(result.error);
    }

    return {
      taskId: task.taskId,
      pdfPath,
      pdfName: pdfBaseName(pdfPath),
      totalPages: SIMULATED_TOTAL_PAGES,
      selectedPages: result.pages,
      status: "pending",
    };
  }

  async renderAndExportPage(ctx: PageProcessContext): Promise<PageResult> {
    // 模拟单页渲染失败
    const failMarker = `fail-page-${ctx.pageNumber}`;
    if (ctx.workItem.pdfPath.includes(failMarker)) {
      throw new Error(`模拟第 ${ctx.pageNumber} 页渲染失败`);
    }

    // 模拟异步渲染耗时
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      taskId: ctx.task.taskId,
      pdfPath: ctx.workItem.pdfPath,
      pageNumber: ctx.pageNumber,
      status: "success",
      outputPath: `${ctx.pdfOutputDir}/${ctx.workItem.pdfName}_p${String(
        ctx.pageNumber
      ).padStart(3, "0")}.jpg`,
    };
  }
}
