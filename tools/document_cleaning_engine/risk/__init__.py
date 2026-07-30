"""Risk Engine Module.

提供检测结果的风险评估与清理计划生成能力。
将 DetectionResult 转换为带风险等级的 CleaningPlan。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Tuple

from detector import DetectionResult


class RiskLevel(str, Enum):
    """风险等级策略。

    AUTO   — 自动执行删除（高置信度）
    CONFIRM — 生成计划，等待用户确认
    IGNORE  — 保留，不处理
    """

    AUTO = "AUTO"
    CONFIRM = "CONFIRM"
    IGNORE = "IGNORE"


class ActionType(str, Enum):
    """清理操作类型映射。

    新增检测类型需在此处添加对应的操作类型。
    """

    REMOVE_ANNOTATION = "REMOVE_ANNOTATION"
    REMOVE_ARTIFACT = "REMOVE_ARTIFACT"
    REMOVE_IMAGE = "REMOVE_IMAGE"
    REMOVE_TEXT = "REMOVE_TEXT"
    REMOVE_HEADER = "REMOVE_HEADER"
    REMOVE_FOOTER = "REMOVE_FOOTER"
    REMOVE_SHAPE = "REMOVE_SHAPE"
    REMOVE_DRAWING = "REMOVE_DRAWING"


# Detection 类型到 Action 类型的映射
ACTION_TYPE_MAP: Dict[str, ActionType] = {
    "annotation": ActionType.REMOVE_ANNOTATION,
    "artifact": ActionType.REMOVE_ARTIFACT,
    "image": ActionType.REMOVE_IMAGE,
    "text": ActionType.REMOVE_TEXT,
    "header": ActionType.REMOVE_HEADER,
    "footer": ActionType.REMOVE_FOOTER,
    "shape": ActionType.REMOVE_SHAPE,
    "drawing": ActionType.REMOVE_DRAWING,
}


@dataclass
class CleaningAction:
    """单个清理操作。

    包含操作类型、目标信息、风险等级和原始检测结果。
    """

    action_type: str
    """操作类型，取值为 ActionType 枚举值之一。"""

    target_type: str
    """目标类型：annotation / artifact / image / text / header / footer / shape / drawing。"""

    confidence: float
    """检测置信度。"""

    risk_level: RiskLevel
    """风险等级策略。"""

    risk_score: float
    """风险评分（0-100）。"""

    action_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    """操作唯一标识（UUID）。"""

    page: Optional[int] = None
    """目标页面编号（从 1 开始），None 表示所有页面。"""

    target_ref: Optional[str] = None
    """用于定位删除目标的引用。

    示例:
    - Annotation: annot_ref_xxx
    - Image: xref_123
    - Word Shape: xml_path
    - Text: node_hash
    """

    content: str = ""
    """检测到的内容描述。"""

    bbox: Optional[Tuple[float, float, float, float]] = None
    """边界框。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""


@dataclass
class CleaningPlan:
    """清理计划。

    包含对所有检测结果的风险评估和操作列表。
    支持状态流转：DRAFT → WAIT_CONFIRM → CONFIRMED → EXECUTING → COMPLETED/FAILED。
    """

    file_path: str
    """文档文件路径。"""

    risk_level: RiskLevel
    """整体风险等级（取所有 Action 中的最高等级）。"""

    plan_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    """计划唯一标识（UUID）。"""

    document_type: str = "PDF"
    """文档类型：PDF / WORD。"""

    created_time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    """计划创建时间（ISO 8601 格式）。"""

    actions: List[CleaningAction] = field(default_factory=list)
    """清理操作列表。"""

    summary: Dict[str, object] = field(default_factory=dict)
    """摘要信息。"""

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
        return any(a.risk_level == RiskLevel.CONFIRM for a in self.actions)

    def has_auto_actions(self) -> bool:
        """检查是否有自动执行的操作。"""
        return any(a.risk_level == RiskLevel.AUTO for a in self.actions)

    def update_summary(self) -> None:
        """重新计算并更新摘要信息。"""
        auto_count = sum(1 for a in self.actions if a.risk_level == RiskLevel.AUTO)
        confirm_count = sum(1 for a in self.actions if a.risk_level == RiskLevel.CONFIRM)
        ignore_count = sum(1 for a in self.actions if a.risk_level == RiskLevel.IGNORE)

        self.summary = {
            "total_detected": len(self.actions),
            "auto_count": auto_count,
            "confirm_count": confirm_count,
            "ignore_count": ignore_count,
            "file_path": self.file_path,
            "document_type": self.document_type,
        }


__all__ = [
    "RiskLevel",
    "ActionType",
    "ACTION_TYPE_MAP",
    "CleaningAction",
    "CleaningPlan",
    "RiskEngine",
]

from .risk_engine import RiskEngine
