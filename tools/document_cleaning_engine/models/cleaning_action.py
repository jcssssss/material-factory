"""CleaningAction 数据模型。

单个清理操作的定义，包含操作类型、目标定位、风险等级等信息。
由 RiskEngine 根据 DetectionResult 生成，供 Cleaner 执行。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple


@dataclass
class CleaningAction:
    """单个清理操作。

    定义一次清理操作的所有必要信息：
    - 操作类型（删除 Annotation / Image / Text 等）
    - 目标定位（页面、目标引用、边界框）
    - 风险信息（置信度、风险等级、风险评分）
    - 上下文内容
    """

    action_type: str
    """操作类型，取值为 ActionType 枚举值之一。"""

    target_type: str
    """目标类型：annotation / artifact / image / text / header / footer / shape / drawing。"""

    confidence: float
    """检测置信度 [0.0, 1.0]。"""

    risk_level: str
    """风险等级策略：AUTO / CONFIRM / IGNORE。"""

    risk_score: float
    """风险评分（0-100）。"""

    action_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    """操作唯一标识（UUID）。"""

    page: Optional[int] = None
    """目标页面编号（从 1 开始），None 表示所有页面。"""

    bbox: Optional[Tuple[float, float, float, float]] = None
    """边界框 (x0, y0, x1, y1)，可能为 None。"""

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

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""
