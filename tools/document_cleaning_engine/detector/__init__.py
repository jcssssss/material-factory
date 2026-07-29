"""PDF Detector Module.

提供 PDF 文档检测能力，识别水印、页眉、页脚等非主体元素。
所有检测结果统一以 DetectionResult 格式输出。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple


@dataclass
class DetectionResult:
    """检测结果数据模型。

    所有 Detector 子模块统一输出格式。
    """

    type: str
    """检测结果类型: annotation / artifact / image / text / header / footer。"""

    page: int
    """检测到的页面编号（从 1 开始）。"""

    bbox: Optional[Tuple[float, float, float, float]] = None
    """边界框 (x0, y0, x1, y1)，可能为 None（如 artifact 检测）。"""

    content: str = ""
    """检测到的内容描述。"""

    confidence: float = 0.0
    """置信度 [0.0, 1.0]，>= 0.8 为候选元素。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""


from .pdf_detector import PDFDetector

__all__ = [
    "DetectionResult",
    "PDFDetector",
]
