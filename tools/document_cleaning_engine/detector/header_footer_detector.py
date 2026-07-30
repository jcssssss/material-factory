"""页眉页脚检测模块。

检测 PDF 页面顶部（0%-15%）和底部（85%-100%）区域的重复文本块，
识别页眉/页脚候选元素。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

import fitz

from . import DetectionResult


class HeaderFooterDetector:
    """页眉页脚检测器。

    检测区域:
    - 页眉: 页面高度 0%-15%
    - 页脚: 页面高度 85%-100%

    评分维度（100 分制）:
    - 跨页重复率 (40%): 相同文本在多页的相同区域出现
    - 位置       (25%): 距页面顶部/底部的距离
    - 字体大小   (15%): 页眉页脚通常字体较小
    - 距离正文   (10%): 与正文区域的分离程度
    - 文本长度   (10%): 页眉页脚通常较短
    """

    # 页眉区域：页面高度 0%-18%（从15%放宽到18%以覆盖更多边界情况）
    HEADER_RATIO_MAX = 0.18
    # 页脚区域：页面高度 82%-100%（从85%放宽到82%）
    FOOTER_RATIO_MIN = 0.82

    def detect(self, doc: fitz.Document) -> List[DetectionResult]:
        """检测 PDF 中的页眉页脚候选。

        Args:
            doc: fitz 文档对象。

        Returns:
            检测结果列表。
        """
        total_pages = len(doc)
        if total_pages == 0:
            return []

        results: List[DetectionResult] = []

        # 分别检测页眉和页脚
        results.extend(self._detect_region(doc, "header", total_pages))
        results.extend(self._detect_region(doc, "footer", total_pages))

        return results

    def _detect_region(
        self,
        doc: fitz.Document,
        region: str,
        total_pages: int,
    ) -> List[DetectionResult]:
        """检测指定区域（页眉/页脚）的重复文本。

        Args:
            doc: fitz 文档对象。
            region: "header" 或 "footer"。
            total_pages: 总页数。

        Returns:
            检测结果列表。
        """
        # 收集指定区域的文本块: {text -> [(page_num, bbox, size, text, origin)]}
        region_texts: Dict[str, List[Tuple[int, fitz.Rect, float, str, tuple]]] = (
            defaultdict(list)
        )

        for page_num in range(total_pages):
            page = doc[page_num]
            page_h = page.rect.height
            blocks = page.get_text("dict").get("blocks", [])

            for block in blocks:
                if block.get("type") != 0:
                    continue

                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if not text or len(text) < 2:
                            continue

                        bbox = span.get("bbox", (0, 0, 0, 0))
                        size = span.get("size", 12)
                        origin = span.get("origin", (0.0, 0.0))

                        # 根据区域类型筛选
                        bbox_top_ratio = bbox[1] / page_h if page_h > 0 else 0

                        if region == "header" and bbox_top_ratio > self.HEADER_RATIO_MAX:
                            continue
                        if region == "footer" and bbox_top_ratio < self.FOOTER_RATIO_MIN:
                            continue

                        region_texts[text].append(
                            (page_num, fitz.Rect(bbox), size, text, origin)
                        )

        # 评分并输出
        results: List[DetectionResult] = []

        for text, occurrences in region_texts.items():
            # 只上报跨页重复的文本（单页的不可能是页眉页脚）
            pages_appeared = len({occ[0] for occ in occurrences})
            if pages_appeared < 2:
                continue

            score, metadata = self._score_region_group(
                text, [(p, b, s, t) for p, b, s, t, _ in occurrences],
                total_pages, region, doc
            )

            # 阈值降至 0，全部作为候选上报；保留 confidence 供排序
            if score < 0.0:
                continue

            confidence = score / 100.0
            first_page, first_bbox, first_size, _, first_origin = occurrences[0]

            # origin 供 Cleaner 使用（优先使用 span origin）
            origin = first_origin if first_origin and first_origin != (0.0, 0.0) else (first_bbox.x0, first_bbox.y0)
            metadata["origin"] = (float(origin[0]), float(origin[1]))
            metadata["font_size"] = first_size

            results.append(
                DetectionResult(
                    type=region,
                    page=first_page + 1,
                    bbox=(
                        first_bbox.x0, first_bbox.y0,
                        first_bbox.x1, first_bbox.y1,
                    ),
                    content=text,
                    confidence=round(confidence, 2),
                    metadata=metadata,
                )
            )

        return results

    def _score_region_group(
        self,
        text: str,
        occurrences: List[Tuple[int, fitz.Rect, float, str]],
        total_pages: int,
        region: str,
        doc: fitz.Document,
    ) -> Tuple[float, Dict[str, object]]:
        """对页眉/页脚文本组进行综合评分（100 分制）。

        Args:
            text: 文本内容。
            occurrences: [(page_num, bbox, size, text), ...]。
            total_pages: 总页数。
            region: "header" 或 "footer"。
            doc: fitz 文档对象。

        Returns:
            (score, metadata): 综合评分和详细信息。
        """
        # 跨页重复率 (40%)
        repetition_score = self._score_repetition(occurrences, total_pages)

        # 位置 (25%)
        position_score = self._score_position(occurrences, region, doc)

        # 字体大小 (15%)
        font_size_score = self._score_font_size(occurrences)

        # 距离正文 (10%)
        distance_score = self._score_distance(occurrences, region, doc)

        # 文本长度 (10%)
        length_score = self._score_text_length(text)

        total_score = (
            repetition_score + position_score + font_size_score
            + distance_score + length_score
        )

        pages_appeared = len({occ[0] for occ in occurrences})
        metadata: Dict[str, object] = {
            "region": region,
            "pages_appeared": pages_appeared,
            "total_pages": total_pages,
            "repetition_score": round(repetition_score, 1),
            "position_score": round(position_score, 1),
            "font_size_score": round(font_size_score, 1),
            "distance_score": round(distance_score, 1),
            "length_score": round(length_score, 1),
            "total_score": round(total_score, 1),
        }

        return total_score, metadata

    def _score_repetition(
        self,
        occurrences: List[Tuple[int, fitz.Rect, float, str]],
        total_pages: int,
    ) -> float:
        """跨页重复率评分（满分 40）。

        页眉页脚通常在所有页面重复出现。
        """
        if total_pages <= 1:
            return 0.0

        pages_appeared = len({occ[0] for occ in occurrences})
        ratio = pages_appeared / total_pages
        return 40.0 * ratio

    def _score_position(
        self,
        occurrences: List[Tuple[int, fitz.Rect, float, str]],
        region: str,
        doc: fitz.Document,
    ) -> float:
        """位置评分（满分 25）。

        页眉应紧贴顶部，页脚应紧贴底部。
        """
        scores: List[float] = []

        for page_num, bbox, _, _ in occurrences:
            page = doc[page_num]
            page_h = page.rect.height
            if page_h == 0:
                continue

            if region == "header":
                # 页眉越靠近顶部得分越高
                bottom_ratio = bbox.y1 / page_h
                if bottom_ratio <= 0.05:
                    scores.append(25.0)
                elif bottom_ratio <= 0.10:
                    scores.append(20.0)
                elif bottom_ratio <= 0.15:
                    scores.append(15.0)
                else:
                    scores.append(5.0)
            else:
                # 页脚越靠近底部得分越高
                top_ratio = bbox.y0 / page_h
                if top_ratio >= 0.95:
                    scores.append(25.0)
                elif top_ratio >= 0.90:
                    scores.append(20.0)
                elif top_ratio >= 0.85:
                    scores.append(15.0)
                else:
                    scores.append(5.0)

        return max(scores) if scores else 0.0

    def _score_font_size(
        self,
        occurrences: List[Tuple[int, fitz.Rect, float, str]],
    ) -> float:
        """字体大小评分（满分 15）。

        页眉页脚通常使用较小字体（8pt-12pt）。
        """
        sizes = [size for _, _, size, _ in occurrences]
        if not sizes:
            return 0.0

        avg_size = sum(sizes) / len(sizes)

        if 8 <= avg_size <= 12:
            return 15.0
        elif 6 <= avg_size < 8 or 12 < avg_size <= 14:
            return 10.0
        elif avg_size < 6:
            return 5.0
        return 3.0  # 字体过大

    def _score_distance(
        self,
        occurrences: List[Tuple[int, fitz.Rect, float, str]],
        region: str,
        doc: fitz.Document,
    ) -> float:
        """距离正文评分（满分 10）。

        页眉页脚通常与正文区域有明显间距。
        """
        distances: List[float] = []

        for page_num, bbox, _, _ in occurrences:
            page = doc[page_num]
            page_h = page.rect.height
            if page_h == 0:
                continue

            if region == "header":
                # 页眉下方到正文开始的距离
                gap = (self.HEADER_RATIO_MAX * page_h) - bbox.y1
                distances.append(max(0, gap / page_h))
            else:
                # 正文结束到页脚上方的距离
                gap = bbox.y0 - (self.FOOTER_RATIO_MIN * page_h)
                distances.append(max(0, gap / page_h))

        if not distances:
            return 0.0

        avg_gap = sum(distances) / len(distances)

        if avg_gap > 0.03:
            return 10.0
        elif avg_gap > 0.01:
            return 7.0
        elif avg_gap > 0.005:
            return 5.0
        return 2.0

    def _score_text_length(self, text: str) -> float:
        """文本长度评分（满分 10）。

        页眉页脚通常为短文本。
        """
        length = len(text)

        if length <= 10:
            return 10.0
        elif length <= 20:
            return 8.0
        elif length <= 30:
            return 5.0
        elif length <= 50:
            return 3.0
        return 1.0
