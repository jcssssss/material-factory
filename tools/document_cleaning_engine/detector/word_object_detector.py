"""Word 非文本对象检测器主入口。

协调 ShapeDetector 和 DrawingDetector，输出统一 DetectionResult。
"""

from __future__ import annotations

from typing import List

from detector import DetectionResult
from models.word_object import WordObject

from .shape_detector import ShapeDetector
from .drawing_detector import DrawingDetector


class WordObjectDetector:
    """Word 非文本对象检测器。

    集成 Shape 和 DrawingML 检测，输出标准 DetectionResult。
    """

    CONFIDENCE_THRESHOLD = 0.6

    def __init__(self) -> None:
        self._shape_detector = ShapeDetector()
        self._drawing_detector = DrawingDetector()

    def detect(self, docx_path: str) -> List[DetectionResult]:
        """检测 DOCX 中的非文本水印对象。

        Args:
            docx_path: DOCX 文件路径。

        Returns:
            检测结果列表。
        """
        results: List[DetectionResult] = []

        # Shape 检测
        shapes = self._shape_detector.detect(docx_path)
        for obj in shapes:
            if obj.confidence >= self.CONFIDENCE_THRESHOLD:
                results.append(self._to_detection_result(obj))

        # DrawingML 检测
        drawings = self._drawing_detector.detect(docx_path)
        for obj in drawings:
            if obj.confidence >= self.CONFIDENCE_THRESHOLD:
                results.append(self._to_detection_result(obj))

        return results

    @staticmethod
    def _to_detection_result(obj: WordObject) -> DetectionResult:
        """将 WordObject 转换为 DetectionResult。"""
        metadata = dict(obj.metadata)
        metadata["object_type"] = obj.object_type
        metadata["xml_file"] = obj.xml_file
        if obj.relation_id:
            metadata["relation_id"] = obj.relation_id

        return DetectionResult(
            type="word_object",
            page=0,
            bbox=obj.bbox,
            content=obj.content or "",
            confidence=obj.confidence,
            metadata=metadata,
        )
