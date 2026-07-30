"""Word 文档元素数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class WordElement:
    """Word 文档中的可检测元素。

    用于在检测和清理之间传递元素信息。
    """

    element_type: str
    """元素类型: paragraph / header / footer / shape / picture / drawing / textbox。"""

    location: str
    """位置描述: body / header / footer。"""

    content: Optional[str] = None
    """文本内容（如有）。"""

    xml_path: Optional[str] = None
    """XML 路径（如 word/header1.xml）。"""

    confidence: float = 0.0
    """置信度 [0.0, 1.0]。"""

    metadata: Dict[str, Any] = field(default_factory=dict)
    """扩展信息。"""
