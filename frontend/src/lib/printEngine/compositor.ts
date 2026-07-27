import { invoke } from "@tauri-apps/api/core";
import { embedJfif300Dpi } from "../exportImage";
import type { CalibrationCorners, BackgroundTemplate } from "../../types/background";
import type { FolderTreeNode } from "../../types/materialList";
import { readBackgroundFile } from "./backgroundDb";

export const COMPOSE_WIDTH = 1242;
export const COMPOSE_HEIGHT = 1656;

export async function decodeImageBytes(bytes: Uint8Array): Promise<ImageBitmap> {
  const blob = new Blob([bytes as BlobPart]);
  return createImageBitmap(blob);
}

export async function composePrintImage(params: {
  bgBytes: Uint8Array;
  bgW: number;
  bgH: number;
  corners: CalibrationCorners;
  materialBytes: Uint8Array;
}): Promise<Uint8Array> {
  const { bgBytes, bgW, bgH, corners, materialBytes } = params;

  const warpedNumberArray = await invoke<number[]>("warp_to_a4", {
    materialBytes: Array.from(materialBytes),
    bgW,
    bgH,
    corners,
  });
  const warpedBytes = new Uint8Array(warpedNumberArray);

  const canvas = document.createElement("canvas");
  canvas.width = COMPOSE_WIDTH;
  canvas.height = COMPOSE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 Canvas 2D 上下文");

  const bgBitmap = await decodeImageBytes(bgBytes);
  const bgScale = Math.min(COMPOSE_WIDTH / bgW, COMPOSE_HEIGHT / bgH);
  const bgDrawW = Math.round(bgW * bgScale);
  const bgDrawH = Math.round(bgH * bgScale);
  const bgOffsetX = Math.floor((COMPOSE_WIDTH - bgDrawW) / 2);
  const bgOffsetY = Math.floor((COMPOSE_HEIGHT - bgDrawH) / 2);

  ctx.fillStyle = "#ffffff";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillRect(0, 0, COMPOSE_WIDTH, COMPOSE_HEIGHT);
  ctx.drawImage(bgBitmap, bgOffsetX, bgOffsetY, bgDrawW, bgDrawH);

  const warpedBitmap = await decodeImageBytes(warpedBytes);
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(warpedBitmap, 0, 0, COMPOSE_WIDTH, COMPOSE_HEIGHT);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas 导出 JPG Blob 失败"));
      },
      "image/jpeg",
      1.0,
    );
  });

  const rawBytes = new Uint8Array(await blob.arrayBuffer());
  return embedJfif300Dpi(rawBytes);
}

function joinPath(...segments: string[]): string {
  return segments.map((s) => s.replace(/\/+$/, "")).filter(Boolean).join("/");
}

function collectJpgFiles(node: FolderTreeNode): { name: string; path: string }[] {
  const result: { name: string; path: string }[] = [];
  for (const child of node.children) {
    if (!child.is_dir && child.extension?.toLowerCase() === ".jpg") {
      result.push({ name: child.name, path: child.path });
    }
  }
  return result;
}

export async function generatePrintImages(
  taskOutputDir: string,
  backgrounds: BackgroundTemplate[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const tree = await invoke<FolderTreeNode>("scan_folder_tree", { folder: taskOutputDir });
  const materialFiles = collectJpgFiles(tree);
  if (materialFiles.length === 0) return 0;

  const shuffled = [...backgrounds].sort(() => Math.random() - 0.5);
  const printDir = joinPath(taskOutputDir, "仿打印");
  await invoke<void>("ensure_output_dir", { path: printDir });

  for (let i = 0; i < materialFiles.length; i++) {
    const file = materialFiles[i];
    const bg = shuffled[i % shuffled.length];
    const corners: CalibrationCorners = [
      bg.a4_x1!, bg.a4_y1!,
      bg.a4_x2!, bg.a4_y2!,
      bg.a4_x3!, bg.a4_y3!,
      bg.a4_x4!, bg.a4_y4!,
    ];

    const materialNumberArray = await invoke<number[]>("read_pdf_bytes", { path: file.path });
    const bgNumberArray = await readBackgroundFile(bg.file_name);

    const outputBytes = await composePrintImage({
      bgBytes: new Uint8Array(bgNumberArray),
      bgW: bg.width,
      bgH: bg.height,
      corners,
      materialBytes: new Uint8Array(materialNumberArray),
    });

    const outPath = joinPath(printDir, `${String(i + 1).padStart(3, "0")}.jpg`);
    await invoke<void>("write_image_file", {
      path: outPath,
      bytes: Array.from(outputBytes),
    });

    onProgress?.(i + 1, materialFiles.length);

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return materialFiles.length;
}
