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

describe("TaskProgressPanel", () => {
  it("无执行中任务时显示空状态", () => {
    render(<TaskProgressPanel />);
    expect(screen.getByText("暂无执行中的任务")).toBeInTheDocument();
  });

  it("有进度时显示任务名和指标", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "我的任务", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({
      taskId: "task_t1", currentPdfName: "doc.pdf",
      currentPage: 3, totalPages: 10,
      successPages: 2, failedPages: 0,
    });

    render(<TaskProgressPanel />);
    expect(screen.getByText("我的任务")).toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("计算正确的百分比", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({
      taskId: "task_t1", currentPdfName: "doc.pdf",
      currentPage: 5, totalPages: 10,
      successPages: 3, failedPages: 1,
    });

    render(<TaskProgressPanel />);
    // 3+1=4 处理 / 10 总页 = 40%
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("totalPages 为 0 时百分比为 0", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({
      taskId: "task_t1", currentPdfName: "doc.pdf",
      successPages: 0, failedPages: 0,
    });

    render(<TaskProgressPanel />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("running 状态显示暂停按钮", () => {
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({ taskId: "task_t1", successPages: 0, failedPages: 0 });
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
    useTaskStore.getState().setProgress({ taskId: "task_t1", successPages: 1, failedPages: 0 });
    useTaskStore.getState().setController(ctrl);

    render(<TaskProgressPanel />);
    expect(screen.getByText("继续")).toBeInTheDocument();
  });

  it("打印进度信息展示", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({
      taskId: "task_t1", successPages: 2, failedPages: 0,
      printDone: 1, printTotal: 3,
    });

    render(<TaskProgressPanel />);
    expect(screen.getByText(/仿打印/)).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("打印完成时显示「已完成」", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({
      taskId: "task_t1", successPages: 2, failedPages: 0,
      printDone: 3, printTotal: 3,
    });

    render(<TaskProgressPanel />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("最近事件区域显示日志（最多 5 条）", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({ taskId: "task_t1", successPages: 0, failedPages: 0 });
    for (let i = 0; i < 8; i++) {
      useTaskStore.getState().appendLog({
        timestamp: "2026-01-01T00:00:00.000Z",
        level: "info", scope: "task", message: `日志 ${i + 1}`,
      });
    }

    render(<TaskProgressPanel />);
    // 应显示最后 5 条（日志 4-8） 而非全部 8 条
    expect(screen.getByText("日志 8")).toBeInTheDocument();
    expect(screen.getByText("日志 4")).toBeInTheDocument();
    expect(screen.queryByText("日志 1")).toBeNull();
    expect(screen.queryByText("日志 2")).toBeNull();
    expect(screen.queryByText("日志 3")).toBeNull();
  });

  it("无日志时显示「尚未产生日志」", () => {
    useTaskStore.getState().enqueueTask({
      taskId: "task_t1", taskName: "t", sourceType: "files",
      sourcePaths: [], outputDir: "/out", pageRuleMode: "firstN",
      status: "running", createdAt: "2026-01-01T00:00:00.000Z",
    });
    useTaskStore.getState().setCurrentTaskId("task_t1");
    useTaskStore.getState().setProgress({ taskId: "task_t1", successPages: 0, failedPages: 0 });

    render(<TaskProgressPanel />);
    expect(screen.getByText("尚未产生日志")).toBeInTheDocument();
  });
});
