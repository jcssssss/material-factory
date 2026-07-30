"""Plan Module.

提供 CleaningPlan 的生成能力。
包含 PlanGenerator 对检测结果进行汇总、去重、风险过滤后生成标准清理计划。
"""

from __future__ import annotations

from .plan_generator import PlanGenerator

__all__ = ["PlanGenerator"]
