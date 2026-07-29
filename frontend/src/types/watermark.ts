// 去水印模块前端类型定义。
// 与 Rust 后端 WatermarkReport / RegionInfo 等数据结构对齐（serde camelCase）。

export interface WatermarkReport {
  hasWatermark: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  regions: RegionInfo[];
  pageCount: number;
  summary: string;
}

export interface RegionInfo {
  pageNumber: number;
  text: string;
  type: RegionType;
  /** 归一化矩形 (x0, y0, x1, y1)，坐标 0.0~1.0 相对于页面尺寸 */
  bbox: [number, number, number, number];
  /** XObject 对象编号（仅 Image/Form 水印有效） */
  xobjectId?: number;
}

export type RegionType =
  | "header"
  | "footer"
  | "watermark"
  | "page_number"
  | "image_watermark"
  | "annotation_watermark"
  | "form_watermark";

export interface WatermarkRemovalResult {
  outputPath: string;
  removedHeader: boolean;
  removedFooter: boolean;
  removedWatermark: boolean;
  removedCount: number;
}

export interface WatermarkRequest {
  inputPath: string;
  outputPath: string;
}

export interface WatermarkResult {
  inputPath: string;
  outputPath: string;
  success: boolean;
  error: string | null;
  report: WatermarkReport | null;
  removal: WatermarkRemovalResult | null;
}

/** 文件处理状态 */
export type FileProcessStatus =
  | "pending"
  | "detecting"
  | "removing"
  | "done"
  | "no_watermark"
  | "failed";

/** 批量处理中的单个项 */
export interface BatchItem {
  id: string;
  name: string;
  path: string;
  extension: string;
  groupName: string;
  status: FileProcessStatus;
  report: WatermarkReport | null;
  removal: WatermarkRemovalResult | null;
  errorMessage: string | null;
}

/** 文件夹分组 */
export interface FileGroup {
  name: string;
  items: BatchItem[];
  expanded: boolean;
}
