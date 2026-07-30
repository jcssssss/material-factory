"""Word Validator 单元测试。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from validator.word_validator import WordValidator


class TestWordValidator:
    """WordValidator 功能测试。"""

    def setup_method(self) -> None:
        self.validator = WordValidator()

    @patch("validator.word_validator.zipfile")
    @patch("validator.word_validator.Document")
    def test_normal_validation(
        self, mock_document: MagicMock, mock_zipfile: MagicMock
    ) -> None:
        """正常清理应返回通过。"""
        # Mock ZIP 结构
        mock_zip = MagicMock()
        mock_zip.namelist.return_value = [
            "word/document.xml", "word/styles.xml",
            "word/_rels/something.xml",
        ]
        mock_zipfile.ZipFile.return_value.__enter__.return_value = mock_zip

        # Mock Document
        mock_orig = MagicMock()
        mock_clean = MagicMock()

        # Sections
        mock_section = MagicMock()
        mock_section.header.paragraphs = []
        mock_section.footer.paragraphs = []
        mock_orig.sections = [mock_section, mock_section]
        mock_clean.sections = [mock_section, mock_section]

        # Paragraphs
        orig_para = MagicMock()
        orig_para.text = "Original content text here for Word document validation"
        mock_orig.paragraphs = [orig_para]

        clean_para = MagicMock()
        clean_para.text = "Original content text here for Word document"  # 少了一些
        mock_clean.paragraphs = [clean_para]

        mock_document.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("original.docx", "cleaned.docx")

        assert result["open_success"] is True
        assert result["zip_structure_ok"] is True

        structure = result["structure"]
        assert structure["section_match"] is True

        content = result["content"]
        assert content["text_loss_rate"] > 0

    @patch("validator.word_validator.zipfile")
    def test_corrupted_zip(self, mock_zipfile: MagicMock) -> None:
        """损坏的 ZIP 应返回结构错误。"""
        mock_zipfile.ZipFile.side_effect = Exception("Bad ZIP file")

        result = self.validator.validate("orig.docx", "bad.docx")
        assert result["open_success"] is False
        assert result["zip_structure_ok"] is False

    @patch("validator.word_validator.zipfile")
    def test_missing_required_xml(self, mock_zipfile: MagicMock) -> None:
        """缺少必需 XML 文件应返回结构错误。"""
        mock_zip = MagicMock()
        mock_zip.namelist.return_value = ["word/styles.xml"]  # 缺少 document.xml
        mock_zipfile.ZipFile.return_value.__enter__.return_value = mock_zip

        result = self.validator.validate("orig.docx", "incomplete.docx")
        assert result["zip_structure_ok"] is False

    @patch("validator.word_validator.zipfile")
    @patch("validator.word_validator.Document")
    def test_section_count_mismatch(
        self, mock_document: MagicMock, mock_zipfile: MagicMock
    ) -> None:
        """Section 数量不同应检测到。"""
        # Mock ZIP
        mock_zip = MagicMock()
        mock_zip.namelist.return_value = [
            "word/document.xml", "word/styles.xml",
            "word/_rels/something.xml",
        ]
        mock_zipfile.ZipFile.return_value.__enter__.return_value = mock_zip

        mock_orig = MagicMock()
        mock_clean = MagicMock()
        mock_orig.sections = [MagicMock()] * 3
        mock_clean.sections = [MagicMock()] * 2  # 少了一个 section

        mock_orig.paragraphs = []
        mock_clean.paragraphs = []

        mock_document.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("orig.docx", "bad.docx")
        structure = result["structure"]
        assert structure["section_match"] is False
        assert structure["original_sections"] == 3
        assert structure["cleaned_sections"] == 2

    @patch("validator.word_validator.zipfile")
    @patch("validator.word_validator.Document")
    def test_header_footer_change(
        self, mock_document: MagicMock, mock_zipfile: MagicMock
    ) -> None:
        """Header/Footer 变化应被检测到。"""
        mock_zip = MagicMock()
        mock_zip.namelist.return_value = [
            "word/document.xml", "word/styles.xml",
            "word/_rels/something.xml",
        ]
        mock_zipfile.ZipFile.return_value.__enter__.return_value = mock_zip

        mock_orig = MagicMock()
        mock_clean = MagicMock()

        # 原始有 header
        h_section = MagicMock()
        h_para = MagicMock()
        h_para.text.strip.return_value = "Header Text"
        h_section.header.paragraphs = [h_para]
        h_section.footer.paragraphs = []

        # 清理后 header 已删除
        c_section = MagicMock()
        c_section.header.paragraphs = []
        c_section.footer.paragraphs = []

        mock_orig.sections = [h_section]
        mock_clean.sections = [c_section]
        mock_orig.paragraphs = []
        mock_clean.paragraphs = []

        mock_document.side_effect = [mock_orig, mock_clean]

        result = self.validator.validate("orig.docx", "cleaned.docx")
        structure = result["structure"]
        assert structure["header_change"] == 1
        assert structure["original_headers"] == 1
        assert structure["cleaned_headers"] == 0


class TestWordValidatorEdgeCases:
    """WordValidator 边界情况测试。"""

    def setup_method(self) -> None:
        self.validator = WordValidator()

    def test_empty_document(self) -> None:
        """空文档应正常处理。"""
        with patch("validator.word_validator.zipfile") as mock_zipfile:
            with patch("validator.word_validator.Document") as mock_document:
                mock_zip = MagicMock()
                mock_zip.namelist.return_value = [
                    "word/document.xml", "word/styles.xml",
                    "word/_rels/something.xml",
                ]
                mock_zipfile.ZipFile.return_value.__enter__.return_value = mock_zip

                mock_orig = MagicMock()
                mock_clean = MagicMock()
                mock_orig.sections = []
                mock_clean.sections = []
                mock_orig.paragraphs = [MagicMock(text="")]
                mock_clean.paragraphs = [MagicMock(text="")]

                mock_document.side_effect = [mock_orig, mock_clean]

                result = self.validator.validate("empty.docx", "empty_clean.docx")
                assert result["zip_structure_ok"] is True
                assert result["open_success"] is True
