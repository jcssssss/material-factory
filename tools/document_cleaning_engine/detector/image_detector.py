"""图片水印检测模块。

检测 PDF 中重复出现的图片对象（如 Logo、平台标识、半透明水印图）。
使用评分模型评估图片成为水印候选的概率。
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Dict, List, Tuple

import fitz

from . import DetectionResult


class ImageDetector:
    """图片水印检测器。

    评分维度（100 分制）:
    - 跨页重复 (40%): 同一图片出现的页面比例
    - 面积占比 (25%): 图片面积 / 页面面积
    - 中央位置 (20%): 图片是否位于页面中央区域
    - 透明度   (15%): 图片是否包含 Alpha 通道
    """

    # 置信度阈值：0 = 所有跨页重复图片全部上报
    CONFIDENCE_THRESHOLD = 0.0

    def detect(self, doc: fitz.Document) -> List[DetectionResult]:
        """检测 PDF 中的重复图片水印候选。

        Args:
            doc: fitz 文档对象。

        Returns:
            检测结果列表。
        """
        total_pages = len(doc)
        if total_pages == 0:
            return []

        # 按图片哈希分组: {hash -> [(page_num, xref, bbox)]}
        image_groups: Dict[str, List[Tuple[int, int, fitz.Rect]]] = defaultdict(list)

        for page_num in range(total_pages):
            page = doc[page_num]
            images = page.get_images()

            for img in images:
                xref = img[0]
                try:
                    ext = doc.extract_image(xref)
                except Exception:
                    continue

                img_bytes = ext.get("image")
                if not img_bytes:
                    continue

                img_hash = hashlib.sha256(img_bytes).hexdigest()

                # 获取图片在页面上的位置
                rects = page.get_image_rects(xref)
                for rect in rects:
                    image_groups[img_hash].append((page_num, xref, rect))

        # 对各组图片进行评分
        results: List[DetectionResult] = []

        for img_hash, occurrences in image_groups.items():
            score, metadata = self._score_image_group(
                occurrences, total_pages, doc
            )

            confidence = score / 100.0
            if confidence < self.CONFIDENCE_THRESHOLD:
                continue

            # 取首次出现的页面作为代表
            first_page, first_xref, first_bbox = occurrences[0]
            ext = doc.extract_image(first_xref)

            # 在 metadata 中添加 xref 供 Cleaner 使用
            metadata["xref"] = first_xref
            metadata["image_hash"] = img_hash
            # 记录所有出现页面的 xref（用于清理所有引用）
            all_xrefs = list({occ[1] for occ in occurrences})
            metadata["xrefs"] = all_xrefs

            results.append(
                DetectionResult(
                    type="image",
                    page=first_page + 1,
                    bbox=(
                        first_bbox.x0, first_bbox.y0,
                        first_bbox.x1, first_bbox.y1,
                    ),
                    content=f"重复图片 (SHA256:{img_hash[:8]}...)",
                    confidence=round(confidence, 2),
                    metadata=metadata,
                )
            )

        return results

    def _score_image_group(
        self,
        occurrences: List[Tuple[int, int, fitz.Rect]],
        total_pages: int,
        doc: fitz.Document,
    ) -> Tuple[float, Dict[str, object]]:
        """对一组重复图片进行综合评分（100 分制）。

        Args:
            occurrences: [(page_num, xref, bbox), ...]。
            total_pages: PDF 总页数。
            doc: fitz 文档对象。

        Returns:
            (score, metadata): 综合评分和详细信息。
        """
        # 跨页重复评分 (40%)
        pages_with_image = len({occ[0] for occ in occurrences})
        repetition_score = self._score_repetition(pages_with_image, total_pages)

        # 面积占比评分 (25%)
        area_score = self._score_area_ratio(occurrences, doc)

        # 中央位置评分 (20%)
        position_score = self._score_center_position(occurrences, doc)

        # 透明度评分 (15%)
        alpha_score = self._score_alpha(occurrences, doc)

        total_score = (
            repetition_score + area_score + position_score + alpha_score
        )

        repeat_rate = pages_with_image / total_pages if total_pages > 0 else 0.0
        metadata: Dict[str, object] = {
            "pages_appeared": pages_with_image,
            "total_pages": total_pages,
            "repeat_rate": round(repeat_rate, 4),
            "repetition_score": round(repetition_score, 1),
            "area_score": round(area_score, 1),
            "position_score": round(position_score, 1),
            "alpha_score": round(alpha_score, 1),
            "total_score": round(total_score, 1),
        }

        return total_score, metadata

    def _score_repetition(self, pages_appeared: int, total_pages: int) -> float:
        """跨页重复评分（满分 40）。

        按出现页面比例线性映射。
        """
        if total_pages == 0:
            return 0.0
        ratio = pages_appeared / total_pages
        return 40.0 * ratio

    def _score_area_ratio(
        self,
        occurrences: List[Tuple[int, int, fitz.Rect]],
        doc: fitz.Document,
    ) -> float:
        """面积占比评分（满分 25）。

        水印通常面积较小，中等偏小面积得分高。
        极小（<1%）或极大（>50%）扣分。
        """
        scores: List[float] = []
        for page_num, _, bbox in occurrences:
            page = doc[page_num]
            page_area = page.rect.width * page.rect.height
            if page_area == 0:
                continue
            img_area = bbox.width * bbox.height
            ratio = img_area / page_area

            # 评分曲线：水印图片可大可小，中等面积得分最高
            if ratio < 0.005:
                s = 3.0   # 极小，不太可能是水印
            elif ratio < 0.02:
                s = 12.0  # 较小，可能是小 Logo
            elif ratio < 0.25:
                s = 25.0  # 理想范围（2%-25%）
            elif ratio < 0.40:
                s = 18.0  # 较大，可能是背景水印
            elif ratio < 0.60:
                s = 10.0  # 很大，可能是主要内容
            else:
                s = 3.0   # 极大，几乎占满页面

            scores.append(s)

        return max(scores) if scores else 0.0

    def _score_center_position(
        self,
        occurrences: List[Tuple[int, int, fitz.Rect]],
        doc: fitz.Document,
    ) -> float:
        """中央位置评分（满分 20）。

        水印常位于页面中央、斜向或边缘区域。
        """
        scores: List[float] = []
        for page_num, _, bbox in occurrences:
            page = doc[page_num]
            page_w = page.rect.width
            page_h = page.rect.height

            # 图片中心坐标（归一化到 [0,1]）
            cx = (bbox.x0 + bbox.x1) / 2 / page_w
            cy = (bbox.y0 + bbox.y1) / 2 / page_h

            # 计算距页面中心的偏移
            dx = abs(cx - 0.5)
            dy = abs(cy - 0.5)
            dist = (dx**2 + dy**2) ** 0.5

            # 中心区域 (dist < 0.15): 高分
            # 边缘区域 (dist > 0.35): 中等分
            # 极偏区域: 低分
            if dist < 0.15:
                s = 20.0
            elif dist < 0.25:
                s = 15.0
            elif dist < 0.35:
                s = 12.0
            else:
                s = 5.0

            # 斜向区域加分（水印常见斜向摆放）
            if abs(dx - dy) < 0.1 and dist > 0.25:
                s = min(20.0, s + 3.0)

            scores.append(s)

        return max(scores) if scores else 0.0

    def _score_alpha(
        self,
        occurrences: List[Tuple[int, int, fitz.Rect]],
        doc: fitz.Document,
    ) -> float:
        """透明度评分（满分 15）。

        水印常为半透明，通过 Soft Mask（smask）判断。
        """
        for page_num, xref, _ in occurrences:
            try:
                ext = doc.extract_image(xref)
            except Exception:
                continue

            # smask 非零表示存在透明度信息
            if ext.get("smask", 0):
                return 15.0

        return 0.0
