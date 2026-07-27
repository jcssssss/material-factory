import { useEffect, useState } from "react";
import { useTaskStore } from "../store/useTaskStore";
import { TaskForm } from "../components/task/TaskForm";
import { TaskQueueTable } from "../components/task/TaskQueueTable";
import { TaskProgressPanel } from "../components/task/TaskProgressPanel";
import { runQueue } from "../lib/taskRunner";
import { PdfPageProcessor } from "../lib/pdfPageProcessor";
import { logger } from "../lib/logger";
import { checkLibreOffice, type LibreOfficeStatus } from "../lib/wordConverter";
import { isWordPath } from "../lib/inputValidation";

const processor = new PdfPageProcessor();

export default function WorkbenchPage() {
  const queue = useTaskStore((s) => s.queue);
  const currentTaskId = useTaskStore((s) => s.currentTaskId);
  const breakpoints = useTaskStore((s) => s.breakpoints);
  const resumeTaskFromBreakpoint = useTaskStore((s) => s.resumeTaskFromBreakpoint);
  const abandonTask = useTaskStore((s) => s.abandonTask);
  const [isRunning, setIsRunning] = useState(false);
  const [libreOffice, setLibreOffice] = useState<LibreOfficeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkLibreOffice().then((status) => {
      if (!cancelled) setLibreOffice(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasPending = queue.some((t) => t.status === "pending");

  const resumableBreakpoints = Object.values(breakpoints).filter(
    (bp) =>
      bp.taskConfig.status === "paused" || bp.taskConfig.status === "running"
  );

  const hasWordInQueue = queue.some(
    (t) => t.sourceType === "files" && t.sourcePaths.some((p) => isWordPath(p))
  );
  const mayHaveWord = queue.some(
    (t) => t.sourceType === "folder" || t.sourcePaths.some((p) => isWordPath(p))
  );
  const libreOfficeMissing = libreOffice !== null && !libreOffice.available;
  const blockStart = libreOfficeMissing && mayHaveWord;

  async function handleStart() {
    if (isRunning) return;
    setIsRunning(true);
    try {
      await runQueue(processor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.appError(`队列执行异常：${msg}`);
    } finally {
      await processor.cleanup().catch(() => {});
      setIsRunning(false);
    }
  }

  async function handleResume(taskId: string) {
    resumeTaskFromBreakpoint(taskId);
    if (!isRunning) {
      setIsRunning(true);
      try {
        await runQueue(processor);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.appError(`队列恢复执行异常：${msg}`);
      } finally {
        await processor.cleanup().catch(() => {});
        setIsRunning(false);
      }
    }
  }

  function handleAbandon(taskId: string) {
    abandonTask(taskId);
  }

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-workspace-muted">
            {isRunning || currentTaskId ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-workspace-success animate-pulse" />
                队列执行中
              </span>
            ) : (
              "队列空闲"
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={!hasPending || isRunning || blockStart}
          title={
            blockStart ? "未检测到 LibreOffice，含 Word 任务无法启动" : undefined
          }
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {isRunning ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              执行中…
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 5.25a.75.75 0 00-.75.75v8a.75.75 0 001.28.53l6.25-6.25a.75.75 0 000-1.06L7.28 5.22a.75.75 0 00-.53-.22z" clipRule="evenodd" />
              </svg>
              启动队列
            </>
          )}
        </button>
      </div>

      {libreOfficeMissing && mayHaveWord ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span>
            {hasWordInQueue
              ? "未检测到 LibreOffice。含 Word 文件的任务无法启动，请先安装 LibreOffice 后重启应用。纯 PDF 任务不受影响。"
              : "未检测到 LibreOffice。文件夹任务可能包含 Word 文件，将无法启动。请先安装 LibreOffice 后重启应用。纯 PDF 任务不受影响。"}
          </span>
        </div>
      ) : null}

      {resumableBreakpoints.length > 0 ? (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 px-4 py-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-indigo-800">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-indigo-500">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
            </svg>
            检测到 {resumableBreakpoints.length} 个未完成任务
          </div>
          <div className="space-y-2">
            {resumableBreakpoints.map((bp) => {
              const completedCount = bp.pdfs.filter((p) => p.completed).length;
              return (
                <div
                  key={bp.taskId}
                  className="flex items-center justify-between rounded-lg bg-white px-4 py-2.5 shadow-sm"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-workspace-fg">
                      {bp.taskConfig.taskName}
                    </span>
                    <span className="text-xs text-workspace-muted">
                      已完成 {completedCount}/{bp.pdfs.length} 个 PDF · 中断于{" "}
                      {new Date(bp.lastUpdatedAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleResume(bp.taskId)}
                      disabled={isRunning}
                      className="rounded-md bg-workspace-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      继续
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAbandon(bp.taskId)}
                      disabled={isRunning}
                      className="rounded-md border border-workspace-border bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      放弃
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid flex-1 grid-cols-1 gap-5 overflow-auto lg:grid-cols-12">
        <div className="lg:col-span-5 xl:col-span-4">
          <TaskForm />
        </div>
        <div className="flex flex-col gap-5 lg:col-span-7 xl:col-span-8">
          <TaskQueueTable />
          <TaskProgressPanel />
        </div>
      </div>
    </div>
  );
}
