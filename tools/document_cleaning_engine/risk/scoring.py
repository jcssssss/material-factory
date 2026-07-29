"""风险评分模型。

实现 RiskScore 计算：
RiskScore = Detection Confidence * 50 + Object Type Score * 30 + Position Score * 20
"""

from __future__ import annotations

from typing import Optional, Tuple

from detector import DetectionResult


class RiskScorer:
    """风险评分器。

    对单个 DetectionResult 计算 0-100 的风险评分。
    供 RiskEngine 在生成 CleaningAction 前使用。
    """

    # ── 对象类型基础分 ──────────────────────────────────────────────
    # Annotation 和 Artifact 得分最高（结构化对象，安全可删）
    # 文本水印较高（匹配关键词后为高置信）
    # 图片水印居中
    # 页眉页脚较低（可能包含有效内容）
    TYPE_BASE_SCORES = {
        "annotation": 30,
        "artifact": 30,
        "text": 25,
        "image": 20,
        "header": 15,
        "footer": 15,
    }

    def score(self, detection: DetectionResult) -> float:
        """计算单个检测结果的风险评分。

        Args:
            detection: 检测结果。

        Returns:
            风险评分（0-100）。
        """
        # 1. 置信度贡献 (0-50)
        confidence_score = detection.confidence * 50.0

        # 2. 对象类型评分 (0-30)
        type_score = self._type_score(detection)

        # 3. 位置评分 (0-20)
        position_score = self._position_score(detection)

        total = confidence_score + type_score + position_score

        # 确保在 0-100 范围内
        return max(0.0, min(100.0, total))

    def _type_score(self, detection: DetectionResult) -> float:
        """计算对象类型评分（满分 30）。"""
        base = self.TYPE_BASE_SCORES.get(detection.type, 10)

        # 文本水印：匹配关键词则加分
        if detection.type == "text":
            total_score = detection.metadata.get("total_score", 0)
            # total_score 是原检测器的 100 分制评分，映射到 0-30
            type_score = base + (total_score / 100.0) * 5.0
            return min(30.0, type_score)

        # 图片水印：总分高则加分
        if detection.type == "image":
            total_score = detection.metadata.get("total_score", 0)
            type_score = base + (total_score / 100.0) * 5.0
            return min(30.0, type_score)

        return float(base)

    def _position_score(
        self, detection: DetectionResult
    ) -> float:
        """计算位置评分（满分 20）。

        水印在中央区域得分高，在角落得分低。
        """
        bbox = detection.bbox
        if not bbox:
            # 无位置信息的（如 Artifact），给中等分
            return 10.0

        x0, y0, x1, y1 = bbox
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2

        # 归一化到 [0,1]，假设标准 A4 页面 (595x842)
        page_w = 595.0
        page_h = 842.0
        nx = cx / page_w
        ny = cy / page_h

        # 距页面中心的归一化距离
        dx = abs(nx - 0.5)
        dy = abs(ny - 0.5)
        dist = (dx**2 + dy**2) ** 0.5

        # 越靠近中心分越高
        if dist < 0.15:
            return 20.0
        elif dist < 0.25:
            return 16.0
        elif dist < 0.35:
            return 12.0
        elif dist < 0.45:
            return 8.0
        else:
            return 4.0
