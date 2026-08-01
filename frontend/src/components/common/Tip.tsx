import * as React from "react";
import {
  type ReactNode,
  useRef,
  useState,
  useEffect,
  cloneElement,
} from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipArrow,
} from "../ui/tooltip";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";

type TipProps = {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
  side?: Side;
  sideOffset?: number;
  /**
   * 仅当 children 内容被截断（overflow hidden）时才弹出完整内容。
   * 用于「滑动到隐藏的目标立刻弹出」，未截断的内容不打扰用户。
   */
  onlyOverflow?: boolean;
};

/** 检测元素内容是否超出可见区域（被 truncate / overflow-hidden 截断）。 */
function useOverflow() {
  const ref = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      setOverflow(
        el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
      );
    };
    check();
    // jsdom 等无 ResizeObserver 环境跳过监听，仅做初始检测
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, overflow };
}

/**
 * 项目统一的 tips 组件：立即弹出（delayDuration=0）、带箭头、
 * 进出动画（fade + zoom + slide）、圆角卡片样式。
 * 覆盖原生 title（浏览器延迟无法控制），所有隐藏内容通过它展示完整信息。
 */
export function Tip({
  label,
  children,
  className,
  side = "top",
  sideOffset = 6,
  onlyOverflow = false,
}: TipProps) {
  const { ref, overflow } = useOverflow();

  if (!label) return <>{children}</>;

  let trigger: ReactNode = children;
  if (onlyOverflow) {
    // 注入 ref 测量 children 是否溢出；非元素（字符串/数组）无法测量，直接渲染
    if (React.isValidElement(children)) {
      const triggerProps: { ref?: React.Ref<HTMLElement> } = { ref: ref as never };
      trigger = cloneElement(children as React.ReactElement, triggerProps);
    } else {
      return <>{children}</>;
    }
  }

  if (onlyOverflow && !overflow) return <>{trigger}</>;

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={sideOffset}
          className={cn(
            "max-w-[380px] break-words whitespace-normal overflow-visible rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-xl backdrop-blur-sm",
            "animate-in fade-in-0 zoom-in-95 duration-150",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-1.5 data-[side=left]:slide-in-from-right-1.5 data-[side=right]:slide-in-from-left-1.5 data-[side=top]:slide-in-from-bottom-1.5",
            className
          )}
        >
          {label}
          <TooltipArrow className="text-popover" width={10} height={5} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
