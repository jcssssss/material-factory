"""Word 非文本对象数据模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple


@dataclass
class WordObject:
    """Word 文档中的非文本对象（Shape/DrawingML/Picture）。

    用于检测和清理之间的信息传递。
    """

    object_type: str
    """对象类型: shape / textbox / drawing / picture / vml。"""

    xml_file: str
    """所在 XML 文件路径，如 word/header1.xml。"""

    xml_path: str = ""
    """XML 节点路径描述。"""

    relation_id: Optional[str] = None
    """关系 ID（如 rId1），用于图片引用。"""

    content: Optional[str] = None
    """文本内容（TextBox 内部文本）。"""

    bbox: Optional[Tuple[float, float, float, float]] = None
    """边界框 (x0, y0, x1, y1)。"""

    confidence: float = 0.0
    """置信度 [0.0, 1.0]。"""

    metadata: Dict[str, Any] = field(default_factory=dict)
    """扩展信息。"""
