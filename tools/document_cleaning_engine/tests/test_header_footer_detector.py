"""HeaderFooterDetector 测试。"""

from __future__ import annotations

import fitz
import pytest

from detector.header_footer_detector import HeaderFooterDetector


class TestHeaderFooterDetector:
    """页眉页脚检测测试。"""

    def setup_method(self) -> None:
        self.detector = HeaderFooterDetector()

    def test_detect_header(self) -> None:
        """每页顶部固定文本应检测为 header。"""
        doc = fitz.open()
        try:
            for i in range(5):
                page = doc.new_page()
                # 页眉（顶部 0-15% 区域）
                page.insert_text((20, 30), "Monthly Report 2024", fontsize=10)
                page.insert_text(
                    (50, 200), f"Body text page {i+1}", fontsize=11
                )

            results = self.detector.detect(doc)
            headers = [r for r in results if r.type == "header"]
            assert len(headers) >= 1
            assert headers[0].confidence >= 0.5
        finally:
            doc.close()

    def test_detect_footer(self) -> None:
        """每页底部固定文本应检测为 footer。"""
        doc = fitz.open()
        try:
            for i in range(5):
                page = doc.new_page()
                page.insert_text(
                    (50, 200), f"Body text page {i+1}", fontsize=11
                )
                # 页脚（底部 82-100% 区域），每页相同内容
                page.insert_text((200, 810), "Confidential - Internal Use", fontsize=9)

            results = self.detector.detect(doc)
            footers = [r for r in results if r.type == "footer"]
            assert len(footers) >= 1
            assert footers[0].confidence >= 0.5
        finally:
            doc.close()

    def test_origin_in_metadata(self) -> None:
        """检测结果应包含 origin 供 Cleaner 使用。"""
        doc = fitz.open()
        try:
            for _ in range(3):
                page = doc.new_page()
                page.insert_text((20, 30), "Header Text", fontsize=10)

            results = self.detector.detect(doc)
            if results:
                meta = results[0].metadata
                assert "origin" in meta
        finally:
            doc.close()

    def test_body_title_not_high_confidence(self) -> None:
        """正文标题（仅出现一次）不应高置信度检测。"""
        doc = fitz.open()
        try:
            for i in range(3):
                page = doc.new_page()
                # 每页标题都不同，不应被检测为高置信页眉
                page.insert_text(
                    (20, 30), f"Chapter {i+1}", fontsize=14
                )
                page.insert_text(
                    (50, 200), "Normal content", fontsize=11
                )

            results = self.detector.detect(doc)
            # 每个标题出现在 header 区域但仅出现一次
            # 置信度应 < 0.8（页眉/页脚阈值），不会进入 CleaningPlan
            for r in results:
                assert r.confidence < 0.8
        finally:
            doc.close()
