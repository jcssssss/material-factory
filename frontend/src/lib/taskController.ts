// 任务运行时控制器：桥接 UI 的暂停/继续/取消操作与 taskRunner 的执行循环。
//
// 设计要点：
//   - UI 通过 store action 调用 controller.pause()/resume()/cancel()
//   - taskRunner 在每个 PDF/页边界调用 controller.checkAndAwait()
//   - 暂停时 checkAndAwait 阻塞，直到 resume 或 cancel 唤醒
//   - 取消时 checkAndAwait 立即返回 false，taskRunner 退出循环
//
// 与 spec.md "Requirement: 任务运行时控制" 对齐。

export type ControlState = "running" | "paused" | "cancelled";

export class TaskController {
  private state: ControlState = "running";
  // 暂停时阻塞的 waiter 队列。resume/cancel 时全部唤醒。
  private waiters: Array<(shouldContinue: boolean) => void> = [];

  get currentState(): ControlState {
    return this.state;
  }

  // 暂停：仅 running → paused。
  pause(): void {
    if (this.state === "running") {
      this.state = "paused";
    }
  }

  // 继续：仅 paused → running，唤醒所有 waiter。
  resume(): void {
    if (this.state === "paused") {
      this.state = "running";
      this.notifyWaiters(true);
    }
  }

  // 取消：running/paused → cancelled，唤醒所有 waiter（shouldContinue=false）。
  cancel(): void {
    if (this.state === "running" || this.state === "paused") {
      this.state = "cancelled";
      this.notifyWaiters(false);
    }
  }

  private notifyWaiters(shouldContinue: boolean): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((fn) => fn(shouldContinue));
  }

  // 在每个 PDF/页边界调用。
  // - running：立即返回 true
  // - cancelled：立即返回 false
  // - paused：阻塞直到 resume（返回 true）或 cancel（返回 false）
  async checkAndAwait(): Promise<boolean> {
    if (this.state === "running") return true;
    if (this.state === "cancelled") return false;
    // paused：等待 resume 或 cancel
    return new Promise<boolean>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
