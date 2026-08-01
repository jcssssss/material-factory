// taskRunner 单元测试。
//
// 覆盖 SubTask 7.2 + 7.3 验证项：
//   - 单任务单 PDF 流程
//   - 单任务多 PDF 流程
//   - 多任务串行流程
//   - 单页失败不中断下一页
//   - 单 PDF 失败不中断同任务其他 PDF
//   - 单任务失败不中断下一任务
//   - 输出目录命名规则

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runQueue, runTask } from "../taskRunner";
import { MockPageProcessor } from "../mockPageProcessor";
import { useTaskStore } from "../../store/useTaskStore";
import type { ExecutionProgress, TaskConfig } from "../../types/task";
import { convertWordFilesToPdf } from "../wordConverter";
import { TaskController } from "../taskController";
import type { TaskBreakpoint } from "../persistence";
import { saveBreakpoint } from "../persistence";

// Mock wordConverter 模块，避免测试中调用真实 Tauri invoke。
// 默认实现：批量返回与原 Word 同 stem 的 PDF 缓存路径。
vi.mock("../wordConverter", () => ({
  convertWordFilesToPdf: vi.fn(async (files: string[], _taskId: string) => {
    return files.map((wordPath: string) => {
      const stem = wordPath.replace(/\\/g, "/").split("/").pop() ?? "";
      const name = stem.replace(/\.(docx|doc)$/i, "");
      return { wordPath, pdfPath: `/cache/${name}.pdf`, error: null };
    });
  }),
}));

// Mock persistence 模块：saveBreakpoint / removePersistedBreakpoint 替换为 spy，
// 避免测试中操作真实 localStorage。其余实现保持原样。
vi.mock("../persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../persistence")>();
  return {
    ...actual,
    saveBreakpoint: vi.fn(),
    removePersistedBreakpoint: vi.fn(),
  };
});

// 构造一个任务配置。
function makeTask(overrides: Partial<TaskConfig> = {}): TaskConfig {
  return {
    taskId: `task_${Math.random().toString(36).slice(2, 8)}`,
    taskName: "test-task",
    sourceType: "files",
    sourcePaths: ["/test/normal.pdf"],
    outputDir: "/out",
    firstN: 3,
    pageRuleMode: "firstN",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// 重置 store 到初始状态。
function resetStore(): void {
  useTaskStore.setState({
    queue: [],
    currentTaskId: null,
    progress: null,
    history: [],
    logs: [],
    logsLoaded: true,
    draft: {
      taskName: "",
      sourceType: "files",
      sourcePaths: [],
      outputDir: "",
      pageRuleMode: "firstN",
      firstN: undefined,
      customPages: "",
    },
  });
}

// 运行时控制测试用的共享 processor 实例。
// 测试中临时覆盖 renderAndExportPage，afterEach 恢复原始方法。
const mockProcessor = new MockPageProcessor();

describe("单任务单 PDF 流程", () => {
  beforeEach(() => resetStore());

  it("正常执行：所有页成功，任务状态 completed", async () => {
    const task = makeTask({
      sourcePaths: ["/test/normal.pdf"],
      firstN: 3,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    expect(result.status).toBe("completed");
    expect(result.pageResults).toHaveLength(3);
    expect(result.pageResults.every((r) => r.status === "success")).toBe(true);
    expect(result.summary.successPageCount).toBe(3);
    expect(result.summary.failedPageCount).toBe(0);
    expect(result.summary.totalPdfCount).toBe(1);
  });

  it("输出路径遵循 {outputDir}/{taskName}/{pdfName}/{pdfName}_p{页码三位}.jpg", async () => {
    const task = makeTask({
      taskName: "catalog",
      sourcePaths: ["/test/product.pdf"],
      outputDir: "/output",
      firstN: 1,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    expect(result.pageResults[0].outputPath).toBe(
      "/output/catalog/product/product_p001.jpg"
    );
  });
});

describe("单任务多 PDF 流程", () => {
  beforeEach(() => resetStore());

  it("多个 PDF 全部成功", async () => {
    const task = makeTask({
      sourcePaths: ["/test/a.pdf", "/test/b.pdf", "/test/c.pdf"],
      firstN: 2,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    expect(result.status).toBe("completed");
    expect(result.summary.totalPdfCount).toBe(3);
    expect(result.summary.successPageCount).toBe(6); // 3 PDFs × 2 pages
    expect(result.pageResults).toHaveLength(6);
  });

  it("单 PDF 失败不中断同任务其他 PDF", async () => {
    // 第 2 个 PDF 模拟解析失败
    const task = makeTask({
      sourcePaths: ["/test/a.pdf", "/test/fail-pdf.pdf", "/test/c.pdf"],
      firstN: 2,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    // 任务最终状态：completed_with_errors（有 PDF 失败但有产出）
    expect(result.status).toBe("completed_with_errors");
    expect(result.summary.totalPdfCount).toBe(3);

    // a.pdf 和 c.pdf 各 2 页成功 = 4 页
    // fail-pdf.pdf 失败 = 1 个 failed PageResult（pageNumber=0）
    const success = result.pageResults.filter((r) => r.status === "success");
    const failed = result.pageResults.filter((r) => r.status === "failed");
    expect(success).toHaveLength(4);
    expect(failed).toHaveLength(1);
    expect(failed[0].pdfPath).toContain("fail-pdf");
    expect(failed[0].errorMessage).toMatch(/模拟 PDF 解析失败/);
  });

  it("单页失败不中断同 PDF 下一页和其他 PDF", async () => {
    // fail-page-2 模拟第 2 页渲染失败
    const task = makeTask({
      sourcePaths: ["/test/fail-page-2.pdf", "/test/normal.pdf"],
      firstN: 3,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    // fail-page-2.pdf：第 1, 3 页成功，第 2 页失败
    // normal.pdf：3 页成功
    const success = result.pageResults.filter((r) => r.status === "success");
    const failed = result.pageResults.filter((r) => r.status === "failed");
    expect(success).toHaveLength(5); // 2 + 3
    expect(failed).toHaveLength(1);
    expect(failed[0].pageNumber).toBe(2);
    expect(failed[0].pdfPath).toContain("fail-page-2");

    // 任务最终状态：completed_with_errors
    expect(result.status).toBe("completed_with_errors");
  });
});

describe("多任务串行流程", () => {
  beforeEach(() => resetStore());

  it("多个任务按顺序自动执行", async () => {
    const task1 = makeTask({
      taskName: "task-1",
      sourcePaths: ["/test/a.pdf"],
      firstN: 1,
    });
    const task2 = makeTask({
      taskName: "task-2",
      sourcePaths: ["/test/b.pdf"],
      firstN: 2,
    });
    const task3 = makeTask({
      taskName: "task-3",
      sourcePaths: ["/test/c.pdf"],
      firstN: 1,
    });

    useTaskStore.getState().queue = [task1, task2, task3];

    const processor = new MockPageProcessor();
    await runQueue(processor);

    // 队列中所有任务都应完成
    const queue = useTaskStore.getState().queue;
    expect(queue.every((t) => t.status === "completed")).toBe(true);

    // 历史记录应有 3 条
    const history = useTaskStore.getState().history;
    expect(history).toHaveLength(3);

    // 历史记录按完成顺序排列（最新的在前）
    expect(history[0].config.taskName).toBe("task-3");
    expect(history[1].config.taskName).toBe("task-2");
    expect(history[2].config.taskName).toBe("task-1");

    // 验证各任务的页数
    expect(history[0].summary?.successPageCount).toBe(1);
    expect(history[1].summary?.successPageCount).toBe(2);
    expect(history[2].summary?.successPageCount).toBe(1);
  });

  it("单任务失败不中断下一任务", async () => {
    // task1 的 PDF 解析失败（fail-pdf）→ 任务 completed_with_errors（PDF 级失败非致命）
    // task2 正常 → 任务 completed
    const task1 = makeTask({
      taskName: "failed-task",
      sourcePaths: ["/test/fail-pdf.pdf"],
      firstN: 1,
    });
    const task2 = makeTask({
      taskName: "normal-task",
      sourcePaths: ["/test/normal.pdf"],
      firstN: 2,
    });

    useTaskStore.getState().queue = [task1, task2];

    const processor = new MockPageProcessor();
    await runQueue(processor);

    const history = useTaskStore.getState().history;
    expect(history).toHaveLength(2);

    // task1 有 PDF 失败但非任务级致命 → completed_with_errors
    // task2 仍正常执行 → completed
    const failedTask = history.find((h) => h.config.taskName === "failed-task");
    const normalTask = history.find((h) => h.config.taskName === "normal-task");
    expect(failedTask?.config.status).toBe("completed_with_errors");
    expect(normalTask?.config.status).toBe("completed");
    expect(normalTask?.summary?.successPageCount).toBe(2);
  });

  it("任务级失败（expandPdfs 抛出）标记 failed 并继续下一任务", async () => {
    // 使用一个仅在 task1 触发任务级失败的处理器
    class FailingProcessor extends MockPageProcessor {
      async expandPdfs(task: TaskConfig) {
        if (task.taskName === "scan-fail") {
          throw new Error("无法扫描文件夹");
        }
        return super.expandPdfs(task);
      }
    }

    const task1 = makeTask({ taskName: "scan-fail" });
    const task2 = makeTask({
      taskName: "normal",
      sourcePaths: ["/test/normal.pdf"],
      firstN: 1,
    });

    useTaskStore.getState().queue = [task1, task2];

    const processor = new FailingProcessor();
    await runQueue(processor);

    const history = useTaskStore.getState().history;
    expect(history).toHaveLength(2);

    const failed = history.find((h) => h.config.taskName === "scan-fail");
    const normal = history.find((h) => h.config.taskName === "normal");
    expect(failed?.config.status).toBe("failed");
    expect(normal?.config.status).toBe("completed");
  });
});

describe("输出目录命名规则", () => {
  beforeEach(() => resetStore());

  it("多 PDF 场景：每个 PDF 独立子目录", async () => {
    const task = makeTask({
      taskName: "catalog",
      sourcePaths: ["/test/alpha.pdf", "/test/beta.pdf"],
      outputDir: "/output",
      firstN: 1,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    const paths = result.pageResults.map((r) => r.outputPath);
    expect(paths).toContain("/output/catalog/alpha/alpha_p001.jpg");
    expect(paths).toContain("/output/catalog/beta/beta_p001.jpg");
  });

  it("同任务不同 PDF 的导出结果互不混淆", async () => {
    const task = makeTask({
      taskName: "catalog",
      sourcePaths: ["/test/alpha.pdf", "/test/beta.pdf"],
      outputDir: "/output",
      firstN: 2,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    const alphaPaths = result.pageResults
      .filter((r) => r.pdfPath.includes("alpha"))
      .map((r) => r.outputPath);
    const betaPaths = result.pageResults
      .filter((r) => r.pdfPath.includes("beta"))
      .map((r) => r.outputPath);

    // alpha 的图片都在 alpha/ 子目录
    expect(alphaPaths.every((p) => p?.includes("/alpha/alpha_"))).toBe(true);
    // beta 的图片都在 beta/ 子目录
    expect(betaPaths.every((p) => p?.includes("/beta/beta_"))).toBe(true);
    // 两组路径无交集
    const alphaSet = new Set(alphaPaths);
    const betaSet = new Set(betaPaths);
    const intersection = [...alphaSet].filter((p) => betaSet.has(p));
    expect(intersection).toHaveLength(0);
  });
});

describe("任务状态机", () => {
  beforeEach(() => resetStore());

  it("所有页成功 → completed", async () => {
    const task = makeTask({ firstN: 3 });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);
    expect(result.status).toBe("completed");
  });

  it("部分页失败 → completed_with_errors", async () => {
    const task = makeTask({
      sourcePaths: ["/test/fail-page-2.pdf"],
      firstN: 3,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);
    expect(result.status).toBe("completed_with_errors");
  });

  it("全部 PDF 解析失败 → completed_with_errors（PDF 级失败非任务级致命）", async () => {
    // 单个 PDF 解析失败属于 PDF 级失败，产生 failed PageResult，
    // 但 hasFatalError=false（expandPdfs 成功返回了 PDF 路径），
    // 因此任务状态为 completed_with_errors，而非 failed。
    const task = makeTask({
      sourcePaths: ["/test/fail-pdf.pdf"],
      firstN: 3,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);
    expect(result.status).toBe("completed_with_errors");
    expect(result.summary.failedPageCount).toBe(1);
    expect(result.summary.successPageCount).toBe(0);
  });

  it("无合法 PDF（expandPdfs 返回空）→ failed（任务级致命）", async () => {
    // 非受支持文件被 expandPdfs 过滤 → pdfPaths 为空 → hasFatalError=true → failed
    const task = makeTask({
      sourcePaths: ["/test/not-a-pdf.txt"],
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);
    expect(result.status).toBe("failed");
    expect(result.summary.totalPdfCount).toBe(0);
  });
});

describe("Word 输入预处理", () => {
  beforeEach(() => {
    resetStore();
    // 清除 mock 调用记录与一次性实现（mockRejectedValueOnce 等），
    // 默认实现由 vi.mock 工厂提供，保持不变。
    vi.mocked(convertWordFilesToPdf).mockClear();
  });

  it("Word 文件转换成功后进入 PDF 处理链路", async () => {
    const task = makeTask({
      sourcePaths: ["/test/report.docx"],
      firstN: 2,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    // convertWordFilesToPdf 被调用一次，返回 /cache/report.pdf
    expect(convertWordFilesToPdf).toHaveBeenCalledTimes(1);
    expect(convertWordFilesToPdf).toHaveBeenCalledWith(
      ["/test/report.docx"],
      task.taskId
    );

    // 转换后复用 PDF 链路，2 页全部成功
    expect(result.status).toBe("completed");
    expect(result.pageResults).toHaveLength(2);
    expect(result.pageResults.every((r) => r.status === "success")).toBe(true);

    // pageResults 的 pdfPath 保留原始 Word 路径（用户选的文件）
    expect(result.pageResults.every((r) => r.pdfPath === "/test/report.docx")).toBe(true);

    // 输出目录基于 Word 文件 stem（report），与原 PDF 行为一致
    expect(result.pageResults[0].outputPath).toContain("/report/report_p001.jpg");

    // summary.totalPdfCount 计入转换后的 PDF
    expect(result.summary.totalPdfCount).toBe(1);
  });

  it("Word 转换失败记录为 failed 并继续其他 PDF", async () => {
    // 让批量转换抛错（仅影响下一次调用）
    vi.mocked(convertWordFilesToPdf).mockRejectedValueOnce(
      new Error("LibreOffice 未安装")
    );

    const task = makeTask({
      sourcePaths: ["/test/fail-word.docx", "/test/normal.pdf"],
      firstN: 1,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    // Word 转换失败 + normal.pdf 成功 → completed_with_errors
    expect(result.status).toBe("completed_with_errors");

    const failed = result.pageResults.filter((r) => r.status === "failed");
    const success = result.pageResults.filter((r) => r.status === "success");
    expect(failed).toHaveLength(1);
    expect(success).toHaveLength(1);

    // failed 记录的 pdfPath 为原始 Word 路径
    expect(failed[0].pdfPath).toContain("fail-word");
    expect(failed[0].pageNumber).toBe(0);
    expect(failed[0].errorMessage).toMatch(/Word 转换失败/);

    // success 记录的 pdfPath 为 normal.pdf 原路径
    expect(success[0].pdfPath).toContain("normal.pdf");

    // summary.totalPdfCount 仅计入成功进入 PDF 链路的文件（normal.pdf）
    expect(result.summary.totalPdfCount).toBe(1);
  });

  it("PDF + Word 混合输入全部成功", async () => {
    const task = makeTask({
      sourcePaths: ["/test/a.pdf", "/test/b.docx"],
      firstN: 1,
    });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    expect(result.status).toBe("completed");
    expect(result.summary.successPageCount).toBe(2);
    expect(result.summary.failedPageCount).toBe(0);

    // a.pdf（原始 PDF）和 b.docx（转换后的 PDF）各 1 页成功
    const aResults = result.pageResults.filter((r) => r.pdfPath === "/test/a.pdf");
    const bResults = result.pageResults.filter((r) => r.pdfPath === "/test/b.docx");
    expect(aResults).toHaveLength(1);
    expect(bResults).toHaveLength(1);
    expect(aResults[0].status).toBe("success");
    expect(bResults[0].status).toBe("success");

    // 输出目录基于各自 stem：a/ 和 b/
    expect(aResults[0].outputPath).toContain("/a/a_p001.jpg");
    expect(bResults[0].outputPath).toContain("/b/b_p001.jpg");

    // summary.totalPdfCount 计入两个文件
    expect(result.summary.totalPdfCount).toBe(2);

    // convertWordFilesToPdf 仅对 b.docx 调用一次
    expect(convertWordFilesToPdf).toHaveBeenCalledTimes(1);
    expect(convertWordFilesToPdf).toHaveBeenCalledWith(["/test/b.docx"], task.taskId);
  });

  it("Word 转换阶段纳入整体进度，位于 PDF 转换之前", async () => {
    // 在 mock 转换函数内部捕获调用时刻的进度快照，
    // 验证转换期间整体进度已切换到 word_convert 阶段。
    let snapshotDuringConvert: ExecutionProgress | null = null;
    vi.mocked(convertWordFilesToPdf).mockImplementationOnce(
      async (files: string[], _taskId: string) => {
        snapshotDuringConvert = useTaskStore.getState().progress;
        return files.map((wordPath: string) => {
          const stem = wordPath.replace(/\\/g, "/").split("/").pop() ?? "";
          const name = stem.replace(/\.(docx|doc)$/i, "");
          return { wordPath, pdfPath: `/cache/${name}.pdf`, error: null };
        });
      }
    );

    const task = makeTask({
      sourcePaths: ["/test/report.docx", "/test/normal.pdf"],
      firstN: 1,
    });
    const processor = new MockPageProcessor();
    await runTask(task, processor);

    // 转换期间：整体进度处于 word_convert 阶段，且位于 PDF 转换之前
    expect(snapshotDuringConvert?.currentStage?.stage).toBe("word_convert");
    expect(snapshotDuringConvert?.plannedStages[0]).toBe("word_convert");
    expect(snapshotDuringConvert?.plannedStages).toContain("pdf_convert");

    // 任务结束时：word_convert 已标记为完成阶段
    const finalProgress = useTaskStore.getState().progress;
    expect(finalProgress?.completedStages).toContain("word_convert");
  });

  it("多个 Word 文件分批顺序转换（BATCH=6 → 3 批串行）", async () => {
    const wordFiles = Array.from(
      { length: 14 },
      (_, i) => `/test/w${String(i + 1).padStart(2, "0")}.docx`,
    );
    // 注入 inFlight 计数：验证共享 profile 下必须串行（同一时刻最多 1 路 soffice）。
    let inFlight = 0;
    let maxInFlight = 0;
    const impl = vi.fn(async (files: string[], _taskId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return files.map((wordPath: string) => {
        const stem = wordPath.replace(/\\/g, "/").split("/").pop() ?? "";
        const name = stem.replace(/\.(docx|doc)$/i, "");
        return { wordPath, pdfPath: `/cache/${name}.pdf`, error: null };
      });
    });
    vi.mocked(convertWordFilesToPdf).mockImplementation(impl);

    const task = makeTask({ sourcePaths: wordFiles, firstN: 1 });
    const processor = new MockPageProcessor();
    const result = await runTask(task, processor);

    // 14 个文件 → 3 批（6+6+2），串行逐批转换。
    expect(convertWordFilesToPdf).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1); // 串行：同一时刻最多 1 路 soffice（共享 profile 下并发会撞锁）

    // 全部成功：每个 Word 转 1 页。
    expect(result.status).toBe("completed");
    expect(result.summary.successPageCount).toBe(14);
    expect(result.summary.failedPageCount).toBe(0);
    expect(result.summary.totalPdfCount).toBe(14);

    // 恢复默认实现，避免污染后续测试。
    vi.mocked(convertWordFilesToPdf).mockImplementation(
      async (files: string[], _taskId: string) => {
        return files.map((wordPath: string) => {
          const stem = wordPath.replace(/\\/g, "/").split("/").pop() ?? "";
          const name = stem.replace(/\.(docx|doc)$/i, "");
          return { wordPath, pdfPath: `/cache/${name}.pdf`, error: null };
        });
      }
    );
  });
});

describe("初始进度与扫描日志", () => {
  beforeEach(() => resetStore());

  it("任务开始时立即推送 0% 初始进度（含 plannedStages）", async () => {
    const task = makeTask({ sourcePaths: ["/test/a.pdf"], firstN: 1 });
    const processor = new MockPageProcessor();
    let snapshotAtScan: ExecutionProgress | null = null;
    const origExpand = processor.expandPdfs.bind(processor);
    // 在 expandPdfs 内捕获初始进度：它应在扫描前已被推送。
    processor.expandPdfs = async (t) => {
      snapshotAtScan = useTaskStore.getState().progress;
      return origExpand(t);
    };

    await runTask(task, processor);

    expect(snapshotAtScan).not.toBeNull();
    expect(snapshotAtScan?.taskId).toBe(task.taskId);
    expect(snapshotAtScan?.plannedStages).toContain("pdf_convert");
    expect(snapshotAtScan?.currentStage).toBeNull();
    expect(snapshotAtScan?.completedStages).toEqual([]);
  });

  it("扫描阶段产生前后日志", async () => {
    const task = makeTask({
      sourcePaths: ["/test/report.docx", "/test/a.pdf"],
      firstN: 1,
    });
    const processor = new MockPageProcessor();
    await runTask(task, processor);

    const messages = useTaskStore.getState().logs.map((l) => l.message);
    expect(messages.some((m) => m.includes("正在扫描输入文件"))).toBe(true);
    expect(messages.some((m) => m.includes("扫描完成：找到 2 个 PDF/Word 文件"))).toBe(true);
  });
});

describe("运行时控制（暂停/继续/取消）", () => {
  const originalRender = mockProcessor.renderAndExportPage.bind(mockProcessor);

  beforeEach(() => resetStore());

  afterEach(() => {
    mockProcessor.renderAndExportPage = originalRender;
  });

  it("暂停后继续：在页边界阻塞，resume 后继续执行", async () => {
    const controller = new TaskController();
    const task = makeTask({
      sourcePaths: ["/test/a.pdf"],
      firstN: 3,
    });

    // 在第一页完成后暂停。
    // MockPageProcessor 的 renderAndExportPage 会在第一次调用后让我们有机会暂停。
    let callCount = 0;
    mockProcessor.renderAndExportPage = async (ctx) => {
      callCount++;
      const result = await originalRender(ctx);
      // 第一页完成后暂停。
      if (callCount === 1) {
        controller.pause();
        // 异步 resume，模拟用户点击"继续"。
        setTimeout(() => controller.resume(), 10);
      }
      return result;
    };

    const result = await runTask(task, mockProcessor, controller);

    expect(result.status).toBe("completed");
    expect(result.pageResults.length).toBe(3);
    expect(result.pageResults.every((r) => r.status === "success")).toBe(true);
  });

  it("取消：立即在下一个边界退出，已完成的页保留", async () => {
    const controller = new TaskController();
    const task = makeTask({
      sourcePaths: ["/test/a.pdf"],
      firstN: 3,
    });

    // 在第一页完成后取消。
    let callCount = 0;
    mockProcessor.renderAndExportPage = async (ctx) => {
      callCount++;
      const result = await originalRender(ctx);
      if (callCount === 1) {
        controller.cancel();
      }
      return result;
    };

    const result = await runTask(task, mockProcessor, controller);

    expect(result.status).toBe("cancelled");
    // 第一页已完成并保留。
    expect(result.pageResults.length).toBe(1);
    expect(result.pageResults[0].status).toBe("success");
  });

  it("暂停时取消：从 paused 状态直接取消", async () => {
    const controller = new TaskController();
    const task = makeTask({
      sourcePaths: ["/test/a.pdf"],
      firstN: 3,
    });

    // 在页边界检查前暂停，然后取消。
    let callCount = 0;
    mockProcessor.renderAndExportPage = async (ctx) => {
      callCount++;
      const result = await originalRender(ctx);
      if (callCount === 1) {
        controller.pause();
        // 暂停后异步取消（checkAndAwait 阻塞时唤醒为 false）。
        setTimeout(() => controller.cancel(), 10);
      }
      return result;
    };

    const result = await runTask(task, mockProcessor, controller);

    expect(result.status).toBe("cancelled");
    expect(result.pageResults.length).toBe(1);
    expect(result.pageResults[0].status).toBe("success");
  });

  it("无 controller 时正常运行不受影响", async () => {
    const task = makeTask({
      sourcePaths: ["/test/a.pdf"],
      firstN: 2,
    });
    const result = await runTask(task, mockProcessor);
    expect(result.status).toBe("completed");
    expect(result.pageResults.length).toBe(2);
  });
});

describe("PDF 级断点恢复", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("首次执行：每个 PDF 完成后写入断点", async () => {
    const task = makeTask({
      sourcePaths: ["/test/a.pdf", "/test/b.pdf"],
      firstN: 2,
    });
    const result = await runTask(task, mockProcessor);

    expect(result.status).toBe("completed");
    // saveBreakpoint 至少调用 3 次：1 次初始 + 2 次（每个 PDF 完成后）
    expect(saveBreakpoint).toHaveBeenCalledTimes(3);
  });

  it("断点恢复：跳过已完成的 PDF，只处理未完成的", async () => {
    const task = makeTask({
      sourcePaths: ["/test/a.pdf", "/test/b.pdf"],
      firstN: 2,
    });

    // 构造断点：a.pdf 已完成，b.pdf 未完成
    const breakpoint: TaskBreakpoint = {
      taskId: task.taskId,
      taskConfig: task,
      startedAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:10:00.000Z",
      pdfs: [
        {
          originalPath: "/test/a.pdf",
          resolvedPdfPath: "/test/a.pdf",
          completed: true,
          pageResults: [
            {
              taskId: task.taskId,
              pdfPath: "/test/a.pdf",
              pageNumber: 1,
              status: "success",
              outputPath: "/out/a/a_p001.jpg",
            },
            {
              taskId: task.taskId,
              pdfPath: "/test/a.pdf",
              pageNumber: 2,
              status: "success",
              outputPath: "/out/a/a_p002.jpg",
            },
          ],
        },
        {
          originalPath: "/test/b.pdf",
          resolvedPdfPath: "/test/b.pdf",
          completed: false,
          pageResults: [],
        },
      ],
    };

    const result = await runTask(task, mockProcessor, undefined, breakpoint);

    expect(result.status).toBe("completed");
    // a.pdf 的 2 页结果来自断点，b.pdf 的 2 页结果来自新处理
    expect(result.pageResults.length).toBe(4);
    // a.pdf 的结果应该来自断点（outputPath 以 /out/a 开头）
    const aResults = result.pageResults.filter((r) => r.pdfPath === "/test/a.pdf");
    expect(aResults.length).toBe(2);
    expect(aResults[0].outputPath).toBe("/out/a/a_p001.jpg");
    // b.pdf 的结果应该来自新处理
    const bResults = result.pageResults.filter((r) => r.pdfPath === "/test/b.pdf");
    expect(bResults.length).toBe(2);
  });

  it("断点恢复：使用存储的 startedAt 时间", async () => {
    const task = makeTask({
      sourcePaths: ["/test/a.pdf"],
      firstN: 1,
    });
    const breakpoint: TaskBreakpoint = {
      taskId: task.taskId,
      taskConfig: task,
      startedAt: "2026-01-01T00:00:00.000Z",
      lastUpdatedAt: "2026-01-01T00:10:00.000Z",
      pdfs: [
        {
          originalPath: "/test/a.pdf",
          resolvedPdfPath: "/test/a.pdf",
          completed: false,
          pageResults: [],
        },
      ],
    };

    const result = await runTask(task, mockProcessor, undefined, breakpoint);

    // startedAt 应沿用断点中的时间
    expect(result.summary.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
