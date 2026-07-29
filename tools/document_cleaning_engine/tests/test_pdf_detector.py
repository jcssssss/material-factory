"""PDFDetector 单元测试。"""

from __future__ import annotations

import fitz
import pytest

from detector import DetectionResult
from detector.annotation_detector import AnnotationDetector
from detector.artifact_detector import ArtifactDetector
from detector.image_detector import ImageDetector
from detector.text_detector import TextDetector
from detector.header_footer_detector import HeaderFooterDetector
from detector.pdf_detector import PDFDetector


class TestAnnotationDetector:
    """Annotation 检测测试。"""

    def setup_method(self) -> None:
        self.detector = AnnotationDetector()

    def test_detect_annotations(self, annotation_pdf_path: str) -> None:
        """应检测到 PDF 中的所有 Annotation。"""
        doc = fitz.open(annotation_pdf_path)
        try:
            results = self.detector.detect(doc)
            assert len(results) >= 3  # text + highlight + stamp
            for r in results:
                assert r.type == "annotation"
                assert r.confidence == 1.0
                assert r.page == 1
                assert r.bbox is not None
        finally:
            doc.close()


class TestArtifactDetector:
    """Artifact 水印检测测试。"""

    def setup_method(self) -> None:
        self.detector = ArtifactDetector()

    def test_detect_artifact_watermark(self, artifact_pdf_path: str) -> None:
        """应检测到 PDF 中的 Watermark Artifact。"""
        doc = fitz.open(artifact_pdf_path)
        try:
            results = self.detector.detect(doc)
            assert len(results) >= 1
            assert results[0].type == "artifact"
            assert results[0].confidence == 1.0
            assert results[0].metadata.get("artifact_type") == "Watermark"
        finally:
            doc.close()


class TestImageDetector:
    """图片水印检测测试。"""

    def setup_method(self) -> None:
        self.detector = ImageDetector()

    def test_detect_repeated_image(self, image_logo_pdf_path: str) -> None:
        """应检测到多页重复图片（水印候选）。"""
        doc = fitz.open(image_logo_pdf_path)
        try:
            results = self.detector.detect(doc)
            assert len(results) >= 1
            assert results[0].type == "image"
            assert results[0].confidence >= 0.8
            assert results[0].metadata.get("pages_appeared") == 5
            assert results[0].metadata.get("total_pages") == 5
        finally:
            doc.close()


class TestTextDetector:
    """文本水印检测测试。"""

    def setup_method(self) -> None:
        self.detector = TextDetector()

    def test_detect_watermark_text(self, text_watermark_pdf_path: str) -> None:
        """应检测到跨页重复的中央文本水印。"""
        doc = fitz.open(text_watermark_pdf_path)
        try:
            results = self.detector.detect(doc)
            assert len(results) >= 1
            assert results[0].type == "text"
            assert results[0].confidence >= 0.8
            # 应检测到 "Confidential"
            assert "confidential" in results[0].content.lower()
        finally:
            doc.close()


class TestHeaderFooterDetector:
    """页眉页脚检测测试。"""

    def setup_method(self) -> None:
        self.detector = HeaderFooterDetector()

    def test_detect_header(self, header_pdf_path: str) -> None:
        """应检测到页眉区域文本。"""
        doc = fitz.open(header_pdf_path)
        try:
            results = self.detector.detect(doc)
            headers = [r for r in results if r.type == "header"]
            assert len(headers) >= 1
            assert headers[0].confidence >= 0.5
        finally:
            doc.close()

    def test_detect_footer(self, footer_pdf_path: str) -> None:
        """应检测到页脚区域文本。"""
        doc = fitz.open(footer_pdf_path)
        try:
            results = self.detector.detect(doc)
            footers = [r for r in results if r.type == "footer"]
            assert len(footers) >= 1
            assert footers[0].confidence >= 0.5
        finally:
            doc.close()


class TestPDFDetector:
    """PDFDetector 主入口集成测试。"""

    def setup_method(self) -> None:
        self.detector = PDFDetector()

    def test_detect_all_from_annotation_pdf(
        self, annotation_pdf_path: str
    ) -> None:
        """PDFDetector 应能从带 Annotation 的 PDF 中检测到结果。"""
        results = self.detector.detect(annotation_pdf_path)
        types = {r.type for r in results}
        assert "annotation" in types

    def test_detect_all_from_text_watermark_pdf(
        self, text_watermark_pdf_path: str
    ) -> None:
        """PDFDetector 应能从带文本水印的 PDF 中检测到结果。"""
        results = self.detector.detect(text_watermark_pdf_path)
        types = {r.type for r in results}
        assert "text" in types

    def test_detect_all_from_header_pdf(self, header_pdf_path: str) -> None:
        """PDFDetector 应能从带页眉的 PDF 中检测到结果。"""
        results = self.detector.detect(header_pdf_path)
        types = {r.type for r in results}
        assert "header" in types

    def test_detect_all_from_footer_pdf(self, footer_pdf_path: str) -> None:
        """PDFDetector 应能从带页脚的 PDF 中检测到结果。"""
        results = self.detector.detect(footer_pdf_path)
        types = {r.type for r in results}
        assert "footer" in types

    def test_encrypted_pdf_returns_no_results(
        self, encrypted_pdf_path: str
    ) -> None:
        """加密 PDF 应跳过检测，返回空列表。"""
        results = self.detector.detect(encrypted_pdf_path)
        assert len(results) == 0

    def test_invalid_pdf_returns_no_results(
        self, invalid_pdf_path: str
    ) -> None:
        """无效 PDF 应返回空列表。"""
        results = self.detector.detect(invalid_pdf_path)
        assert len(results) == 0


class TestDetectionResult:
    """DetectionResult 数据模型测试。"""

    def test_create_result(self) -> None:
        """应能创建 DetectionResult。"""
        r = DetectionResult(
            type="text",
            page=5,
            bbox=(0.0, 0.0, 100.0, 50.0),
            content="内部资料",
            confidence=0.92,
            metadata={"font_size": 20},
        )
        assert r.type == "text"
        assert r.page == 5
        assert r.bbox == (0.0, 0.0, 100.0, 50.0)
        assert r.content == "内部资料"
        assert r.confidence == 0.92
        assert r.metadata["font_size"] == 20

    def test_default_values(self) -> None:
        """默认值应正确设置。"""
        r = DetectionResult(type="annotation", page=1)
        assert r.content == ""
        assert r.confidence == 0.0
        assert r.bbox is None
        assert r.metadata == {}
