"""Word 检测器基础框架。

提供 Word 文档元素检测的基础接口。
后续 Task-010（文字水印）、Task-011（Shape/Drawing）在此基础上扩展。
"""

from __future__ import annotations

from typing import List

from detector import DetectionResult
from analyzer.word_analyzer import WordAnalyzer


class WordDetector:
    """Word 检测器。

    V1 负责基础文档扫描，输出文档结构信息。
    具体水印检测由后续任务扩展。
    """

    def __init__(self) -> None:
        self._analyzer = WordAnalyzer()

    def detect(self, docx_path: str) -> List[DetectionResult]:
        """扫描 Word 文档，输出基础检测结果。

        Args:
            docx_path: DOCX 文件路径。

        Returns:
            检测结果列表（V1 返回基础扫描信息）。
        """
        doc_info = self._analyzer.analyze(docx_path)

        if doc_info.metadata.get("error"):
            return []

        results: List[DetectionResult] = []

        # 报告文档基本信息
        sections = doc_info.metadata.get("sections", [])

        for section in sections:
            # Header 内容
            for header_text in section.get("header_texts", []):
                results.append(
                    DetectionResult(
                        type="header",
                        page=section["index"] + 1,
                        confidence=0.5,
                        content=header_text,
                        metadata={
                            "element_type": "header",
                            "section": section["index"],
                            "source": "word",
                        },
                    )
                )

            # Footer 内容
            for footer_text in section.get("footer_texts", []):
                results.append(
                    DetectionResult(
                        type="footer",
                        page=section["index"] + 1,
                        confidence=0.5,
                        content=footer_text,
                        metadata={
                            "element_type": "footer",
                            "section": section["index"],
                            "source": "word",
                        },
                    )
                )

        # 报告 Shape/Drawing 存在
        if doc_info.has_shapes:
            results.append(
                DetectionResult(
                    type="word_element",
                    page=0,
                    confidence=0.3,
                    content="VML Shape detected",
                    metadata={
                        "element_type": "shape",
                        "source": "word",
                    },
                )
            )

        if doc_info.has_drawing:
            results.append(
                DetectionResult(
                    type="word_element",
                    page=0,
                    confidence=0.3,
                    content="DrawingML detected",
                    metadata={
                        "element_type": "drawing",
                        "source": "word",
                    },
                )
            )

        return results
