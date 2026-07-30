"""页眉页脚清理器。

通过操作 PDF Content Stream 删除页眉/页脚文本绘制指令。
复用 ContentStreamParser 实现底层解析，策略与 TextWatermarkCleaner 一致。
"""

from __future__ import annotations

import logging
from typing import Optional, Tuple

import fitz

from risk import CleaningAction

from . import CleaningResult, CleaningStatus
from .content_stream_parser import ContentStreamParser
from .text_matcher import TextMatcher

logger = logging.getLogger(__name__)


class HeaderFooterCleaner:
    """页眉页脚清理器。

    删除位于页面顶部/底部固定区域的文本绘制指令。
    仅在能够精准定位指令时执行删除。
    """

    def __init__(self) -> None:
        self._parser = ContentStreamParser()
        self._matcher = TextMatcher()

    def clean(self, doc: fitz.Document, action: CleaningAction) -> CleaningResult:
        """删除指定页面上的页眉/页脚文本。

        Args:
            doc: fitz 文档对象（可写打开）。
            action: 清理操作（须为 REMOVE_HEADER 或 REMOVE_FOOTER）。

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
        page_height = page.rect.height

        # Form XObject 保护
        if self._matcher.has_form_xobject(page):
            return CleaningResult(
                action=action,
                status=CleaningStatus.SKIPPED,
                error="page contains Form XObject",
                fallback_action="skip",
                metadata={"reason": "FORM_XOBJECT_HEADER_FOOTER"},
            )

        # 获取目标 origin
        origin = self._get_origin(action)
        if not origin:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="no target position in action",
                fallback_action="manual_review",
            )

        content = action.content

        # 定位 Content Stream 指令
        target_tm = self._matcher.find_target_tm_by_bbox(
            page, origin, page_height, content
        )
        if not target_tm:
            target_tm = self._matcher.find_target_tm(page, origin, page_height)
        if not target_tm:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="text instruction not found in content stream",
                fallback_action="manual_review",
            )

        # 执行删除
        raw_content = page.read_contents()
        if not raw_content:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="empty content stream",
                fallback_action="manual_review",
            )

        ops = self._parser.parse(raw_content)
        removed = self._parser.remove_text_op(ops, target_tm)

        if removed == 0:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="text instruction not found",
                fallback_action="manual_review",
            )

        try:
            new_content = self._parser.serialize(ops)
            self._update_content_stream(page, new_content)
        except Exception as e:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"failed to update content stream: {e}",
                fallback_action="retry",
            )

        return CleaningResult(
            action=action,
            status=CleaningStatus.SUCCESS,
            metadata={"removed_ops": removed},
        )

    @staticmethod
    def _get_origin(action: CleaningAction) -> Optional[Tuple[float, float]]:
        """从 Action 中提取 origin。"""
        origin = action.metadata.get("origin")
        if origin and isinstance(origin, (list, tuple)) and len(origin) >= 2:
            return (float(origin[0]), float(origin[1]))
        if action.bbox:
            x0, y0, x1, y1 = action.bbox
            return ((x0 + x1) / 2, (y0 + y1) / 2)
        return None

    @staticmethod
    def _update_content_stream(page: fitz.Page, new_content: bytes) -> None:
        """更新页面内容流。"""
        xrefs = page.get_contents()
        if not xrefs:
            raise RuntimeError("no content stream xref found")
        page.parent.update_stream(xrefs[0], new_content)
        for xref in xrefs[1:]:
            try:
                page.parent.update_stream(xref, b"")
            except Exception:
                pass
