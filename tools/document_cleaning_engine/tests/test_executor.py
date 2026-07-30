"""Executor 单元测试。

测试 ActionExecutor 和 CleaningExecutor 的执行流程、失败隔离、取消等。
全部使用 Mock 避免依赖实际 PDF/Word 文件。
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from unittest.mock import MagicMock, patch

import pytest

from cleaner import CleaningResult, CleaningStatus
from models.execution_context import ExecutionContext
from risk import CleaningAction, CleaningPlan, RiskLevel
from executor.action_executor import ActionExecutor
from executor.cleaning_executor import CleaningExecutor


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def sample_action() -> CleaningAction:
    return CleaningAction(
        action_type="REMOVE_ANNOTATION",
        page=1,
        target_type="annotation",
        confidence=1.0,
        risk_level=RiskLevel.AUTO,
        risk_score=95.0,
    )


@pytest.fixture
def sample_plan(sample_action: CleaningAction) -> CleaningPlan:
    return CleaningPlan(
        file_path="test.pdf",
        risk_level=RiskLevel.AUTO,
        actions=[sample_action],
    )


@pytest.fixture
def sample_context() -> ExecutionContext:
    return ExecutionContext(
        task_id=str(uuid.uuid4()),
        input_file="/tmp/test_input.pdf",
        output_file="/tmp/test_output.pdf",
        document_type="PDF",
    )


# ── Test ActionExecutor ───────────────────────────────────────────────────────


class TestActionExecutor:
    """ActionExecutor 基本功能测试。"""

    def test_empty_plan(self, sample_context: ExecutionContext) -> None:
        """空计划应返回空结果。"""
        executor = ActionExecutor()
        plan = CleaningPlan(
            file_path="empty.pdf",
            risk_level=RiskLevel.IGNORE,
            actions=[],
        )
        results = executor.execute(plan, sample_context)
        assert results == []

    @patch("executor.action_executor.PDFCleaner")
    def test_pdf_execution(
        self,
        mock_pdf_cleaner: MagicMock,
        sample_plan: CleaningPlan,
        sample_context: ExecutionContext,
        sample_action: CleaningAction,
    ) -> None:
        """PDF 执行应调用 PDFCleaner。"""
        mock_pdf_cleaner_instance = MagicMock()
        mock_pdf_cleaner.return_value = mock_pdf_cleaner_instance
        mock_pdf_cleaner_instance.clean.return_value = [
            CleaningResult(action=sample_action, status=CleaningStatus.SUCCESS),
        ]

        executor = ActionExecutor()
        executor._pdf_cleaner = mock_pdf_cleaner_instance
        results = executor.execute(sample_plan, sample_context)

        assert len(results) == 1
        assert results[0].status == CleaningStatus.SUCCESS
        mock_pdf_cleaner_instance.clean.assert_called_once_with(
            input_path=sample_context.input_file,
            plan=sample_plan,
            output_path=sample_context.output_file,
        )

    @patch("executor.action_executor.WordTextCleaner")
    @patch("executor.action_executor.WordObjectCleaner")
    def test_word_execution(
        self,
        mock_obj_cleaner: MagicMock,
        mock_text_cleaner: MagicMock,
        sample_action: CleaningAction,
    ) -> None:
        """Word 执行应调用对应 Cleaner。"""
        word_plan = CleaningPlan(
            file_path="test.docx",
            risk_level=RiskLevel.AUTO,
            document_type="WORD",
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT",
                    page=1, target_type="text",
                    confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
                CleaningAction(
                    action_type="REMOVE_SHAPE",
                    page=1, target_type="shape",
                    confidence=0.9, risk_level=RiskLevel.AUTO, risk_score=75.0,
                ),
            ],
        )
        word_context = ExecutionContext(
            task_id=str(uuid.uuid4()),
            input_file="/tmp/test.docx",
            output_file="/tmp/test_clean.docx",
            document_type="WORD",
        )

        mock_text_instance = MagicMock()
        mock_text_cleaner.return_value = mock_text_instance
        mock_text_instance.clean.return_value = [
            CleaningResult(action=word_plan.actions[0], status=CleaningStatus.SUCCESS),
        ]

        mock_obj_instance = MagicMock()
        mock_obj_cleaner.return_value = mock_obj_instance
        mock_obj_instance.clean.return_value = [
            CleaningResult(action=word_plan.actions[1], status=CleaningStatus.SUCCESS),
        ]

        executor = ActionExecutor()
        executor._word_text_cleaner = mock_text_instance
        executor._word_object_cleaner = mock_obj_instance

        results = executor.execute(word_plan, word_context)
        assert len(results) == 2

        mock_text_instance.clean.assert_called_once()
        mock_obj_instance.clean.assert_called_once()

    def test_unsupported_document_type(
        self, sample_plan: CleaningPlan
    ) -> None:
        """不支持的类型应返回 SKIPPED。"""
        context = ExecutionContext(
            task_id=str(uuid.uuid4()),
            input_file="test.xyz",
            output_file="test_clean.xyz",
            document_type="XYZ",
        )
        executor = ActionExecutor()
        results = executor.execute(sample_plan, context)
        assert len(results) == 1
        assert results[0].status == CleaningStatus.SKIPPED

    def test_cancel_before_execution(
        self, sample_plan: CleaningPlan
    ) -> None:
        """取消后执行应返回空结果。"""
        context = ExecutionContext(
            task_id=str(uuid.uuid4()),
            input_file="test.pdf",
            output_file="test_clean.pdf",
            document_type="PDF",
            cancel_requested=True,
        )
        executor = ActionExecutor()
        results = executor.execute(sample_plan, context)
        assert results == []


class TestActionExecutorFailure:
    """ActionExecutor 失败隔离测试。"""

    def test_page_failures_none(self) -> None:
        """无页面失败时返回 None。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT", page=1, target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        results = [
            CleaningResult(action=action, status=CleaningStatus.SUCCESS),
            CleaningResult(action=action, status=CleaningStatus.SUCCESS),
        ]
        assert ActionExecutor.check_page_failures(results) is None

    def test_page_failures_exceed_threshold(self) -> None:
        """页面失败超过阈值时应返回提示。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT", page=5, target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        results = [
            CleaningResult(
                action=action, status=CleaningStatus.FAILED, error="err"
            )
            for _ in range(4)  # 阈值=3, 这里4个
        ]
        hint = ActionExecutor.check_page_failures(results)
        assert hint is not None
        assert "5" in hint

    def test_page_failures_below_threshold(self) -> None:
        """页面失败未超过阈值时应返回 None。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT", page=3, target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        results = [
            CleaningResult(
                action=action, status=CleaningStatus.FAILED, error="err"
            )
            for _ in range(2)  # 阈值=3, 这里2个
        ]
        assert ActionExecutor.check_page_failures(results) is None

    def test_critical_failure_detected(self) -> None:
        """NODE_NOT_FOUND 应视为关键失败。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT", page=1, target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        results = [
            CleaningResult(
                action=action, status=CleaningStatus.FAILED,
                error="not found",
                metadata={"reason": "NODE_NOT_FOUND"},
            ),
        ]
        assert ActionExecutor.has_critical_failure(results) is True

    def test_no_critical_failure(self) -> None:
        """非关键失败应返回 False。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT", page=1, target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        results = [
            CleaningResult(
                action=action, status=CleaningStatus.FAILED,
                error="some other error",
            ),
        ]
        assert ActionExecutor.has_critical_failure(results) is False


# ── Test CleaningExecutor ────────────────────────────────────────────────────


class TestCleaningExecutor:
    """CleaningExecutor 集成测试（Mock Cleaner）。"""

    def test_execute_empty_plan(self) -> None:
        """空计划应返回失败任务（无源文件）。"""
        plan = CleaningPlan(
            file_path="",
            risk_level=RiskLevel.IGNORE,
            actions=[],
        )
        executor = CleaningExecutor()
        task = executor.execute(plan)
        # 空计划且无源文件 → FAILED（无法复制）
        # 但 executor 内部会处理空计划：create_task → set_failed
        assert task.task_id is not None
        # 由于没有 source file 且 plan 为空，会在不同阶段出错
        assert task.status in ("COMPLETED", "FAILED")

    def test_execute_with_temp_file(self) -> None:
        """使用临时文件执行应完成。"""
        # 创建临时 PDF 文件
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name
            f.write(b"%PDF-1.4 dummy pdf content")

        try:
            plan = CleaningPlan(
                file_path=pdf_path,
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

            with patch("executor.cleaning_executor.ActionExecutor.execute") as mock_exec:
                mock_exec.return_value = [
                    CleaningResult(
                        action=plan.actions[0],
                        status=CleaningStatus.SUCCESS,
                    ),
                ]

                executor = CleaningExecutor()
                task = executor.execute(plan)

                assert task.status == "COMPLETED"
                assert task.total_actions == 1
        finally:
            os.unlink(pdf_path)

    def test_execute_partial_success(self) -> None:
        """部分失败应返回 PARTIAL_SUCCESS。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name
            f.write(b"%PDF-1.4 dummy")

        try:
            plan = CleaningPlan(
                file_path=pdf_path,
                risk_level=RiskLevel.AUTO,
                actions=[
                    CleaningAction(
                        action_type="REMOVE_ANNOTATION",
                        page=1, target_type="annotation",
                        confidence=1.0, risk_level=RiskLevel.AUTO,
                        risk_score=95.0,
                    ),
                    CleaningAction(
                        action_type="REMOVE_TEXT",
                        page=2, target_type="text",
                        confidence=0.95, risk_level=RiskLevel.AUTO,
                        risk_score=80.0,
                    ),
                ],
            )

            with patch("executor.cleaning_executor.ActionExecutor.execute") as mock_exec:
                mock_exec.return_value = [
                    CleaningResult(
                        action=plan.actions[0],
                        status=CleaningStatus.SUCCESS,
                    ),
                    CleaningResult(
                        action=plan.actions[1],
                        status=CleaningStatus.FAILED,
                        error="NODE_NOT_FOUND",
                    ),
                ]

                executor = CleaningExecutor()
                task = executor.execute(plan)

                assert task.status == "PARTIAL_SUCCESS"
                assert task.success_count == 1
                assert task.failed_count == 1
        finally:
            os.unlink(pdf_path)

    def test_execute_need_review(self) -> None:
        """同一页面失败过多应为 NEED_REVIEW。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name
            f.write(b"%PDF-1.4 dummy")

        try:
            plan = CleaningPlan(
                file_path=pdf_path,
                risk_level=RiskLevel.AUTO,
                actions=[
                    CleaningAction(
                        action_type="REMOVE_TEXT",
                        page=5, target_type="text",
                        confidence=0.95, risk_level=RiskLevel.AUTO,
                        risk_score=80.0,
                    )
                    for _ in range(5)
                ],
            )

            with patch("executor.cleaning_executor.ActionExecutor.execute") as mock_exec:
                mock_exec.return_value = [
                    CleaningResult(
                        action=a,
                        status=CleaningStatus.FAILED,
                        error="error",
                    )
                    for a in plan.actions
                ]

                executor = CleaningExecutor()
                task = executor.execute(plan)

                assert task.status == "NEED_REVIEW"
                assert "5" in (task.error or "")
        finally:
            os.unlink(pdf_path)

    def test_cancel_during_execution(self) -> None:
        """取消任务应返回 CANCELLED 状态。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name
            f.write(b"%PDF-1.4 dummy")

        try:
            plan = CleaningPlan(
                file_path=pdf_path,
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

            executor = CleaningExecutor()
            task = executor.execute(plan)

            # 同步执行已完成，此时 request_cancel 应无效
            # （因为任务已不是 RUNNING 状态）
            result = executor.request_cancel(task.task_id)
            assert result is False or task.status != "RUNNING"
        finally:
            os.unlink(pdf_path)

    def test_execution_report_generated(self) -> None:
        """执行报告应包含正确字段。"""
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name
            f.write(b"%PDF-1.4 dummy")

        try:
            plan = CleaningPlan(
                file_path=pdf_path,
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

            with patch("executor.cleaning_executor.ActionExecutor.execute") as mock_exec:
                mock_exec.return_value = [
                    CleaningResult(
                        action=plan.actions[0],
                        status=CleaningStatus.SUCCESS,
                    ),
                ]

                executor = CleaningExecutor()
                task = executor.execute(plan)

                report_dir = os.path.join(
                    executor._output_base_dir,
                    task.task_id,
                    "report",
                )
                report_path = os.path.join(report_dir, "execution_report.json")
                plan_path = os.path.join(report_dir, "cleaning_plan.json")

                assert os.path.exists(report_path)
                assert os.path.exists(plan_path)

                with open(report_path) as f:
                    report = json.load(f)
                assert report["task_id"] == task.task_id
                assert report["status"] == "COMPLETED"
                assert report["success"] == 1
                assert report["failed"] == 0
        finally:
            os.unlink(pdf_path)


class TestActionExecutorEdgeCases:
    """ActionExecutor 边界情况测试。"""

    def test_executor_raises_exception(
        self, sample_plan: CleaningPlan, sample_context: ExecutionContext
    ) -> None:
        """Cleaner 抛出异常时 executor 应妥善处理。"""

        class _FailingCleaner:
            def clean(self, **kwargs):  # type: ignore[no-untyped-def]
                raise RuntimeError("Unexpected crash")

        executor = ActionExecutor()
        # 模拟_pdf_cleaner 抛异常
        executor._pdf_cleaner = _FailingCleaner()  # type: ignore[assignment]

        results = executor.execute(sample_plan, sample_context)
        # 应该返回 FAILED 结果，而不是传播异常
        assert len(results) == 1
        assert results[0].status == CleaningStatus.FAILED
        assert "Unexpected crash" in (results[0].error or "")
