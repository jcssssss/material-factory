import { useEffect, useState, type ReactNode } from "react";
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
import {
  LayoutDashboard,
  History,
  ScrollText,
  Image,
  Droplets,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, ReactNode> = {
  "/": <LayoutDashboard className="h-5 w-5" />,
  "/history": <History className="h-5 w-5" />,
  "/logs": <ScrollText className="h-5 w-5" />,
  "/backgrounds": <Image className="h-5 w-5" />,
  "/watermark-removal": <Droplets className="h-5 w-5" />,
};

function CollapsibleText({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
        show ? "w-28 opacity-100" : "w-0 opacity-0"
      )}
    >
      {children}
    </span>
  );
}

function NavItem({ path, label, icon, active, disabled, collapsed }: {
  path: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  disabled?: boolean;
  collapsed?: boolean;
}) {
  const content = (
    <div
      className={cn(
        "flex items-center rounded-lg py-2 text-sm transition-all duration-150",
        collapsed ? "justify-center px-0 gap-0" : "px-3 gap-2.5",
        disabled && "text-white/20",
        !disabled && active && "bg-primary/10 font-medium text-primary",
        !disabled && !active && "text-white/50 hover:bg-workspace-sidebar-hover hover:text-white"
      )}
    >
      {!disabled && active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
      )}
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
          !disabled && active && "bg-primary text-primary-foreground shadow-sm"
        )}
      >
        {icon}
      </span>
      <div className={cn("flex items-center gap-1.5", collapsed ? "hidden" : "min-w-0 flex-1")}>
        <CollapsibleText show={!collapsed}>
          <span>{label}</span>
        </CollapsibleText>
        {disabled && (
          <span
            className={cn(
              "shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/40 transition-all duration-300",
              collapsed && "w-0 scale-0 opacity-0"
            )}
          >
            开发中
          </span>
        )}
      </div>
      {disabled && collapsed && (
        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
        </span>
      )}
    </div>
  );

  if (disabled) {
    const el = <div className="group relative">{content}</div>;
    if (collapsed) {
      return (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>{el}</TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-1.5 bg-white text-foreground shadow-md border">
            <span>{label}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">开发中</span>
          </TooltipContent>
        </Tooltip>
      );
    }
    return el;
  }

  if (collapsed) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <a href={`#${path}`} className="group relative block">
            {content}
          </a>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-1.5 bg-white text-foreground shadow-md border">
          <span>{label}</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <a href={`#${path}`} className="group relative block">
      {content}
    </a>
  );
}

function AppShell() {
  const location = useLocation();
  const activeRoute = routes.find((r) => matchPath(r.path, location.pathname));
  const Route = activeRoute?.element;
  const navRoutes = routes.filter((r) => !r.path.startsWith("/calibrate"));
  const mainRoutes = navRoutes.filter((r) => !r.disabled);
  const disabledRoutes = navRoutes.filter((r) => r.disabled);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background text-foreground">
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r bg-workspace-sidebar shadow-sidebar transition-all duration-300 ease-in-out overflow-hidden",
            collapsed ? "w-16" : "w-52"
          )}
        >
          {/* Logo */}
          <div className={cn("flex items-center pt-5 pb-4 border-b border-border/40", collapsed ? "justify-center px-0 gap-0" : "px-5 gap-2.5")}>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow-sm">
              <img src="/icon64.png" alt="" className="h-full w-full object-cover" />
            </div>
            {!collapsed && (
              <span className="text-sm font-extrabold leading-none text-white">素材工厂</span>
            )}
          </div>

          {/* 导航 */}
          <nav className={cn("flex-1 space-y-0.5", collapsed ? "px-0" : "px-3")}>
            <div
              className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out",
                collapsed ? "max-h-0 opacity-0" : "max-h-5 mb-2 opacity-100"
              )}
            >
              <span className="inline-block px-3 text-[10px] font-medium uppercase tracking-wider text-white/40">
                功能
              </span>
            </div>

            {mainRoutes.map((r) => {
              const active = !!matchPath(r.path, location.pathname);
              return (
                <NavItem
                  key={r.path}
                  path={r.path}
                  label={r.label}
                  icon={NAV_ICONS[r.path]}
                  active={active}
                  collapsed={collapsed}
                />
              );
            })}

            {disabledRoutes.length > 0 && (
              <>
                <Separator className={cn("my-3 bg-white/10", collapsed ? "mx-0" : "mx-3")} />
                {disabledRoutes.map((r) => (
                  <NavItem
                    key={r.path}
                    path={r.path}
                    label={r.label}
                    icon={NAV_ICONS[r.path]}
                    active={false}
                    disabled
                    collapsed={collapsed}
                  />
                ))}
              </>
            )}
          </nav>

          {/* 底部 */}
          <div className="flex flex-col items-center border-t border-white/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCollapsed((c) => !c)}
              className={cn(
                "w-full text-white/40 hover:text-white/80 hover:bg-workspace-sidebar-hover",
                collapsed ? "px-0" : "justify-start gap-2 px-4"
              )}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4 mx-auto" />
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 shrink-0" />
                  <CollapsibleText show={true}>
                    <span className="text-[11px]">收起菜单</span>
                  </CollapsibleText>
                </>
              )}
            </Button>

            <div
              className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out",
                collapsed ? "max-h-0 py-0" : "max-h-6 pb-3"
              )}
            >
              <span className="block text-center text-[11px] text-white/30">v1.1</span>
            </div>
          </div>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-12 shrink-0 items-center border-b bg-card/80 px-6 backdrop-blur-sm">
            <h1 className="text-sm font-semibold">
              {activeRoute?.label ?? ""}
            </h1>
          </header>
          <div className="flex-1 overflow-auto">
            {Route ?? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                页面不存在
              </div>
            )}
          </div>
        </main>
      </div>
    </TooltipProvider>
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
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">加载中…</span>
        </div>
      </div>
    );
  }

  return (
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppShell />
    </HashRouter>
  );
}
