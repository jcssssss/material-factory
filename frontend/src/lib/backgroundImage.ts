// 背景模板上传辅助：仅保留字节格式化工具。
// 缩放/编码/HEIC 兜底已全部在 Rust 端（save_background_file）后台完成，
// 前端只负责选择路径、读字节、上传，主线程不做任何图片处理。

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
