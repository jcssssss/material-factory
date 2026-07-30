import HomePage from "./HomePage";
import TaskCenterPage from "./TaskCenterPage";
import SettingsPage from "./SettingsPage";
import CreateTaskPage from "./CreateTaskPage";
import ScannerPage from "./ScannerPage";
import ResultPage from "./ResultPage";
import DetailPage from "./DetailPage";
import CleaningProgressPage from "./CleaningProgressPage";
import ReportPage from "./ReportPage";
import { useDcStore, type DcTab } from "../../store/useDcStore";
import type { FileItem } from "../components/FileSelector";
import type { FileDetectionResult, CleanReport } from "../types";

const SUB_ICONS: Record<DcTab, string> = {
  home: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path d="M10 2a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5v-5.5A.75.75 0 0110 2z"/></svg>`,
  tasks: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zM10 6.75a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0v-2.5h-2.5a.75.75 0 010-1.5h2.5v-2.5A.75.75 0 0110 6.75z" clip-rule="evenodd"/></svg>`,
  report: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M2.5 3.5A1.5 1.5 0 014 2h7.879a1.5 1.5 0 011.06.44l3.622 3.62a1.5 1.5 0 01.44 1.06V16.5a1.5 1.5 0 01-1.5 1.5H4a1.5 1.5 0 01-1.5-1.5v-13zM5 5.5a1 1 0 011-1h2a1 1 0 010 2H6a1 1 0 01-1-1zm0 4.5a1 1 0 011-1h6a1 1 0 010 2H6a1 1 0 01-1-1zm0 4.5a1 1 0 011-1h4a1 1 0 010 2H6a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652A1 1 0 0111.18 19H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.82 7.593a1 1 0 01-.205-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.992 6.992 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>`,
};

const TABS: { key: DcTab; label: string }[] = [
  { key: "home", label: "首页" },
  { key: "tasks", label: "任务中心" },
  { key: "report", label: "清理报告" },
  { key: "settings", label: "设置" },
];

export default function DocumentCleanerPage() {
  const {
    activeTab, view, detectionResults, detailFileName,
    scanningTaskId, scanningFiles, cleaningResults, reportData,
    sourceFiles,
    setActiveTab, navigate,
    startScan, finishScan, cancelScan,
    viewDetail, backFromDetail,
    startClean, finishClean, cancelClean, backToTasks,
  } = useDcStore();

  // 子组件回调 → store actions
  const callbacks = {
    onCreateTask: () => navigate("create"),
    onStartScan: (taskId: string, files: FileItem[]) => startScan(taskId, files),
    onScanComplete: (results: FileDetectionResult[]) => finishScan(results),
    onScanCancel: () => cancelScan(),
    onViewDetail: (fileName: string) => viewDetail(fileName),
    onBackFromDetail: () => backFromDetail(),
    onStartClean: () => startClean(),
    onCleanComplete: (report: CleanReport) => finishClean(report),
    onCleanCancel: () => cancelClean(),
    onBackToTasks: () => backToTasks(),
    onBackFromCreate: () => navigate("home"),
  };

  // 当前详情页的数据
  const detailResult = detailFileName && detectionResults
    ? detectionResults.find((r) => r.fileName === detailFileName) ?? detectionResults[0]
    : null;

  return (
    <div className="flex h-full">
      {/* 子导航 */}
      <nav className="flex w-40 shrink-0 flex-col gap-1 border-r border-workspace-border/60 bg-workspace-sidebar/20 px-3 pt-5">
        <div className="mb-2 px-2 pb-2 text-[11px] font-medium tracking-wider text-workspace-muted/40 uppercase">
          文档清理
        </div>
        {TABS.map((t) => {
          const active = activeTab === t.key && view === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 " +
                (active
                  ? "bg-workspace-accent/10 font-medium text-workspace-accent shadow-sm"
                  : "text-workspace-muted/70 hover:bg-workspace-sidebar-hover hover:text-workspace-fg")
              }
            >
              <span
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs transition-all " +
                  (active
                    ? "bg-workspace-accent text-white shadow-sm"
                    : "bg-workspace-sidebar/60 text-workspace-muted/50")
                }
                dangerouslySetInnerHTML={{ __html: SUB_ICONS[t.key] }}
              />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col overflow-auto p-6">
        {view === "cleaning" && cleaningResults ? (
          <CleaningProgressPage
            results={cleaningResults}
            filePaths={sourceFiles.map((f) => f.path)}
            onComplete={callbacks.onCleanComplete}
            onCancel={callbacks.onCleanCancel}
          />
        ) : view === "detail" && detailResult ? (
          <DetailPage
            result={detailResult}
            onBack={callbacks.onBackFromDetail}
          />
        ) : view === "results" && detectionResults ? (
          <ResultPage
            results={detectionResults}
            onStartClean={callbacks.onStartClean}
            onBackToTasks={callbacks.onBackToTasks}
            onViewDetail={callbacks.onViewDetail}
          />
        ) : view === "scanning" && scanningTaskId ? (
          <ScannerPage
            taskId={scanningTaskId}
            files={scanningFiles}
            onComplete={callbacks.onScanComplete}
            onCancel={callbacks.onScanCancel}
          />
        ) : view === "create" ? (
          <CreateTaskPage
            onBack={callbacks.onBackFromCreate}
            onStartScan={callbacks.onStartScan}
          />
        ) : view === "tasks" ? (
          <>
            <div className="mb-5 flex items-center justify-between shrink-0">
              <h1 className="text-base font-semibold text-workspace-fg">任务中心</h1>
              <button
                type="button"
                onClick={callbacks.onCreateTask}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5v-5.5A.75.75 0 0110 3z" clipRule="evenodd" />
                </svg>
                新建清理任务
              </button>
            </div>
            <TaskCenterPage />
          </>
        ) : view === "report" ? (
          <>
            <div className="mb-5 shrink-0">
              <h1 className="text-base font-semibold text-workspace-fg">清理报告</h1>
            </div>
            <ReportPage report={reportData} />
          </>
        ) : view === "settings" ? (
          <>
            <div className="mb-5 shrink-0">
              <h1 className="text-base font-semibold text-workspace-fg">设置</h1>
            </div>
            <SettingsPage />
          </>
        ) : (
          /* home */
          <>
            <div className="mb-5 flex items-center justify-between shrink-0">
              <div>
                <h1 className="text-base font-semibold text-workspace-fg">文档清理</h1>
                <p className="mt-0.5 text-xs text-workspace-muted">
                  自动检测并清理文档中的水印、页眉与页脚
                </p>
              </div>
              <button
                type="button"
                onClick={callbacks.onCreateTask}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:from-indigo-700 hover:to-indigo-600 hover:shadow-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10.362 1.093a.75.75 0 00-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925zM18 6.443l-7.25 4v8.25l6.862-3.786A.75.75 0 0018 14.25V6.443zm-8.75 12.25v-8.25l-7.25-4v7.807a.75.75 0 00.388.657l6.862 3.786z" />
                </svg>
                新建清理任务
              </button>
            </div>
            <HomePage />
          </>
        )}
      </div>
    </div>
  );
}
