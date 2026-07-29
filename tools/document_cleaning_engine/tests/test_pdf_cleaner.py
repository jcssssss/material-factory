"""PDFCleaner 单元测试。"""

from __future__ import annotations

import os
import tempfile

import fitz
import pytest

from cleaner import (
    CleaningResult,
    CleaningStatus,
    PDFCleaner,
)
from cleaner.annotation_cleaner import AnnotationCleaner
from cleaner.artifact_cleaner import ArtifactCleaner
from cleaner.cleaner_utils import (
    verify_annotation_count,
    verify_page_count,
)
from risk import (
    CleaningAction,
    CleaningPlan,
    RiskLevel,
)


class TestAnnotationCleaner:
    """Annotation 清理测试。"""

    def setup_method(self) -> None:
        self.cleaner = AnnotationCleaner()

    def test_delete_annotation(self, annotation_pdf_path: str) -> None:
        """应能删除指定 Annotation。"""
        before_count = verify_annotation_count(annotation_pdf_path)
        fd, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        doc = fitz.open(annotation_pdf_path)
        try:
            # 获取第一个 Annotation 的 bbox
            page = doc[0]
            annot = list(page.annots())[0]

            action = CleaningAction(
                action_type="REMOVE_ANNOTATION",
                page=1,
                target_type="annotation",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
                bbox=(annot.rect.x0, annot.rect.y0, annot.rect.x1, annot.rect.y1),
                metadata={"annot_type": str(annot.type[0]) if isinstance(annot.type, tuple) else str(annot.type)},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.SUCCESS
            assert result.metadata.get("removed_count", 0) >= 1

            # 保存到输出文件用于验证
            doc.save(output_path, garbage=4, deflate=True)
        finally:
            doc.close()

        # 验证删除后 Annotation 减少
        after_count = verify_annotation_count(output_path)
        assert after_count < before_count
        os.unlink(output_path)

    def test_delete_nonexistent_annotation(self) -> None:
        """不存在的 Annotation 应返回 FAILED。"""
        doc = fitz.open()
        try:
            doc.new_page()
            doc.insert_page(0)

            action = CleaningAction(
                action_type="REMOVE_ANNOTATION",
                page=1,
                target_type="annotation",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
                bbox=(0, 0, 10, 10),
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
            assert "not found" in (result.error or "")
        finally:
            doc.close()

    def test_page_out_of_range(self) -> None:
        """越界页码应返回 FAILED。"""
        doc = fitz.open()
        try:
            action = CleaningAction(
                action_type="REMOVE_ANNOTATION",
                page=999,
                target_type="annotation",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
            )
            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
        finally:
            doc.close()


class TestArtifactCleaner:
    """Artifact 清理测试。"""

    def setup_method(self) -> None:
        self.cleaner = ArtifactCleaner()

    def test_delete_artifact_watermark(self, artifact_pdf_path: str) -> None:
        """应能删除 Watermark Artifact。"""
        doc = fitz.open(artifact_pdf_path)
        try:
            action = CleaningAction(
                action_type="REMOVE_ARTIFACT",
                page=1,
                target_type="artifact",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.SUCCESS
            assert result.metadata.get("removed_count", 0) >= 1
        finally:
            doc.close()

    def test_delete_nonexistent_artifact(self) -> None:
        """不存在的 Artifact 应返回 FAILED。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((50, 50), "Normal content")

            action = CleaningAction(
                action_type="REMOVE_ARTIFACT",
                page=1,
                target_type="artifact",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
        finally:
            doc.close()


class TestPDFCleaner:
    """PDFCleaner 集成测试。"""

    def setup_method(self) -> None:
        self.cleaner = PDFCleaner()

    def _create_annotation_plan(
        self, pdf_path: str, page: int = 1
    ) -> CleaningPlan:
        """创建用于测试的 Annotation 删除计划。"""
        doc = fitz.open(pdf_path)
        try:
            page_obj = doc[page - 1]
            annots = list(page_obj.annots())
            if not annots:
                return CleaningPlan(file_path=pdf_path, risk_level=RiskLevel.IGNORE)
            annot = annots[0]
            action = CleaningAction(
                action_type="REMOVE_ANNOTATION",
                page=page,
                target_type="annotation",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
                bbox=(annot.rect.x0, annot.rect.y0, annot.rect.x1, annot.rect.y1),
                metadata={"annot_type": str(annot.type[0]) if isinstance(annot.type, tuple) else str(annot.type)},
            )
        finally:
            doc.close()
        return CleaningPlan(
            file_path=pdf_path,
            risk_level=RiskLevel.AUTO,
            actions=[action],
        )

    def test_clean_annotation(self, annotation_pdf_path: str) -> None:
        """集成测试：删除 Annotation 并验证。"""
        fd, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        try:
            before_count = verify_annotation_count(annotation_pdf_path)
            before_pages = verify_page_count(annotation_pdf_path)

            plan = self._create_annotation_plan(annotation_pdf_path)
            results = self.cleaner.clean(annotation_pdf_path, plan, output_path)

            # 验证结果
            assert len(results) >= 1
            assert any(r.status == CleaningStatus.SUCCESS for r in results)

            # 验证输出文件存在
            assert os.path.exists(output_path)

            # 验证页数不变
            after_pages = verify_page_count(output_path)
            assert after_pages == before_pages

            # 验证 Annotation 减少
            after_count = verify_annotation_count(output_path)
            assert after_count < before_count
        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)

    def test_clean_artifact(self, artifact_pdf_path: str) -> None:
        """集成测试：删除 Artifact 并验证页数不变。"""
        fd, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        try:
            before_pages = verify_page_count(artifact_pdf_path)

            action = CleaningAction(
                action_type="REMOVE_ARTIFACT",
                page=1,
                target_type="artifact",
                confidence=1.0,
                risk_level=RiskLevel.AUTO,
                risk_score=95.0,
            )
            plan = CleaningPlan(
                file_path=artifact_pdf_path,
                risk_level=RiskLevel.AUTO,
                actions=[action],
            )

            results = self.cleaner.clean(artifact_pdf_path, plan, output_path)
            assert len(results) >= 1
            assert any(r.status == CleaningStatus.SUCCESS for r in results)

            # 页数不变
            after_pages = verify_page_count(output_path)
            assert after_pages == before_pages
        finally:
            if os.path.exists(output_path):
                os.unlink(output_path)

    def test_empty_plan(self) -> None:
        """空计划应返回空结果。"""
        plan = CleaningPlan(file_path="test.pdf", risk_level=RiskLevel.IGNORE)
        results = self.cleaner.clean("test.pdf", plan, "out.pdf")
        assert len(results) == 0

    def test_no_auto_actions(self) -> None:
        """只有非 AUTO 的 Action 应跳过。"""
        action = CleaningAction(
            action_type="REMOVE_HEADER",
            page=1,
            target_type="header",
            confidence=0.8,
            risk_level=RiskLevel.CONFIRM,
            risk_score=60.0,
        )
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.CONFIRM,
            actions=[action],
        )
        results = self.cleaner.clean("test.pdf", plan, "out.pdf")
        assert len(results) == 0

    def test_unsupported_action_skipped(self) -> None:
        """不支持的 Action 类型应被跳过。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((50, 50), "Content")
            fd, input_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd)
            doc.save(input_path)
        finally:
            doc.close()

        fd2, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd2)

        try:
            # 使用不存在的 Action 类型测试跳过
            action = CleaningAction(
                action_type="REMOVE_UNKNOWN",
                page=1,
                target_type="unknown",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=80.0,
            )
            plan = CleaningPlan(
                file_path=input_path,
                risk_level=RiskLevel.AUTO,
                actions=[action],
            )

            results = self.cleaner.clean(input_path, plan, output_path)
            assert len(results) == 1
            assert results[0].status == CleaningStatus.SKIPPED
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)

    def test_action_failure_isolation(self) -> None:
        """单 Action 失败不应影响整体执行。"""
        doc = fitz.open()
        try:
            for _ in range(3):
                page = doc.new_page()
                page.insert_text((50, 50), "Content")
            fd, input_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd)
            doc.save(input_path)
        finally:
            doc.close()

        fd2, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd2)

        try:
            # 一个合法的 annotation 删除 + 两个不合法的（页面无 annotation）
            actions = [
                CleaningAction(
                    action_type="REMOVE_ANNOTATION",
                    page=1,
                    target_type="annotation",
                    confidence=1.0,
                    risk_level=RiskLevel.AUTO,
                    risk_score=95.0,
                    bbox=(0, 0, 10, 10),
                ),
                CleaningAction(
                    action_type="REMOVE_ANNOTATION",
                    page=2,
                    target_type="annotation",
                    confidence=1.0,
                    risk_level=RiskLevel.AUTO,
                    risk_score=95.0,
                ),
                CleaningAction(
                    action_type="REMOVE_ARTIFACT",
                    page=3,
                    target_type="artifact",
                    confidence=1.0,
                    risk_level=RiskLevel.AUTO,
                    risk_score=95.0,
                ),
            ]
            plan = CleaningPlan(
                file_path=input_path,
                risk_level=RiskLevel.AUTO,
                actions=actions,
            )

            results = self.cleaner.clean(input_path, plan, output_path)

            # 第一个应为 FAILED（无 annotation）
            # 第二、三个也应为 FAILED
            assert len(results) == 3
            # 保存成功 -> action 本身不报错，但目标不存在则 FAILED
            failed_count = sum(1 for r in results if r.status == CleaningStatus.FAILED)
            assert failed_count == 3  # 3 个都因为目标不存在而 FAILED
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)


class TestCleaningResult:
    """CleaningResult 数据模型测试。"""

    def test_success_result(self) -> None:
        """SUCCESS 状态应正确设置。"""
        action = CleaningAction(
            action_type="REMOVE_ANNOTATION",
            page=1,
            target_type="annotation",
            confidence=1.0,
            risk_level=RiskLevel.AUTO,
            risk_score=95.0,
        )
        result = CleaningResult(
            action=action,
            status=CleaningStatus.SUCCESS,
            metadata={"removed_count": 1},
        )
        assert result.status == CleaningStatus.SUCCESS
        assert result.error is None
        assert result.metadata["removed_count"] == 1

    def test_failed_result(self) -> None:
        """FAILED 状态应包含错误信息。"""
        action = CleaningAction(
            action_type="REMOVE_ANNOTATION",
            page=1,
            target_type="annotation",
            confidence=1.0,
            risk_level=RiskLevel.AUTO,
            risk_score=95.0,
        )
        result = CleaningResult(
            action=action,
            status=CleaningStatus.FAILED,
            error="annotation target not found",
            fallback_action="manual_review",
        )
        assert result.status == CleaningStatus.FAILED
        assert result.error == "annotation target not found"
        assert result.fallback_action == "manual_review"

    def test_skipped_result(self) -> None:
        """SKIPPED 状态应正确设置。"""
        action = CleaningAction(
            action_type="REMOVE_TEXT",
            page=1,
            target_type="text",
            confidence=0.9,
            risk_level=RiskLevel.AUTO,
            risk_score=80.0,
        )
        result = CleaningResult(
            action=action,
            status=CleaningStatus.SKIPPED,
            error="unsupported action type",
        )
        assert result.status == CleaningStatus.SKIPPED
