"""Validator — 清理验证器主入口。

根据文件类型路由到对应的 PDF/Word Validator，
整合验证结果和 expected_loss 模型，生成 ValidationReport。
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from models.validation_report import ValidationReport
from risk import CleaningAction, CleaningPlan, RiskLevel

from .pdf_validator import PDFValidator
from .watermark_recheck import WatermarkRechecker
from .word_validator import WordValidator

logger = logging.getLogger(__name__)


class Validator:
    """清理验证器主入口。

    职责：
    1. 根据文件扩展名路由到 PDFValidator / WordValidator
    2. 执行文件级验证（可打开、Page数等）
    3. 执行结构级验证（页面尺寸、Section数等）
    4. 执行内容级验证（expected_loss 模型比较）
    5. 执行水印复检
    6. 汇总结果生成 ValidationReport
    """

    # expected_loss 阈值
    LOSS_WARNING_THRESHOLD = 0.15  # 实际超过预期 +15% → WARNING
    LOSS_FAIL_THRESHOLD = 0.30  # 实际超过预期 +30% → FAILED/NEED_REVIEW

    def __init__(self) -> None:
        self._pdf_validator = PDFValidator()
        self._word_validator = WordValidator()
        self._watermark_rechecker = WatermarkRechecker()

    def validate(
        self,
        original_file: str,
        cleaned_file: str,
        cleaning_plan: CleaningPlan,
        task_id: str = "",
    ) -> ValidationReport:
        """验证清理结果。

        Args:
            original_file: 原始文件路径。
            cleaned_file: 清理后文件路径。
            cleaning_plan: 清理计划（包含执行的 Action 列表）。
            task_id: 可选的任务 ID。

        Returns:
            验证报告。
        """
        report = ValidationReport(
            task_id=task_id,
            file_path=original_file,
            cleaned_path=cleaned_file,
        )

        # 1. 检查输出文件是否存在
        if not os.path.exists(cleaned_file):
            report.errors.append("OUTPUT_NOT_FOUND")
            report.set_status()
            return report

        # 2. 检查文件大小
        original_size = os.path.getsize(original_file) if os.path.exists(original_file) else 0
        cleaned_size = os.path.getsize(cleaned_file)
        report.file_check["original_size"] = original_size
        report.file_check["cleaned_size"] = cleaned_size
        report.file_check["file_size_ok"] = cleaned_size > 0

        if cleaned_size == 0:
            report.errors.append("OUTPUT_FILE_EMPTY")
            report.set_status()
            return report

        if original_size > 0 and cleaned_size < original_size * 0.01:
            report.warnings.append(
                f"文件大小异常: 原 {original_size} bytes → 清理后 {cleaned_size} bytes"
            )

        # 3. 根据扩展名路由
        ext = os.path.splitext(cleaned_file)[1].lower()

        if ext == ".pdf":
            self._validate_pdf(report, original_file, cleaned_file, cleaning_plan)
        elif ext == ".docx":
            self._validate_word(report, original_file, cleaned_file, cleaning_plan)
        else:
            report.warnings.append(f"不支持的验证格式: {ext}")

        # 4. 水印复检
        self._check_watermarks(report, cleaned_file, cleaning_plan, ext)

        # 5. 确定最终状态
        report.set_status()

        logger.info(
            "验证完成: file=%s, status=%s, errors=%d, warnings=%d",
            cleaned_file, report.status, len(report.errors), len(report.warnings),
        )
        return report

    def _validate_pdf(
        self,
        report: ValidationReport,
        original_file: str,
        cleaned_file: str,
        plan: CleaningPlan,
    ) -> None:
        """执行 PDF 验证。"""
        pdf_check = self._pdf_validator.validate(original_file, cleaned_file)

        # 文件级
        report.file_check.update({
            "open_success": pdf_check.get("open_success", False),
            "original_pages": pdf_check.get("original_pages", 0),
            "cleaned_pages": pdf_check.get("cleaned_pages", 0),
            "page_count_match": pdf_check.get("page_count_match", False),
        })

        if not pdf_check.get("open_success", False):
            report.errors.append("PDF_OPEN_ERROR")

        if not pdf_check.get("page_count_match", True):
            report.errors.append("PAGE_COUNT_CHANGED")

        # 结构级
        report.structure_check["page_size_match"] = pdf_check.get("page_size_match", True)
        if not pdf_check.get("page_size_match", True):
            report.errors.append("PAGE_SIZE_CHANGED")

        # 内容级
        content = pdf_check.get("content", {})
        expected = self._calc_expected_loss(plan, "PDF", content)

        report.content_check["text_loss_rate"] = content.get("text_loss_rate", 0.0)
        report.content_check["expected_loss"] = expected.get("text", 0.0)
        report.content_check["image_loss_rate"] = content.get("image_loss_rate", 0.0)
        report.content_check["expected_image_loss"] = expected.get("image", 0)
        report.content_check["images_before"] = content.get("images_before", 0)
        report.content_check["images_after"] = content.get("images_after", 0)

        self._check_expected_loss(
            report,
            content.get("text_loss_rate", 0.0),
            expected.get("text", 0.0),
            "文本",
        )

        # 图片变化检查
        img_before = content.get("images_before", 0)
        img_after = content.get("images_after", 0)
        img_diff = img_before - img_after
        expected_img_removal = expected.get("image", 0)

        if img_diff > expected_img_removal + 5:
            report.warnings.append(
                f"图片减少 {img_diff} 张，超过计划删除 {expected_img_removal} 张"
            )

    def _validate_word(
        self,
        report: ValidationReport,
        original_file: str,
        cleaned_file: str,
        plan: CleaningPlan,
    ) -> None:
        """执行 Word 验证。"""
        word_check = self._word_validator.validate(original_file, cleaned_file)

        # 文件级
        report.file_check.update({
            "open_success": word_check.get("open_success", False),
            "zip_structure_ok": word_check.get("zip_structure_ok", False),
        })

        if not word_check.get("open_success", False):
            report.errors.append("DOCX_OPEN_ERROR")

        if not word_check.get("zip_structure_ok", True):
            report.errors.append("DOCX_STRUCTURE_CORRUPTED")

        # 结构级
        structure = word_check.get("structure", {})
        report.structure_check["section_match"] = structure.get("section_match", True)
        report.structure_check["original_sections"] = structure.get("original_sections", 0)
        report.structure_check["cleaned_sections"] = structure.get("cleaned_sections", 0)

        if not structure.get("section_match", True):
            report.errors.append("SECTION_COUNT_CHANGED")

        # Header/Footer 变化
        report.structure_check["header_change"] = structure.get("header_change", 0)
        report.structure_check["footer_change"] = structure.get("footer_change", 0)

        # 内容级
        content = word_check.get("content", {})
        expected = self._calc_expected_loss(plan, "WORD", content)

        report.content_check["text_loss_rate"] = content.get("text_loss_rate", 0.0)
        report.content_check["expected_loss"] = expected.get("text", 0.0)
        report.content_check["paragraphs_before"] = content.get("paragraphs_before", 0)
        report.content_check["paragraphs_after"] = content.get("paragraphs_after", 0)

        self._check_expected_loss(
            report,
            content.get("text_loss_rate", 0.0),
            expected.get("text", 0.0),
            "文本",
        )

    def _check_watermarks(
        self,
        report: ValidationReport,
        cleaned_file: str,
        plan: CleaningPlan,
        ext: str,
    ) -> None:
        """执行水印复检。"""
        # 从 Plan 中提取需要复检的目标
        targets = [
            a for a in plan.actions
            if a.risk_level in (RiskLevel.AUTO, RiskLevel.CONFIRM)
        ]

        if not targets:
            report.watermark_check = {
                "remaining_count": 0,
                "watermarks_cleared": True,
                "details": [],
            }
            return

        recheck_result = self._watermark_rechecker.check(
            cleaned_file, targets, ext=ext
        )

        report.watermark_check = {
            "remaining_count": recheck_result.get("remaining", 0),
            "watermarks_cleared": recheck_result.get("remaining", 0) == 0,
            "details": recheck_result.get("details", []),
        }

        if recheck_result.get("remaining", 0) > 0:
            report.warnings.append(
                f"水印复检: {recheck_result['remaining']} 个目标仍存在"
            )

    @staticmethod
    def _calc_expected_loss(
        plan: CleaningPlan,
        doc_type: str,
        content_info: dict,
    ) -> dict:
        """计算 expected_loss。

        根据 CleaningPlan 中的 Action 估算预期影响:

        文本预计损失：
        - 每个 REMOVE_TEXT action 约删除 20 字符（页眉/页脚水印）
        - 每个 REMOVE_HEADER/FOOTER action 约删除 15 字符
        - 每个 REMOVE_ANNOTATION action 约删除 10 字符

        图片预计损失：
        - 每个 REMOVE_IMAGE action 删除 1 张图片

        Args:
            plan: 清理计划。
            doc_type: 文档类型。
            content_info: 原始内容信息（用于计算比例）。

        Returns:
            {"text": 预计文本损失比例, "image": 预计图片删除数量}。
        """
        total_text_actions = sum(
            1 for a in plan.actions
            if a.action_type in (
                "REMOVE_TEXT", "REMOVE_HEADER", "REMOVE_FOOTER",
            )
        )
        total_annotation_actions = sum(
            1 for a in plan.actions
            if a.action_type in ("REMOVE_ANNOTATION",)
        )
        total_image_actions = sum(
            1 for a in plan.actions
            if a.action_type in ("REMOVE_IMAGE",)
        )

        # 估算删除字符数
        estimated_chars = (
            total_text_actions * 20
            + total_annotation_actions * 10
        )

        # 计算比例
        total_chars = content_info.get("total_chars_before", 0)
        text_ratio = 0.0
        if total_chars > 0:
            text_ratio = round(estimated_chars / total_chars, 4)

        return {
            "text": text_ratio,
            "image": total_image_actions,
        }

    def _check_expected_loss(
        self,
        report: ValidationReport,
        actual_loss: float,
        expected_loss: float,
        label: str,
    ) -> None:
        """比较实际损失与预期损失，判断是否需要报警。

        actual_loss <= expected_loss + 15%  → 正常
        actual_loss >  expected_loss + 15%  → WARNING
        actual_loss >  expected_loss + 30%  → NEED_REVIEW
        """
        if expected_loss == 0 and actual_loss == 0:
            return

        excess = actual_loss - expected_loss

        if excess > self.LOSS_FAIL_THRESHOLD:
            report.warnings.append(
                f"{label}损失 {actual_loss:.1%} 远超预期 {expected_loss:.1%} "
                f"(超出 {excess:.1%}，阈值 {self.LOSS_FAIL_THRESHOLD:.0%})"
            )
        elif excess > self.LOSS_WARNING_THRESHOLD:
            report.warnings.append(
                f"{label}损失 {actual_loss:.1%} 超过预期 {expected_loss:.1%} "
                f"(超出 {excess:.1%}，阈值 {self.LOSS_WARNING_THRESHOLD:.0%})"
            )
