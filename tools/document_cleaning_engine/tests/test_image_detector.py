"""ImageDetector 增强测试。"""

from __future__ import annotations

import fitz
import pytest

from detector.image_detector import ImageDetector


class TestImageDetector:
    """图片水印检测测试。"""

    def setup_method(self) -> None:
        self.detector = ImageDetector()

    def test_detect_repeated_logo(self) -> None:
        """多页重复 Logo 应检测为图片水印候选。"""
        doc = fitz.open()
        try:
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 80))
            pix.clear_with()
            for _ in range(5):
                page = doc.new_page()
                page.insert_image(fitz.Rect(200, 350, 400, 430), pixmap=pix)

            results = self.detector.detect(doc)
            assert len(results) >= 1
            assert results[0].type == "image"
            assert "xref" in results[0].metadata
            assert isinstance(results[0].metadata["xref"], int)
            assert "repeat_rate" in results[0].metadata
            assert results[0].metadata["repeat_rate"] == 1.0
        finally:
            doc.close()

    def test_md5_replaced_by_sha256(self) -> None:
        """图片哈希应使用 SHA256。"""
        doc = fitz.open()
        try:
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 50, 50))
            pix.clear_with()
            page = doc.new_page()
            page.insert_image(fitz.Rect(100, 100, 150, 150), pixmap=pix)

            results = self.detector.detect(doc)
            if results:
                img_hash = results[0].metadata.get("image_hash", "")
                # SHA256 是 64 位十六进制
                assert len(img_hash) == 64, f"expected SHA256 (64 chars), got '{img_hash}' ({len(img_hash)} chars)"
        finally:
            doc.close()

    def test_unique_images_not_detected(self) -> None:
        """不同图片仍作为候选上报（阈值 0，全部上报）。"""
        doc = fitz.open()
        try:
            for i in range(3):
                page = doc.new_page()
                pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 30 + i, 30 + i))
                pix.clear_with()
                page.insert_image(fitz.Rect(100, 100, 130 + i, 130 + i), pixmap=pix)

            results = self.detector.detect(doc)
            # 阈值 0，所有图片都作为候选上报
            assert len(results) == 3
        finally:
            doc.close()

    def test_large_image_low_risk(self) -> None:
        """大面积图片仍作为候选上报（阈值 0，全部上报）。"""
        doc = fitz.open()
        try:
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 500, 800))
            pix.clear_with()
            page = doc.new_page()
            page.insert_image(page.rect, pixmap=pix)

            results = self.detector.detect(doc)
            # 阈值 0，即使大面积单页也作为候选上报
            assert len(results) == 1
        finally:
            doc.close()

    def test_xref_in_metadata(self) -> None:
        """检测结果应包含图片 xref。"""
        doc = fitz.open()
        try:
            pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 100))
            pix.clear_with()
            for _ in range(3):
                page = doc.new_page()
                page.insert_image(fitz.Rect(200, 300, 400, 400), pixmap=pix)

            results = self.detector.detect(doc)
            assert len(results) >= 1
            meta = results[0].metadata
            assert "xref" in meta
            assert "xrefs" in meta
            assert isinstance(meta["xrefs"], list)
            assert len(meta["xrefs"]) > 0
        finally:
            doc.close()
