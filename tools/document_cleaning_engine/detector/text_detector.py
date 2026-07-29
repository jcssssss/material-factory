"""文本水印检测模块。

检测 PDF 中的文本型水印候选（如"机密"、"内部资料"等跨页重复文本）。
使用评分模型评估文本成为水印候选的概率。
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Dict, List, Tuple

import fitz

from . import DetectionResult


class TextDetector:
    """文本水印检测器。

    评分维度（100 分制）:
    - 关键词匹配 (30%): 文本是否匹配水印关键词库
    - 位置评分   (25%): 文本是否位于高风险区域（中央/斜向/边缘）
    - 跨页重复   (30%): 相同文本在多页出现
    - 样式评分   (15%): 字体大小、旋转角度、透明效果
    """

    # 置信度阈值：>= 0.8 为候选水印
    CONFIDENCE_THRESHOLD = 0.8

    # 初始水印关键词库
    KEYWORDS: List[str] = [
        "机密",
        "内部资料",
        "Confidential",
        "Draft",
        "Sample",
        "版权所有",
        "Copyright",
        "禁止传播",
    ]

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

        # 收集所有文本块: {text_content -> [(page_num, span_info)]}
        text_groups: Dict[str, List[Tuple[int, dict]]] = defaultdict(list)

        for page_num in range(total_pages):
            page = doc[page_num]
            blocks = page.get_text("dict").get("blocks", [])

            for block in blocks:
                if block.get("type") != 0:  # 0 = text block
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

        # 对各组文本进行评分
        results: List[DetectionResult] = []
        page_width = doc[0].rect.width if total_pages > 0 else 595.0
        page_height = doc[0].rect.height if total_pages > 0 else 842.0

        for text, occurrences in text_groups.items():
            score, metadata = self._score_text_group(
                text, occurrences, total_pages, page_width, page_height
            )

            confidence = score / 100.0
            if confidence < self.CONFIDENCE_THRESHOLD:
                continue

            # 取首次出现的页面
            first_page, first_span = occurrences[0]
            bbox = first_span["bbox"]
            origin = first_span.get("origin", (0.0, 0.0))

            # 在 metadata 中加入 origin 供 Cleaner 使用
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
        """对一组重复文本进行综合评分（100 分制）。

        Args:
            text: 文本内容。
            occurrences: [(page_num, span_info), ...]。
            total_pages: 总页数。
            page_width: 页面宽度。
            page_height: 页面高度。

        Returns:
            (score, metadata): 综合评分和详细信息。
        """
        # 关键词匹配评分 (30%)
        keyword_score = self._score_keywords(text)

        # 位置评分 (25%)
        position_score = self._score_position(occurrences, page_width, page_height)

        # 跨页重复评分 (30%)
        repetition_score = self._score_repetition(occurrences, total_pages)

        # 样式评分 (15%)
        style_score = self._score_style(occurrences)

        total_score = (
            keyword_score + position_score + repetition_score + style_score
        )

        pages_appeared = len({occ[0] for occ in occurrences})
        metadata: Dict[str, object] = {
            "text": text,
            "pages_appeared": pages_appeared,
            "total_pages": total_pages,
            "keyword_score": round(keyword_score, 1),
            "position_score": round(position_score, 1),
            "repetition_score": round(repetition_score, 1),
            "style_score": round(style_score, 1),
            "total_score": round(total_score, 1),
        }

        return total_score, metadata

    def _score_keywords(self, text: str) -> float:
        """关键词匹配评分（满分 30）。

        匹配水印词库中的关键词，匹配越多得分越高。
        """
        matched = 0
        for keyword in self.KEYWORDS:
            if keyword.lower() in text.lower():
                matched += 1

        if matched >= 3:
            return 30.0
        elif matched == 2:
            return 28.0
        elif matched == 1:
            return 25.0
        return 0.0

    def _score_position(
        self,
        occurrences: List[Tuple[int, dict]],
        page_width: float,
        page_height: float,
    ) -> float:
        """位置评分（满分 25）。

        水印常见位置：页面中央、斜向区域、边缘区域。
        按距页面中心的距离连续评分，而非离散判定。
        """
        scores: List[float] = []

        for _, span in occurrences:
            origin = span.get("origin", (0, 0))
            ox, oy = origin[0] / page_width, origin[1] / page_height

            dx = abs(ox - 0.5)
            dy = abs(oy - 0.5)
            dist = (dx**2 + dy**2) ** 0.5

            # 中央区域 (dist < 0.35): 高分
            # 边缘区域 (dist > 0.40): 中低分
            # 斜向区域加分
            is_diagonal = (
                abs(dx - dy) < 0.1 and dist > 0.2
            )

            if dist < 0.15:
                s = 25.0  # 正中央
            elif dist < 0.25:
                s = 22.0  # 近中央
            elif dist < 0.35:
                s = 18.0  # 中央附近
            elif dist < 0.45:
                s = 12.0  # 中等偏移
            else:
                s = 8.0   # 边缘

            # 斜向区域加分（水印常见斜向摆放）
            if is_diagonal:
                s = min(25.0, s + 3.0)

            scores.append(s)

        return max(scores) if scores else 0.0

    def _score_repetition(
        self,
        occurrences: List[Tuple[int, dict]],
        total_pages: int,
    ) -> float:
        """跨页重复评分（满分 30）。

        相同文本出现在越多页面，得分越高。
        """
        if total_pages <= 1:
            return 0.0

        pages_appeared = len({occ[0] for occ in occurrences})
        ratio = pages_appeared / total_pages
        return 30.0 * ratio

    def _score_style(
        self,
        occurrences: List[Tuple[int, dict]],
    ) -> float:
        """样式评分（满分 15）。

        水印通常有特殊的样式特征：
        - 字体大小异常（过大或过小）
        - 存在旋转角度
        - 透明/半透明效果（alpha < 255）
        """
        scores: List[float] = []

        for _, span in occurrences:
            s = 0.0
            size = span.get("size", 12)

            # 字体大小异常 (超过 30pt 或小于 6pt 通常不正常)
            if size > 40:
                s += 7.0  # 超大字体，水印特征明显
            elif size > 20:
                s += 5.0  # 大字体，可疑
            elif size < 6:
                s += 3.0
            else:
                s += 2.0

            # 旋转角度检测
            line_dir = span.get("line_dir", (1.0, 0.0))
            is_rotated = (
                abs(line_dir[0]) > 0.01 and abs(line_dir[1]) > 0.01
            )
            if is_rotated:
                # 检查是否为 90° 旋转（垂直文本）
                if abs(line_dir[0]) < 0.1:
                    s += 7.0  # 垂直文本，常见于水印
                else:
                    # 斜向水印（如 45° 旋转）
                    angle = math.degrees(
                        math.atan2(line_dir[1], line_dir[0])
                    )
                    if 20 <= abs(angle) <= 70:
                        s += 9.0  # 斜向水印，高分
                    else:
                        s += 5.0  # 其他旋转
            else:
                s += 1.0  # 水平文本，低分

            # 透明度检测
            alpha = span.get("alpha", 255)
            if alpha < 255:
                s += 3.0  # 有透明度

            scores.append(s)

        return max(scores) if scores else 0.0
