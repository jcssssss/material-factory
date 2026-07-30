"""WatermarkRechecker — 水印复检模块。

在清理执行后重新检测文件，确认计划删除的目标水印是否已被清除。
"""

from __future__ import annotations

import logging
from typing import Dict, List

from detector import DetectionResult, PDFDetector
from detector.word_detector import WordDetector
from risk import CleaningAction

logger = logging.getLogger(__name__)


class WatermarkRechecker:
    """水印复检器。

    对清理后的文件运行检测器，检查计划删除的目标是否仍然存在。
    支持 PDF 和 Word 两种文档类型。
    """

    def __init__(self) -> None:
        self._pdf_detector = PDFDetector()
        self._word_detector = WordDetector()

    def check(
        self,
        cleaned_file: str,
        targets: List[CleaningAction],
        ext: str = ".pdf",
    ) -> Dict[str, object]:
        """复检清理后的文件。

        对清理后的文件运行检测器，将检测结果与 Plan 目标对比。

        Args:
            cleaned_file: 清理后文件路径。
            targets: 计划删除的目标（CleaningAction 列表）。
            ext: 文件扩展名，用于选择检测器。

        Returns:
            复检结果。
        """
        # 如果没有需要检测的目标，直接返回成功
        if not targets:
            return {
                "remaining": 0,
                "details": [],
            }

        # 运行检测器
        if ext == ".pdf":
            new_detections = self._pdf_detector.detect(cleaned_file)
        elif ext == ".docx":
            new_detections = self._word_detector.detect(cleaned_file)
        else:
            return {
                "remaining": 0,
                "details": [{"error": f"unsupported type: {ext}"}],
            }

        # 对比目标与检测结果
        remaining = self._find_remaining(targets, new_detections)

        details: List[Dict[str, object]] = []
        for action, dets in remaining:
            details.append({
                "action_id": action.action_id,
                "action_type": action.action_type,
                "target_ref": action.target_ref,
                "remaining_detections": len(dets),
            })

        return {
            "remaining": len(details),
            "details": details,
        }

    @staticmethod
    def _find_remaining(
        targets: List[CleaningAction],
        new_detections: List[DetectionResult],
    ) -> List[tuple]:
        """找出清理后仍然存在的目标。

        匹配策略：
        - 删除 text 类型的匹配 content
        - 删除 image 类型的用 Plan 中的信息做最佳匹配
        - 删除 annotation/artifact/shape/drawing 的匹配 target_ref

        Args:
            targets: 计划删除的目标。
            new_detections: 清理后的检测结果。

        Returns:
            仍存在的目标列表 [(action, matching_detections)]。
        """
        remaining: List[tuple] = []

        if not new_detections:
            return remaining

        for action in targets:
            matching = []

            for det in new_detections:
                # 按类型过滤
                if action.target_type != det.type:
                    continue

                # 按 target_ref 或 content 匹配
                if action.target_ref:
                    det_ref = det.metadata.get("target_ref", "")
                    if str(det_ref) == str(action.target_ref):
                        matching.append(det)
                elif action.content and action.content == det.content:
                    matching.append(det)
                else:
                    # 没有精确匹配条件，按类型算
                    matching.append(det)

            if matching:
                remaining.append((action, matching))

        return remaining
