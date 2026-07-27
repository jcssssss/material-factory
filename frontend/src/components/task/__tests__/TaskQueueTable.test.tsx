import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskQueueTable } from "../TaskQueueTable";
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

const mockTask = (overrides: Record<string, any> = {}) => ({
  taskId: "task_test",
  taskName: "测试任务",
  sourceType: "files" as const,
  sourcePaths: ["/test/a.pdf"],
  outputDir: "/out",
  pageRuleMode: "firstN" as const,
  firstN: 3,
  status: "pending" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("TaskQueueTable", () => {
  it("队列为空时显示空状态", () => {
    render(<TaskQueueTable />);
    expect(screen.getByText("队列暂无任务")).toBeInTheDocument();
    expect(screen.getByText(/在左侧表单中创建任务/)).toBeInTheDocument();
  });

  it("有任务时渲染表格行", () => {
    useTaskStore.getState().enqueueTask(mockTask());
    render(<TaskQueueTable />);
    expect(screen.getByText("测试任务")).toBeInTheDocument();
    expect(screen.getByText("待执行")).toBeInTheDocument();
  });

  it("表格显示任务数量", () => {
    useTaskStore.getState().enqueueTask(mockTask());
    useTaskStore.getState().enqueueTask(mockTask({ taskId: "task_2", taskName: "任务2" }));
    render(<TaskQueueTable />);
    expect(screen.getByText("共 2 个")).toBeInTheDocument();
  });

  it("展示页码规则列", () => {
    useTaskStore.getState().enqueueTask(mockTask());
    render(<TaskQueueTable />);
    expect(screen.getByText("前 3 页")).toBeInTheDocument();
  });

  it("清空按钮清空队列", async () => {
    const user = userEvent.setup();
    useTaskStore.getState().enqueueTask(mockTask());
    render(<TaskQueueTable />);
    await user.click(screen.getByText("清空"));
    expect(useTaskStore.getState().queue).toHaveLength(0);
  });

  it("pending 状态显示「移除」按钮", () => {
    useTaskStore.getState().enqueueTask(mockTask());
    render(<TaskQueueTable />);
    expect(screen.getByText("移除")).toBeInTheDocument();
  });

  it("running 状态显示「暂停」按钮", () => {
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask(mockTask({ status: "running" }));
    useTaskStore.getState().setCurrentTaskId("task_test");
    useTaskStore.getState().setController(ctrl);
    render(<TaskQueueTable />);
    expect(screen.getByText("暂停")).toBeInTheDocument();
  });

  it("paused 状态显示「继续」和「取消」按钮", () => {
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask(mockTask({ status: "paused" }));
    useTaskStore.getState().setCurrentTaskId("task_test");
    useTaskStore.getState().setController(ctrl);
    render(<TaskQueueTable />);
    expect(screen.getByText("继续")).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
  });

  it("completed 状态显示「移除」而非控制按钮", () => {
    useTaskStore.getState().enqueueTask(mockTask({ status: "completed" }));
    useTaskStore.getState().setCurrentTaskId("task_test");
    render(<TaskQueueTable />);
    expect(screen.getByText("移除")).toBeInTheDocument();
    expect(screen.queryByText("暂停")).toBeNull();
    expect(screen.queryByText("取消")).toBeNull();
  });

  it("点击移除从队列删除", async () => {
    const user = userEvent.setup();
    useTaskStore.getState().enqueueTask(mockTask());
    render(<TaskQueueTable />);
    await user.click(screen.getByText("移除"));
    expect(useTaskStore.getState().queue).toHaveLength(0);
  });
});
