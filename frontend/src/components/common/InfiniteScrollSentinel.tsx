import { forwardRef } from "react";

type Props = {
  hasMore: boolean;
  label?: string;
};

// 无限滚动列表底部的加载哨兵：滚到附近自动触发加载更多。
const InfiniteScrollSentinel = forwardRef<HTMLDivElement, Props>(
  function InfiniteScrollSentinel({ hasMore, label = "已全部加载" }, ref) {
    return (
      <div
        ref={ref}
        className="flex items-center justify-center py-3 text-xs text-muted-foreground/70"
      >
        {hasMore ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            加载中…
          </span>
        ) : (
          <span className="text-muted-foreground/50">{label}</span>
        )}
      </div>
    );
  },
);

export default InfiniteScrollSentinel;
