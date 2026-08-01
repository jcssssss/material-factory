// setProgress 节流器。
//
// 背景：taskRunner 逐页处理时会频繁调用 useTaskStore.setProgress（2000 页 = 2000 次），
// 每次 set 都会触发 Zustand 订阅组件（TaskProgressPanel 等）重新渲染，造成不必要的
// React 渲染开销。通过节流把高频进度上报合并到 ~10Hz，UI 进度条依然顺滑。
//
// 用法：
//   const throttle = createProgressThrottle(100);
//   throttle.push(progress);          // 高频循环内调用（节流合并）
//   throttle.flush(); setProgress(p); // 阶段切换/终态：先 flush 落地 pending，再设新值
import { useTaskStore } from "../store/useTaskStore";
import type { ExecutionProgress } from "../types/task";

export interface ProgressThrottle {
  push: (progress: ExecutionProgress) => void;
  flush: () => void;
}

export function createProgressThrottle(minIntervalMs = 100): ProgressThrottle {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: ExecutionProgress | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (latest) {
      useTaskStore.getState().setProgress(latest);
      latest = null;
      last = Date.now();
    }
  };

  const push = (progress: ExecutionProgress): void => {
    latest = progress;
    // 已有定时器在途：仅更新最新值，等待其 flush（节流合并）。
    if (timer) return;
    const wait = Math.max(0, minIntervalMs - (Date.now() - last));
    if (wait === 0) {
      flush();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, wait);
  };

  return { push, flush };
}
