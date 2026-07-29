"""PDF 文档信息数据模型。

定义 PDFDocumentInfo 数据类和 PDFType 枚举，
为 PDF Analyzer 的分析结果提供标准化输出。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict


class PDFType(str, Enum):
    """PDF 类型枚举。

    固定五类，覆盖文档清理引擎的所有输入类型。
    """

    TEXT_PDF = "TEXT_PDF"
    """纯文本 PDF — 页面主要内容为文本对象。"""

    SCAN_PDF = "SCAN_PDF"
    """扫描 PDF — 页面主要内容为扫描图片。"""

    MIXED_PDF = "MIXED_PDF"
    """混合 PDF — 同时存在文本页面和图片页面。"""

    ENCRYPTED_PDF = "ENCRYPTED_PDF"
    """加密 PDF — 文件受密码保护，无法解析内容。"""

    UNKNOWN = "UNKNOWN"
    """未知类型 — 无法确定 PDF 类型（文件损坏/空文件等）。"""


@dataclass
class PDFDocumentInfo:
    """PDF 文档分析结果模型。

    包含 PDF 的基础信息和分析结论，供后续 Detector 模块使用。
    """

    file_path: str
    """PDF 文件路径。"""

    page_count: int
    """PDF 总页数。"""

    pdf_type: str
    """PDF 类型，取值为 PDFType 枚举值之一（字符串）。"""

    is_encrypted: bool
    """是否加密。"""

    has_text: bool
    """是否包含文本内容。"""

    has_images: bool
    """是否包含图片内容。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息，包含分析过程的详细信息。

    预留字段，当前包含：
    - text_pages: int — 包含文本的页面数
    - image_pages: int — 包含图片的页面数
    - error: str — 分析过程中的错误信息（如有）
    """
