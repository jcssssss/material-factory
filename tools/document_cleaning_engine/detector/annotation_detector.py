"""Annotation 检测模块。

检测 PDF 中的 Annotation 对象（批注、高亮、水印注释等）。
Annotation 属于结构化对象，检测置信度固定为 1.0。
"""

from __future__ import annotations

from typing import List

import fitz

from . import DetectionResult


class AnnotationDetector:
    """Annotation 检测器。

    遍历页面，识别所有 Annotation 对象并输出检测结果。
    """

    def detect(self, doc: fitz.Document) -> List[DetectionResult]:
        """检测 PDF 中的所有 Annotation。

        Args:
            doc: fitz 文档对象。

        Returns:
            检测结果列表。
        """
        results: List[DetectionResult] = []

        for page_num in range(len(doc)):
            page = doc[page_num]
            annots = page.annots()
            if not annots:
                continue

            for annot in annots:
                annot_type = annot.type[0] if isinstance(annot.type, tuple) else str(annot.type)
                info = annot.info or {}
                content = info.get("content", "") or ""
                title = info.get("title", "") or ""

                results.append(
                    DetectionResult(
                        type="annotation",
                        page=page_num + 1,
                        bbox=tuple(annot.rect) if annot.rect else None,  # type: ignore[arg-type]
                        content=content or title or str(annot_type),
                        confidence=1.0,
                        metadata={
                            "annot_type": str(annot_type),
                            "title": title,
                        },
                    )
                )

        return results
