"""Annotation 清理器。

使用 PyMuPDF 删除 PDF Annotation 对象。
通过 page.delete_annot() 安全删除，不修改页面内容流。
"""

from __future__ import annotations

import logging
from typing import List, Optional, Tuple

import fitz

from risk import CleaningAction

from . import CleaningResult, CleaningStatus

logger = logging.getLogger(__name__)


class AnnotationCleaner:
    """Annotation 清理器。

    根据页码和 bbox 匹配目标 Annotation 并删除。
    仅删除 /Annots 中的引用，不影响正文内容。
    """

    BBOX_TOLERANCE = 5.0

    def clean(self, doc: fitz.Document, action: CleaningAction) -> CleaningResult:
        """删除指定页面上的 Annotation。

        Args:
            doc: fitz 文档对象（可写打开）。
            action: 清理操作（须为 REMOVE_ANNOTATION）。

        Returns:
            清理执行结果。
        """
        page_index = action.page - 1
        if page_index < 0 or page_index >= len(doc):
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"page {action.page} out of range",
                fallback_action="manual_review",
            )

        page = doc[page_index]
        annots = page.annots()
        if not annots:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="annotation target not found",
                fallback_action="manual_review",
            )

        annot_list = list(annots)
        target_bbox = action.bbox
        target_type = action.metadata.get("annot_type", "")

        # 查找匹配的 Annotation
        matched = self._find_matching(annot_list, target_bbox, target_type)

        if not matched:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="annotation target not found",
                fallback_action="manual_review",
            )

        # 执行删除
        removed_count = 0
        for annot in matched:
            try:
                page.delete_annot(annot)
                removed_count += 1
            except Exception as e:
                logger.warning("Failed to delete annotation: %s", e)

        return CleaningResult(
            action=action,
            status=CleaningStatus.SUCCESS,
            metadata={"removed_count": removed_count},
        )

    def _find_matching(
        self,
        annot_list: List,
        target_bbox: Optional[Tuple[float, float, float, float]],
        target_type: str,
    ) -> list:
        """按 bbox 和类型匹配 Annotation。"""
        matched = []

        for annot in annot_list:
            # 类型匹配
            if target_type:
                annot_type = annot.type
                at = str(annot_type[0]) if isinstance(annot_type, tuple) else str(annot_type)
                if not at or target_type.lower() not in at.lower():
                    continue

            # bbox 匹配
            if target_bbox:
                rect = annot.rect
                if not self._bbox_match(rect, target_bbox):
                    continue

            matched.append(annot)

        return matched

    @staticmethod
    def _bbox_match(rect: fitz.Rect, target: Tuple[float, float, float, float]) -> bool:
        """比较 bbox 是否匹配（含容忍度）。"""
        r_cx = (rect.x0 + rect.x1) / 2
        r_cy = (rect.y0 + rect.y1) / 2
        t_cx = (target[0] + target[2]) / 2
        t_cy = (target[1] + target[3]) / 2

        dx = abs(r_cx - t_cx)
        dy = abs(r_cy - t_cy)

        return dx <= AnnotationCleaner.BBOX_TOLERANCE and dy <= AnnotationCleaner.BBOX_TOLERANCE
