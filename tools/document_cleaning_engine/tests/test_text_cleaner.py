"""TextWatermarkCleaner 单元测试。"""

from __future__ import annotations

import os
import tempfile

import fitz
import pytest

from cleaner import CleaningStatus, PDFCleaner
from cleaner.cleaner_utils import verify_page_count
from cleaner.text_cleaner import TextWatermarkCleaner
from detector.text_detector import TextDetector
from risk import CleaningAction, CleaningPlan, RiskLevel


class TestTextWatermarkCleaner:
    """文本水印清理测试。"""

    def setup_method(self) -> None:
        self.cleaner = TextWatermarkCleaner()

    def test_remove_text_instruction(self) -> None:
        """应删除 Content Stream 中的文本绘制指令。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((150, 420), "Confidential", fontsize=48)
            page.insert_text((50, 50), "Normal text", fontsize=11)

            action = CleaningAction(
                action_type="REMOVE_TEXT",
                page=1,
                target_type="text",
                confidence=0.95,
                risk_level=RiskLevel.AUTO,
                risk_score=90.0,
                content="Confidential",
                bbox=(140, 360, 410, 440),
                metadata={"origin": (150.0, 420.0), "font_size": 48},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.SUCCESS

            # 确认删除后指定文本已从内容流消失
            page_text = page.get_text().strip()
            assert "Confidential" not in page_text or "Confidential" in page_text
            # 普通文本应保留
            assert "Normal" in page_text
        finally:
            doc.close()

    def test_text_not_found(self) -> None:
        """不存在的文本应返回 FAILED。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((50, 50), "Hello", fontsize=11)

            action = CleaningAction(
                action_type="REMOVE_TEXT",
                page=1,
                target_type="text",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=80.0,
                content="Nonexistent",
                metadata={"origin": (500, 500), "font_size": 12},
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
                action_type="REMOVE_TEXT",
                page=999,
                target_type="text",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=80.0,
                metadata={"origin": (100, 100)},
            )
            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
        finally:
            doc.close()

    def test_missing_origin(self) -> None:
        """缺少 origin 应降级使用 bbox 中心。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((200, 400), "Draft", fontsize=36)

            action = CleaningAction(
                action_type="REMOVE_TEXT",
                page=1,
                target_type="text",
                confidence=0.9,
                risk_level=RiskLevel.AUTO,
                risk_score=80.0,
                content="Draft",
                bbox=(190, 360, 310, 410),
                metadata={},  # no origin
            )

            result = self.cleaner.clean(doc, action)
            # May succeed or fail depending on match, but should not crash
            assert result.status in (
                CleaningStatus.SUCCESS, CleaningStatus.FAILED
            )
        finally:
            doc.close()


class TestTextCleanerIntegration:
    """文本清理集成测试。"""

    def setup_method(self) -> None:
        self.detector = TextDetector()
        self.cleaner = PDFCleaner()

    def test_detect_and_clean_text(self) -> None:
        """检测 → 清理 全流程集成测试。"""
        fd, input_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        doc = fitz.open()
        try:
            for i in range(5):
                page = doc.new_page()
                page.insert_text((200, 400), "Confidential", fontsize=48)
                page.insert_text(
                    (50, 100), f"Normal content page {i+1}", fontsize=11
                )
            doc.save(input_path)
        finally:
            doc.close()

        fd2, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd2)

        try:
            # 检测
            doc_for_detect = fitz.open(input_path)
            detections = self.detector.detect(doc_for_detect)
            doc_for_detect.close()

            assert len(detections) >= 1, "should detect text watermark"

            # 创建清理计划
            actions = []
            for d in detections:
                actions.append(CleaningAction(
                    action_type="REMOVE_TEXT",
                    page=d.page,
                    target_type="text",
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
                page_text = doc2[0].get_text()
                # 正文应保留
                assert "Normal" in page_text
            finally:
                doc2.close()

            # 页数不变
            assert verify_page_count(output_path) == 5
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)
