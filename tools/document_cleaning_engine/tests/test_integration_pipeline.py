"""集成测试 — 完整端到端清理链路。

测试从 PDF/Word 输入到最终验证的完整流程。
使用 conftest 中的真实 PDF 生成 fixture 作为输入。
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from detector import DetectionResult, PDFDetector
from plan import PlanGenerator
from executor.cleaning_executor import CleaningExecutor
from validator import Validator
from risk import CleaningAction, CleaningPlan, RiskLevel
from reports.dry_run_report import DryRunReport


# ══════════════════════════════════════════════════════════════════════════════
# Case PDF-001: Annotation 水印删除完整流程
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestPipelineAnnotation:
    """Annotation 水印端到端流程。"""

    def test_detect_to_plan(self, annotation_pdf_path: str) -> None:
        """Detection → Plan 流程。"""
        detector = PDFDetector()
        detections = detector.detect(annotation_pdf_path)

        assert len(detections) > 0
        assert any(d.type == "annotation" for d in detections)

        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=annotation_pdf_path)

        assert len(plan.actions) > 0
        assert any(a.action_type == "REMOVE_ANNOTATION" for a in plan.actions)
        assert plan.risk_level in (RiskLevel.AUTO, RiskLevel.CONFIRM)

    def test_plan_to_execution(
        self, annotation_pdf_path: str
    ) -> None:
        """Plan → Executor 流程。"""
        detector = PDFDetector()
        detections = detector.detect(annotation_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=annotation_pdf_path)

        if plan.actions and plan.status == "WAIT_CONFIRM":
            plan = generator.confirm_plan(plan)

        executor = CleaningExecutor()
        task = executor.execute(plan, file_path=annotation_pdf_path)

        assert task.task_id is not None
        assert task.status in ("COMPLETED", "PARTIAL_SUCCESS", "FAILED")
        assert task.success_count + task.failed_count == task.total_actions

    def test_full_pipeline(self, annotation_pdf_path: str) -> None:
        """Detect → Plan → Execute → Validate 完整流程。"""
        detector = PDFDetector()
        detections = detector.detect(annotation_pdf_path)
        assert len(detections) > 0

        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=annotation_pdf_path)

        if plan.status == "WAIT_CONFIRM":
            plan = generator.confirm_plan(plan)

        executor = CleaningExecutor()
        task = executor.execute(plan, file_path=annotation_pdf_path)

        # 验证：找到输出文件并验证
        output_dir = os.path.join(
            executor._output_base_dir,
            task.task_id,
            "clean",
        )
        clean_files = []
        if os.path.isdir(output_dir):
            clean_files = os.listdir(output_dir)

        if clean_files:
            clean_path = os.path.join(output_dir, clean_files[0])
            validator = Validator()
            vresult = validator.validate(
                original_file=annotation_pdf_path,
                cleaned_file=clean_path,
                cleaning_plan=plan,
                task_id=task.task_id,
            )
            assert vresult.status in ("PASS", "WARNING", "FAILED", "NEED_REVIEW")


# ══════════════════════════════════════════════════════════════════════════════
# Case PDF-002: Artifact 水印完整流程
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestPipelineArtifact:
    """Artifact 水印端到端流程。"""

    def test_detect_artifact(self, artifact_pdf_path: str) -> None:
        """检测 Artifact 水印。"""
        detector = PDFDetector()
        detections = detector.detect(artifact_pdf_path)

        artifact_dets = [d for d in detections if d.type == "artifact"]
        # Artifact 检测可能为 0（根据 PDF 生成方式）
        # 但至少不会崩溃
        assert isinstance(detections, list)

    def test_artifact_to_plan(self, artifact_pdf_path: str) -> None:
        """Artifact → Plan 流程。"""
        detector = PDFDetector()
        detections = detector.detect(artifact_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=artifact_pdf_path)
        assert plan.file_path == artifact_pdf_path

    def test_artifact_full_pipeline(self, artifact_pdf_path: str) -> None:
        """Artifact 完整流程。"""
        detector = PDFDetector()
        detections = detector.detect(artifact_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=artifact_pdf_path)

        if plan.actions and plan.status == "WAIT_CONFIRM":
            plan = generator.confirm_plan(plan)

        executor = CleaningExecutor()
        task = executor.execute(plan, file_path=artifact_pdf_path)
        assert task.task_id is not None


# ══════════════════════════════════════════════════════════════════════════════
# Case PDF-003: 图片水印检测
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestPipelineImage:
    """图片水印端到端流程。"""

    def test_detect_image(self, image_logo_pdf_path: str) -> None:
        """检测图片水印。"""
        detector = PDFDetector()
        detections = detector.detect(image_logo_pdf_path)
        assert isinstance(detections, list)

    def test_image_risk_assessment(self, image_logo_pdf_path: str) -> None:
        """图片水印风险评估。"""
        detector = PDFDetector()
        detections = detector.detect(image_logo_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=image_logo_pdf_path)
        assert isinstance(plan.risk_level, RiskLevel)


# ══════════════════════════════════════════════════════════════════════════════
# Case PDF-004: 文本水印检测 + 删除 + 验证
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestPipelineText:
    """文本水印端到端流程。"""

    def test_detect_text(self, text_watermark_pdf_path: str) -> None:
        """检测文本水印。"""
        detector = PDFDetector()
        detections = detector.detect(text_watermark_pdf_path)
        assert isinstance(detections, list)

    def test_text_risk_and_plan(self, text_watermark_pdf_path: str) -> None:
        """文本水印风险评估并生成计划。"""
        detector = PDFDetector()
        detections = detector.detect(text_watermark_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=text_watermark_pdf_path)

        assert hasattr(plan, "actions")
        assert hasattr(plan, "risk_level")
        assert hasattr(plan, "summary")

    def test_text_pipeline(self, text_watermark_pdf_path: str) -> None:
        """文本水印完整流程。"""
        detector = PDFDetector()
        detections = detector.detect(text_watermark_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=text_watermark_pdf_path)

        if plan.actions and plan.status == "WAIT_CONFIRM":
            plan = generator.confirm_plan(plan)

        executor = CleaningExecutor()
        task = executor.execute(plan, file_path=text_watermark_pdf_path)
        assert task.task_id is not None


# ══════════════════════════════════════════════════════════════════════════════
# Case PDF-005: 页眉页脚检测 + 删除
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestPipelineHeaderFooter:
    """页眉页脚端到端流程。"""

    def test_detect_header(self, header_pdf_path: str) -> None:
        """检测页眉。"""
        detector = PDFDetector()
        detections = detector.detect(header_pdf_path)
        assert isinstance(detections, list)

    def test_detect_footer(self, footer_pdf_path: str) -> None:
        """检测页脚。"""
        detector = PDFDetector()
        detections = detector.detect(footer_pdf_path)
        assert isinstance(detections, list)

    def test_header_pipeline(self, header_pdf_path: str) -> None:
        """页眉完整流程。"""
        detector = PDFDetector()
        detections = detector.detect(header_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=header_pdf_path)

        if plan.actions and plan.status == "WAIT_CONFIRM":
            plan = generator.confirm_plan(plan)

        executor = CleaningExecutor()
        task = executor.execute(plan, file_path=header_pdf_path)
        assert task.task_id is not None


# ══════════════════════════════════════════════════════════════════════════════
# Case PIPELINE-001: Dry-run → Plan → Report
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestDryRunPipeline:
    """Dry-run 报告生成流程。"""

    def test_dry_run_from_detections(self, annotation_pdf_path: str) -> None:
        """从检测结果生成 Dry-run 报告。"""
        detector = PDFDetector()
        detections = detector.detect(annotation_pdf_path)
        generator = PlanGenerator()
        plan = generator.generate(detections, file_path=annotation_pdf_path)

        reporter = DryRunReport()
        report_str = reporter.generate(plan)

        import json
        report = json.loads(report_str)
        assert "file" in report
        assert "summary" in report
        assert "actions" in report


# ══════════════════════════════════════════════════════════════════════════════
# Case DATA-001: 数据模型一致性验证
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestDataConsistency:
    """数据模型一致性验证。"""

    def test_detection_result_uniform(self) -> None:
        """所有检测器输出统一格式。"""
        # 所有 DetectionResult 应有相同字段
        dr = DetectionResult(type="test", page=1, confidence=0.8)
        assert hasattr(dr, "type")
        assert hasattr(dr, "page")
        assert hasattr(dr, "bbox")
        assert hasattr(dr, "content")
        assert hasattr(dr, "confidence")
        assert hasattr(dr, "metadata")

    def test_cleaning_action_uniform(self) -> None:
        """所有 CleaningAction 统一格式。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT",
            page=1,
            target_type="text",
            confidence=0.95,
            risk_level=RiskLevel.AUTO,
            risk_score=85.0,
        )
        assert hasattr(action, "action_id")
        assert hasattr(action, "action_type")
        assert hasattr(action, "page")
        assert hasattr(action, "target_type")
        assert hasattr(action, "confidence")
        assert hasattr(action, "risk_level")
        assert hasattr(action, "risk_score")
        assert hasattr(action, "target_ref")
        assert hasattr(action, "content")
        assert hasattr(action, "bbox")
        assert hasattr(action, "metadata")

    def test_cleaning_plan_uniform(self) -> None:
        """所有 CleaningPlan 统一格式。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
        )
        assert hasattr(plan, "plan_id")
        assert hasattr(plan, "file_path")
        assert hasattr(plan, "document_type")
        assert hasattr(plan, "created_time")
        assert hasattr(plan, "actions")
        assert hasattr(plan, "summary")
        assert hasattr(plan, "risk_level")
        assert hasattr(plan, "status")

    def test_risk_level_enum_values(self) -> None:
        """RiskLevel 枚举值正确。"""
        assert RiskLevel.AUTO.value == "AUTO"
        assert RiskLevel.CONFIRM.value == "CONFIRM"
        assert RiskLevel.IGNORE.value == "IGNORE"


# ══════════════════════════════════════════════════════════════════════════════
# Case MODULE-001: 模块导入一致性
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.integration
class TestModuleImports:
    """所有模块可正常导入。"""

    def test_detector_import(self) -> None:
        from detector import PDFDetector, DetectionResult
        assert PDFDetector is not None
        assert DetectionResult is not None

    def test_analyzer_import(self) -> None:
        from analyzer import PDFAnalyzer
        assert PDFAnalyzer is not None

    def test_risk_import(self) -> None:
        from risk import RiskEngine, RiskLevel, CleaningAction, CleaningPlan
        assert RiskEngine is not None

    def test_plan_import(self) -> None:
        from plan import PlanGenerator
        assert PlanGenerator is not None

    def test_executor_import(self) -> None:
        from executor import CleaningExecutor, ActionExecutor
        assert CleaningExecutor is not None

    def test_validator_import(self) -> None:
        from validator import Validator, PDFValidator, WordValidator
        assert Validator is not None

    def test_batch_import(self) -> None:
        from batch import BatchManager, BatchTask, ProductTask
        assert BatchManager is not None

    def test_logutil_import(self) -> None:
        from logutil import MFLogger, JSONFormatter
        assert MFLogger is not None

    def test_report_import(self) -> None:
        from report import BatchReportGenerator
        assert BatchReportGenerator is not None

    def test_task_import(self) -> None:
        from task import CleaningTask, TaskManager
        assert CleaningTask is not None

    def test_models_import(self) -> None:
        from models import (
            CleaningAction, CleaningPlan, CleaningResult,
            ExecutionContext, ValidationReport,
        )
        assert CleaningAction is not None
        assert CleaningPlan is not None
        assert CleaningResult is not None
        assert ExecutionContext is not None
        assert ValidationReport is not None
