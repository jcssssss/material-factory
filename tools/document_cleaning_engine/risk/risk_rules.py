"""风险等级规则。

所有检测到的候选默认 CONFIRM（等待用户确认）。
仅有结构化安全对象（Annotation/Artifact）自动处理。
不依赖任何关键词或置信度阈值。
"""

from __future__ import annotations

from . import RiskLevel
from detector import DetectionResult


class RiskRules:
    """风险等级规则引擎。

    决策逻辑：
    - Annotation/Artifact → AUTO（结构化对象，100% 安全可删）
    - 所有其他检测候选 → CONFIRM（等待用户确认）
    - 未知类型 → IGNORE
    """

    def evaluate(self, detection: DetectionResult) -> RiskLevel:
        """评估单个检测结果的风险等级。

        Args:
            detection: 检测结果。

        Returns:
            风险等级（AUTO / CONFIRM / IGNORE）。
        """
        evaluator = self._get_evaluator(detection.type)
        return evaluator(detection)

    @staticmethod
    def _get_evaluator(det_type: str):
        """获取对应类型的评估函数。"""
        evaluators = {
            "annotation": _auto,
            "artifact": _auto,
            "image": _confirm,
            "text": _confirm,
            "header": _confirm,
            "footer": _confirm,
            "shape": _confirm,
            "drawing": _confirm,
        }
        return evaluators.get(det_type, _ignore)


def _auto(_detection: DetectionResult) -> RiskLevel:
    """结构化安全对象：自动处理。"""
    return RiskLevel.AUTO


def _confirm(_detection: DetectionResult) -> RiskLevel:
    """所有检测候选：等待用户确认。"""
    return RiskLevel.CONFIRM


def _ignore(_detection: DetectionResult) -> RiskLevel:
    """未知类型：忽略。"""
    return RiskLevel.IGNORE
