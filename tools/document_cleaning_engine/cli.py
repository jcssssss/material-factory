#!/usr/bin/env python3
"""
Document Cleaning Engine CLI — Tauri 桥接接口。

提供三个子命令供 Rust 端 subprocess 调用：
  detect   <pdf_path>      → 检测水印/页眉/页脚，输出 JSON
  clean    <pdf> <output>  → 执行清理，输出 JSON 结果
  validate <orig> <clean>  → 验证清理结果，输出 JSON

输出始终为 UTF-8 JSON（单行或缩进），stdout 承载数据，stderr 承载日志。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import tempfile
from pathlib import Path

import fitz

# 确保本项目模块可导入
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from detector import PDFDetector, DetectionResult
from executor import CleaningExecutor
from risk import CleaningPlan, RiskLevel
from validator import PDFValidator


logging.basicConfig(
    level=logging.WARNING,
    format="%(levelname)s %(name)s %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("cli")


# ─── 检测 ──────────────────────────────────────────────────────────────


def cmd_detect(pdf_path: str) -> None:
    """执行检测，输出前端对齐的 JSON 结构。"""
    detector = PDFDetector()
    raw: list[DetectionResult] = detector.detect(pdf_path)
    file_name = Path(pdf_path).name

    # 获取页面高度用于坐标归一化
    page_heights: dict[int, float] = {}
    page_widths: dict[int, float] = {}
    try:
        doc = fitz.open(pdf_path)
        for i, pg in enumerate(doc):
            page_heights[i + 1] = pg.rect.height
            page_widths[i + 1] = pg.rect.width
        doc.close()
    except Exception:
        pass

    items = []
    wm_idx = hdr_idx = ftr_idx = 0
    for r in raw:
        if r.type in ("annotation", "image", "text", "shape", "drawing"):
            item_type = "watermark"
            sub_type = {
                "annotation": "标注水印",
                "image": "图片水印",
                "text": "文字水印",
                "shape": "形状",
                "drawing": "绘制对象",
            }.get(r.type, "水印")
            wm_idx += 1
            name = f"水印{wm_idx:02d}"
        elif r.type == "header":
            item_type, sub_type = "header", "文字页眉"
            hdr_idx += 1
            name = f"页眉{hdr_idx:02d}"
        elif r.type == "footer":
            item_type, sub_type = "footer", "文字页脚"
            ftr_idx += 1
            name = f"页脚{ftr_idx:02d}"
        elif r.type == "artifact":
            item_type, sub_type = "watermark", "Artifact 水印"
            wm_idx += 1
            name = f"水印{wm_idx:02d}"
        else:
            item_type, sub_type = "watermark", r.type
            wm_idx += 1
            name = f"水印{wm_idx:02d}"

        bx = r.bbox
        confidence_pct = round(r.confidence * 100)
        # 归一化 y 坐标（0-1）用于位置描述
        ph = page_heights.get(r.page, 842.0)
        if bx and ph > 0:
            cy = (bx[1] + bx[3]) / 2 / ph
            if cy > 0.85:
                loc = f"顶部 (y: {cy*100:.0f}%)"
            elif cy < 0.12:
                loc = f"底部 (y: {cy*100:.0f}%)"
            else:
                cx = (bx[0] + bx[2]) / 2
                loc = f"页面中心 (x: {cx:.0f}, y: {cy*100:.0f}%)"
        else:
            loc = "未知"
        # 归一化 bbox 到 0-1
        norm_bbox = None
        if bx and ph > 0:
            pw = page_widths.get(r.page, 595.0)
            if pw > 0:
                norm_bbox = (bx[0]/pw, bx[1]/ph, bx[2]/pw, bx[3]/ph)

        items.append({
            "id": f"detect_{r.page}_{r.type}_{wm_idx}",
            "type": item_type,
            "subType": sub_type,
            "name": name,
            "page": r.page,
            "location": loc,
            "confidence": confidence_pct,
            "markedForDeletion": confidence_pct >= 80,
            "bbox": list(norm_bbox) if norm_bbox else None,
        })

    output = {
        "fileName": file_name,
        "items": items,
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


# ─── 清理 ──────────────────────────────────────────────────────────────


def cmd_clean(pdf_path: str, output_path: str) -> None:
    """对单个 PDF 执行清理并输出报告。"""
    # 1. 检测
    detector = PDFDetector()
    raw = detector.detect(pdf_path)

    # 2. 构建 CleaningPlan
    from risk import RiskEngine, RiskLevel

    engine = RiskEngine()
    plan = engine.evaluate(raw, file_path=pdf_path)
    # CLI 模式：强制所有 Action 为 AUTO（用户已确认执行）
    for action in plan.actions:
        action.risk_level = RiskLevel.AUTO

    # 3. 执行清理
    executor = CleaningExecutor()
    task = executor.execute(plan, file_path=pdf_path, document_type="PDF")

    # 4. 复制清理后的文件到用户指定位置
    src_dir = os.path.join(
        tempfile.gettempdir(), "cleaning_engine_output", task.task_id, "clean"
    )
    if os.path.isdir(src_dir):
        for fname in os.listdir(src_dir):
            src = os.path.join(src_dir, fname)
            if os.path.isfile(src):
                os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
                shutil.copy2(src, output_path)
                break

    file_name = Path(pdf_path).name
    report = {
        "taskId": task.task_id,
        "totalFiles": 1,
        "successCount": task.success_count,
        "failedCount": task.failed_count,
        "skippedCount": task.skipped_count,
        "files": [
            {
                "fileName": file_name,
                "status": "success" if task.status in ("COMPLETED", "PARTIAL_SUCCESS") else "failed",
                "error": task.error,
            }
        ],
        "completedAt": task.updated_time,
    }
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


# ─── 验证 ──────────────────────────────────────────────────────────────


def cmd_validate(original_path: str, cleaned_path: str) -> None:
    """验证清理结果。"""
    validator = PDFValidator()
    result = validator.validate(original_path, cleaned_path)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


# ─── 主入口 ────────────────────────────────────────────────────────────


def main() -> None:
    if len(sys.argv) < 3:
        print(
            "Usage:\n"
            f"  {sys.argv[0]} detect <pdf_path>\n"
            f"  {sys.argv[0]} clean <pdf_path> <output_path>\n"
            f"  {sys.argv[0]} validate <original_pdf> <cleaned_pdf>",
            file=sys.stderr,
        )
        sys.exit(1)

    command = sys.argv[1]
    try:
        if command == "detect":
            cmd_detect(sys.argv[2])
        elif command == "clean":
            if len(sys.argv) < 4:
                print("clean requires <pdf_path> <output_path>", file=sys.stderr)
                sys.exit(1)
            cmd_clean(sys.argv[2], sys.argv[3])
        elif command == "validate":
            if len(sys.argv) < 4:
                print("validate requires <orig> <cleaned>", file=sys.stderr)
                sys.exit(1)
            cmd_validate(sys.argv[2], sys.argv[3])
        else:
            print(f"Unknown command: {command}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        logger.exception("Command failed")
        json.dump({"error": str(e)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
