"""Section 分析器。

遍历 Word 文档的 Section 结构，提取 Header/Footer 信息。
"""

from __future__ import annotations

from typing import Any, Dict, List

from docx import Document


class SectionAnalyzer:
    """Section 分析器。

    分析文档中的 Section 结构，包括 Header/Footer 存在性、
    奇偶页不同、首页不同等属性。
    """

    def analyze(self, document: Document) -> List[Dict[str, Any]]:
        """分析所有 Section。

        Args:
            document: python-docx Document 对象。

        Returns:
            Section 信息列表。
        """
        sections = []
        for i, section in enumerate(document.sections):
            info = {
                "section_index": i,
                "header_exists": self._has_content(section.header),
                "footer_exists": self._has_content(section.footer),
                "different_first_page": section.different_first_page_header_footer,
                "page_width": section.page_width,
                "page_height": section.page_height,
                "header_paragraphs": self._get_paragraphs(section.header),
                "footer_paragraphs": self._get_paragraphs(section.footer),
            }
            sections.append(info)
        return sections

    @staticmethod
    def _has_content(header_footer) -> bool:
        """检查 Header/Footer 是否包含内容。"""
        for paragraph in header_footer.paragraphs:
            if paragraph.text.strip():
                return True
        return False

    @staticmethod
    def _get_paragraphs(header_footer) -> List[str]:
        """提取 Header/Footer 中的文本内容。"""
        texts = []
        for paragraph in header_footer.paragraphs:
            text = paragraph.text.strip()
            if text:
                texts.append(text)
        return texts
