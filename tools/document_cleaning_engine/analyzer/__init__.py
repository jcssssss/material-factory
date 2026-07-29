"""PDF Analyzer Module.

提供 PDF 文档基础分析能力：
- 判断 PDF 类型（文本/扫描/混合/加密）
- 获取 PDF 基础信息（页数、文本/图片内容）
- 为后续 Detector 模块提供统一输入
"""

from .document_info import PDFDocumentInfo, PDFType
from .pdf_analyzer import PDFAnalyzer

__all__ = [
    "PDFDocumentInfo",
    "PDFType",
    "PDFAnalyzer",
]
