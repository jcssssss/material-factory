"""Dry-run 报告生成器。

将 CleaningPlan 输出为人类可读的 JSON 格式报告，
供用户在执行清理前预览。
"""

from __future__ import annotations

import json
from typing import Dict, List

from risk import CleaningPlan, RiskLevel


class DryRunReport:
    """Dry-run 报告生成器。

    输入 CleaningPlan，生成包含摘要和详情列表的 JSON 报告。
    """

    def generate(self, plan: CleaningPlan) -> str:
        """生成 Dry-run 报告（JSON 格式）。

        Args:
            plan: 清理计划。

        Returns:
            JSON 格式的 Dry-run 报告字符串。
        """
        summary = self._build_summary(plan)
        actions = self._build_actions(plan)

        report = {
            "file": plan.file_path,
            "summary": summary,
            "actions": actions,
        }

        return json.dumps(report, ensure_ascii=False, indent=2)

    def _build_summary(self, plan: CleaningPlan) -> Dict[str, object]:
        """构建报告摘要。"""
        auto_count = 0
        confirm_count = 0
        ignore_count = 0

        for action in plan.actions:
            if action.risk_level == RiskLevel.AUTO:
                auto_count += 1
            elif action.risk_level == RiskLevel.CONFIRM:
                confirm_count += 1
            else:
                ignore_count += 1

        return {
            "total_detected": len(plan.actions),
            "auto_remove": auto_count,
            "confirm": confirm_count,
            "ignore": ignore_count,
            "overall_risk": plan.risk_level.value,
        }

    def _build_actions(self, plan: CleaningPlan) -> List[Dict[str, object]]:
        """构建操作详情列表。"""
        action_list: List[Dict[str, object]] = []

        for action in plan.actions:
            action_list.append({
                "type": action.target_type,
                "action": action.action_type,
                "page": action.page,
                "confidence": action.confidence,
                "risk_score": action.risk_score,
                "decision": action.risk_level.value,
                "content": action.content,
                "bbox": list(action.bbox) if action.bbox else None,
            })

        return action_list
