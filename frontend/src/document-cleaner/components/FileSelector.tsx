import { useState, useCallback, type DragEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";

export type FileItem = {
  path: string;
  name: string;
  type: string;
  size: number;
};

const SUPPORTED = [
  { ext: "pdf", label: "PDF" },
  { ext: "doc", label: "DOC" },
  { ext: "docx", "label": "DOCX" },
];

function extname(p: string): string {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : p.slice(i + 1).toLowerCase();
}

function detectType(path: string): { type: string; supported: boolean } {
  const ext = extname(path);
  const found = SUPPORTED.find((s) => s.ext === ext);
  return found
    ? { type: found.label, supported: true }
    : { type: ext.toUpperCase() || "未知", supported: false };
}

function mockSize(name: string): number {
  // 根据文件名哈希生成一个 0.3~8 MB 之间的稳定值
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const mb = 0.3 + ((Math.abs(hash) % 770) / 100);
  return Math.round(mb * 100) / 100;
}

function formatSize(mb: number): string {
  return mb < 1 ? `${Math.round(mb * 1024)} KB` : `${mb.toFixed(1)} MB`;
}

export function FileSelector({
  files,
  onChange,
}: {
  files: FileItem[];
  onChange: (files: FileItem[]) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (paths: string[]) => {
      const newItems: FileItem[] = [];
      for (const p of paths) {
        const name = p.split("/").pop() ?? p.split("\\").pop() ?? p;
        if (files.some((f) => f.path === p)) continue;
        const { type, supported } = detectType(p);
        if (!supported) continue;
        newItems.push({ path: p, name, type, size: mockSize(name) });
      }
      if (newItems.length > 0) onChange([...files, ...newItems]);
    },
    [files, onChange]
  );

  const removeFile = useCallback(
    (path: string) => {
      onChange(files.filter((f) => f.path !== path));
    },
    [files, onChange]
  );

  // Tauri 文件对话框
  const handlePickFiles = async () => {
    const result = await open({
      multiple: true,
      filters: [
        { name: "文档", extensions: ["pdf", "doc", "docx"] },
      ],
    });
    if (result) {
      const paths = Array.isArray(result) ? result : [result];
      addFiles(paths);
    }
  };

  const handlePickFolder = async () => {
    const result = await open({
      directory: true,
      multiple: false,
    });
    if (result) {
      const dir = Array.isArray(result) ? result[0] : result;
      // mock: 从文件夹名生成几个文件
      const baseName = dir.split("/").pop() ?? dir.split("\\").pop() ?? "folder";
      addFiles([
        `${dir}/${baseName}_001.pdf`,
        `${dir}/${baseName}_002.pdf`,
        `${dir}/notes.docx`,
      ]);
    }
  };

  // 拖拽
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = () => setDragging(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    // 从拖拽的 File 对象读取名称并模拟
    const dropped = Array.from(e.dataTransfer.files);
    const names = dropped.map((f) => f.name).filter((n) => {
      const ext = n.split(".").pop()?.toLowerCase();
      return SUPPORTED.some((s) => s.ext === ext);
    });
    if (names.length > 0) addFiles(names);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePickFiles}
          className="inline-flex items-center gap-1.5 rounded-lg border border-workspace-border/60 bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50 hover:shadow"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5z" />
          </svg>
          选择文件
        </button>
        <button
          type="button"
          onClick={handlePickFolder}
          className="inline-flex items-center gap-1.5 rounded-lg border border-workspace-border/60 bg-white px-3 py-1.5 text-xs font-medium text-workspace-fg-secondary shadow-sm transition hover:bg-slate-50 hover:shadow"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM2 8.76v6.49A1.75 1.75 0 003.75 17h12.5A1.75 1.75 0 0018 15.25V8.76a3.235 3.235 0 00-1.75-.51H3.75c-.645 0-1.245.188-1.75.51z" />
          </svg>
          选择文件夹
        </button>
        <span className="text-[11px] text-workspace-muted/60">
          支持 PDF、DOC、DOCX
        </span>
      </div>

      {/* 拖拽区域 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition " +
          (dragging
            ? "border-indigo-400 bg-indigo-50/30"
            : "border-workspace-border/40 hover:border-indigo-400/50 hover:bg-indigo-50/20")
        }
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={
            "h-7 w-7 transition-colors " +
            (dragging ? "text-indigo-400" : "text-workspace-muted/40")
          }
        >
          <path d="M9.25 13.25a.75.75 0 001.5 0V4.636l2.955 3.129a.75.75 0 001.09-1.03l-4.25-4.5a.75.75 0 00-1.09 0l-4.25 4.5a.75.75 0 101.09 1.03L9.25 4.636V13.25z" />
          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5a2.75 2.75 0 002.75-2.75v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
        </svg>
        <span
          className={
            "text-sm font-medium " +
            (dragging ? "text-indigo-500" : "text-workspace-muted")
          }
        >
          {dragging ? "释放以上传文件" : "拖拽文件到此处上传"}
        </span>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-workspace-border/60 bg-workspace-surface">
          {files.map((f) => (
            <div
              key={f.path}
              className="flex items-center justify-between border-b border-workspace-border/20 px-3.5 py-2.5 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                {/* 文件图标 */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={
                    "h-4 w-4 shrink-0 " +
                    (f.type === "PDF" ? "text-red-500" : "text-blue-500")
                  }
                >
                  <path d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5z" />
                </svg>
                <span className="truncate text-sm text-workspace-fg" title={f.path}>
                  {f.name}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs tabular-nums text-workspace-muted">
                  {f.type}
                </span>
                <span className="text-xs tabular-nums text-workspace-muted">
                  {formatSize(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.path)}
                  className="rounded p-0.5 text-workspace-muted/50 transition hover:text-red-500"
                  title="移除"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c-.84 0-1.673.025-2.5.075V3.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25v.325C11.673 4.025 10.84 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
