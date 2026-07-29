"""Risk Engine Module.

提供检测结果的风险评估与清理计划生成能力。
将 DetectionResult 转换为带风险等级的 CleaningPlan。
"""

from __future__ import annotations

from dataclasses import dataclass, field
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
    """清理操作类型映射。"""

    REMOVE_ANNOTATION = "REMOVE_ANNOTATION"
    REMOVE_ARTIFACT = "REMOVE_ARTIFACT"
    REMOVE_IMAGE = "REMOVE_IMAGE"
    REMOVE_TEXT = "REMOVE_TEXT"
    REMOVE_HEADER = "REMOVE_HEADER"
    REMOVE_FOOTER = "REMOVE_FOOTER"


# Detection 类型到 Action 类型的映射
ACTION_TYPE_MAP: Dict[str, ActionType] = {
    "annotation": ActionType.REMOVE_ANNOTATION,
    "artifact": ActionType.REMOVE_ARTIFACT,
    "image": ActionType.REMOVE_IMAGE,
    "text": ActionType.REMOVE_TEXT,
    "header": ActionType.REMOVE_HEADER,
    "footer": ActionType.REMOVE_FOOTER,
}


@dataclass
class CleaningAction:
    """单个清理操作。

    包含操作类型、目标信息、风险等级和原始检测结果。
    """

    action_type: str
    """操作类型，取值为 ActionType 枚举值之一。"""

    page: int
    """目标页面编号。"""

    target_type: str
    """目标类型：annotation / artifact / image / text / header / footer。"""

    confidence: float
    """检测置信度。"""

    risk_level: RiskLevel
    """风险等级策略。"""

    risk_score: float
    """风险评分（0-100）。"""

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
    """

    file_path: str
    """PDF 文件路径。"""

    risk_level: RiskLevel
    """整体风险等级（取所有 Action 中的最高等级）。"""

    actions: List[CleaningAction] = field(default_factory=list)
    """清理操作列表。"""


__all__ = [
    "RiskLevel",
    "ActionType",
    "ACTION_TYPE_MAP",
    "CleaningAction",
    "CleaningPlan",
    "RiskEngine",
]

from .risk_engine import RiskEngine
