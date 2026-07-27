import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTaskStore, createTaskId } from "../useTaskStore";
import type { TaskConfig, LogEntry } from "../../types/task";

// 模拟 persistence，避免 localStorage 副作用
vi.mock("../../lib/persistence", () => ({
  saveHistory: vi.fn(),
  clearPersistedHistory: vi.fn(),
  clearPersistedLogs: vi.fn(),
  removePersistedBreakpoint: vi.fn(),
}));

function makeTask(overrides?: Partial<TaskConfig>): TaskConfig {
  return {
    taskId: createTaskId(),
    taskName: "测试任务",
    sourceType: "files",
    sourcePaths: ["/test/a.pdf"],
    outputDir: "/out",
    pageRuleMode: "firstN",
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  // 重置 store 到初始状态
  useTaskStore.setState({
    queue: [],
    currentTaskId: null,
    progress: null,
    currentController: null,
    history: [],
    logs: [],
    logsLoaded: false,
    draft: {
      taskName: "",
      sourceType: "files",
      sourcePaths: [],
      outputDir: "",
      pageRuleMode: "firstN",
      firstN: undefined,
      customPages: "",
    },
    breakpoints: {},
  });
});

describe("draft 操作", () => {
  it("初始草稿为空", () => {
    const draft = useTaskStore.getState().draft;
    expect(draft.taskName).toBe("");
    expect(draft.sourceType).toBe("files");
    expect(draft.sourcePaths).toEqual([]);
  });

  it("setDraft 合并更新草稿", () => {
    useTaskStore.getState().setDraft({ taskName: "我的任务" });
    expect(useTaskStore.getState().draft.taskName).toBe("我的任务");

    useTaskStore.getState().setDraft({ firstN: 5 });
    expect(useTaskStore.getState().draft.firstN).toBe(5);
    expect(useTaskStore.getState().draft.taskName).toBe("我的任务");
  });

  it("resetDraft 恢复默认值", () => {
    useTaskStore.getState().setDraft({ taskName: "临时任务", firstN: 3 });
    useTaskStore.getState().resetDraft();
    const draft = useTaskStore.getState().draft;
    expect(draft.taskName).toBe("");
    expect(draft.firstN).toBeUndefined();
  });
});

describe("队列操作", () => {
  it("enqueueTask 加入任务", () => {
    const task = makeTask();
    useTaskStore.getState().enqueueTask(task);
    expect(useTaskStore.getState().queue).toHaveLength(1);
    expect(useTaskStore.getState().queue[0].taskId).toBe(task.taskId);
  });

  it("enqueueTask 追加而非覆盖", () => {
    useTaskStore.getState().enqueueTask(makeTask({ taskName: "A" }));
    useTaskStore.getState().enqueueTask(makeTask({ taskName: "B" }));
    expect(useTaskStore.getState().queue).toHaveLength(2);
  });

  it("removeTask 移除指定任务", () => {
    const a = makeTask({ taskName: "A" });
    const b = makeTask({ taskName: "B" });
    useTaskStore.getState().enqueueTask(a);
    useTaskStore.getState().enqueueTask(b);
    useTaskStore.getState().removeTask(a.taskId);
    expect(useTaskStore.getState().queue).toHaveLength(1);
    expect(useTaskStore.getState().queue[0].taskName).toBe("B");
  });

  it("clearQueue 清空所有任务", () => {
    useTaskStore.getState().enqueueTask(makeTask());
    useTaskStore.getState().enqueueTask(makeTask());
    useTaskStore.getState().clearQueue();
    expect(useTaskStore.getState().queue).toHaveLength(0);
  });

  it("updateTaskStatus 更新指定任务状态", () => {
    const task = makeTask();
    useTaskStore.getState().enqueueTask(task);
    useTaskStore.getState().updateTaskStatus(task.taskId, "running");
    expect(useTaskStore.getState().queue[0].status).toBe("running");
  });

  it("updateTaskStatus 不影响其他任务", () => {
    const a = makeTask({ taskName: "A" });
    const b = makeTask({ taskName: "B" });
    useTaskStore.getState().enqueueTask(a);
    useTaskStore.getState().enqueueTask(b);
    useTaskStore.getState().updateTaskStatus(a.taskId, "running");
    expect(useTaskStore.getState().queue[0].status).toBe("running");
    expect(useTaskStore.getState().queue[1].status).toBe("pending");
  });
});

describe("进度 & 执行状态", () => {
  it("setProgress 设置进度", () => {
    const p = {
      taskId: "t1",
      successPages: 3,
      failedPages: 1,
      currentPdfName: "test.pdf",
      currentPage: 2,
      totalPages: 5,
    };
    useTaskStore.getState().setProgress(p);
    expect(useTaskStore.getState().progress).toEqual(p);
  });

  it("setProgress null 清进度", () => {
    useTaskStore.getState().setProgress({
      taskId: "t1", successPages: 3, failedPages: 1,
    });
    useTaskStore.getState().setProgress(null);
    expect(useTaskStore.getState().progress).toBeNull();
  });

  it("setCurrentTaskId 设置当前任务 ID", () => {
    useTaskStore.getState().setCurrentTaskId("task_abc");
    expect(useTaskStore.getState().currentTaskId).toBe("task_abc");
  });

  it("setController 设置控制器", () => {
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().setController(ctrl);
    expect(useTaskStore.getState().currentController).toBe(ctrl);
  });
});

describe("日志操作", () => {
  const testEntry: LogEntry = {
    timestamp: "2026-01-01T00:00:00.000Z",
    level: "info",
    scope: "task",
    message: "测试日志",
  };

  it("appendLog 追加单条", () => {
    useTaskStore.getState().appendLog(testEntry);
    expect(useTaskStore.getState().logs).toHaveLength(1);
    expect(useTaskStore.getState().logs[0].message).toBe("测试日志");
  });

  it("appendLogs 追加多条", () => {
    const entries = [testEntry, { ...testEntry, message: "第二条" }];
    useTaskStore.getState().appendLogs(entries);
    expect(useTaskStore.getState().logs).toHaveLength(2);
  });

  it("setLogs 覆盖并标记已加载", () => {
    useTaskStore.getState().setLogs([testEntry]);
    expect(useTaskStore.getState().logs).toHaveLength(1);
    expect(useTaskStore.getState().logsLoaded).toBe(true);
  });

  it("clearLogs 清空内存日志", () => {
    useTaskStore.getState().appendLog(testEntry);
    useTaskStore.getState().clearLogs();
    expect(useTaskStore.getState().logs).toHaveLength(0);
  });
});

describe("历史记录", () => {
  it("addHistory 添加并持久化", () => {
    const task = makeTask();
    useTaskStore.getState().addHistory({
      config: task,
      summary: {
        taskId: task.taskId,
        totalPdfCount: 1,
        totalPageCount: 3,
        successPageCount: 3,
        failedPageCount: 0,
        startedAt: new Date().toISOString(),
      },
    });
    expect(useTaskStore.getState().history).toHaveLength(1);
  });

  it("addHistory 不超过 200 条上限", () => {
    for (let i = 0; i < 210; i++) {
      useTaskStore.getState().addHistory({
        config: makeTask({ taskName: `task-${i}` }),
        summary: {
          taskId: `t${i}`, totalPdfCount: 0, totalPageCount: 0,
          successPageCount: 0, failedPageCount: 0,
          startedAt: new Date().toISOString(),
        },
      });
    }
    expect(useTaskStore.getState().history).toHaveLength(200);
  });

  it("clearHistory 清空历史", () => {
    useTaskStore.getState().addHistory({
      config: makeTask(), summary: {
        taskId: "t1", totalPdfCount: 0, totalPageCount: 0,
        successPageCount: 0, failedPageCount: 0,
        startedAt: new Date().toISOString(),
      },
    });
    useTaskStore.getState().clearHistory();
    expect(useTaskStore.getState().history).toHaveLength(0);
  });

  it("setHistory 覆盖历史", () => {
    const h = [{
      config: makeTask(), summary: {
        taskId: "loaded", totalPdfCount: 0, totalPageCount: 0,
        successPageCount: 0, failedPageCount: 0,
        startedAt: new Date().toISOString(),
      },
    }];
    useTaskStore.getState().setHistory(h);
    expect(useTaskStore.getState().history).toHaveLength(1);
    expect(useTaskStore.getState().history[0].summary?.taskId).toBe("loaded");
  });
});

describe("断点操作", () => {
  it("setBreakpoints 设置断点", () => {
    useTaskStore.getState().setBreakpoints({
      task_t1: {
        taskId: "task_t1",
        taskConfig: makeTask(),
        pdfs: [],
        startedAt: new Date().toISOString(),
      },
    });
    expect(Object.keys(useTaskStore.getState().breakpoints)).toHaveLength(1);
  });

  it("removeBreakpoint 移除断点", () => {
    useTaskStore.getState().setBreakpoints({
      task_t1: {
        taskId: "task_t1",
        taskConfig: makeTask(),
        pdfs: [],
        startedAt: new Date().toISOString(),
      },
    });
    useTaskStore.getState().removeBreakpoint("task_t1");
    expect(useTaskStore.getState().breakpoints["task_t1"]).toBeUndefined();
  });

  it("resumeTaskFromBreakpoint 将任务以 pending 加回队列", () => {
    const task = makeTask();
    useTaskStore.getState().setBreakpoints({
      [task.taskId]: {
        taskId: task.taskId,
        taskConfig: task,
        pdfs: [],
        startedAt: new Date().toISOString(),
      },
    });
    useTaskStore.getState().resumeTaskFromBreakpoint(task.taskId);
    expect(useTaskStore.getState().queue).toHaveLength(1);
    expect(useTaskStore.getState().queue[0].status).toBe("pending");
  });

  it("abandonTask 将断点任务标记 cancelled 写入历史", () => {
    const task = makeTask();
    useTaskStore.getState().setBreakpoints({
      [task.taskId]: {
        taskId: task.taskId,
        taskConfig: task,
        pdfs: [
          {
            pdfPath: "/test/a.pdf",
            pdfName: "a",
            pageResults: [
              { taskId: task.taskId, pdfPath: "/test/a.pdf", pageNumber: 1, status: "success", outputPath: "/out/a_p001.jpg" },
              { taskId: task.taskId, pdfPath: "/test/a.pdf", pageNumber: 2, status: "failed", errorMessage: "err" },
            ],
          },
        ],
        startedAt: new Date().toISOString(),
      },
    });
    useTaskStore.getState().abandonTask(task.taskId);
    expect(useTaskStore.getState().history).toHaveLength(1);
    expect(useTaskStore.getState().history[0].config.status).toBe("cancelled");
    expect(useTaskStore.getState().history[0].summary?.successPageCount).toBe(1);
    expect(useTaskStore.getState().history[0].summary?.failedPageCount).toBe(1);
    // 断点已移除
    expect(useTaskStore.getState().breakpoints[task.taskId]).toBeUndefined();
  });

  it("abandonTask 无断点时无操作", () => {
    useTaskStore.getState().abandonTask("nonexistent");
    expect(useTaskStore.getState().history).toHaveLength(0);
  });
});

describe("运行时控制 (pause/resume/cancel)", () => {
  it("pauseTask 暂停运行中的任务", () => {
    const task = makeTask({ status: "running" });
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask(task);
    useTaskStore.getState().setCurrentTaskId(task.taskId);
    useTaskStore.getState().setController(ctrl);

    useTaskStore.getState().pauseTask(task.taskId);
    expect(ctrl.pause).toHaveBeenCalledOnce();
    expect(useTaskStore.getState().queue[0].status).toBe("paused");
  });

  it("pauseTask 对非运行状态无效", () => {
    const task = makeTask({ status: "completed" });
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask(task);
    useTaskStore.getState().setCurrentTaskId(task.taskId);
    useTaskStore.getState().setController(ctrl);

    useTaskStore.getState().pauseTask(task.taskId);
    expect(ctrl.pause).not.toHaveBeenCalled();
    expect(useTaskStore.getState().queue[0].status).toBe("completed");
  });

  it("resumeTask 继续暂停的任务", () => {
    const task = makeTask({ status: "paused" });
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask(task);
    useTaskStore.getState().setCurrentTaskId(task.taskId);
    useTaskStore.getState().setController(ctrl);

    useTaskStore.getState().resumeTask(task.taskId);
    expect(ctrl.resume).toHaveBeenCalledOnce();
    expect(useTaskStore.getState().queue[0].status).toBe("running");
  });

  it("cancelTask 调用 controller.cancel", () => {
    const task = makeTask({ status: "running" });
    const ctrl = { pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() } as any;
    useTaskStore.getState().enqueueTask(task);
    useTaskStore.getState().setCurrentTaskId(task.taskId);
    useTaskStore.getState().setController(ctrl);

    useTaskStore.getState().cancelTask(task.taskId);
    expect(ctrl.cancel).toHaveBeenCalledOnce();
  });

  it("无 controller 时运行时控制无操作", () => {
    const task = makeTask({ status: "running" });
    useTaskStore.getState().enqueueTask(task);
    useTaskStore.getState().setCurrentTaskId(task.taskId);
    // 未设置 controller

    useTaskStore.getState().pauseTask(task.taskId);
    expect(useTaskStore.getState().queue[0].status).toBe("running");
  });
});

describe("createTaskId", () => {
  it("生成以 task_ 为前缀的 ID", () => {
    const id = createTaskId();
    expect(id).toMatch(/^task_/);
  });

  it("每次调用生成不同 ID", () => {
    const ids = new Set(Array.from({ length: 10 }, () => createTaskId()));
    expect(ids.size).toBe(10);
  });
});
