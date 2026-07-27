import { useEffect, useState } from "react";
import { HashRouter, matchPath, useLocation } from "react-router-dom";
import { routes } from "./routes";
import { useTaskStore } from "./store/useTaskStore";
import {
  loadPersistedHistory,
  loadPersistedLogs,
  loadBreakpoints,
} from "./lib/persistence";
import type { TaskBreakpoint } from "./lib/persistence";
import { logger } from "./lib/logger";

const NAV_ICONS: Record<string, string> = {
  "/": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z" clip-rule="evenodd"/></svg>`,
  "/history": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clip-rule="evenodd"/></svg>`,
  "/logs": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clip-rule="evenodd"/></svg>`,
  "/backgrounds": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path d="M13.75 7.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z"/><path fill-rule="evenodd" d="M1.5 4.5A2.5 2.5 0 014 2h12a2.5 2.5 0 012.5 2.5v8a2.5 2.5 0 01-2.5 2.5H4a2.5 2.5 0 01-2.5-2.5v-8zM4 3.5a1 1 0 00-1 1v5.19l2.76-2.2a1.25 1.25 0 011.58 0l3.11 2.49 1.1-1.1a1.25 1.25 0 011.77 0l2.68 2.68V4.5a1 1 0 00-1-1H4z" clip-rule="evenodd"/></svg>`,
};

function AppShell() {
  const location = useLocation();
  const activeRoute = routes.find((r) => matchPath(r.path, location.pathname));
  const Route = activeRoute?.element;
  return (
    <div className="flex h-screen bg-workspace-bg text-workspace-fg">
      <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-workspace-border/60 bg-workspace-sidebar pt-5 shadow-sidebar">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[10px] font-bold leading-none text-white">
          M
        </div>
        <div className="flex flex-col items-center gap-1">
          {routes.filter((r) => !r.path.startsWith("/calibrate")).map((r) => {
            const active = !!matchPath(r.path, location.pathname);
            return (
              <a
                key={r.path}
                href={`#${r.path}`}
                className={
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 " +
                  (active
                    ? "bg-workspace-accent text-white shadow-lg shadow-indigo-500/20"
                    : "text-workspace-muted/60 hover:bg-workspace-sidebar-hover hover:text-white")
                }
                dangerouslySetInnerHTML={{ __html: NAV_ICONS[r.path] }}
                title={r.label}
              />
            );
          })}
        </div>
      </aside>
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-workspace-border/60 bg-workspace-surface/80 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-workspace-fg">
              {activeRoute?.label ?? ""}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-workspace-accent-light px-2 py-0.5 text-[11px] font-medium text-workspace-accent">
              v1.1
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          {Route ?? (
            <div className="flex h-full items-center justify-center text-workspace-muted">
              页面不存在
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function usePersistenceBootstrap() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const history = loadPersistedHistory();
      useTaskStore.getState().setHistory(history);

      const breakpoints = loadBreakpoints();
      const breakpointsMap: Record<string, TaskBreakpoint> = {};
      for (const bp of breakpoints) {
        breakpointsMap[bp.taskId] = bp;
      }
      useTaskStore.getState().setBreakpoints(breakpointsMap);

      const diskLogs = await loadPersistedLogs();
      if (cancelled) return;
      const memoryLogs = useTaskStore.getState().logs;
      const merged = [...diskLogs, ...memoryLogs];
      useTaskStore.getState().setLogs(merged);

      logger.appInfo("应用启动，已加载历史任务、日志与断点");
      setReady(true);
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

export default function App() {
  const ready = usePersistenceBootstrap();

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-workspace-bg text-workspace-muted">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <span className="text-sm">加载中…</span>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}
