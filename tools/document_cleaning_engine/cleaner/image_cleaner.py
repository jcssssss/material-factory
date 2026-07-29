"""图片水印清理器。

删除 PDF 页面中的 Image XObject 引用。
通过操作 /Resources/XObject 字典和 Content Stream 实现。
"""

from __future__ import annotations

import logging
import re
from typing import List, Optional, Set

import fitz

from risk import CleaningAction

from . import CleaningResult, CleaningStatus

logger = logging.getLogger(__name__)


class ImageCleaner:
    """图片水印清理器。

    删除独立 Image XObject 的页面引用。
    不处理 Form XObject 内嵌的图片。
    """

    # 安全限制：覆盖面积 > 20% 页面面积时停止删除
    MAX_AREA_RATIO = 0.20
    # 安全限制：重复率 < 0.5 时跳过
    MIN_REPEAT_RATE = 0.5

    def clean(self, doc: fitz.Document, action: CleaningAction) -> CleaningResult:
        """删除指定页面上的图片对象引用。

        Args:
            doc: fitz 文档对象（可写打开）。
            action: 清理操作（须为 REMOVE_IMAGE）。

        Returns:
            清理执行结果。
        """
        page_index = action.page - 1
        if page_index < 0 or page_index >= len(doc):
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"page {action.page} out of range",
                fallback_action="manual_review",
            )

        # 安全检查
        safety_check = self._safety_check(action)
        if safety_check is not None:
            return safety_check

        page = doc[page_index]
        xref = action.metadata.get("xref")

        if not xref or not isinstance(xref, int):
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="image xref not found in action metadata",
                fallback_action="manual_review",
            )

        # 找到图片对应的资源名称（如 /fzImg0）
        img_name = self._find_image_name(page, xref)
        if not img_name:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"image xref {xref} not found on page {action.page}",
                fallback_action="manual_review",
            )

        # Form XObject 保护：检查该图片是否被 Form XObject 引用
        if self._is_in_form_xobject(page, xref, doc):
            return CleaningResult(
                action=action,
                status=CleaningStatus.SKIPPED,
                error="image is referenced by Form XObject, skipping",
                fallback_action="skip",
                metadata={"reason": "FORM_XOBJECT_IMAGE"},
            )

        # 执行删除
        try:
            self._remove_image_reference(page, xref, img_name, doc)
        except Exception as e:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"failed to remove image: {e}",
                fallback_action="manual_review",
            )

        return CleaningResult(
            action=action,
            status=CleaningStatus.SUCCESS,
            metadata={"removed_xref": xref, "image_name": img_name},
        )

    def _safety_check(self, action: CleaningAction) -> Optional[CleaningResult]:
        """执行安全检查。

        检查项：
        1. 重复率 >= 0.5
        2. 面积占比 <= 20%
        3. 扫描 PDF 保护（由 PDFCleaner 在外部判断）
        """
        metadata = action.metadata

        # 检查 1：重复率
        repeat_rate = metadata.get("repeat_rate", 0)
        if isinstance(repeat_rate, (int, float)) and repeat_rate < self.MIN_REPEAT_RATE:
            return CleaningResult(
                action=action,
                status=CleaningStatus.SKIPPED,
                error=f"repeat_rate {repeat_rate} < {self.MIN_REPEAT_RATE}",
                fallback_action="skip",
            )

        # 检查 2：面积占比
        area_scores = []
        for key, val in metadata.items():
            if key.startswith("area_ratio_"):
                if isinstance(val, (int, float)) and val > self.MAX_AREA_RATIO:
                    area_scores.append(val)

        if area_scores and max(area_scores) > self.MAX_AREA_RATIO:
            return CleaningResult(
                action=action,
                status=CleaningStatus.SKIPPED,
                error=f"image covers > {self.MAX_AREA_RATIO*100:.0f}% page area",
                fallback_action="skip",
            )

        return None

    @staticmethod
    def _find_image_name(page: fitz.Page, target_xref: int) -> Optional[str]:
        """根据 xref 查找图片在页面中的资源名称。"""
        images = page.get_images()
        for img in images:
            xref = img[0]
            name = img[7]
            if xref == target_xref:
                return name
        return None

    @staticmethod
    def _is_in_form_xobject(
        page: fitz.Page, target_xref: int, doc: fitz.Document
    ) -> bool:
        """检查图片是否被 Form XObject 引用。

        V1 不处理 Form XObject 内嵌图片。
        """
        xobjects = page.get_xobjects()
        for xobj_ref, xobj_name in xobjects:
            # 检查 Form XObject 是否引用了目标图片
            xobj_xref = int(xobj_ref.split()[0]) if isinstance(xobj_ref, str) and xobj_ref[0].isdigit() else 0
            if xobj_xref:
                try:
                    obj_str = doc.xref_object(xobj_xref)
                    if f"/{target_xref} 0 R" in obj_str:
                        return True
                except Exception:
                    continue
        return False

    @staticmethod
    def _remove_image_reference(
        page: fitz.Page, xref: int, img_name: str, doc: fitz.Document
    ) -> None:
        """从页面中移除图片引用。

        步骤：
        1. 从 /Resources/XObject 字典中移除图片条目
        2. 从 Content Stream 中移除对应的 Do 操作符
        """
        page_xref = doc.page_xref(page.number)

        # 1. 从 /Resources/XObject 中移除
        # 获取 Resources 对象的 xref
        res_info = doc.xref_get_key(page_xref, "Resources")
        if res_info[0] == "xref":
            res_xref = int(res_info[1].split()[0])
            # 将 XObject 中的图片条目置为 null
            doc.xref_set_key(res_xref, f"XObject/{img_name}", "null")

        # 2. 从 Content Stream 中移除对应的 Do 操作符
        content_xrefs = page.get_contents()
        if content_xrefs:
            all_content = b""
            for cx in content_xrefs:
                stream = doc.xref_stream(cx)
                if stream:
                    all_content += stream

            # 移除包含目标图片的整个 q...Q 块
            pattern = rb"q[^Q]*/" + re.escape(img_name.encode()) + rb"\s+Do[^Q]*Q"
            new_content = re.sub(pattern, b"", all_content)

            # 清理多余空行
            new_content = re.sub(rb"\n{3,}", b"\n\n", new_content)
            new_content = new_content.strip()

            # 更新内容流
            if content_xrefs:
                doc.update_stream(content_xrefs[0], new_content)

        # 3. 清理页面资源标记
        page.clean_contents()
