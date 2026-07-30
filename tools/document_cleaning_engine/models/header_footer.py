"""页眉页脚数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple


@dataclass
class HeaderFooterInfo:
    """页眉页脚信息。

    用于在检测和清理之间传递信息。
    """

    type: str
    """header 或 footer。"""

    text: str
    """文本内容。"""

    pages: List[int]
    """出现页面列表。"""

    bbox: Tuple[float, float, float, float]
    """边界框 (x0, y0, x1, y1)。"""

    repeat_rate: float
    """出现页面比例。"""

    font_size: float
    """字体大小。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""
