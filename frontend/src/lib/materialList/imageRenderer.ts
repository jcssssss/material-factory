// 资料列表展示图生成器：Canvas 图片渲染器。
//
// 与 v1.2.0 spec.md 对齐：
//   - "Requirement: 图片生成规范"：1242×1656 px 白底，垂直排列图标+文件名
//   - "Requirement: 不包含额外内容"：无商品名称/数量/营销文案/水印/Logo
//   - JPEG 质量复用 v1.0 规范（quality=1.0），但资料列表图不嵌入 300 DPI 元数据
//     （spec 仅要求 1242×1656 尺寸，未要求 DPI）
//
// 布局说明（1242×1656 画布）：
//   - 上下左右边距：80px
//   - 行高：80px（每行容纳图标 + 文件名，垂直居中）
//   - 图标尺寸：64×64（与 iconAssets SVG 视口一致）
//   - 图标与文件名间距：24px
//   - 文件名字号：40px，颜色 #333333，字体 PingFang SC / Microsoft YaHei / sans-serif
//   - 文件名按可用宽度截断并添加省略号（measureText 测量）

import { JPEG_QUALITY } from "../exportImage";
import type { LayoutPage } from "./layoutEngine";
import { getIconForFileType, svgStringToImage } from "./iconAssets";

// ─── 常量 ───

// 图片宽度：与 spec "图片尺寸" 对齐（1242×1656，3:4）。
export const MATERIAL_IMAGE_WIDTH = 1242;

// 图片高度。
export const MATERIAL_IMAGE_HEIGHT = 1656;

// 背景色：纯白。
export const BACKGROUND_COLOR = "#ffffff";

// 画布四边边距。
export const PAGE_PADDING = 80;

// 每行高度（图标 + 文件名垂直居中 + 行间距）。
export const ROW_HEIGHT = 80;

// 单页最多可完整容纳的行数：画布高 1656 − 上边距 80，每行 80px。
// 分页器（layoutEngine.paginateChildren）必须以此为准，否则超出的行会被
// 绘制到画布外而丢失。
export const MAX_ITEMS_PER_PAGE = Math.floor(
  (MATERIAL_IMAGE_HEIGHT - PAGE_PADDING) / ROW_HEIGHT
);

// 图标绘制尺寸（与 SVG 视口一致，1:1 绘制避免缩放模糊）。
export const ICON_SIZE = 64;

// 图标右边缘到文件名左边缘的间距。
export const ICON_TEXT_GAP = 24;

// 文件名字号。
export const FONT_SIZE = 40;

// 文件名颜色。
export const TEXT_COLOR = "#333333";

// 文件名字体栈：macOS 优先 PingFang SC，Windows 优先 Microsoft YaHei，回退 sans-serif。
export const FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

// ─── 渲染函数 ───

// 图标缓存：模块级单例，只加载一次。
// 之前每页都重新加载 6 个 SVG → Image，100 页 = 600 次加载，严重阻塞主线程。
// 现在首次调用加载并缓存，后续直接返回缓存结果。
let iconCache: Map<string, HTMLImageElement> | null = null;

async function preloadIconImages(): Promise<
  Map<string, HTMLImageElement>
> {
  if (iconCache) return iconCache;
  const types = ["pdf", "word", "excel", "ppt", "folder", "other"] as const;
  const entries = await Promise.all(
    types.map(async (t) => {
      const svg = getIconForFileType(t);
      const img = await svgStringToImage(svg);
      return [t, img] as const;
    })
  );
  iconCache = new Map(entries);
  return iconCache;
}

// 将单个布局页渲染为白底 Canvas。
//
// 流程：
//   1. 创建 1242×1656 Canvas，填充白色背景
//   2. 预加载 6 类图标
//   3. 从顶部边距开始，逐项绘制：
//      - 图标（左对齐，垂直居中于行高）
//      - 文件名（图标右侧，垂直居中于行高，超长截断 + 省略号）
//   4. 每项向下递增 ROW_HEIGHT
//
// 不绘制商品名称、文件数量、营销文案、水印、Logo（spec 要求）。
export async function renderLayoutPageToCanvas(
  page: LayoutPage
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = MATERIAL_IMAGE_WIDTH;
  canvas.height = MATERIAL_IMAGE_HEIGHT;

  // Tauri WebView 在长任务/高内存下偶发返回 null 2D 上下文；重试新建 canvas 防御。
  let ctx: CanvasRenderingContext2D | null = null;
  for (let attempt = 0; attempt < 3 && !ctx; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
    ctx = canvas.getContext("2d");
  }
  if (!ctx) {
    throw new Error("无法获取 Canvas 2D 上下文");
  }

  // 白色背景。
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, MATERIAL_IMAGE_WIDTH, MATERIAL_IMAGE_HEIGHT);

  // 预加载图标。
  const iconMap = await preloadIconImages();

  // 文件名可用宽度 = 画布宽度 - 左边距 - 图标宽度 - 间距 - 右边距。
  const availableTextWidth =
    MATERIAL_IMAGE_WIDTH -
    PAGE_PADDING -
    ICON_SIZE -
    ICON_TEXT_GAP -
    PAGE_PADDING;

  // 配置字体（一次设置，绘制每项时复用）。
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textBaseline = "middle";

  // 逐项绘制。
  let y = PAGE_PADDING;
  for (const item of page.items) {
    // 图标垂直居中于行高：y + (ROW_HEIGHT - ICON_SIZE) / 2
    const iconY = y + (ROW_HEIGHT - ICON_SIZE) / 2;
    const iconImg = iconMap.get(item.fileType);
    if (iconImg) {
      ctx.drawImage(iconImg, PAGE_PADDING, iconY, ICON_SIZE, ICON_SIZE);
    }

    // 文件名垂直居中于行高：y + ROW_HEIGHT / 2
    const textY = y + ROW_HEIGHT / 2;
    const truncated = truncateText(ctx, item.name, availableTextWidth);
    ctx.fillText(truncated, PAGE_PADDING + ICON_SIZE + ICON_TEXT_GAP, textY);

    y += ROW_HEIGHT;
  }

  return canvas;
}

// 将文件名按可用宽度截断并添加省略号。
//
// 策略：
//   1. 若完整名称宽度 ≤ 可用宽度，直接返回
//   2. 否则二分查找最大保留字符数，使 "保留部分 + …" 不超过可用宽度
//   3. 至少保留 1 个字符 + "…"
//
// 使用 measureText 测量宽度，支持中英文混合。
export function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  const ellipsis = "…";
  const ellipsisWidth = ctx.measureText(ellipsis).width;

  // 二分查找最大保留长度。
  let low = 1;
  let high = text.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const sliceWidth = ctx.measureText(text.slice(0, mid)).width;
    if (sliceWidth + ellipsisWidth <= maxWidth) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, best) + ellipsis;
}

// 将 Canvas 导出为 JPG Blob。
//
// 复用 v1.0 JPEG 质量规范（quality=1.0，即 100%）。
// 资料列表图不嵌入 300 DPI 元数据（spec 仅要求 1242×1656 尺寸）。
export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number = JPEG_QUALITY
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas 导出 JPG Blob 失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}
