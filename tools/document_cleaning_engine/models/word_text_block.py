"""Word 文本块数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class WordTextBlock:
    """Word 文档中的文本块。

    用于检测阶段与 XML 节点之间的映射。
    """

    element_type: str
    """元素类型: paragraph / header / footer / watermark。"""

    text: str
    """文本内容。"""

    xml_path: str
    """XML 文件路径，如 word/header1.xml。"""

    section_index: Optional[int] = None
    """Section 索引（如适用）。"""

    location: str = ""
    """位置描述，如 document.xml / header1.xml / footer1.xml。"""

    confidence: float = 0.0
    """置信度 [0.0, 1.0]。"""

    metadata: Dict[str, Any] = field(default_factory=dict)
    """扩展信息。"""
