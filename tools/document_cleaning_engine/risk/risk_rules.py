"""风险等级规则。

定义各检测类型到风险等级（AUTO/CONFIRM/IGNORE）的映射规则。
"""

from __future__ import annotations

from . import RiskLevel
from detector import DetectionResult


class RiskRules:
    """风险等级规则引擎。

    根据检测结果的类型和置信度，判断对应的风险等级策略。
    """

    # 文本水印关键词列表（继承自 TextDetector）
    WATERMARK_KEYWORDS = [
        "机密", "内部资料", "Confidential", "Draft",
        "Sample", "版权所有", "Copyright", "禁止传播",
    ]

    def evaluate(self, detection: DetectionResult) -> RiskLevel:
        """评估单个检测结果的风险等级。

        Args:
            detection: 检测结果。

        Returns:
            风险等级（AUTO / CONFIRM / IGNORE）。
        """
        evaluator = self._get_evaluator(detection.type)
        return evaluator(detection)

    def _get_evaluator(self, det_type: str):
        """获取对应类型的评估函数。"""
        evaluators = {
            "annotation": self._evaluate_annotation,
            "artifact": self._evaluate_artifact,
            "image": self._evaluate_image,
            "text": self._evaluate_text,
            "header": self._evaluate_header_footer,
            "footer": self._evaluate_header_footer,
        }
        return evaluators.get(det_type, self._evaluate_unknown)

    @staticmethod
    def _evaluate_annotation(detection: DetectionResult) -> RiskLevel:
        """Annotation 风险规则。

        Annotation 属于结构化对象，始终 AUTO。
        """
        return RiskLevel.AUTO

    @staticmethod
    def _evaluate_artifact(detection: DetectionResult) -> RiskLevel:
        """Artifact Watermark 风险规则。

        Artifact 属于结构化对象，始终 AUTO。
        """
        return RiskLevel.AUTO

    @staticmethod
    def _evaluate_image(detection: DetectionResult) -> RiskLevel:
        """图片水印风险规则。

        confidence >= 0.8 → AUTO
        0.6 <= confidence < 0.8 → CONFIRM
        confidence < 0.6 → IGNORE
        """
        conf = detection.confidence
        if conf >= 0.8:
            return RiskLevel.AUTO
        elif conf >= 0.6:
            return RiskLevel.CONFIRM
        return RiskLevel.IGNORE

    def _evaluate_text(self, detection: DetectionResult) -> RiskLevel:
        """文本水印风险规则。

        AUTO 条件（必须同时满足）:
        - confidence >= 0.9
        - 命中关键词
        - 非正文区域（中央/斜向/边缘）
        - 独立文本块

        否则 → CONFIRM
        """
        conf = detection.confidence

        # 低置信度直接 CONFIRM（不 IGNORE，因为文本水印需要人工判断）
        if conf < 0.7:
            return RiskLevel.IGNORE

        # AUTO 需要满足所有条件
        if conf >= 0.9 and self._has_keyword(detection):
            return RiskLevel.AUTO

        return RiskLevel.CONFIRM

    @staticmethod
    def _evaluate_header_footer(detection: DetectionResult) -> RiskLevel:
        """页眉页脚风险规则。

        confidence >= 0.8 → CONFIRM（由用户决定）
        否则 → IGNORE
        """
        if detection.confidence >= 0.8:
            return RiskLevel.CONFIRM
        return RiskLevel.IGNORE

    @staticmethod
    def _evaluate_unknown(detection: DetectionResult) -> RiskLevel:
        """未知类型风险规则。"""
        return RiskLevel.IGNORE

    @classmethod
    def _has_keyword(cls, detection: DetectionResult) -> bool:
        """检查检测结果是否命中水印关键词。"""
        content = detection.content.lower()
        for keyword in cls.WATERMARK_KEYWORDS:
            if keyword.lower() in content:
                return True
        return False
