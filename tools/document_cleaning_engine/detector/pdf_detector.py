"""PDF 检测器主入口。

统一协调所有子检测器，对 PDF 进行全方位检测。
输出标准化的 DetectionResult 列表供 Risk Engine 使用。
"""

from __future__ import annotations

import logging
from typing import List

import fitz

from . import DetectionResult
from .annotation_detector import AnnotationDetector
from .artifact_detector import ArtifactDetector
from .header_footer_detector import HeaderFooterDetector
from .image_detector import ImageDetector
from .text_detector import TextDetector

logger = logging.getLogger(__name__)


class PDFDetector:
    """PDF 检测器。

    集成所有子检测器并对 PDF 进行全方位扫描。
    返回合并后的非主体元素检测结果列表。
    """

    def __init__(self) -> None:
        self._annotation_detector = AnnotationDetector()
        self._artifact_detector = ArtifactDetector()
        self._image_detector = ImageDetector()
        self._text_detector = TextDetector()
        self._header_footer_detector = HeaderFooterDetector()

    def detect(self, pdf_path: str) -> List[DetectionResult]:
        """对指定 PDF 进行全方位检测。

        内部依次调用各子检测器，汇总所有检测结果。

        Args:
            pdf_path: PDF 文件路径。

        Returns:
            所有子检测器合并后的检测结果列表。
        """
        results: List[DetectionResult] = []

        try:
            doc = fitz.open(pdf_path)
        except Exception as e:
            logger.error("无法打开 PDF 进行检测: %s, 错误: %s", pdf_path, e)
            return results

        try:
            # 检测加密 PDF — 加密文档不进行内容检测
            if doc.is_encrypted:
                logger.info("PDF 已加密，跳过检测: %s", pdf_path)
                return results

            # 依次运行各子检测器
            logger.info("开始 Annotation 检测...")
            results.extend(self._annotation_detector.detect(doc))

            logger.info("开始 Artifact 检测...")
            results.extend(self._artifact_detector.detect(doc))

            logger.info("开始图片水印检测...")
            results.extend(self._image_detector.detect(doc))

            logger.info("开始文本水印检测...")
            results.extend(self._text_detector.detect(doc))

            logger.info("开始页眉页脚检测...")
            results.extend(self._header_footer_detector.detect(doc))

            logger.info(
                "检测完成: %s, 共发现 %d 个候选元素",
                pdf_path,
                len(results),
            )
        finally:
            doc.close()

        return results
