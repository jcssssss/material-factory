"""PDF Cleaner 主入口。

接收 CleaningPlan，执行清理操作，输出 CleaningResult 列表。
支持失败隔离：单 Action 失败不影响其他 Action。
"""

from __future__ import annotations

import logging
import os
from collections import Counter
from typing import List

import fitz

from risk import (
    ACTION_TYPE_MAP,
    ActionType,
    CleaningAction,
    CleaningPlan,
    RiskLevel,
)

from . import CleaningResult, CleaningStatus
from .annotation_cleaner import AnnotationCleaner
from .artifact_cleaner import ArtifactCleaner
from .image_cleaner import ImageCleaner
from .text_cleaner import TextWatermarkCleaner

logger = logging.getLogger(__name__)


class PDFCleaner:
    """PDF 清理器。

    根据 CleaningPlan 执行清理操作，输出每次操作的执行结果。
    支持的操作类型：
    - REMOVE_ANNOTATION
    - REMOVE_ARTIFACT
    - REMOVE_IMAGE
    - REMOVE_TEXT
    - REMOVE_HEADER
    - REMOVE_FOOTER

    其他操作类型将被跳过。
    """

    # 页面失败阈值：同一页面失败 Action 数 >= 此值时标记 PARTIAL_SUCCESS
    PAGE_FAIL_THRESHOLD = 3

    def __init__(self) -> None:
        self._annotation_cleaner = AnnotationCleaner()
        self._artifact_cleaner = ArtifactCleaner()
        self._image_cleaner = ImageCleaner()
        self._text_cleaner = TextWatermarkCleaner()

    def clean(
        self,
        input_path: str,
        plan: CleaningPlan,
        output_path: str,
    ) -> List[CleaningResult]:
        """执行清理计划。

        流程：
        1. 打开 PDF（可写）
        2. 遍历 CleaningPlan 中的每个 Action
        3. 根据 Action 类型分发到对应 Cleaner
        4. 记录执行结果
        5. 保存 PDF
        6. 返回结果列表

        Args:
            input_path: 输入 PDF 文件路径。
            plan: 清理计划。
            output_path: 输出 PDF 文件路径。

        Returns:
            清理执行结果列表。
        """
        if not plan.actions:
            logger.info("CleaningPlan has no actions, skipping")
            return []

        # 安全检查：只处理 AUTO 级别的 Action
        # （CONFIRM 需要用户确认后由外部决定是否执行）
        filtered_actions = [
            a for a in plan.actions
            if a.risk_level == RiskLevel.AUTO
        ]

        if not filtered_actions:
            logger.info("No AUTO actions in plan, skipping")
            return []

        # 打开 PDF
        try:
            doc = fitz.open(input_path)
        except Exception as e:
            logger.error("Failed to open PDF: %s", e)
            return [
                CleaningResult(
                    action=a,
                    status=CleaningStatus.FAILED,
                    error=f"file open failed: {e}",
                )
                for a in filtered_actions
            ]

        results: List[CleaningResult] = []
        page_fail_counts: Counter = Counter()

        try:
            for action in filtered_actions:
                result = self._execute_action(doc, action)
                results.append(result)

                # 统计页面失败数
                if result.status == CleaningStatus.FAILED:
                    page_fail_counts[action.page] += 1

            # 如果同一页面失败 Action >= 阈值，标记这些 Action 为 PARTIAL_SUCCESS
            self._mark_partial_success(results, page_fail_counts)

            # 保存 PDF
            try:
                doc.save(
                    output_path,
                    garbage=4,  # 彻底清理未引用对象
                    deflate=True,
                    clean=True,
                )
            except Exception as e:
                logger.error("Failed to save PDF: %s", e)
                # 保存失败 → 所有 SUCCESS 改为 FAILED
                for r in results:
                    if r.status == CleaningStatus.SUCCESS:
                        r.status = CleaningStatus.FAILED
                        r.error = f"save failed: {e}"
                        r.fallback_action = "retry"
                return results

        finally:
            doc.close()

        # 验证输出文件
        if not os.path.exists(output_path):
            for r in results:
                if r.status == CleaningStatus.SUCCESS:
                    r.status = CleaningStatus.FAILED
                    r.error = "output file not created"

        return results

    def _execute_action(
        self,
        doc: fitz.Document,
        action: CleaningAction,
    ) -> CleaningResult:
        """执行单个清理操作。"""
        # 安全检查：只处理允许的 Action 类型
        if action.action_type not in (
            ActionType.REMOVE_ANNOTATION.value,
            ActionType.REMOVE_ARTIFACT.value,
            ActionType.REMOVE_IMAGE.value,
            ActionType.REMOVE_TEXT.value,
        ):
            return CleaningResult(
                action=action,
                status=CleaningStatus.SKIPPED,
                error=f"unsupported action type: {action.action_type}",
                fallback_action="skip",
            )

        # 分发到对应 Cleaner
        try:
            if action.action_type == ActionType.REMOVE_ANNOTATION.value:
                return self._annotation_cleaner.clean(doc, action)
            elif action.action_type == ActionType.REMOVE_ARTIFACT.value:
                return self._artifact_cleaner.clean(doc, action)
            elif action.action_type == ActionType.REMOVE_IMAGE.value:
                return self._image_cleaner.clean(doc, action)
            elif action.action_type == ActionType.REMOVE_TEXT.value:
                return self._text_cleaner.clean(doc, action)
        except Exception as e:
            logger.error("Action execution failed: %s", e)
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"execution error: {e}",
                fallback_action="manual_review",
            )

        return CleaningResult(
            action=action,
            status=CleaningStatus.SKIPPED,
        )

    @staticmethod
    def _mark_partial_success(
        results: List[CleaningResult],
        page_fail_counts: Counter,
    ) -> None:
        """标记部分成功：同一页面失败 Action 数超标时。"""
        for result in results:
            if (
                result.status == CleaningStatus.FAILED
                and page_fail_counts.get(result.action.page, 0)
                >= PDFCleaner.PAGE_FAIL_THRESHOLD
            ):
                result.status = CleaningStatus.PARTIAL_SUCCESS
                result.fallback_action = "manual_review"
