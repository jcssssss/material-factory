"""Risk Engine 主入口。

接收 DetectionResult 列表，评估风险并生成 CleaningPlan。
"""

from __future__ import annotations

import logging
from typing import List

from detector import DetectionResult

from . import (
    ACTION_TYPE_MAP,
    ActionType,
    CleaningAction,
    CleaningPlan,
    RiskLevel,
)
from .risk_rules import RiskRules
from .scoring import RiskScorer

logger = logging.getLogger(__name__)


class RiskEngine:
    """风险引擎。

    对检测结果进行风险评估，生成标准化的清理计划。
    """

    def __init__(self) -> None:
        self._rules = RiskRules()
        self._scorer = RiskScorer()

    def evaluate(
        self,
        detections: List[DetectionResult],
        file_path: str = "",
    ) -> CleaningPlan:
        """评估检测结果并生成清理计划。

        流程：
        1. 逐条检测结果进行风险评分
        2. 根据规则确定风险等级
        3. 生成 CleaningAction
        4. 汇总为 CleaningPlan

        Args:
            detections: 检测结果列表。
            file_path: 可选，PDF 文件路径。

        Returns:
            清理计划。
        """
        if not detections:
            return CleaningPlan(
                file_path=file_path,
                risk_level=RiskLevel.IGNORE,
                actions=[],
            )

        actions: List[CleaningAction] = []

        for detection in detections:
            action = self._create_action(detection)
            actions.append(action)

        # 整体风险等级取最高等级
        overall_risk = self._determine_overall_risk(actions)

        return CleaningPlan(
            file_path=file_path,
            risk_level=overall_risk,
            actions=actions,
        )

    def _create_action(self, detection: DetectionResult) -> CleaningAction:
        """将单个检测结果转换为清理操作。

        1. 计算风险评分
        2. 确定风险等级
        3. 映射操作类型
        4. 构建 CleaningAction
        """
        risk_score = self._scorer.score(detection)
        risk_level = self._rules.evaluate(detection)
        action_type = ACTION_TYPE_MAP.get(
            detection.type, ActionType.REMOVE_TEXT
        )

        return CleaningAction(
            action_type=action_type.value,
            page=detection.page,
            target_type=detection.type,
            confidence=detection.confidence,
            risk_level=risk_level,
            risk_score=round(risk_score, 1),
            content=detection.content,
            bbox=detection.bbox,
            metadata=dict(detection.metadata),
        )

    @staticmethod
    def _determine_overall_risk(
        actions: List[CleaningAction],
    ) -> RiskLevel:
        """确定整体风险等级。

        优先级：AUTO > CONFIRM > IGNORE
        只要有一条 AUTO，整体就是 AUTO。
        """
        for action in actions:
            if action.risk_level == RiskLevel.AUTO:
                return RiskLevel.AUTO

        for action in actions:
            if action.risk_level == RiskLevel.CONFIRM:
                return RiskLevel.CONFIRM

        return RiskLevel.IGNORE
