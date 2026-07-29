import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskProgressPanel } from "../TaskProgressPanel";
import { useTaskStore } from "../../../store/useTaskStore";

beforeEach(() => {
  useTaskStore.setState({
    queue: [],
    currentTaskId: null,
    progress: null,
    currentController: null,
    history: [],
    logs: [],
    logsLoaded: false,
    draft: {
      taskName: "", sourceType: "files", sourcePaths: [], outputDir: "",
      pageRuleMode: "firstN", firstN: undefined, customPages: "",
    },
    breakpoints: {},
  });
});

function makeProgress(overrides: Partial<ReturnType<typeof useTaskStore.getState>["progress"]> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return {
    taskId: "task_t1",
    plannedStages: ["pdf_convert"] as const,
    currentStage: { stage: "pdf_convert" as const, done: 0, total: 10 },
    completedStages: [] as string[],
    successPages: 0,
    failedPages: 0,
    ...overrides,
  };
}

describe("TaskProgressPanel", () => {
  it("无执行中任务时显示空状态", () => {
    render(<TaskProgressPanel />);
    expect(screen.getByText("暂无执行中的任务")).toBeInTheDocument();
  });

  it("有进度时显示任务名和阶段指示器", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "我的任务", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress({
      currentStage: { stage: "pdf_convert", done: 3, total: 10, detail: "doc.pdf 第 3/10 页" },
    }));

    render(<TaskProgressPanel />);
    expect(screen.getByText("我的任务")).toBeInTheDocument();
    expect(screen.getByText("PDF 转换")).toBeInTheDocument();
    expect(screen.getByText("3/10")).toBeInTheDocument();
  });

  it("计算正确的整体百分比", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    // 3 阶段：pdf_convert(已完成) + material_list(进行中 5/10) + print_compose(待执行)
    useTaskStore.getState().setProgress(makeProgress({
      plannedStages: ["pdf_convert", "material_list", "print_compose"],
      currentStage: { stage: "material_list", done: 5, total: 10 },
      completedStages: ["pdf_convert"],
      successPages: 10,
      failedPages: 0,
    }));

    render(<TaskProgressPanel />);
    // 已完成 1 阶段 + 当前阶段 5/10 = 1.5 阶段 / 3 = 50%
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("单阶段完成时显示 100%", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress({
      currentStage: null,
      completedStages: ["pdf_convert"],
      successPages: 10,
      failedPages: 0,
    }));

    render(<TaskProgressPanel />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("已完成阶段显示对勾图标", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress({
      plannedStages: ["pdf_convert", "print_compose"],
      currentStage: { stage: "print_compose", done: 5, total: 20, detail: "合成中 5/20" },
      completedStages: ["pdf_convert"],
      successPages: 10,
      failedPages: 0,
    }));

    render(<TaskProgressPanel />);
    // 两个阶段标签都应出现
    expect(screen.getByText("PDF 转换")).toBeInTheDocument();
    expect(screen.getByText("仿打印合成")).toBeInTheDocument();
    expect(screen.getByText("5/20")).toBeInTheDocument();
  });

  it("PDF 转换完成后显示成功/失败统计", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress({
      plannedStages: ["pdf_convert", "print_compose"],
      currentStage: { stage: "print_compose", done: 3, total: 10 },
      completedStages: ["pdf_convert"],
      successPages: 28,
      failedPages: 2,
    }));

    render(<TaskProgressPanel />);
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("running 状态显示暂停按钮", () => {
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress());
    useTaskStore.getState().setController(ctrl);

    render(<TaskProgressPanel />);
    expect(screen.getByText("暂停")).toBeInTheDocument();
  });

  it("paused 状态显示继续按钮", () => {
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "paused", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress({ successPages: 1, failedPages: 0 }));
    useTaskStore.getState().setController(ctrl);

    render(<TaskProgressPanel />);
    expect(screen.getByText("继续")).toBeInTheDocument();
  });

  it("显示当前阶段详情文本", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress({
      currentStage: { stage: "pdf_convert", done: 3, total: 10, detail: "report.pdf 第 3/10 页" },
    }));

    render(<TaskProgressPanel />);
    expect(screen.getByText("report.pdf 第 3/10 页")).toBeInTheDocument();
  });

  it("最近事件区域显示日志（最多 5 条）", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress());
    for (let i = 0; i < 8; i++) {
      useTaskStore.getState().appendLog({
        timestamp: "2026-01-01T00:00:00.000Z",
        level: "info", scope: "task", message: `日志 ${i + 1}`,
      });
    }

    render(<TaskProgressPanel />);
    expect(screen.getByText("日志 8")).toBeInTheDocument();
    expect(screen.getByText("日志 4")).toBeInTheDocument();
    expect(screen.queryByText("日志 1")).toBeNull();
  });

  it("无日志时显示「尚未产生日志」", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress(makeProgress());

    render(<TaskProgressPanel />);
    expect(screen.getByText("尚未产生日志")).toBeInTheDocument();
  });
});
