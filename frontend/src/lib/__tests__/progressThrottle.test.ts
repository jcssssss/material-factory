// progressThrottle 单元测试。
//
// 覆盖：
//   - 首次 push 立即触发（任务开始立即显示进度）
//   - 后续高频 push 在节流窗口内合并为一次 setProgress（取最新值）
//   - flush 立即落地 pending 进度并取消定时器
//   - 距上次触发超过窗口时 push 立即触发
//   - 无 pending 时 flush 是 no-op

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createProgressThrottle } from "../progressThrottle";
import { useTaskStore } from "../../store/useTaskStore";
import type { ExecutionProgress } from "../../types/task";

function makeProgress(done: number, patch: Partial<ExecutionProgress> = {}): ExecutionProgress {
  return {
    taskId: "task_t",
    plannedStages: ["pdf_convert"],
    currentStage: { stage: "pdf_convert", done, total: 10 },
    completedStages: [],
    successPages: 0,
    failedPages: 0,
    ...patch,
  };
}

// 提取每次 setProgress 收到的 currentStage.done 序列，便于断言合并语义。
function doneSequence(spy: ReturnType<typeof vi.spyOn>): number[] {
  return spy.mock.calls.map((c) => (c[0] as ExecutionProgress).currentStage?.done ?? -1);
}

describe("createProgressThrottle", () => {
  let setProgressSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // spy 使 setProgress 不真正改 store，仅记录调用。
    setProgressSpy = vi.spyOn(useTaskStore.getState(), "setProgress").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("首次 push 立即触发，窗口内后续 push 合并为一次（取最新值）", () => {
    const throttle = createProgressThrottle(100);
    throttle.push(makeProgress(1)); // 立即触发（last 初始为 0）
    throttle.push(makeProgress(2)); // 距上次 < 100ms → 合并 pending
    throttle.push(makeProgress(3)); // 更新 pending

    expect(doneSequence(setProgressSpy)).toEqual([1]);

    vi.advanceTimersByTime(100); // 定时器到期，flush 合并后的最新值
    expect(doneSequence(setProgressSpy)).toEqual([1, 3]);
  });

  it("flush 立即落地 pending 进度并取消定时器", () => {
    const throttle = createProgressThrottle(100);
    throttle.push(makeProgress(5)); // 立即触发
    throttle.push(makeProgress(6)); // 合并 pending，等待定时器

    throttle.flush(); // 立即落地 pending（done=6）
    expect(doneSequence(setProgressSpy)).toEqual([5, 6]);

    // 定时器被取消：再推时间不产生重复触发
    vi.advanceTimersByTime(200);
    expect(setProgressSpy).toHaveBeenCalledTimes(2);
  });

  it("距上次触发超过窗口时，push 立即触发（不节流）", () => {
    const throttle = createProgressThrottle(100);
    throttle.push(makeProgress(1)); // 立即
    expect(setProgressSpy).toHaveBeenCalledTimes(1);

    // 等待超过窗口
    vi.advanceTimersByTime(200);
    throttle.push(makeProgress(2));
    expect(setProgressSpy).toHaveBeenCalledTimes(2); // 间隔足够，立即触发
  });

  it("flush 无 pending 时是 no-op", () => {
    const throttle = createProgressThrottle(100);
    throttle.flush();
    expect(setProgressSpy).not.toHaveBeenCalled();
  });
});
