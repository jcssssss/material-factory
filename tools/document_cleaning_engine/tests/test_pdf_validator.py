"""PDF Validator 单元测试。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from validator.pdf_validator import PDFValidator


class TestPDFValidator:
    """PDFValidator 功能测试（Mock PyMuPDF）。"""

    def setup_method(self) -> None:
        self.validator = PDFValidator()

    @patch("validator.pdf_validator.fitz")
    def test_normal_validation(self, mock_fitz: MagicMock) -> None:
        """正常清理应返回正确结果。"""
        mock_orig = MagicMock()
        mock_clean = MagicMock()

        mock_orig.__len__.return_value = 5
        mock_clean.__len__.return_value = 5

        # 模拟页面尺寸
        def page_getitem(i):
            p = MagicMock()
            p.rect.width = 595.0
            p.rect.height = 842.0
            return p

        mock_orig.__getitem__.side_effect = page_getitem
        mock_clean.__getitem__.side_effect = page_getitem

        # 模拟文本内容 - 让 iter 返回独立 mock 而不是被 __getitem__ 复用的
        orig_p = MagicMock()
        orig_p.get_text.return_value = "Normal content text " * 10
        orig_p.get_images.return_value = [1, 2, 3]
        clean_p = MagicMock()
        clean_p.get_text.return_value = "Normal content text " * 9
        clean_p.get_images.return_value = [1, 2]

        mock_orig.__iter__.return_value = [orig_p]
        mock_clean.__iter__.return_value = [clean_p]

        mock_fitz.open.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("original.pdf", "cleaned.pdf")

        assert result["open_success"] is True
        assert result["original_pages"] == 5
        assert result["cleaned_pages"] == 5
        assert result["page_count_match"] is True
        assert result["page_size_match"] is True

        content = result["content"]
        assert content["text_loss_rate"] > 0
        assert content["images_before"] == 3
        assert content["images_after"] == 2

    @patch("validator.pdf_validator.fitz")
    def test_page_count_mismatch(self, mock_fitz: MagicMock) -> None:
        """页数不同应检测到。"""
        mock_orig = MagicMock()
        mock_clean = MagicMock()
        mock_orig.__len__.return_value = 100
        mock_clean.__len__.return_value = 90

        def page_getitem(i):
            p = MagicMock()
            p.rect.width = 595.0
            p.rect.height = 842.0
            return p

        mock_orig.__getitem__.side_effect = page_getitem
        mock_clean.__getitem__.side_effect = page_getitem
        mock_orig.__iter__.return_value = []
        mock_clean.__iter__.return_value = []

        mock_fitz.open.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("orig.pdf", "cleaned.pdf")
        assert result["page_count_match"] is False
        assert result["original_pages"] == 100
        assert result["cleaned_pages"] == 90

    @patch("validator.pdf_validator.fitz")
    def test_open_failure(self, mock_fitz: MagicMock) -> None:
        """文件无法打开时应返回错误。"""
        mock_fitz.open.side_effect = [Exception("File corrupted"), None]

        # 清理后文件也无法打开
        mock_fitz.open.side_effect = Exception("Cannot open")

        result = self.validator.validate("bad.pdf", "missing.pdf")
        assert result["open_success"] is False
        assert result["page_count_match"] is False

    @patch("validator.pdf_validator.fitz")
    def test_page_size_changed(self, mock_fitz: MagicMock) -> None:
        """页面尺寸变化应检测到。"""
        mock_orig = MagicMock()
        mock_clean = MagicMock()
        mock_orig.__len__.return_value = 2
        mock_clean.__len__.return_value = 2

        # 原始页面尺寸
        def orig_getitem(i):
            p = MagicMock()
            p.rect.width = 595.0
            p.rect.height = 842.0
            return p

        mock_orig.__getitem__.side_effect = orig_getitem

        # 清理后页面尺寸不同
        def clean_getitem(i):
            p = MagicMock()
            p.rect.width = 600.0 if i == 0 else 595.0
            p.rect.height = 842.0
            return p

        mock_clean.__getitem__.side_effect = clean_getitem

        # 模拟迭代
        orig_content = MagicMock()
        orig_content.get_text.return_value = "text"
        orig_content.get_images.return_value = []
        mock_orig.__iter__.return_value = [orig_content, orig_content]

        clean_content = MagicMock()
        clean_content.get_text.return_value = "text"
        clean_content.get_images.return_value = []
        mock_clean.__iter__.return_value = [clean_content, clean_content]

        mock_fitz.open.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("orig.pdf", "cleaned.pdf")
        assert result["page_size_match"] is False

    @patch("validator.pdf_validator.fitz")
    def test_content_text_change(self, mock_fitz: MagicMock) -> None:
        """文本变化应被检测到。"""
        mock_orig = MagicMock()
        mock_clean = MagicMock()
        mock_orig.__len__.return_value = 1
        mock_clean.__len__.return_value = 1

        def page_getitem(i):
            p = MagicMock()
            p.rect.width = 595.0
            p.rect.height = 842.0
            return p

        mock_orig.__getitem__.side_effect = page_getitem
        mock_clean.__getitem__.side_effect = page_getitem

        mock_orig_page = MagicMock()
        mock_orig_page.get_text.return_value = "Original text content here for testing"
        mock_orig_page.get_images.return_value = []

        mock_clean_page = MagicMock()
        mock_clean_page.get_text.return_value = "Original text content here"
        mock_clean_page.get_images.return_value = []

        mock_orig.__iter__.return_value = [mock_orig_page]
        mock_clean.__iter__.return_value = [mock_clean_page]

        mock_fitz.open.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("orig.pdf", "cleaned.pdf")
        content = result["content"]
        assert content["text_changed"] is True
        assert content["text_loss_rate"] > 0


class TestPDFValidatorEdgeCases:
    """PDFValidator 边界情况测试。"""

    def setup_method(self) -> None:
        self.validator = PDFValidator()

    def test_empty_content(self) -> None:
        """空白 PDF 应正常处理。"""
        with patch("validator.pdf_validator.fitz") as mock_fitz:
            mock_orig = MagicMock()
            mock_clean = MagicMock()
            mock_orig.__len__.return_value = 1
            mock_clean.__len__.return_value = 1

            def page_getitem(i):
                p = MagicMock()
                p.rect.width = 595.0
                p.rect.height = 842.0
                return p

            mock_orig.__getitem__.side_effect = page_getitem
            mock_clean.__getitem__.side_effect = page_getitem

            empty_page = MagicMock()
            empty_page.get_text.return_value = ""
            empty_page.get_images.return_value = []
            mock_orig.__iter__.return_value = [empty_page]
            mock_clean.__iter__.return_value = [empty_page]

            mock_fitz.open.side_effect = [mock_orig, mock_clean]

            result = self.validator.validate("empty.pdf", "empty_clean.pdf")
            assert result["open_success"] is True
            content = result["content"]
            assert content["text_loss_rate"] == 0.0
            assert content["images_before"] == 0
