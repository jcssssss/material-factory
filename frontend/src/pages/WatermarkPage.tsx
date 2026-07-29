import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type {
  BatchItem,
  FileProcessStatus,
  WatermarkReport,
  WatermarkRemovalResult,
} from "../types/watermark";
import type { FolderTreeNode } from "../types/materialList";
import { processBatch } from "../lib/watermarkProcessor";
import UploadBar from "../components/watermark/UploadBar";
import BatchList from "../components/watermark/BatchList";

let nextId = 0;
function uid(): string {
  nextId += 1;
  return `wm_${Date.now().toString(36)}_${nextId}`;
}

function extractName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function extractExtension(path: string): string {
  const name = extractName(path);
  const dotIdx = name.lastIndexOf(".");
  return dotIdx >= 0 ? name.slice(dotIdx + 1) : "";
}

function joinPath(...segments: string[]): string {
  return segments.map((s) => s.replace(/\/+$/, "")).filter(Boolean).join("/");
}

function flattenTree(
  children: FolderTreeNode[],
  rootPath: string,
  rootName: string,
): BatchItem[] {
  const items: BatchItem[] = [];
  for (const child of children) {
    if (child.is_dir) {
      items.push(...flattenTree(child.children, rootPath, rootName));
    } else if (child.file_type === "pdf" || child.file_type === "word") {
      const parentDir = child.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      const relativeDir = parentDir.replace(rootPath.replace(/\\/g, "/"), "").replace(/^\//, "");
      const groupName = relativeDir ? `${rootName}/${relativeDir}` : rootName;
      items.push({
        id: uid(), name: child.name, path: child.path, extension: child.extension ?? "",
        groupName, status: "pending", report: null, removal: null, errorMessage: null,
      });
    }
  }
  return items;
}

export default function WatermarkPage() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [outputDir, setOutputDir] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAddFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: true, title: "选择资料文件夹" });
    if (!selected) return;
    const folders = Array.isArray(selected) ? selected : [selected];
    const newItems = [...items];
    for (const folder of folders) {
      const folderName = extractName(folder);
      try {
        const tree: FolderTreeNode = await invoke("scan_folder_tree", { folder });
        newItems.push(...flattenTree(tree.children, folder, folderName));
      } catch { /* skip failed folders */ }
    }
    setItems(newItems);
  }, [items]);

  const handleAddFiles = useCallback(async () => {
    const selected = await open({
      multiple: true, title: "选择 PDF 或 Word 文件",
      filters: [{ name: "PDF / Word", extensions: ["pdf", "docx", "doc"] }],
    });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    for (const filePath of files) {
      items.push({
        id: uid(), name: extractName(filePath), path: filePath,
        extension: extractExtension(filePath), groupName: "默认文件夹",
        status: "pending", report: null, removal: null, errorMessage: null,
      });
    }
    setItems([...items]);
  }, [items]);

  const handleSelectOutputDir = useCallback(async () => {
    const selected = await open({ directory: true, title: "选择去水印输出目录" });
    if (selected && typeof selected === "string") setOutputDir(selected);
  }, []);

  const handleProgress = useCallback(
    (itemId: string, status: FileProcessStatus, report?: WatermarkReport | null, removal?: WatermarkRemovalResult | null, error?: string | null) => {
      setItems((prev) => prev.map((item) =>
        item.id === itemId ? { ...item, status, report: report ?? item.report, removal: removal ?? item.removal, errorMessage: error ?? item.errorMessage } : item,
      ));
    }, [],
  );

  const handleStart = useCallback(async () => {
    if (!outputDir || isProcessing) return;
    const pendingItems = items.filter((i) => i.status === "pending");
    if (pendingItems.length === 0) return;
    setIsProcessing(true);
    try {
      await invoke("ensure_output_dir", { path: outputDir });
      const uniqueDirs = new Set(pendingItems.map((i) => i.groupName).filter((g) => g !== "默认文件夹"));
      for (const dir of uniqueDirs) {
        await invoke("ensure_output_dir", { path: joinPath(outputDir, dir) });
      }
      await processBatch(pendingItems, outputDir, handleProgress);
    } catch (err) {
      console.error(`批量处理异常：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  }, [items, outputDir, isProcessing, handleProgress]);

  const handleClear = useCallback(() => { if (!isProcessing) setItems([]); }, [isProcessing]);
  const handleRemoveItem = useCallback((id: string) => { setItems((prev) => prev.filter((item) => item.id !== id)); }, []);

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-workspace-fg">去水印</h2>
          {items.length > 0 && (
            <span className="text-xs text-workspace-muted">
              {items.length} 个文件{outputDir ? "" : " · 请选择输出目录"}
            </span>
          )}
        </div>
      </div>

      <UploadBar
        hasItems={items.length > 0}
        isProcessing={isProcessing}
        outputDir={outputDir}
        onAddFolder={handleAddFolder}
        onAddFiles={handleAddFiles}
        onClear={handleClear}
        onStart={handleStart}
        onSelectOutputDir={handleSelectOutputDir}
      />

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-2.5">
        <div className="flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.747 9H9z" clipRule="evenodd"/>
          </svg>
          <div className="text-xs leading-relaxed text-indigo-800">
            支持自动检测并去除 PDF 文档中的文字水印、图片水印、Form 水印、标注水印、页眉和页脚。点击「添加文件夹」批量处理。
          </div>
        </div>
      </div>

      <BatchList items={items} onRemoveItem={handleRemoveItem} />
    </div>
  );
}
