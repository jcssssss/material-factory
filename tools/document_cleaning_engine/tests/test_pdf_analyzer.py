"""PDFAnalyzer 单元测试。"""

from __future__ import annotations

import fitz
import pytest

from analyzer.document_info import PDFDocumentInfo, PDFType
from analyzer.pdf_analyzer import PDFAnalyzer


class TestPDFAnalyzer:
    """PDFAnalyzer 核心测试。"""

    def setup_method(self) -> None:
        self.analyzer = PDFAnalyzer()

    # ── Case 1: 文本 PDF ──────────────────────────────────────────────

    def test_text_pdf(self, text_pdf_path: str) -> None:
        """纯文本 PDF 应识别为 TEXT_PDF。"""
        result = self.analyzer.analyze(text_pdf_path)

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.TEXT_PDF.value
        assert result.is_encrypted is False
        assert result.has_text is True
        assert result.has_images is False
        assert result.page_count == 10
        assert result.metadata["text_pages"] == 10
        assert result.metadata["image_pages"] == 0

    # ── Case 2: 扫描 PDF ──────────────────────────────────────────────

    def test_scan_pdf(self, scan_pdf_path: str) -> None:
        """图片扫描 PDF 应识别为 SCAN_PDF。"""
        result = self.analyzer.analyze(scan_pdf_path)

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.SCAN_PDF.value
        assert result.is_encrypted is False
        assert result.has_text is False
        assert result.has_images is True
        assert result.page_count == 10
        assert result.metadata["text_pages"] == 0
        assert result.metadata["image_pages"] == 10

    # ── Case 3: 混合 PDF ──────────────────────────────────────────────

    def test_mixed_pdf(self, mixed_pdf_path: str) -> None:
        """混合 PDF（文本 + 图片）应识别为 MIXED_PDF。"""
        result = self.analyzer.analyze(mixed_pdf_path)

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.MIXED_PDF.value
        assert result.is_encrypted is False
        assert result.has_text is True
        assert result.has_images is True
        assert result.page_count == 10
        assert result.metadata["text_pages"] == 3
        assert result.metadata["image_pages"] == 7

    # ── Case 4: 加密 PDF ──────────────────────────────────────────────

    def test_encrypted_pdf(self, encrypted_pdf_path: str) -> None:
        """加密 PDF 应识别为 ENCRYPTED_PDF 且不尝试解密。"""
        result = self.analyzer.analyze(encrypted_pdf_path)

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.ENCRYPTED_PDF.value
        assert result.is_encrypted is True
        assert result.page_count > 0
        # 加密文档不分析具体内容
        assert result.has_text is False
        assert result.has_images is False

    # ── 边界情况 ──────────────────────────────────────────────────────

    def test_empty_pdf(self, empty_pdf_path: str) -> None:
        """空白 PDF（有页面但无文本/图片内容）应识别为 UNKNOWN。"""
        result = self.analyzer.analyze(empty_pdf_path)

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.UNKNOWN.value
        assert result.page_count == 1
        assert result.is_encrypted is False
        assert result.has_text is False
        assert result.has_images is False

    def test_invalid_file(self, invalid_pdf_path: str) -> None:
        """无效 PDF 文件应识别为 UNKNOWN 且记录错误。"""
        result = self.analyzer.analyze(invalid_pdf_path)

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.UNKNOWN.value
        assert result.page_count == 0
        assert result.is_encrypted is False
        assert result.has_text is False
        assert result.has_images is False
        assert "error" in result.metadata

    def test_file_not_found(self) -> None:
        """不存在的文件应识别为 UNKNOWN。"""
        result = self.analyzer.analyze("/path/to/nonexistent.pdf")

        assert isinstance(result, PDFDocumentInfo)
        assert result.pdf_type == PDFType.UNKNOWN.value

    # ── PDFDocumentInfo 数据模型 ──────────────────────────────────────

    def test_document_info_default_metadata(self) -> None:
        """PDFDocumentInfo 的 metadata 默认应为空字典。"""
        info = PDFDocumentInfo(
            file_path="test.pdf",
            page_count=10,
            pdf_type=PDFType.TEXT_PDF.value,
            is_encrypted=False,
            has_text=True,
            has_images=False,
        )
        assert info.metadata == {}

    def test_document_info_with_metadata(self) -> None:
        """PDFDocumentInfo 应正确存储扩展信息。"""
        info = PDFDocumentInfo(
            file_path="test.pdf",
            page_count=10,
            pdf_type=PDFType.MIXED_PDF.value,
            is_encrypted=False,
            has_text=True,
            has_images=True,
            metadata={"text_pages": 3, "image_pages": 7},
        )
        assert info.metadata["text_pages"] == 3
        assert info.metadata["image_pages"] == 7

    def test_pdf_type_enum_values(self) -> None:
        """PDFType 枚举值应正确对应字符串。"""
        assert PDFType.TEXT_PDF.value == "TEXT_PDF"
        assert PDFType.SCAN_PDF.value == "SCAN_PDF"
        assert PDFType.MIXED_PDF.value == "MIXED_PDF"
        assert PDFType.ENCRYPTED_PDF.value == "ENCRYPTED_PDF"
        assert PDFType.UNKNOWN.value == "UNKNOWN"
