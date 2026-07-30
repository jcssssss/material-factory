"""PDFValidator — PDF 清理结果验证器。

检查清理后的 PDF 文件完整性：
-  可打开
-  页数一致
-  页面尺寸一致
-  文本变化在预期范围内
-  图片数量变化合理
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

import fitz

logger = logging.getLogger(__name__)


class PDFValidator:
    """PDF 清理结果验证器。

    对清理前后的 PDF 进行逐项比较验证。
    """

    def validate(
        self,
        original_path: str,
        cleaned_path: str,
    ) -> Dict[str, object]:
        """验证 PDF 清理结果。

        Args:
            original_path: 原始 PDF 路径。
            cleaned_path: 清理后 PDF 路径。

        Returns:
            验证结果字典。
        """
        result: Dict[str, object] = {
            "open_success": False,
            "original_pages": 0,
            "cleaned_pages": 0,
            "page_count_match": False,
            "page_size_match": True,
            "content": {},
        }

        # 打开原始文件
        original_doc = self._safe_open(original_path)
        if original_doc is None:
            return result

        # 打开清理后文件
        cleaned_doc = self._safe_open(cleaned_path)
        if cleaned_doc is None:
            original_doc.close()
            return result

        try:
            # 页数
            orig_pages = len(original_doc)
            clean_pages = len(cleaned_doc)
            result["original_pages"] = orig_pages
            result["cleaned_pages"] = clean_pages
            result["page_count_match"] = orig_pages == clean_pages
            result["open_success"] = True

            # 页面尺寸
            page_size_match = self._check_page_sizes(original_doc, cleaned_doc)
            result["page_size_match"] = page_size_match

            # 内容变化
            content = self._check_content(original_doc, cleaned_doc)
            result["content"] = content

        finally:
            original_doc.close()
            cleaned_doc.close()

        return result

    @staticmethod
    def _safe_open(path: str) -> Optional[fitz.Document]:
        """安全打开 PDF，失败返回 None。"""
        try:
            return fitz.open(path)
        except Exception as e:
            logger.error("PDF 打开失败: %s, 错误: %s", path, e)
            return None

    @staticmethod
    def _check_page_sizes(
        original: fitz.Document,
        cleaned: fitz.Document,
    ) -> bool:
        """检查清理前后页面尺寸是否一致。"""
        if len(original) != len(cleaned):
            return True  # 页数已不同，尺寸检查不适用

        for i in range(len(original)):
            orig_rect = original[i].rect
            clean_rect = cleaned[i].rect

            if (
                abs(orig_rect.width - clean_rect.width) > 1
                or abs(orig_rect.height - clean_rect.height) > 1
            ):
                logger.warning(
                    "页面 %d 尺寸变化: (%.1f,%.1f) → (%.1f,%.1f)",
                    i + 1,
                    orig_rect.width, orig_rect.height,
                    clean_rect.width, clean_rect.height,
                )
                return False

        return True

    @staticmethod
    def _check_content(
        original: fitz.Document,
        cleaned: fitz.Document,
    ) -> Dict[str, object]:
        """检查内容变化。"""
        content: Dict[str, object] = {}

        # 原始文本总量
        orig_text = ""
        orig_image_count = 0
        for page in original:
            orig_text += page.get_text()
            orig_image_count += len(page.get_images())

        # 清理后文本总量
        clean_text = ""
        clean_image_count = 0
        for page in cleaned:
            clean_text += page.get_text()
            clean_image_count += len(page.get_images())

        # 文本变化率
        orig_len = len(orig_text)
        clean_len = len(clean_text)
        text_loss_rate = 0.0
        if orig_len > 0:
            text_loss_rate = round((orig_len - clean_len) / orig_len, 4)

        content["total_chars_before"] = orig_len
        content["total_chars_after"] = clean_len
        content["text_loss_rate"] = text_loss_rate
        content["text_changed"] = orig_text != clean_text

        # 图片变化
        content["images_before"] = orig_image_count
        content["images_after"] = clean_image_count

        image_loss_rate = 0.0
        if orig_image_count > 0:
            image_loss_rate = round(
                (orig_image_count - clean_image_count) / orig_image_count, 4
            )
        content["image_loss_rate"] = image_loss_rate

        return content
