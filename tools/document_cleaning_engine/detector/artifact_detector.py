"""Artifact 水印检测模块。

检测 PDF Content Stream 中的 Artifact 标记，
仅识别 /Subtype /Watermark 类型的 Artifact 对象。
"""

from __future__ import annotations

import re
from typing import List

import fitz

from . import DetectionResult


class ArtifactDetector:
    """Artifact 检测器。

    读取页面 Content Stream，检测 /Artifact 标记及其子类型。
    仅关注 /Subtype /Watermark 的水印 Artifact。
    """

    # 匹配 /Artifact 后跟随 /Subtype /Watermark 的模式
    # PDF Artifact 标记格式: /Artifact <</Subtype /Watermark>> BDC ... EMC
    _WATERMARK_PATTERN = re.compile(
        rb"/Artifact\b[^B]*/Watermark\b"
    )

    def detect(self, doc: fitz.Document) -> List[DetectionResult]:
        """检测 PDF 中的 Watermark Artifact。

        Args:
            doc: fitz 文档对象。

        Returns:
            检测结果列表。
        """
        results: List[DetectionResult] = []

        for page_num in range(len(doc)):
            page = doc[page_num]

            try:
                raw_content = page.read_contents()
            except Exception:
                continue

            if not raw_content:
                continue

            if self._WATERMARK_PATTERN.search(raw_content):
                results.append(
                    DetectionResult(
                        type="artifact",
                        page=page_num + 1,
                        confidence=1.0,
                        content="Watermark Artifact",
                        metadata={
                            "artifact_type": "Watermark",
                        },
                    )
                )

        return results
