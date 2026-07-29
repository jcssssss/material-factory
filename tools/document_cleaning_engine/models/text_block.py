"""文本块数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Tuple


@dataclass
class TextBlock:
    """PDF 页面文本块信息。

    由 PyMuPDF 提取，用于检测阶段与 Content Stream 指令的映射。
    """

    page: int
    """页码（从 1 开始）。"""

    text: str
    """文本内容。"""

    bbox: Tuple[float, float, float, float]
    """边界框 (x0, y0, x1, y1)，PyMuPDF 坐标系统。"""

    font_size: float
    """字体大小。"""

    font_name: str
    """字体名称。"""

    origin: Tuple[float, float]
    """文本原点 (x, y)，PyMuPDF 坐标系统（左上为原点）。"""

    rotation: float = 0.0
    """旋转角度（度）。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""
