import type { CleanerTask, CleanerTaskStatus } from "../types";

/** 生成唯一 id */
function uid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function makeTask(partial?: Partial<CleanerTask>): CleanerTask {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: partial?.name ?? `清理任务`,
    status: (partial?.status ?? "created") as CleanerTaskStatus,
    filesCount: partial?.filesCount ?? 0,
    completedCount: partial?.completedCount ?? 0,
    failedCount: partial?.failedCount ?? 0,
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
  };
}

// 内存 mock 数据
let mockTasks: CleanerTask[] = [
  makeTask({ name: "测试文档_2024", status: "completed", filesCount: 3, completedCount: 3 }),
  makeTask({ name: "合同扫描件", status: "completed_with_error", filesCount: 5, completedCount: 4, failedCount: 1 }),
  makeTask({ name: "报告附件", status: "cancelled", filesCount: 2 }),
];

/** 获取所有任务 */
export function getTasks(): CleanerTask[] {
  return [...mockTasks];
}

/** 按 id 获取任务 */
export function getTask(id: string): CleanerTask | undefined {
  return mockTasks.find((t) => t.id === id);
}

/** 创建任务 */
export function createTask(name: string, filesCount = 0): CleanerTask {
  const task = makeTask({ name, filesCount });
  mockTasks = [task, ...mockTasks];
  return task;
}

/** 更新任务状态 */
export function updateTaskStatus(id: string, status: CleanerTaskStatus): CleanerTask | undefined {
  const task = mockTasks.find((t) => t.id === id);
  if (!task) return undefined;
  task.status = status;
  task.updatedAt = new Date().toISOString();
  return task;
}

/** 删除任务 */
export function deleteTask(id: string): boolean {
  const idx = mockTasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  mockTasks.splice(idx, 1);
  return true;
}
