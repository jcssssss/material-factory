"""CleaningPlan 数据模型。

一个完整的清理计划，包含针对单个文档的所有清理操作、
风险摘要、状态管理等。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List

from .cleaning_action import CleaningAction


@dataclass
class CleaningPlan:
    """清理计划。

    包含对所有检测结果的风险评估和操作列表。
    支持状态流转：DRAFT → WAIT_CONFIRM → CONFIRMED → EXECUTING → COMPLETED/FAILED。
    """

    plan_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    """计划唯一标识（UUID）。"""

    file_path: str = ""
    """文档文件路径。"""

    document_type: str = "PDF"
    """文档类型：PDF / WORD。"""

    created_time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    """计划创建时间（ISO 8601 格式）。"""

    actions: List[CleaningAction] = field(default_factory=list)
    """清理操作列表。"""

    summary: Dict[str, object] = field(default_factory=dict)
    """摘要信息。

    自动计算，包含：
    - total_detected: 检测总数
    - auto_count: 自动处理数
    - confirm_count: 待确认数
    - ignore_count: 忽略数
    """

    risk_level: str = "IGNORE"
    """整体风险等级（取所有 Action 中的最高等级）。"""

    status: str = "DRAFT"
    """计划状态。

    状态流转：
    DRAFT         — 初始状态
    WAIT_CONFIRM  — 等待用户确认（有 CONFIRM 等级操作时）
    CONFIRMED     — 用户已确认
    EXECUTING     — 正在执行清理
    COMPLETED     — 清理完成
    FAILED        — 清理失败
    """

    def has_confirm_actions(self) -> bool:
        """检查是否有等待确认的操作。"""
        return any(a.risk_level == "CONFIRM" for a in self.actions)

    def has_auto_actions(self) -> bool:
        """检查是否有自动执行的操作。"""
        return any(a.risk_level == "AUTO" for a in self.actions)

    @property
    def action_count(self) -> int:
        """操作总数。"""
        return len(self.actions)

    def update_summary(self) -> None:
        """重新计算并更新摘要信息。"""
        auto_count = sum(1 for a in self.actions if a.risk_level == "AUTO")
        confirm_count = sum(1 for a in self.actions if a.risk_level == "CONFIRM")
        ignore_count = sum(1 for a in self.actions if a.risk_level == "IGNORE")

        self.summary = {
            "total_detected": len(self.actions),
            "auto_count": auto_count,
            "confirm_count": confirm_count,
            "ignore_count": ignore_count,
            "file_path": self.file_path,
            "document_type": self.document_type,
        }
