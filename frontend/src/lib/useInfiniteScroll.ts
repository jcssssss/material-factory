import { useEffect, useRef, useState } from "react";

// 向上查找最近的滚动祖先，作为 IntersectionObserver 的 root。
// 项目滚动容器可能是页面自有 overflow-auto，也可能是 App 全局容器，需自动定位。
function getScrollParent(el: Element | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

// 无限滚动分页：渲染 items 的前 visibleCount 项，sentinel 进入视口时加载更多。
// items 需为稳定引用（useMemo / state），否则会在每次渲染时重置分页。
export function useInfiniteScroll<T>(items: T[], pageSize = 20) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // items 变化（如搜索 / 刷新）时重置分页到首页
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [items, pageSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const root = getScrollParent(sentinel);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => Math.min(c + pageSize, items.length));
        }
      },
      { root, rootMargin: "150px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [items.length, pageSize]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;
  return { visibleItems, hasMore, sentinelRef };
}
