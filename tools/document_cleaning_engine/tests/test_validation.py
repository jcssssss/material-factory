"""Validator 集成和水印复检单元测试。"""

from __future__ import annotations

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from models.validation_report import ValidationReport
from risk import CleaningAction, CleaningPlan, RiskLevel
from validator import Validator, WatermarkRechecker
from validator.validator import ValidationReport
from detector import DetectionResult


# ── ValidationReport ──────────────────────────────────────────────────────────


class TestValidationReport:
    """ValidationReport 数据模型测试。"""

    def test_default_pass(self) -> None:
        """默认应为 PASS。"""
        report = ValidationReport(
            task_id="t1", file_path="f.pdf", cleaned_path="f_clean.pdf",
        )
        assert report.status == "PASS"

    def test_set_status_pass(self) -> None:
        """无 errors/warnings 应为 PASS。"""
        report = ValidationReport(
            task_id="t1", file_path="f.pdf", cleaned_path="f_clean.pdf",
        )
        report.set_status()
        assert report.status == "PASS"

    def test_set_status_warning(self) -> None:
        """有 warnings 应为 WARNING。"""
        report = ValidationReport(
            task_id="t1", file_path="f.pdf", cleaned_path="f_clean.pdf",
            warnings=["文本损失略超预期"],
        )
        report.set_status()
        assert report.status == "WARNING"

    def test_set_status_failed(self) -> None:
        """有结构级 errors 应为 FAILED。"""
        report = ValidationReport(
            task_id="t1", file_path="f.pdf", cleaned_path="f_clean.pdf",
            errors=["PAGE_COUNT_CHANGED"],
        )
        report.set_status()
        assert report.status == "FAILED"

    def test_set_status_need_review(self) -> None:
        """非结构级 errors 应为 NEED_REVIEW。"""
        report = ValidationReport(
            task_id="t1", file_path="f.pdf", cleaned_path="f_clean.pdf",
            errors=["一些内容问题"],
        )
        report.set_status()
        assert report.status == "NEED_REVIEW"


# ── Validator ─────────────────────────────────────────────────────────────────


class TestValidator:
    """Validator 主入口集成测试。"""

    def setup_method(self) -> None:
        self.validator = Validator()

    def test_output_not_found(self) -> None:
        """输出文件不存在时应返回错误。"""
        plan = CleaningPlan(file_path="orig.pdf", risk_level=RiskLevel.AUTO)
        report = self.validator.validate(
            original_file="/nonexistent/orig.pdf",
            cleaned_file="/nonexistent/clean.pdf",
            cleaning_plan=plan,
        )
        assert "OUTPUT_NOT_FOUND" in report.errors
        assert report.status == "FAILED"

    def test_empty_output_file(self) -> None:
        """空输出文件应返回错误。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_orig:
            f_orig.write(b"original content")
            orig_path = f_orig.name

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_clean:
            clean_path = f_clean.name  # 空文件（0 bytes）

        try:
            plan = CleaningPlan(file_path=orig_path, risk_level=RiskLevel.AUTO)
            report = self.validator.validate(orig_path, clean_path, plan)

            assert report.file_check.get("file_size_ok") is False
            assert "OUTPUT_FILE_EMPTY" in report.errors
        finally:
            os.unlink(orig_path)
            os.unlink(clean_path)

    def test_unsupported_format(self) -> None:
        """不支持的格式应返回警告。"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f_orig:
            orig_path = f_orig.name
            f_orig.write(b"PNG content")

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f_clean:
            clean_path = f_clean.name
            f_clean.write(b"PNG cleaned content")

        try:
            plan = CleaningPlan(file_path=orig_path, risk_level=RiskLevel.AUTO)
            report = self.validator.validate(orig_path, clean_path, plan)
            assert any("不支持的验证格式" in w for w in report.warnings)
        finally:
            os.unlink(orig_path)
            os.unlink(clean_path)

    def test_pdf_validation_success(self) -> None:
        """PDF 成功清理应 PASS。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_orig:
            orig_path = f_orig.name
            f_orig.write(b"dummy pdf content for test " * 100)

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_clean:
            clean_path = f_clean.name
            f_clean.write(b"dummy pdf content for test " * 95)

        try:
            plan = CleaningPlan(
                file_path=orig_path,
                risk_level=RiskLevel.AUTO,
                actions=[
                    CleaningAction(
                        action_type="REMOVE_TEXT",
                        page=1, target_type="text",
                        confidence=0.95, risk_level=RiskLevel.AUTO,
                        risk_score=80.0, content="watermark",
                    ),
                ],
            )

            with patch.object(
                self.validator._pdf_validator, "validate"
            ) as mock_pdf:
                mock_pdf.return_value = {
                    "open_success": True,
                    "original_pages": 10,
                    "cleaned_pages": 10,
                    "page_count_match": True,
                    "page_size_match": True,
                    "content": {
                        "total_chars_before": 1000,
                        "total_chars_after": 950,
                        "text_loss_rate": 0.05,
                        "images_before": 5,
                        "images_after": 5,
                        "image_loss_rate": 0.0,
                    },
                }

                with patch.object(
                    self.validator._watermark_rechecker, "check"
                ) as mock_recheck:
                    mock_recheck.return_value = {
                        "remaining": 0,
                        "details": [],
                    }

                    report = self.validator.validate(
                        orig_path, clean_path, plan
                    )
                    assert report.status == "PASS"

        finally:
            os.unlink(orig_path)
            os.unlink(clean_path)

    def test_watermark_recheck_found(self) -> None:
        """水印复检发现残留应 WARNING。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_orig:
            orig_path = f_orig.name
            f_orig.write(b"content")

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_clean:
            clean_path = f_clean.name
            f_clean.write(b"content")

        try:
            plan = CleaningPlan(
                file_path=orig_path,
                risk_level=RiskLevel.AUTO,
                actions=[
                    CleaningAction(
                        action_type="REMOVE_TEXT",
                        page=1, target_type="text",
                        confidence=0.95, risk_level=RiskLevel.AUTO,
                        risk_score=80.0, content="Confidential",
                    ),
                ],
            )

            with patch.object(
                self.validator._pdf_validator, "validate"
            ) as mock_pdf:
                mock_pdf.return_value = {
                    "open_success": True,
                    "original_pages": 1,
                    "cleaned_pages": 1,
                    "page_count_match": True,
                    "page_size_match": True,
                    "content": {
                        "total_chars_before": 100,
                        "total_chars_after": 90,
                        "text_loss_rate": 0.1,
                        "images_before": 0,
                        "images_after": 0,
                        "image_loss_rate": 0.0,
                    },
                }

                with patch.object(
                    self.validator._watermark_rechecker, "check"
                ) as mock_recheck:
                    mock_recheck.return_value = {
                        "remaining": 1,
                        "details": [{
                            "action_id": "a1",
                            "action_type": "REMOVE_TEXT",
                            "target_ref": None,
                            "remaining_detections": 1,
                        }],
                    }

                    report = self.validator.validate(
                        orig_path, clean_path, plan
                    )
                    assert report.status == "WARNING"
                    assert report.watermark_check["watermarks_cleared"] is False

        finally:
            os.unlink(orig_path)
            os.unlink(clean_path)


# ── Expected Loss ─────────────────────────────────────────────────────────────


class TestExpectedLoss:
    """expected_loss 模型测试。"""

    def test_no_actions(self) -> None:
        """无 Action 时损失应为 0。"""
        plan = CleaningPlan(
            file_path="test.pdf", risk_level=RiskLevel.AUTO, actions=[]
        )
        result = Validator._calc_expected_loss(plan, "PDF", {})
        assert result["text"] == 0.0
        assert result["image"] == 0

    def test_text_actions_estimate(self) -> None:
        """文本 Action 应产生预期损失。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT", page=1, target_type="text",
                    confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
            ],
        )
        # 每个 text action 预计 20 字符
        result = Validator._calc_expected_loss(
            plan, "PDF", {"total_chars_before": 1000}
        )
        assert result["text"] == pytest.approx(0.02)  # 20/1000

    def test_image_actions_count(self) -> None:
        """图片 Action 应计入预计删除数。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_IMAGE", page=1, target_type="image",
                    confidence=0.9, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
                CleaningAction(
                    action_type="REMOVE_IMAGE", page=2, target_type="image",
                    confidence=0.9, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
            ],
        )
        result = Validator._calc_expected_loss(plan, "PDF", {})
        assert result["image"] == 2  # 2 个 REMOVE_IMAGE

    def test_mixed_actions(self) -> None:
        """混合 Action 应正确计算。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT", page=1, target_type="text",
                    confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
                CleaningAction(
                    action_type="REMOVE_HEADER", page=1, target_type="header",
                    confidence=0.85, risk_level=RiskLevel.AUTO, risk_score=70.0,
                ),
                CleaningAction(
                    action_type="REMOVE_IMAGE", page=3, target_type="image",
                    confidence=0.9, risk_level=RiskLevel.AUTO, risk_score=75.0,
                ),
            ],
        )
        result = Validator._calc_expected_loss(
            plan, "PDF", {"total_chars_before": 1000}
        )
        # text_actions=2(REMOVE_TEXT+REMOVE_HEADER), 2*20=40, 40/1000=0.04
        assert result["text"] == pytest.approx(0.04)
        assert result["image"] == 1

    def test_empty_chars_no_division(self) -> None:
        """原文字数为 0 时不应除零。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT", page=1, target_type="text",
                    confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
            ],
        )
        result = Validator._calc_expected_loss(
            plan, "PDF", {"total_chars_before": 0}
        )
        assert result["text"] == 0.0  # 除零保护


# ── WatermarkRechecker ────────────────────────────────────────────────────────


class TestWatermarkRechecker:
    """水印复检模块测试。"""

    def setup_method(self) -> None:
        self.rechecker = WatermarkRechecker()

    def test_no_targets(self) -> None:
        """无目标时应返回成功。"""
        result = self.rechecker.check("file.pdf", [])
        assert result["remaining"] == 0

    def test_unsupported_file_type(self) -> None:
        """不支持的文件类型应返回提示。"""
        result = self.rechecker.check(
            "file.txt", [MagicMock()], ext=".txt"
        )
        assert result["remaining"] == 0

    @patch.object(WatermarkRechecker, "_find_remaining")
    @patch("validator.watermark_recheck.PDFDetector")
    def test_pdf_recheck(
        self,
        mock_detector: MagicMock,
        mock_find: MagicMock,
    ) -> None:
        """PDF 水印复检应调用 PDFDetector。"""
        mock_detector_instance = MagicMock()
        mock_detector.return_value = mock_detector_instance
        mock_detector_instance.detect.return_value = []

        self.rechecker._pdf_detector = mock_detector_instance

        targets = [
            CleaningAction(
                action_type="REMOVE_TEXT", page=1, target_type="text",
                confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
            ),
        ]
        result = self.rechecker.check("clean.pdf", targets, ext=".pdf")

        mock_detector_instance.detect.assert_called_once_with("clean.pdf")
