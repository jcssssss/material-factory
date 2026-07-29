"""ImageCleaner 单元测试。"""

from __future__ import annotations

import os
import tempfile

import fitz
import pytest

from cleaner import CleaningStatus, ImageCleaner, PDFCleaner
from cleaner.cleaner_utils import verify_page_count
from risk import CleaningAction, CleaningPlan, RiskLevel
from detector.image_detector import ImageDetector


class TestImageCleaner:
    """ImageCleaner 单元测试。"""

    def setup_method(self) -> None:
        self.cleaner = ImageCleaner()
        self.detector = ImageDetector()

    def _create_pdf_with_logo(self, num_pages: int = 5) -> str:
        """创建包含重复 Logo 的测试 PDF。"""
        fd, path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        doc = fitz.open()
        try:
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 100))
            pix.clear_with()

            for _ in range(num_pages):
                page = doc.new_page()
                page.insert_image(fitz.Rect(200, 350, 400, 450), pixmap=pix)
                page.insert_text((50, 100), "Normal content", fontsize=11)

            doc.save(path)
        finally:
            doc.close()

        return path

    def test_remove_image_reference(self) -> None:
        """应删除图片对象引用。"""
        input_path = self._create_pdf_with_logo()
        fd, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        try:
            # 先用检测器找到图片
            doc = fitz.open(input_path)
            results = self.detector.detect(doc)
            doc.close()

            assert len(results) >= 1, "should detect at least one image"
            detection = results[0]
            xref = detection.metadata["xref"]

            # 创建清理 Action
            action = CleaningAction(
                action_type="REMOVE_IMAGE",
                page=detection.page,
                target_type="image",
                confidence=detection.confidence,
                risk_level=RiskLevel.AUTO,
                risk_score=85.0,
                metadata=dict(detection.metadata),
            )

            # 执行清理
            doc2 = fitz.open(input_path)
            try:
                result = self.cleaner.clean(doc2, action)
                assert result.status == CleaningStatus.SUCCESS
                doc2.save(output_path, garbage=4, deflate=True)
            finally:
                doc2.close()

            # 验证图片被删除
            doc3 = fitz.open(output_path)
            try:
                page = doc3[0]
                remaining = page.get_images()
                assert len(remaining) == 0
                # 文本应保留
                text = page.get_text().strip()
                assert "Normal" in text
            finally:
                doc3.close()

            # 页数不变
            assert verify_page_count(output_path) == 5
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)

    def test_remove_nonexistent_image(self) -> None:
        """不存在的图片应返回 FAILED。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((50, 50), "Content only")

            action = CleaningAction(
                action_type="REMOVE_IMAGE",
                page=1,
                target_type="image",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=85.0,
                metadata={"xref": 9999, "repeat_rate": 0.8},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
        finally:
            doc.close()

    def test_page_out_of_range(self) -> None:
        """越界页码应返回 FAILED。"""
        doc = fitz.open()
        try:
            doc.new_page()
            action = CleaningAction(
                action_type="REMOVE_IMAGE",
                page=999,
                target_type="image",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=85.0,
                metadata={"xref": 1, "repeat_rate": 0.8},
            )
            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
        finally:
            doc.close()

    def test_low_repeat_rate_skipped(self) -> None:
        """低重复率应被跳过。"""
        doc = fitz.open()
        try:
            doc.new_page()
            action = CleaningAction(
                action_type="REMOVE_IMAGE",
                page=1,
                target_type="image",
                confidence=0.7,
                risk_level=RiskLevel.AUTO,
                risk_score=60.0,
                metadata={"xref": 1, "repeat_rate": 0.3},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.SKIPPED
            assert "repeat_rate" in (result.error or "")
        finally:
            doc.close()

    def test_missing_xref_metadata(self) -> None:
        """缺少 xref 时应返回 FAILED。"""
        doc = fitz.open()
        try:
            doc.new_page()
            action = CleaningAction(
                action_type="REMOVE_IMAGE",
                page=1,
                target_type="image",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=85.0,
                metadata={"repeat_rate": 0.8},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
            assert "xref" in (result.error or "")
        finally:
            doc.close()


class TestImageCleanerIntegration:
    """Image Cleaner 集成测试。"""

    def setup_method(self) -> None:
        self.detector = ImageDetector()
        self.cleaner = PDFCleaner()

    def test_detect_and_clean_pipeline(self) -> None:
        """检测 → 清理 全流程集成测试。"""
        # 创建测试 PDF
        fd, input_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        doc = fitz.open()
        try:
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 100))
            pix.clear_with()
            for _ in range(3):
                page = doc.new_page()
                page.insert_image(fitz.Rect(200, 370, 400, 470), pixmap=pix)
                page.insert_text((50, 100), "Normal content", fontsize=11)
            doc.save(input_path)
        finally:
            doc.close()

        fd, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        try:
            # 检测
            doc_for_detect = fitz.open(input_path)
            detections = self.detector.detect(doc_for_detect)
            doc_for_detect.close()

            assert len(detections) >= 1, "should detect at least one image"

            # 创建 CleaningPlan
            actions = []
            for d in detections:
                actions.append(CleaningAction(
                    action_type="REMOVE_IMAGE",
                    page=d.page,
                    target_type="image",
                    confidence=d.confidence,
                    risk_level=RiskLevel.AUTO,
                    risk_score=85.0,
                    content=d.content,
                    bbox=d.bbox,
                    metadata=dict(d.metadata),
                ))

            plan = CleaningPlan(
                file_path=input_path,
                risk_level=RiskLevel.AUTO,
                actions=actions,
            )

            # 清理
            results = self.cleaner.clean(input_path, plan, output_path)
            assert len(results) >= 1
            assert any(r.status == CleaningStatus.SUCCESS for r in results)

            # 验证输出
            doc2 = fitz.open(output_path)
            try:
                page = doc2[0]
                # 图片应被删除
                assert len(page.get_images()) == 0
                # 文本应保留
                assert "Normal" in page.get_text()
            finally:
                doc2.close()

            # 页数不变
            assert verify_page_count(output_path) == 3
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)
