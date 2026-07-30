"""PlanGenerator — 清理计划生成器。

接收检测结果列表，经过风险评估、去重合并后生成标准化的 CleaningPlan。
所有候选默认 CONFIRM，用户通过 select_actions 选择要执行的操作。
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional, Set, Tuple

from detector import DetectionResult
from risk import (
    CleaningAction,
    CleaningPlan,
    RiskEngine,
    RiskLevel,
)

logger = logging.getLogger(__name__)


class PlanGenerator:
    """清理计划生成器。

    流程：
    1. 逐条检测结果通过 RiskEngine 评估
    2. 合并重复检测（相同 page + bbox + content 合并，提高置信度）
    3. 生成 CleaningPlan，所有操作默认 WAIT_CONFIRM
    4. 用户通过 select_actions 选择要执行的操作
    """

    def __init__(self) -> None:
        self._risk_engine = RiskEngine()

    def generate(
        self,
        detections: List[DetectionResult],
        file_path: str = "",
        document_type: str = "PDF",
    ) -> CleaningPlan:
        """生成清理计划。

        Args:
            detections: 检测结果列表，可来自多种检测器混合输出。
            file_path: 待清理文档的文件路径。
            document_type: 文档类型（PDF / WORD），默认 PDF。

        Returns:
            标准化的 CleaningPlan，所有操作默认 WAIT_CONFIRM。
        """
        if file_path and not isinstance(file_path, str):
            raise ValueError("file_path 必须是字符串")

        if document_type not in ("PDF", "WORD"):
            logger.warning("未知文档类型: %s，使用 PDF 作为默认值", document_type)
            document_type = "PDF"

        if not detections:
            logger.info("无检测结果，返回空计划: %s", file_path)
            return self._empty_plan(file_path, document_type)

        # Step 1: 通过 RiskEngine 评估
        plan = self._risk_engine.evaluate(detections, file_path=file_path)

        if not plan.actions:
            logger.info("评估后无有效操作: %s", file_path)
            return self._empty_plan(file_path, document_type)

        # Step 2: 合并重复检测
        merged_actions = self._merge_duplicates(plan.actions)

        if not merged_actions:
            logger.info("合并后无有效操作: %s", file_path)
            return self._empty_plan(file_path, document_type)

        # Step 3: 构建最终计划
        # 所有候选默认 WAIT_CONFIRM（AUTO 操作的保持 AUTO）
        has_confirm = any(a.risk_level == RiskLevel.CONFIRM for a in merged_actions)
        has_auto = any(a.risk_level == RiskLevel.AUTO for a in merged_actions)
        overall_risk = self._determine_overall_risk(merged_actions)

        final_plan = CleaningPlan(
            file_path=file_path,
            document_type=document_type,
            risk_level=overall_risk,
            actions=merged_actions,
            status="WAIT_CONFIRM" if (has_confirm or has_auto) else "DRAFT",
        )
        final_plan.update_summary()

        logger.info(
            "计划生成完成: file=%s, actions=%d, risk=%s",
            file_path,
            len(merged_actions),
            overall_risk.value,
        )
        return final_plan

    def select_actions(
        self,
        plan: CleaningPlan,
        selected_action_ids: List[str],
    ) -> CleaningPlan:
        """用户选择要执行的操作。

        将 selected_action_ids 中的操作保留（CONFIRM），
        其余操作标记为 IGNORE 并从计划中移除。

        Args:
            plan: 清理计划。
            selected_action_ids: 用户勾选的 action_id 列表。

        Returns:
            更新后的 CleaningPlan（只包含被选中的操作）。
        """
        selected_set = set(selected_action_ids)

        kept: List[CleaningAction] = []
        for action in plan.actions:
            if action.action_id in selected_set:
                # 保留，标记为 AUTO（用户已确认）
                action.risk_level = RiskLevel.AUTO
                kept.append(action)
            else:
                logger.debug("用户未选择: action_id=%s", action.action_id)

        plan.actions = kept
        plan.status = "CONFIRMED" if kept else "DRAFT"
        plan.update_summary()

        if kept:
            plan.risk_level = self._determine_overall_risk(kept)

        logger.info(
            "用户已确认: plan_id=%s, selected=%d/%d", plan.plan_id, len(kept),
            len(selected_set),
        )
        return plan

    def confirm_plan(self, plan: CleaningPlan) -> CleaningPlan:
        """确认整个计划（不筛选，全部执行）。

        Args:
            plan: 待确认的 CleaningPlan。

        Returns:
            状态更新后的 CleaningPlan。
        """
        if plan.status != "WAIT_CONFIRM":
            raise ValueError(
                f"只有 WAIT_CONFIRM 状态的计划可以确认，当前状态: {plan.status}"
            )

        plan.status = "CONFIRMED"
        logger.info("计划已确认: plan_id=%s", plan.plan_id)
        return plan

    # ── 内部方法 ──────────────────────────────────────────────────────

    @staticmethod
    def _empty_plan(file_path: str, document_type: str) -> CleaningPlan:
        """生成空计划（无操作）。"""
        plan = CleaningPlan(
            file_path=file_path,
            document_type=document_type,
            risk_level=RiskLevel.IGNORE,
            actions=[],
            status="DRAFT",
        )
        plan.update_summary()
        return plan

    @staticmethod
    def _merge_duplicates(
        actions: List[CleaningAction],
    ) -> List[CleaningAction]:
        """合并重复检测结果。

        合并策略：
        - 相同 page + bbox + content 视为重复
        - 合并时取最高置信度
        - 保留第一个出现的操作类型
        """
        if not actions:
            return []

        seen: Dict[Tuple, CleaningAction] = {}

        for action in actions:
            dedup_key = (
                action.page,
                action.target_type,
                action.bbox,
                action.content,
            )

            if dedup_key in seen:
                existing = seen[dedup_key]
                if action.confidence > existing.confidence:
                    existing.confidence = action.confidence
                    existing.risk_level = action.risk_level
                    existing.risk_score = max(existing.risk_score, action.risk_score)
                logger.debug("合并重复检测: key=%s", dedup_key)
            else:
                seen[dedup_key] = action

        return list(seen.values())

    @staticmethod
    def _determine_overall_risk(
        actions: List[CleaningAction],
    ) -> RiskLevel:
        """确定整体风险等级。"""
        for action in actions:
            if action.risk_level == RiskLevel.AUTO:
                return RiskLevel.AUTO
        for action in actions:
            if action.risk_level == RiskLevel.CONFIRM:
                return RiskLevel.CONFIRM
        return RiskLevel.IGNORE
