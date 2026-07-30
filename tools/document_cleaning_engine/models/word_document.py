"""Word 文档分析结果数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class WordDocument:
    """Word 文档分析结果。

    包含 DOCX 的基础信息和分析结论。
    """

    file_path: str
    """文件路径。"""

    paragraph_count: int
    """段落总数。"""

    section_count: int
    """Section 数量。"""

    header_count: int
    """Header 总数。"""

    footer_count: int
    """Footer 总数。"""

    has_shapes: bool
    """是否包含 Shape（VML 绘图对象）。"""

    has_drawing: bool
    """是否包含 Drawing（DrawingML 对象）。"""

    metadata: Dict[str, Any] = field(default_factory=dict)
    """扩展信息。"""
