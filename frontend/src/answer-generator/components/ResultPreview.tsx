// 右侧下方「答案预览」区：展示选中的已完成文件的答案 HTML。
// 每个文件生成后已自动落盘到输出文件夹，这里保留 iframe 预览 + 打印
// （WebView 高保真，用户走系统打印对话框选"存储为 PDF"）。

import type { RefObject } from "react";
import { Printer, Eye } from "lucide-react";
import { Button } from "../../components/ui/button";

export function ResultPreview({
  html,
  fileName,
  printAreaRef,
}: {
  html: string | null;
  fileName: string | null;
  printAreaRef: RefObject<HTMLDivElement>;
}) {
  function handlePrint() {
    const el = printAreaRef.current;
    if (!el || !html) return;
    // innerHTML 注入不会执行脚本，安全；等样式渲染完成再触发主窗口打印
    //（打印样式经页面注入的 @media print 规则隐藏应用界面）。
    el.innerHTML = html;
    setTimeout(() => window.print(), 60);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-workspace-muted">
          <Eye className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={fileName ?? undefined}>
            {fileName ? `答案预览 · ${fileName}` : "答案预览"}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          disabled={!html}
        >
          <Printer className="h-4 w-4" />
          打印
        </Button>
      </div>

      {html ? (
        <iframe
          srcDoc={html}
          sandbox=""
          title="答案预览"
          className="min-h-0 flex-1 rounded-lg border border-workspace-border/60 bg-white"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-workspace-border/70 bg-workspace-surface">
          <p className="px-6 text-center text-xs leading-relaxed text-workspace-muted">
            在文件列表中点击已完成的文件，可在此预览答案并打印
          </p>
        </div>
      )}
    </div>
  );
}
