"""文本匹配器。

将检测到的文本水印（DetectionResult）映射到 Content Stream 指令。
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import fitz

from .content_stream_parser import (
    ContentStreamParser,
    PDFOperator,
    TextBlockInstruction,
    _parse_tm,
)


class TextMatcher:
    """文本匹配器。

    根据检测结果的 origin/bbox 定位 Content Stream 中的绘制指令。
    支持坐标转换（PyMuPDF 左上原点 → PDF 左下原点）。
    """

    # 坐标匹配容忍度
    POSITION_TOLERANCE = 3.0

    def __init__(self) -> None:
        self._parser = ContentStreamParser()

    def find_target_tm(
        self,
        page: fitz.Page,
        target_origin: Tuple[float, float],
        page_height: float,
    ) -> Optional[Tuple[float, float, float, float, float, float]]:
        """查找与目标 origin 匹配的 Tm 矩阵。

        Args:
            page: PyMuPDF 页面对象。
            target_origin: 目标 origin (x, y)，PyMuPDF 坐标。
            page_height: 页面高度。

        Returns:
            匹配的 Tm 矩阵 (a, b, c, d, e, f)，None 表示未找到。
        """
        content = page.read_contents()
        if not content:
            return None

        ops = self._parser.parse(content)
        blocks = self._parser.find_text_blocks(ops)

        # 将 PyMuPDF origin 转换为 PDF 坐标
        pdf_x = target_origin[0]
        pdf_y = page_height - target_origin[1]

        best_match = None
        best_dist = float("inf")

        for block in blocks:
            block_origin = block.origin
            if block_origin is None:
                continue

            bx, by = block_origin
            dist = ((bx - pdf_x) ** 2 + (by - pdf_y) ** 2) ** 0.5

            if dist < self.POSITION_TOLERANCE and dist < best_dist:
                best_dist = dist
                best_match = block.tm

        return best_match

    def find_target_tm_by_bbox(
        self,
        page: fitz.Page,
        target_origin: Tuple[float, float],
        page_height: float,
        text: str,
    ) -> Optional[Tuple[float, float, float, float, float, float]]:
        """通过 origin + 文本内容联合匹配 Tm。

        Args:
            page: PyMuPDF 页面对象。
            target_origin: 目标 origin。
            page_height: 页面高度。
            text: 目标文本内容。

        Returns:
            匹配的 Tm 矩阵。
        """
        content = page.read_contents()
        if not content:
            return None

        ops = self._parser.parse(content)
        blocks = self._parser.find_text_blocks(ops)

        pdf_x = target_origin[0]
        pdf_y = page_height - target_origin[1]

        for block in blocks:
            block_origin = block.origin
            if block_origin is None:
                continue

            bx, by = block_origin
            dist = ((bx - pdf_x) ** 2 + (by - pdf_y) ** 2) ** 0.5

            if dist < self.POSITION_TOLERANCE:
                block_text = block.extract_text()
                # 检查文本内容是否匹配
                if text and text in block_text:
                    return block.tm
                # 无文本要求时返回第一个匹配位置的
                if not text:
                    return block.tm

        return None

    @staticmethod
    def has_form_xobject(page: fitz.Page) -> bool:
        """检查页面是否包含 Form XObject。"""
        xobjects = page.get_xobjects()
        for _, name in xobjects:
            if name:
                return True
        return False

    @staticmethod
    def remove_text_ops(
        ops: List[PDFOperator],
        target_tm: Tuple[float, float, float, float, float, float],
    ) -> int:
        """从操作符列表中移除匹配目标 Tm 的文本操作。

        Args:
            ops: 操作符列表。
            target_tm: 目标 Tm 矩阵。

        Returns:
            移除的操作数。
        """
        return ContentStreamParser.remove_text_op(ops, target_tm)
