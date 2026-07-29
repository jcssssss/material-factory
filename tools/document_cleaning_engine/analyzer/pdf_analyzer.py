"""PDF 文档分析器。

实现 PDFAnalyzer 类，提供 PDF 类型判断和基础信息提取能力。
使用 PyMuPDF (fitz) 作为 PDF 解析引擎。
"""

from __future__ import annotations

import logging
from typing import Dict

import fitz

from .document_info import PDFDocumentInfo, PDFType

logger = logging.getLogger(__name__)


class PDFAnalyzer:
    """PDF 文档分析器。

    分析 PDF 文件并返回标准化分析结果。
    负责判断 PDF 类型（文本/扫描/混合/加密）并提取基础信息。
    """

    # SCAN_PDF 判定阈值：图片页面占比 >= 90%
    SCAN_IMAGE_THRESHOLD = 0.9
    # SCAN_PDF 判定阈值：文本页面占比 < 10%
    SCAN_TEXT_THRESHOLD = 0.1

    def analyze(self, file_path: str) -> PDFDocumentInfo:
        """分析 PDF 文件。

        流程：
        1. 打开 PDF（捕获 fitz.FileDataError）
        2. 检测加密状态
        3. 逐页统计文本/图片内容
        4. 根据统计结果判断 PDF 类型
        5. 返回标准化分析结果

        Args:
            file_path: PDF 文件路径。

        Returns:
            PDFDocumentInfo: 分析结果。
        """
        try:
            doc = fitz.open(file_path)
        except fitz.FileDataError as e:
            logger.error("无法打开 PDF 文件: %s, 错误: %s", file_path, e)
            return PDFDocumentInfo(
                file_path=file_path,
                page_count=0,
                pdf_type=PDFType.UNKNOWN.value,
                is_encrypted=False,
                has_text=False,
                has_images=False,
                metadata={"error": f"无法打开 PDF 文件: {e}"},
            )
        except Exception as e:
            logger.error("打开 PDF 文件时发生未知错误: %s, 错误: %s", file_path, e)
            return PDFDocumentInfo(
                file_path=file_path,
                page_count=0,
                pdf_type=PDFType.UNKNOWN.value,
                is_encrypted=False,
                has_text=False,
                has_images=False,
                metadata={"error": f"未知错误: {e}"},
            )

        try:
            # 检测加密
            if doc.is_encrypted:
                return self._build_encrypted_result(file_path, doc)

            # 统计页面内容
            text_pages, image_pages = self._count_page_content(doc)
            has_text = text_pages > 0
            has_images = image_pages > 0

            # 判断 PDF 类型
            pdf_type = self._determine_pdf_type(
                text_pages=text_pages,
                image_pages=image_pages,
                total_pages=doc.page_count,
                has_text=has_text,
                has_images=has_images,
            )

            return PDFDocumentInfo(
                file_path=file_path,
                page_count=doc.page_count,
                pdf_type=pdf_type.value,
                is_encrypted=False,
                has_text=has_text,
                has_images=has_images,
                metadata={
                    "text_pages": text_pages,
                    "image_pages": image_pages,
                },
            )
        finally:
            doc.close()

    def _count_page_content(self, doc: fitz.Document) -> tuple[int, int]:
        """逐页统计文本页面和图片页面数量。

        Args:
            doc: fitz 文档对象。

        Returns:
            (text_pages, image_pages): 包含文本的页数和包含图片的页数。
                同一页可同时计入两者。
        """
        text_pages = 0
        image_pages = 0

        for page in doc:
            # 检查文本内容
            text = page.get_text()
            if text and text.strip():
                text_pages += 1

            # 检查图片内容
            images = page.get_images()
            if images:
                image_pages += 1

        return text_pages, image_pages

    def _determine_pdf_type(
        self,
        text_pages: int,
        image_pages: int,
        total_pages: int,
        has_text: bool,
        has_images: bool,
    ) -> PDFType:
        """根据页面内容统计判断 PDF 类型。

        判断规则（按优先级）：
        1. ENCRYPTED_PDF — 已加密（调用前已处理）
        2. SCAN_PDF — 图片页面占比 >= 90% 且文本页面占比 < 10%
        3. TEXT_PDF — 存在文本内容且为主要内容
        4. MIXED_PDF — 同时存在文本和图片页面
        5. UNKNOWN — 无法判断

        Args:
            text_pages: 包含文本的页面数。
            image_pages: 包含图片的页面数。
            total_pages: 总页数。
            has_text: 是否包含文本。
            has_images: 是否包含图片。

        Returns:
            PDFType: 判断结果。
        """
        if total_pages == 0:
            return PDFType.UNKNOWN

        text_ratio = text_pages / total_pages
        image_ratio = image_pages / total_pages

        # SCAN_PDF: 图片页面占比 >= 90% 且文本页面占比较少
        if image_ratio >= self.SCAN_IMAGE_THRESHOLD and text_ratio < self.SCAN_TEXT_THRESHOLD:
            return PDFType.SCAN_PDF

        # TEXT_PDF: 存在文本内容，且文本是主要内容
        if has_text and not has_images:
            return PDFType.TEXT_PDF
        if text_ratio >= 0.5 and image_ratio < 0.5:
            return PDFType.TEXT_PDF

        # MIXED_PDF: 同时存在文本页面和图片页面
        if has_text and has_images:
            return PDFType.MIXED_PDF

        # 纯图片但未达到 SCAN 阈值（极少数页面）
        if has_images and not has_text:
            return PDFType.SCAN_PDF

        return PDFType.UNKNOWN

    def _build_encrypted_result(self, file_path: str, doc: fitz.Document) -> PDFDocumentInfo:
        """构建加密 PDF 的分析结果。

        Args:
            file_path: 文件路径。
            doc: fitz 文档对象。

        Returns:
            标记为 ENCRYPTED_PDF 的分析结果。
        """
        return PDFDocumentInfo(
            file_path=file_path,
            page_count=doc.page_count,
            pdf_type=PDFType.ENCRYPTED_PDF.value,
            is_encrypted=True,
            has_text=False,
            has_images=False,
            metadata={
                "text_pages": 0,
                "image_pages": 0,
            },
        )
