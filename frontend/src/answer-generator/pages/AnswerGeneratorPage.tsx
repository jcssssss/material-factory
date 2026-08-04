// 答案生成器页面：左侧配置（试卷/输出文件夹/模型/Prompt/生成），
// 右侧上方资料文件列表（每文件进度条）+ 下方答案预览（点击已完成文件可查看/打印）。
// 路由: /answer-generator，导航「答案生成器」。

import { useEffect, useRef } from "react";
import { useAnswerStore } from "../store/useAnswerStore";
import { ConfigSection } from "../components/ConfigSection";
import { FileList } from "../components/FileList";
import { ResultPreview } from "../components/ResultPreview";

export default function AnswerGeneratorPage() {
  const files = useAnswerStore((s) => s.files);
  const selectedIndex = useAnswerStore((s) => s.selectedIndex);
  // 打印专用容器 ref：屏幕隐藏（print:block），打印时仅输出答案内容。
  const printAreaRef = useRef<HTMLDivElement>(null);

  // 页面卸载/重进时若仍在批量生成，取消以释放 Rust 侧资源。
  // 注意：卸载时读取的是当前 store 状态（不能在挂载时缓存 st，否则读不到后来的 running）。
  useEffect(() => {
    return () => {
      const st = useAnswerStore.getState();
      if (st.status === "running") {
        st.cancelGeneration();
      }
    };
  }, []);

  // 打印时隐藏应用侧栏/顶栏，并重置高度/溢出让长答案可跨页打印。
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @media print {
        aside, header { display: none !important; }
        main, .answer-generator-root {
          height: auto !important;
          overflow: visible !important;
        }
      }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  const selected = files[selectedIndex ?? -1] ?? null;
  const selectedHtml = selected?.status === "done" ? selected.resultHtml ?? null : null;
  const selectedName = selected?.name ?? null;

  return (
    <div className="answer-generator-root flex h-full min-h-0 gap-4 p-4">
      <aside className="w-[380px] shrink-0 print:hidden">
        <ConfigSection />
      </aside>
      <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card print:hidden">
        {/* 上方：资料文件列表 + 每文件进度条 */}
        <div className="min-h-0 flex-1 border-b border-workspace-border/60">
          <FileList />
        </div>
        {/* 下方：答案预览（点击已完成文件切换） */}
        <div className="flex min-h-0 flex-[2] flex-col p-4">
          <ResultPreview
            html={selectedHtml}
            fileName={selectedName}
            printAreaRef={printAreaRef}
          />
        </div>
      </section>
      {/* 打印专用容器：ResultPreview.handlePrint 注入答案 HTML */}
      <div className="hidden print:block" ref={printAreaRef} />
    </div>
  );
}
