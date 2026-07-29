"""Artifact Watermark 清理器。

删除 PDF Content Stream 中的 /Artifact /Subtype /Watermark 标记内容。
仅处理 Watermark 类型的 Artifact，不涉及 Header/Footer/Pagination。
"""

from __future__ import annotations

import logging
import re

import fitz

from risk import CleaningAction

from . import CleaningResult, CleaningStatus

logger = logging.getLogger(__name__)


class ArtifactCleaner:
    """Artifact Watermark 清理器。

    通过修改页面 Content Stream 移除 /Artifact 标记块。
    不修改页面的主体内容或结构。
    """

    # 匹配 /Artifact ... BDC ... EMC 块的正则
    _ARTIFACT_BLOCK = re.compile(
        rb"/Artifact\s*([^B]*(?:BDC|bdc)).*?EMC",
        re.DOTALL,
    )
    # 仅匹配 Watermark 子类型的 Artifact
    _WATERMARK_ARTIFACT = re.compile(
        rb"/Artifact\s*<</Subtype\s*/Watermark.*?>>\s*BDC.*?EMC",
        re.DOTALL,
    )

    def clean(self, doc: fitz.Document, action: CleaningAction) -> CleaningResult:
        """删除指定页面上的 Artifact Watermark。

        Args:
            doc: fitz 文档对象（可写打开）。
            action: 清理操作（须为 REMOVE_ARTIFACT）。

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

        # 获取内容流
        try:
            raw = page.read_contents()
        except Exception as e:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"failed to read content stream: {e}",
                fallback_action="manual_review",
            )

        if not raw:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="no content stream found",
                fallback_action="manual_review",
            )

        # 检查是否存在 Watermark Artifact
        if not self._WATERMARK_ARTIFACT.search(raw):
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="Watermark Artifact not found",
                fallback_action="manual_review",
            )

        # 移除所有 Watermark Artifact 块
        new_content, count = self._WATERMARK_ARTIFACT.subn(b"", raw)

        if count == 0:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="Watermark Artifact not found",
                fallback_action="manual_review",
            )

        # 更新内容流
        try:
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
            metadata={"removed_count": count},
        )

    @staticmethod
    def _update_content_stream(page: fitz.Page, new_content: bytes) -> None:
        """更新页面内容流。

        用新内容替换页面的所有内容流。
        """
        xrefs = page.get_contents()
        if not xrefs:
            raise RuntimeError("no content stream xref found")

        # 用第一个内容流的 xref 更新全部内容
        # 删除其余内容流引用
        first_xref = xrefs[0]
        page.parent.update_stream(first_xref, new_content)

        # 如果有多个内容流，删除多余的
        for xref in xrefs[1:]:
            try:
                page.parent.update_stream(xref, b"")
            except Exception:
                pass
