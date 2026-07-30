"""文本水印检测模块。

检测 PDF 中的文本型水印候选。
使用纯结构特征评分，不依赖关键词匹配：

评分维度（100 分制）:
- 跨页重复 (50%): 相同文本在多页按固定位置重复出现（水印最强信号）
- 位置一致性 (25%): 文本在每页的坐标波动极小（水印是固定位置的）
- 视觉异常 (25%): 字体大小、旋转角度、透明度、边距位置
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Dict, List, Tuple

import fitz

from . import DetectionResult


class TextDetector:
    """文本水印检测器。

    核心思路：水印的本质是"在所有页面以固定形式重复出现的非正文内容"。
    不关心文字内容是什么，只分析结构特征。
    """

    # 置信度阈值：上报所有跨页重复文本候选（0 = 全部上报）
    # 评分仍用于排序和 risk_score，但不再丢弃候选
    CONFIDENCE_THRESHOLD = 0.0

    # 跨页重复率下限：只在 >=2 页出现的文本才上报（单页文本不可能是水印）
    MIN_PAGES_FOR_CANDIDATE = 2

    def detect(self, doc: fitz.Document) -> List[DetectionResult]:
        """检测 PDF 中的文本水印候选。

        Args:
            doc: fitz 文档对象。

        Returns:
            检测结果列表。
        """
        total_pages = len(doc)
        if total_pages == 0:
            return []

        page_width = doc[0].rect.width if total_pages > 0 else 595.0
        page_height = doc[0].rect.height if total_pages > 0 else 842.0

        # 收集所有文本块: {text_content -> [(page_num, span_info)]}
        text_groups: Dict[str, List[Tuple[int, dict]]] = defaultdict(list)

        for page_num in range(total_pages):
            page = doc[page_num]
            blocks = page.get_text("dict").get("blocks", [])

            for block in blocks:
                if block.get("type") != 0:
                    continue

                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if not text or len(text) < 2:
                            continue

                        span_info = {
                            "text": text,
                            "font": span.get("font", ""),
                            "size": span.get("size", 0),
                            "bbox": span.get("bbox", (0, 0, 0, 0)),
                            "origin": span.get("origin", (0, 0)),
                            "alpha": span.get("alpha", 255),
                            "line_dir": line.get("dir", (1.0, 0.0)),
                        }
                        text_groups[text].append((page_num, span_info))

        # 评分并输出
        results: List[DetectionResult] = []

        for text, occurrences in text_groups.items():
            # 只上报跨页重复的文本（单页 unique 内容不上报）
            pages_appeared = len({occ[0] for occ in occurrences})
            if pages_appeared < self.MIN_PAGES_FOR_CANDIDATE:
                continue

            score, metadata = self._score_text_group(
                text, occurrences, total_pages, page_width, page_height
            )

            confidence = score / 100.0
            # 阈值已为 0，不再过滤；保留 confidence 供排序和 risk_score
            if confidence < self.CONFIDENCE_THRESHOLD:
                continue

            first_page, first_span = occurrences[0]
            bbox = first_span["bbox"]
            origin = first_span.get("origin", (0.0, 0.0))

            metadata["origin"] = (float(origin[0]), float(origin[1]))
            metadata["font_size"] = first_span.get("size", 0)

            results.append(
                DetectionResult(
                    type="text",
                    page=first_page + 1,
                    bbox=(bbox[0], bbox[1], bbox[2], bbox[3]),
                    content=text,
                    confidence=round(confidence, 2),
                    metadata=metadata,
                )
            )

        return results

    def _score_text_group(
        self,
        text: str,
        occurrences: List[Tuple[int, dict]],
        total_pages: int,
        page_width: float,
        page_height: float,
    ) -> Tuple[float, Dict[str, object]]:
        """对一组重复文本进行结构评分（100 分制）。

        Args:
            text: 文本内容。
            occurrences: [(page_num, span_info), ...]。
            total_pages: 总页数。
            page_width: 页面宽度。
            page_height: 页面高度。

        Returns:
            (score, metadata): 综合评分和详细信息。
        """
        # 跨页重复 (50%)
        repetition_score = self._score_repetition(occurrences, total_pages)

        # 位置一致性 (25%) — 水印在每页的(x,y)几乎不变
        consistency_score = self._score_position_consistency(occurrences, page_width, page_height)

        # 视觉异常 (25%)
        visual_score = self._score_visual_anomaly(occurrences, page_width, page_height)

        total_score = repetition_score + consistency_score + visual_score

        pages_appeared = len({occ[0] for occ in occurrences})
        metadata: Dict[str, object] = {
            "text": text,
            "pages_appeared": pages_appeared,
            "total_pages": total_pages,
            "repeat_rate": round(pages_appeared / max(total_pages, 1), 4),
            "repetition_score": round(repetition_score, 1),
            "consistency_score": round(consistency_score, 1),
            "visual_score": round(visual_score, 1),
            "total_score": round(total_score, 1),
        }

        return total_score, metadata

    @staticmethod
    def _score_repetition(
        occurrences: List[Tuple[int, dict]],
        total_pages: int,
    ) -> float:
        """跨页重复评分（满分 50）。

        水印最核心的特征：在所有页面以相同形式重复出现。
        正文文本通常只出现 1-2 次，水印出现 >= 80% 页面。
        """
        if total_pages <= 1:
            return 0.0

        pages_appeared = len({occ[0] for occ in occurrences})
        ratio = pages_appeared / total_pages

        if ratio >= 1.0:
            return 50.0  # 每页都有
        elif ratio >= 0.8:
            return 45.0
        elif ratio >= 0.6:
            return 35.0
        elif ratio >= 0.4:
            return 25.0
        elif ratio >= 0.2:
            return 15.0
        return 0.0  # 只出现几次，不是水印

    @staticmethod
    def _score_position_consistency(
        occurrences: List[Tuple[int, dict]],
        page_width: float,
        page_height: float,
    ) -> float:
        """位置一致性评分（满分 25）。

        水印在每页的精确位置几乎不变。
        正文文本在不同页面的位置会因内容长度、图表等产生偏移。

        计算所有出现位置的标准差，标准差越小 = 位置越固定 = 越可能是水印。
        """
        if len(occurrences) < 2:
            return 5.0  # 只出现一次，无法判断一致性，低分

        x_positions = []
        y_positions = []

        for _, span in occurrences:
            origin = span.get("origin", (0, 0))
            x_positions.append(origin[0] / page_width)
            y_positions.append(origin[1] / page_height)

        # 计算标准差（归一化到 [0,1] 空间）
        x_std = statistics.stdev(x_positions) if len(x_positions) > 1 else 0
        y_std = statistics.stdev(y_positions) if len(y_positions) > 1 else 0

        # 综合位置偏差
        pos_deviation = (x_std**2 + y_std**2) ** 0.5

        # 偏差越小分越高
        if pos_deviation < 0.01:
            return 25.0  # 位置几乎完全固定
        elif pos_deviation < 0.03:
            return 22.0  # 非常稳定
        elif pos_deviation < 0.05:
            return 18.0  # 较稳定
        elif pos_deviation < 0.10:
            return 12.0  # 有一定偏移
        elif pos_deviation < 0.20:
            return 6.0   # 偏移较大
        return 2.0  # 位置随机，不是水印

    @staticmethod
    def _score_visual_anomaly(
        occurrences: List[Tuple[int, dict]],
        page_width: float,
        page_height: float,
    ) -> float:
        """视觉异常评分（满分 25）。

        水印在视觉上通常与正文不同：
        - 字体过大/过小
        - 有旋转角度（斜向水印）
        - 半透明
        - 位于页面四周边距
        - 覆盖正文区域（跨行/跨列）
        """
        scores: list[float] = []

        for _, span in occurrences:
            s = 0.0
            size = span.get("size", 12)
            origin = span.get("origin", (0, 0))
            bbox = span.get("bbox", (0, 0, 0, 0))
            line_dir = span.get("line_dir", (1.0, 0.0))

            # ── 字体大小异常 (0-10) ──
            if size > 40:
                s += 10.0  # 超大字体，特征明显
            elif size > 20:
                s += 8.0  # 大字体
            elif size > 14:
                s += 5.0  # 偏大
            elif size < 6:
                s += 6.0  # 极小字体（页眉页脚常见）
            elif 6 <= size <= 8:
                s += 4.0  # 偏小
            else:
                s += 1.0  # 正常字号（9-14pt），低可疑

            # ── 旋转检测 (0-6) ──
            is_rotated = (
                abs(line_dir[0]) > 0.01 and abs(line_dir[1]) > 0.01
            )
            if is_rotated:
                if abs(line_dir[0]) < 0.1:
                    s += 6.0  # 垂直文本
                else:
                    angle = math.degrees(
                        math.atan2(line_dir[1], line_dir[0])
                    )
                    if 20 <= abs(angle) <= 70:
                        s += 6.0  # 斜向水印
                    else:
                        s += 3.0

            # ── 透明度 (0-4) ──
            alpha = span.get("alpha", 255)
            if alpha < 255:
                s += 4.0

            # ── 边距位置 (0-5) ──
            ox = origin[0] / page_width
            oy = origin[1] / page_height
            margin_left = ox < 0.08
            margin_right = ox > 0.92
            margin_top = oy < 0.10
            margin_bottom = oy > 0.85

            if margin_top or margin_bottom:
                s += 5.0  # 页眉页脚区域
            elif margin_left or margin_right:
                s += 3.0  # 左右边距

            # ── 跨行/超大覆盖 (0-额外) ──
            span_w = bbox[2] - bbox[0]
            span_h = bbox[3] - bbox[1]
            if span_w > page_width * 0.6:
                s += 2.0  # 水平跨度大
            if span_h > page_height * 0.3:
                s += 3.0  # 垂直覆盖大段区域

            scores.append(s)

        return max(scores) if scores else 0.0
