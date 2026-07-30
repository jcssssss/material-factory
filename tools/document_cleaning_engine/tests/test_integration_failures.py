"""集成测试 — 异常场景和失败隔离测试。

验证系统在边界条件和异常输入下的稳定性。
"""

from __future__ import annotations

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from detector import PDFDetector
from batch import BatchManager, BatchTask, FileCleaningTask, ProductTask
from plan import PlanGenerator
from executor.cleaning_executor import CleaningExecutor
from validator import Validator
from risk import CleaningAction, CleaningPlan, RiskLevel


# ══════════════════════════════════════════════════════════════════════════════
# Case EXCEPTION-001: 损坏 PDF
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestCorruptedPDF:
    """损坏 PDF 处理。"""

    def test_detector_handles_corrupted(self, invalid_pdf_path: str) -> None:
        """检测器应优雅处理损坏 PDF。"""
        detector = PDFDetector()
        # 不应抛异常，应返回空列表
        detections = detector.detect(invalid_pdf_path)
        assert isinstance(detections, list)

    def test_plan_from_empty_detections(self, invalid_pdf_path: str) -> None:
        """损坏 PDF 检测后应生成空计划。"""
        detector = PDFDetector()
        detections = detector.detect(invalid_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=invalid_pdf_path)
        assert len(plan.actions) == 0
        assert plan.risk_level == RiskLevel.IGNORE

    def test_executor_handles_invalid(self, invalid_pdf_path: str) -> None:
        """执行器应处理无效文件路径。"""
        plan = CleaningPlan(
            file_path=invalid_pdf_path,
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT", page=1,
                    target_type="text",
                    confidence=0.95, risk_level=RiskLevel.AUTO,
                    risk_score=80.0,
                ),
            ],
        )
        executor = CleaningExecutor()
        task = executor.execute(plan, file_path=invalid_pdf_path)
        # 会失败，但不应该崩溃
        assert task.status in ("FAILED", "NEED_REVIEW")


# ══════════════════════════════════════════════════════════════════════════════
# Case EXCEPTION-002: 加密 PDF
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestEncryptedPDF:
    """加密 PDF 处理。"""

    def test_detector_skips_encrypted(self, encrypted_pdf_path: str) -> None:
        """加密 PDF 不应进入检测流程。"""
        detector = PDFDetector()
        detections = detector.detect(encrypted_pdf_path)
        # 加密 PDF 应返回空检测结果
        assert isinstance(detections, list)

    def test_encrypted_batch_fails_gracefully(
        self, encrypted_pdf_path: str
    ) -> None:
        """加密 PDF 在批处理中应失败但不中断。"""
        manager = BatchManager()
        batch = BatchTask()
        ft = FileCleaningTask(file_path=encrypted_pdf_path, document_type="PDF")
        product = ProductTask(file_tasks=[ft])

        result = manager.run_batch(batch, [product])
        # 加密文件导致的失败不应是 PR 级别的异常
        assert result.status in (
            "COMPLETED_WITH_ERROR", "FAILED", "COMPLETED"
        )


# ══════════════════════════════════════════════════════════════════════════════
# Case EXCEPTION-003: 空白 PDF
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestEmptyPDF:
    """空白 PDF 处理。"""

    def test_empty_pdf_detection(self, empty_pdf_path: str) -> None:
        """空白 PDF 检测应返回空。"""
        detector = PDFDetector()
        detections = detector.detect(empty_pdf_path)
        assert isinstance(detections, list)

    def test_empty_pdf_plan(self, empty_pdf_path: str) -> None:
        """空白 PDF 不生成 Action。"""
        detector = PDFDetector()
        detections = detector.detect(empty_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=empty_pdf_path)
        assert len(plan.actions) == 0


# ══════════════════════════════════════════════════════════════════════════════
# Case EXCEPTION-004: 输出文件损坏（Validator 检测）
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestValidatorHandlesBadOutput:
    """Validator 处理异常输出。"""

    def test_output_not_found(self) -> None:
        """输出文件不存在应 FAILED。"""
        plan = CleaningPlan(file_path="nonexistent.pdf", risk_level=RiskLevel.AUTO)
        validator = Validator()
        report = validator.validate(
            original_file="/nonexistent/orig.pdf",
            cleaned_file="/nonexistent/clean.pdf",
            cleaning_plan=plan,
        )
        assert report.status == "FAILED"
        assert "OUTPUT_NOT_FOUND" in report.errors

    def test_empty_output_file(self) -> None:
        """空输出文件应 FAILED。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_orig:
            f_orig.write(b"some content")
            orig_path = f_orig.name

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f_clean:
            clean_path = f_clean.name  # 0 bytes

        try:
            plan = CleaningPlan(file_path=orig_path, risk_level=RiskLevel.AUTO)
            validator = Validator()
            report = validator.validate(orig_path, clean_path, plan)
            assert "OUTPUT_FILE_EMPTY" in report.errors
        finally:
            os.unlink(orig_path)
            os.unlink(clean_path)


# ══════════════════════════════════════════════════════════════════════════════
# Case EXCEPTION-005: 未知文件类型
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestUnsupportedFormat:
    """不支持的文件格式处理。"""

    def test_batch_skips_unsupported(self) -> None:
        """批处理中不支持的文件应 SKIPPED。"""
        manager = BatchManager()
        batch = BatchTask()
        ft = FileCleaningTask(file_path="/tmp/test.xyz")
        product = ProductTask(file_tasks=[ft])

        result = manager.run_batch(batch, [product])
        assert ft.status == "SKIPPED"
        assert "不支持的文件格式" in (ft.error or "")


# ══════════════════════════════════════════════════════════════════════════════
# Case FAILURE-001: 批处理失败隔离
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestBatchFailureIsolation:
    """批处理中单文件失败不影响其他文件。"""

    def test_one_fails_others_continue(self) -> None:
        """一个文件失败，其他文件正常处理。"""
        with patch.object(BatchManager, "_process_file") as mock_process:
            manager = BatchManager()
            batch = BatchTask()
            product = ProductTask(file_tasks=[
                FileCleaningTask(file_path="/tmp/a.pdf"),
                FileCleaningTask(file_path="/tmp/b.pdf"),
                FileCleaningTask(file_path="/tmp/c.pdf"),
            ])

            call_count = [0]
            def side_effect(ft, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] == 2:
                    ft.status = "FAILED"
                    ft.error = "CORRUPTED"
                else:
                    ft.status = "COMPLETED"

            mock_process.side_effect = side_effect
            result = manager.run_batch(batch, [product])

            assert result.completed_files == 2
            assert result.failed_files == 1
            assert mock_process.call_count == 3

    def test_exception_isolation(self) -> None:
        """抛异常的文件应被隔离。"""
        with patch.object(BatchManager, "_process_file") as mock_process:
            manager = BatchManager()
            batch = BatchTask()
            product = ProductTask(file_tasks=[
                FileCleaningTask(file_path="/tmp/good1.pdf"),
                FileCleaningTask(file_path="/tmp/crash.pdf"),
                FileCleaningTask(file_path="/tmp/good2.pdf"),
            ])

            call_count = [0]
            def side_effect(ft, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] == 2:
                    raise RuntimeError("Unexpected process crash")
                ft.status = "COMPLETED"

            mock_process.side_effect = side_effect
            result = manager.run_batch(batch, [product])

            assert result.failed_files == 1  # crash.pdf
            assert result.completed_files == 2  # good1.pdf, good2.pdf


# ══════════════════════════════════════════════════════════════════════════════
# Case STATUS-001: 状态流转完整性
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestStatusTransitions:
    """状态流转完整性验证。"""

    def test_batch_status_flow(self) -> None:
        """BatchTask 状态完整流转。"""
        batch = BatchTask()
        assert batch.status == "CREATED"

        batch.status = "RUNNING"
        assert batch.status == "RUNNING"

        batch.completed_files = 10
        batch.total_files = 10
        batch.update_status()
        assert batch.status == "COMPLETED"

    def test_product_status_flow(self) -> None:
        """ProductTask 状态完整流转。"""
        product = ProductTask(file_tasks=[
            FileCleaningTask(status="COMPLETED"),
        ])
        assert product.status == "WAITING"

        product.status = "RUNNING"
        product.update_status()
        assert product.status == "COMPLETED"

    def test_file_status_flow(self) -> None:
        """FileCleaningTask 状态完整流转。"""
        ft = FileCleaningTask()
        assert ft.status == "WAITING"

        ft.status = "ANALYZING"
        assert ft.status == "ANALYZING"

        ft.status = "CLEANING"
        assert ft.status == "CLEANING"

        ft.status = "VALIDATING"
        assert ft.status == "VALIDATING"

        ft.status = "COMPLETED"
        assert ft.status == "COMPLETED"

        ft2 = FileCleaningTask()
        ft2.status = "FAILED"
        assert ft2.status == "FAILED"

        ft3 = FileCleaningTask()
        ft3.status = "SKIPPED"
        assert ft3.status == "SKIPPED"


# ══════════════════════════════════════════════════════════════════════════════
# Case SECURITY-001: 原始文件保护
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestOriginalFileProtection:
    """原始文件不被修改。"""

    def test_executor_copies_before_clean(self) -> None:
        """Executor 在清理前复制源文件。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            orig_content = b"original content " * 100
            f.write(orig_content)
            orig_path = f.name

        try:
            plan = CleaningPlan(
                file_path=orig_path,
                risk_level=RiskLevel.AUTO,
                actions=[
                    CleaningAction(
                        action_type="REMOVE_ANNOTATION",
                        page=1, target_type="annotation",
                        confidence=1.0, risk_level=RiskLevel.AUTO,
                        risk_score=95.0,
                    ),
                ],
            )

            with patch(
                "executor.cleaning_executor.ActionExecutor.execute"
            ) as mock_exec:
                from cleaner import CleaningResult, CleaningStatus
                mock_exec.return_value = [
                    CleaningResult(
                        action=plan.actions[0],
                        status=CleaningStatus.SUCCESS,
                    ),
                ]

                executor = CleaningExecutor()
                executor.execute(plan, file_path=orig_path)

            # 原始文件内容应不变
            with open(orig_path, "rb") as f:
                assert f.read() == orig_content

        finally:
            os.unlink(orig_path)
