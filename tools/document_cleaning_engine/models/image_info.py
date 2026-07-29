"""图片信息数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple


@dataclass
class ImageInfo:
    """PDF 页面图片信息。

    用于在检测和清理之间传递图片对象信息。
    """

    xref: int
    """PDF 图片对象编号。"""

    page: int
    """所在页码（从 1 开始）。"""

    width: int
    """图片宽度（像素）。"""

    height: int
    """图片高度（像素）。"""

    bbox: Tuple[float, float, float, float]
    """图片在页面上的边界框 (x0, y0, x1, y1)。"""

    image_hash: str
    """图片 SHA-256 哈希值，用于重复识别。"""

    opacity: Optional[float] = None
    """透明度。None 表示不透明，0.0-1.0 表示透明程度。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""
