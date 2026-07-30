"""HeaderFooterCleaner 测试。"""

from __future__ import annotations

import os
import tempfile

import fitz
import pytest

from cleaner import CleaningStatus, PDFCleaner
from cleaner.cleaner_utils import verify_page_count
from cleaner.header_footer_cleaner import HeaderFooterCleaner
from detector.header_footer_detector import HeaderFooterDetector
from risk import CleaningAction, CleaningPlan, RiskLevel


class TestHeaderFooterCleaner:
    """页眉页脚清理测试。"""

    def setup_method(self) -> None:
        self.cleaner = HeaderFooterCleaner()

    def test_remove_header(self) -> None:
        """应删除页眉文本指令。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((20, 30), "Report Header", fontsize=10)
            page.insert_text((50, 200), "Body content", fontsize=11)

            action = CleaningAction(
                action_type="REMOVE_HEADER",
                page=1,
                target_type="header",
                confidence=0.85,
                risk_level=RiskLevel.CONFIRM,
                risk_score=75.0,
                content="Report Header",
                bbox=(15, 20, 130, 40),
                metadata={"origin": (20.0, 30.0), "font_size": 10},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.SUCCESS

            # 正文应保留
            assert "Body" in page.get_text()
        finally:
            doc.close()

    def test_remove_footer(self) -> None:
        """应删除页脚文本指令。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((50, 200), "Body content", fontsize=11)
            page.insert_text((200, 810), "- Page 1 -", fontsize=9)

            action = CleaningAction(
                action_type="REMOVE_FOOTER",
                page=1,
                target_type="footer",
                confidence=0.85,
                risk_level=RiskLevel.CONFIRM,
                risk_score=75.0,
                content="- Page 1 -",
                bbox=(195, 800, 230, 820),
                metadata={"origin": (200.0, 810.0), "font_size": 9},
            )

            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.SUCCESS
            assert "Body" in page.get_text()
        finally:
            doc.close()

    def test_text_not_found(self) -> None:
        """不存在的文本应返回 FAILED。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((50, 50), "Hello", fontsize=11)

            action = CleaningAction(
                action_type="REMOVE_HEADER",
                page=1,
                target_type="header",
                confidence=0.85,
                risk_level=RiskLevel.CONFIRM,
                risk_score=75.0,
                metadata={"origin": (500.0, 500.0)},
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
                action_type="REMOVE_HEADER",
                page=999,
                target_type="header",
                confidence=0.85,
                risk_level=RiskLevel.CONFIRM,
                risk_score=75.0,
                metadata={"origin": (20.0, 30.0)},
            )
            result = self.cleaner.clean(doc, action)
            assert result.status == CleaningStatus.FAILED
        finally:
            doc.close()


class TestHeaderFooterIntegration:
    """页眉页脚集成测试。"""

    def setup_method(self) -> None:
        self.detector = HeaderFooterDetector()
        self.cleaner = PDFCleaner()

    def test_detect_and_clean_header(self) -> None:
        """检测 → 清理 全流程集成测试。"""
        fd, input_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)

        doc = fitz.open()
        try:
            for i in range(5):
                page = doc.new_page()
                page.insert_text((20, 30), "Report Header", fontsize=10)
                page.insert_text(
                    (50, 200), f"Body content page {i+1}", fontsize=11
                )
            doc.save(input_path)
        finally:
            doc.close()

        fd2, output_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd2)

        try:
            doc_for_detect = fitz.open(input_path)
            detections = self.detector.detect(doc_for_detect)
            doc_for_detect.close()

            assert len(detections) >= 1

            actions = []
            for d in detections:
                actions.append(CleaningAction(
                    action_type=f"REMOVE_{d.type.upper()}",
                    page=d.page,
                    target_type=d.type,
                    confidence=d.confidence,
                    risk_level=RiskLevel.CONFIRM,
                    risk_score=d.confidence * 100,
                    content=d.content,
                    bbox=d.bbox,
                    metadata=dict(d.metadata),
                ))

            plan = CleaningPlan(
                file_path=input_path,
                risk_level=RiskLevel.CONFIRM,
                actions=actions,
            )

            # REMOVE_HEADER 属于 CONFIRM，PDFCleaner 默认只处理 AUTO
            # 所以我需要把 CONFIRM 改为 AUTO 让 cleaner 执行
            for a in plan.actions:
                a.risk_level = RiskLevel.AUTO

            results = self.cleaner.clean(input_path, plan, output_path)
            assert len(results) >= 1
            assert any(r.status == CleaningStatus.SUCCESS for r in results)

            # 验证输出
            doc2 = fitz.open(output_path)
            try:
                assert "Body" in doc2[0].get_text()
            finally:
                doc2.close()

            assert verify_page_count(output_path) == 5
        finally:
            if os.path.exists(input_path):
                os.unlink(input_path)
            if os.path.exists(output_path):
                os.unlink(output_path)
