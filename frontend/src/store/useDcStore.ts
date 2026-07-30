import { create } from "zustand";
import type { FileDetectionResult, CleanReport } from "../document-cleaner/types";
import type { FileItem } from "../document-cleaner/components/FileSelector";

export type DcTab = "home" | "tasks" | "report" | "settings";
export type DcView = DcTab | "create" | "scanning" | "results" | "detail" | "cleaning";

type DcState = {
  // 视图
  activeTab: DcTab;
  view: DcView;

  // 扫描
  scanningTaskId: string | null;
  scanningFiles: FileItem[];

  // 检测结果
  detectionResults: FileDetectionResult[] | null;
  // 原始文件路径（供清理命令使用）
  sourceFiles: FileItem[];

  // 详情
  detailFileName: string | null;

  // 清理
  cleaningResults: FileDetectionResult[] | null;

  // 报告
  reportData: CleanReport | null;

  // 动作
  setActiveTab: (tab: DcTab) => void;
  navigate: (view: DcView) => void;
  startScan: (taskId: string, files: FileItem[]) => void;
  finishScan: (results: FileDetectionResult[]) => void;
  cancelScan: () => void;
  viewDetail: (fileName: string) => void;
  backFromDetail: () => void;
  startClean: () => void;
  finishClean: (report: CleanReport) => void;
  cancelClean: () => void;
  backToTasks: () => void;
};

export const useDcStore = create<DcState>((set) => ({
  activeTab: "home",
  view: "home",

  scanningTaskId: null,
  scanningFiles: [],

  detectionResults: null,
  sourceFiles: [],
  detailFileName: null,
  cleaningResults: null,
  reportData: null,

  setActiveTab: (tab) =>
    set({ activeTab: tab, view: tab, detectionResults: null, cleaningResults: null, reportData: null }),

  navigate: (view) => set({ view }),

  startScan: (taskId, files) =>
    set({ view: "scanning", scanningTaskId: taskId, scanningFiles: files }),

  finishScan: (results) =>
    set((s) => ({
      view: "results",
      detectionResults: results,
      sourceFiles: s.scanningFiles,
      scanningTaskId: null,
      scanningFiles: [],
    })),

  cancelScan: () =>
    set({ view: "tasks", activeTab: "tasks", scanningTaskId: null, scanningFiles: [] }),

  viewDetail: (fileName) =>
    set({ view: "detail", detailFileName: fileName }),

  backFromDetail: () =>
    set({ view: "results", detailFileName: null }),

  startClean: () =>
    set((s) => ({
      view: "cleaning",
      cleaningResults: s.detectionResults,
      detectionResults: null,
    })),

  finishClean: (report) =>
    set({
      view: "report",
      activeTab: "report",
      reportData: report,
      cleaningResults: null,
    }),

  cancelClean: () =>
    set({ view: "tasks", activeTab: "tasks", cleaningResults: null }),

  backToTasks: () =>
    set({ view: "tasks", activeTab: "tasks", detectionResults: null }),
}));
