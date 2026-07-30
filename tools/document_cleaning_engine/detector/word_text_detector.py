"""Word 文字水印检测器。

检测 DOCX 文档中的文字型水印、Header/Footer 中的重复标识文本。
"""

from __future__ import annotations

from collections import Counter
from typing import Dict, List

from detector import DetectionResult
from matcher.word_text_matcher import WordTextMatcher


class WordTextDetector:
    """Word 文字水印检测器。

    评分模型（100分制）:
    - 关键词匹配 40分: 命中词库
    - Header/Footer位置 30分: 位于页眉页脚
    - 重复率 20分: 跨 Section 重复
    - 文本长度 10分: 短文本加分
    """

    KEYWORDS = [
        "内部资料", "内部文件", "禁止传播", "机密",
        "Confidential", "Draft", "Sample", "Preview",
        "Copyright", "版权所有",
    ]

    CONFIDENCE_THRESHOLD = 0.8

    def __init__(self) -> None:
        self._matcher = WordTextMatcher()

    def detect(self, docx_path: str) -> List[DetectionResult]:
        """检测 DOCX 中的文字水印。

        Args:
            docx_path: DOCX 文件路径。

        Returns:
            检测结果列表。
        """
        all_texts = self._matcher.find_all_texts(docx_path)
        if not all_texts:
            return []

        # 分组评分
        scored = self._score_texts(all_texts)

        # 输出 DetectionResult
        results: List[DetectionResult] = []
        for item in scored:
            text, confidence, metadata = item
            results.append(
                DetectionResult(
                    type="word_text",
                    page=0,
                    confidence=round(confidence, 2),
                    content=text,
                    metadata=metadata,
                )
            )

        return results

    def _score_texts(
        self, all_texts: Dict[str, List]
    ) -> List:
        """对所有文本块评分。"""
        # 收集所有文本
        text_locations: Dict[str, List[dict]] = {}
        for xml_path, blocks in all_texts.items():
            for block in blocks:
                text = block.text
                if text not in text_locations:
                    text_locations[text] = []
                text_locations[text].append({
                    "xml_path": xml_path,
                    "type": block.element_type,
                })

        total_sections = len(all_texts)

        scored = []
        for text, locations in text_locations.items():
            score, metadata = self._score_single(text, locations, total_sections)
            confidence = score / 100.0
            if confidence >= self.CONFIDENCE_THRESHOLD:
                first_loc = locations[0]
                metadata["xml"] = first_loc["xml_path"]
                scored.append((text, confidence, metadata))

        return scored

    def _score_single(
        self, text: str, locations: List[dict], total_sections: int
    ) -> tuple:
        """对单个文本进行评分。"""
        # 关键词匹配 (40分)
        keyword_score = self._score_keywords(text)

        # Header/Footer 位置 (30分)
        location_score = self._score_location(locations)

        # 重复率 (20分)
        repeat_score = self._score_repeat(locations, total_sections)

        # 文本长度 (10分)
        length_score = self._score_length(text)

        total = keyword_score + location_score + repeat_score + length_score

        metadata = {
            "keyword_score": keyword_score,
            "location_score": location_score,
            "repeat_score": repeat_score,
            "length_score": length_score,
            "total_score": total,
            "locations": [loc["xml_path"] for loc in locations],
            "location_types": list({loc["type"] for loc in locations}),
        }

        return total, metadata

    def _score_keywords(self, text: str) -> float:
        """关键词匹配 (40分)。"""
        for keyword in self.KEYWORDS:
            if keyword.lower() in text.lower():
                return 40.0
        return 0.0

    def _score_location(self, locations: List[dict]) -> float:
        """Header/Footer 位置 (30分)。"""
        for loc in locations:
            if loc["type"] in ("header", "footer"):
                return 30.0
        return 5.0

    def _score_repeat(self, locations: List[dict], total: int) -> float:
        """重复率 (20分)。"""
        if total <= 1:
            return 0.0
        repeat_count = len(locations)
        rate = repeat_count / total
        return 20.0 * rate

    @staticmethod
    def _score_length(text: str) -> float:
        """文本长度 (10分)。"""
        length = len(text)
        if length <= 10:
            return 10.0
        elif length <= 20:
            return 8.0
        elif length <= 40:
            return 5.0
        return 2.0
