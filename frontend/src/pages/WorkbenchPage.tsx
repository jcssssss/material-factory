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
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const processor = new PdfPageProcessor();

export default function WorkbenchPage() {
  const queue = useTaskStore((s) => s.queue);
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
    <div className="flex h-full flex-col gap-3 p-4">
      {/* LibreOffice 警告 */}
      {libreOfficeMissing && mayHaveWord ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            {hasWordInQueue
              ? "未检测到 LibreOffice。含 Word 文件的任务无法启动，请先安装 LibreOffice 后重启应用。纯 PDF 任务不受影响。"
              : "未检测到 LibreOffice。文件夹任务可能包含 Word 文件，将无法启动。请先安装 LibreOffice 后重启应用。纯 PDF 任务不受影响。"}
          </span>
        </div>
      ) : null}

      {/* 断点恢复 */}
      {resumableBreakpoints.length > 0 ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
            <Plus className="h-4 w-4" />
            检测到 {resumableBreakpoints.length} 个未完成任务
          </div>
          <div className="space-y-2">
            {resumableBreakpoints.map((bp) => {
              const completedCount = bp.pdfs.filter((p) => p.completed).length;
              return (
                <div
                  key={bp.taskId}
                  className="flex items-center justify-between rounded-lg bg-card px-4 py-2.5 shadow-sm border"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {bp.taskConfig.taskName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      已完成 {completedCount}/{bp.pdfs.length} 个 PDF · 中断于{" "}
                      {new Date(bp.lastUpdatedAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleResume(bp.taskId)}
                      disabled={isRunning}
                    >
                      继续
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAbandon(bp.taskId)}
                      disabled={isRunning}
                    >
                      放弃
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 主内容区 */}
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-auto lg:grid-cols-12">
        <div className="lg:col-span-5 xl:col-span-4">
          <TaskForm />
        </div>
        <div className="flex flex-col gap-3 lg:col-span-7 xl:col-span-8">
          <TaskQueueTable
            onStart={handleStart}
            blockStart={blockStart}
            isRunning={isRunning}
            hasPending={hasPending}
          />
          <TaskProgressPanel />
        </div>
      </div>
    </div>
  );
}
