import type { ReactNode } from "react";
import WorkbenchPage from "../pages/WorkbenchPage";
import HistoryPage from "../pages/HistoryPage";
import LogViewerPage from "../pages/LogViewerPage";
import BackgroundTemplatePage from "../pages/BackgroundTemplatePage";
import CalibratePage from "../pages/CalibratePage";
import DocumentCleanerPage from "../document-cleaner/pages/DocumentCleanerPage";

export type RouteDef = {
  path: string;
  label: string;
  element: ReactNode;
  disabled?: boolean;
};

export const routes: RouteDef[] = [
  { path: "/", label: "工作台", element: <WorkbenchPage /> },
  { path: "/history", label: "历史任务", element: <HistoryPage /> },
  { path: "/logs", label: "日志", element: <LogViewerPage /> },
  { path: "/backgrounds", label: "背景模板", element: <BackgroundTemplatePage /> },
  { path: "/calibrate/:id", label: "透视标定", element: <CalibratePage /> },
  { path: "/watermark-removal", label: "去水印", element: <DocumentCleanerPage />, disabled: true },
];
