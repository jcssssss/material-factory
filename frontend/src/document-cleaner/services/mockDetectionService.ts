import type { FileDetectionResult, DetectionType, CleanReport, FileCleanResult } from "../types";

const LOCATIONS: Record<DetectionType, string[]> = {
  watermark: [
    "左上角 (x: 12, y: 8)",
    "右下角 (x: 188, y: 270)",
    "页面中心 (x: 105, y: 140)",
    "右上角 (x: 175, y: 10)",
    "左下角 (x: 15, y: 265)",
    "底部居中 (x: 105, y: 250)",
  ],
  header: [
    "顶部居中 (x: 105, y: 5)",
    "页眉右侧 (x: 170, y: 6)",
    "页眉左侧 (x: 15, y: 5)",
  ],
  footer: [
    "底部居中 (x: 105, y: 270)",
    "页脚右侧 (x: 175, y: 268)",
    "页脚左侧 (x: 10, y: 270)",
  ],
};

const SUB_TYPES: Record<DetectionType, string[]> = {
  watermark: ["文字水印", "图片水印", "半透明水印"],
  header: ["文字页眉", "线条页眉"],
  footer: ["文字页脚", "页码"],
};

let idCounter = 0;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 为单个文件生成 mock 检测结果 */
export function generateMockResults(fileName: string): FileDetectionResult {
  idCounter += 1;
  const seed = idCounter * 1000 + fileName.length;

  // 用种子确保每次调用结果稳定
  const rng = (max: number, offset = 0) => ((seed + offset) * 13 + 7) % max;

  const watermarkCount = 1 + (rng(3, 0) % 3);   // 1~3
  const headerCount = rng(2, 10) % 2;             // 0~1
  const footerCount = rng(2, 20) % 2;              // 0~1

  const items = [
    ...Array.from({ length: watermarkCount }, (_, i) => ({
      id: `detect_${idCounter}_wm_${i}`,
      type: "watermark" as DetectionType,
      subType: pick(SUB_TYPES.watermark),
      name: `水印${String(i + 1).padStart(2, "0")}`,
      page: 1 + (rng(5, i) % 3),
      location: pick(LOCATIONS.watermark),
      confidence: 75 + (rng(20, i) % 20),
      markedForDeletion: i === 0,
    })),
    ...Array.from({ length: headerCount }, (_, i) => ({
      id: `detect_${idCounter}_hdr_${i}`,
      type: "header" as DetectionType,
      subType: pick(SUB_TYPES.header),
      name: `页眉${String(i + 1).padStart(2, "0")}`,
      page: 1,
      location: pick(LOCATIONS.header),
      confidence: 80 + (rng(15, i + 10) % 15),
      markedForDeletion: true,
    })),
    ...Array.from({ length: footerCount }, (_, i) => ({
      id: `detect_${idCounter}_ftr_${i}`,
      type: "footer" as DetectionType,
      subType: pick(SUB_TYPES.footer),
      name: `页脚${String(i + 1).padStart(2, "0")}`,
      page: 1,
      location: pick(LOCATIONS.footer),
      confidence: 80 + (rng(15, i + 20) % 15),
      markedForDeletion: true,
    })),
  ];

  return { fileName, items };
}

/** 为多个文件生成 mock 结果 */
export function generateMockResultsForFiles(fileNames: string[]): FileDetectionResult[] {
  return fileNames.map((f) => generateMockResults(f));
}

let reportIdCounter = 0;

/** 根据文件列表生成 mock 清理报告 */
export function generateMockReport(fileNames: string[]): CleanReport {
  reportIdCounter += 1;
  const rng = (max: number) => ((reportIdCounter * 7 + fileNames.length) * 13 + 5) % max;

  const files: FileCleanResult[] = fileNames.map((name) => {
    const rand = rng(10);
    if (rand < 1)
      return { fileName: name, status: "failed", error: "文件格式不支持" };
    if (rand < 2)
      return { fileName: name, status: "skipped", error: "文件已加密" };
    return { fileName: name, status: "success" };
  });

  const successCount = files.filter((f) => f.status === "success").length;
  const failedCount = files.filter((f) => f.status === "failed").length;
  const skippedCount = files.filter((f) => f.status === "skipped").length;

  return {
    taskId: (() => { const b = new Uint8Array(8); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); })(),
    totalFiles: fileNames.length,
    successCount,
    failedCount,
    skippedCount,
    files,
    completedAt: new Date().toISOString(),
  };
}
