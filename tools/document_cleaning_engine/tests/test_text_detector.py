"""TextWatermarkDetector 测试。"""

from __future__ import annotations

import fitz
import pytest

from detector.text_detector import TextDetector


class TestTextWatermarkDetector:
    """文本水印检测测试。"""

    def setup_method(self) -> None:
        self.detector = TextDetector()

    def test_high_conf_watermark(self) -> None:
        """中央重复文本水印应高置信度检测。"""
        doc = fitz.open()
        try:
            for _ in range(10):
                page = doc.new_page()
                page.insert_text((200, 400), "Confidential", fontsize=48)

            results = self.detector.detect(doc)
            assert len(results) >= 1
            r = results[0]
            assert r.type == "text"
            assert r.confidence >= 0.8
            assert "origin" in r.metadata
        finally:
            doc.close()

    def test_normal_text_ignored(self) -> None:
        """正文文本（仅出现一次）应不产生检测结果。"""
        doc = fitz.open()
        try:
            for i in range(3):
                page = doc.new_page()
                page.insert_text(
                    (50, 100), f"Unique content on page {i+1}", fontsize=11
                )
            results = self.detector.detect(doc)
            assert len(results) == 0
        finally:
            doc.close()

    def test_origin_in_metadata(self) -> None:
        """检测结果应包含 origin 供 Cleaner 使用。"""
        doc = fitz.open()
        try:
            page = doc.new_page()
            page.insert_text((150, 420), "Draft", fontsize=36)

            results = self.detector.detect(doc)
            if results:
                meta = results[0].metadata
                assert "origin" in meta
                ox, oy = meta["origin"]
                assert abs(ox - 150) < 5
                assert abs(oy - 420) < 5
        finally:
            doc.close()
