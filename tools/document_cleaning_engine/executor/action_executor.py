"""ActionExecutor — Action 路由与执行器。

根据 CleaningAction 的类型和文档类型，路由到对应的 Cleaner 执行。
执行结果以 cleaner.CleaningResult 返回。
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Dict, List, Optional

from cleaner import (
    CleaningResult,
    CleaningStatus,
    PDFCleaner,
)
from cleaner.word_text_cleaner import WordTextCleaner
from cleaner.word_object_cleaner import WordObjectCleaner
from risk import CleaningAction, CleaningPlan, RiskLevel
from models.execution_context import ExecutionContext

logger = logging.getLogger(__name__)


class ActionExecutor:
    """Action 执行器。

    将 CleaningAction 路由到对应的文档 Cleaner 执行。
    支持 PDF 和 Word 两种文档类型的 Action 分发。
    """

    # 页面失败阈值：同一页面超过此数量的 Action 失败 → NEED_REVIEW
    PAGE_FAIL_THRESHOLD = 3

    def __init__(self) -> None:
        self._pdf_cleaner = PDFCleaner()
        self._word_text_cleaner = WordTextCleaner()
        self._word_object_cleaner = WordObjectCleaner()

    def execute(
        self,
        plan: CleaningPlan,
        context: ExecutionContext,
    ) -> List[CleaningResult]:
        """执行清理计划。

        根据文档类型选择对应的 Cleaner 执行所有 Action。

        Args:
            plan: 清理计划。
            context: 执行上下文（包含文件路径、取消标志等）。

        Returns:
            执行结果列表。
        """
        if not plan.actions:
            logger.info("Plan has no actions, skipping execution")
            return []

        # 只执行 AUTO 或更高风险等级的操作（已确认的）
        executable_actions = [
            a for a in plan.actions
            if a.risk_level in (RiskLevel.AUTO, RiskLevel.CONFIRM)
        ]
        if not executable_actions:
            logger.info("No executable actions in plan")
            return []

        # 检查取消标志
        if context.cancel_requested:
            logger.info("Execution cancelled before start")
            return []

        document_type = context.document_type.upper()

        if document_type == "PDF":
            return self._execute_pdf(plan, context)
        elif document_type == "WORD":
            return self._execute_word(plan, context)
        else:
            logger.warning("Unsupported document type: %s", document_type)
            return [
                CleaningResult(
                    action=a,
                    status=CleaningStatus.SKIPPED,
                    error=f"unsupported document type: {document_type}",
                    fallback_action="skip",
                )
                for a in executable_actions
            ]

    def _execute_pdf(
        self,
        plan: CleaningPlan,
        context: ExecutionContext,
    ) -> List[CleaningResult]:
        """执行 PDF 清理。

        PDFCleaner 内部处理所有 PDF 动作类型。
        """
        logger.info("Executing PDF plan: %s", plan.plan_id)

        try:
            # PDFCleaner 内部已处理失败隔离
            results = self._pdf_cleaner.clean(
                input_path=context.input_file,
                plan=plan,
                output_path=context.output_file,
            )
        except Exception as e:
            logger.error("PDF execution failed: %s", e)
            return [
                CleaningResult(
                    action=a,
                    status=CleaningStatus.FAILED,
                    error=f"PDF execution error: {e}",
                    fallback_action="manual_review",
                )
                for a in plan.actions
            ]

        return results

    def _execute_word(
        self,
        plan: CleaningPlan,
        context: ExecutionContext,
    ) -> List[CleaningResult]:
        """执行 Word 清理。

        根据 Action 类型分发到 WordTextCleaner 和 WordObjectCleaner。
        """
        logger.info("Executing Word plan: %s", plan.plan_id)

        all_results: List[CleaningResult] = []

        # 检查取消标志
        if context.cancel_requested:
            return []

        # 分出文本 Action 和对象 Action
        text_actions = [
            a for a in plan.actions
            if a.action_type in ("REMOVE_TEXT", "REMOVE_HEADER", "REMOVE_FOOTER")
        ]
        object_actions = [
            a for a in plan.actions
            if a.action_type in ("REMOVE_SHAPE", "REMOVE_DRAWING")
        ]

        # 执行文本清理
        if text_actions and not context.cancel_requested:
            text_plan = CleaningPlan(
                file_path=plan.file_path,
                risk_level=plan.risk_level,
                actions=text_actions,
                status="CONFIRMED",
            )
            try:
                text_results = self._word_text_cleaner.clean(
                    docx_path=context.input_file,
                    plan=text_plan,
                    output_path=context.output_file,
                )
                all_results.extend(text_results)
            except Exception as e:
                logger.error("Word text cleaning failed: %s", e)
                for a in text_actions:
                    all_results.append(
                        CleaningResult(
                            action=a,
                            status=CleaningStatus.FAILED,
                            error=f"word text clean error: {e}",
                        )
                    )

        # 执行对象清理
        if object_actions and not context.cancel_requested:
            object_plan = CleaningPlan(
                file_path=plan.file_path,
                risk_level=plan.risk_level,
                actions=object_actions,
                status="CONFIRMED",
            )
            try:
                # WordObjectCleaner 需要 docx_path 参数名
                object_results = self._word_object_cleaner.clean(
                    docx_path=context.input_file,
                    plan=object_plan,
                    output_path=context.output_file,
                )
                all_results.extend(object_results)
            except Exception as e:
                logger.error("Word object cleaning failed: %s", e)
                for a in object_actions:
                    all_results.append(
                        CleaningResult(
                            action=a,
                            status=CleaningStatus.FAILED,
                            error=f"word object clean error: {e}",
                        )
                    )

        return all_results

    @staticmethod
    def check_page_failures(
        results: List[CleaningResult],
    ) -> Optional[str]:
        """检查页面级失败。

        同一页面超过 PAGE_FAIL_THRESHOLD 个 Action 失败时返回提示。

        Returns:
            需要人工审核的原因，或 None。
        """
        page_fails: Counter = Counter()
        for result in results:
            if result.status == CleaningStatus.FAILED:
                page = result.action.page
                if page is not None:
                    page_fails[page] += 1

        bad_pages = [
            page for page, count in page_fails.items()
            if count >= ActionExecutor.PAGE_FAIL_THRESHOLD
        ]

        if bad_pages:
            return (
                f"页面 {', '.join(str(p) for p in sorted(bad_pages))} "
                f"失败 Action 超过 {ActionExecutor.PAGE_FAIL_THRESHOLD} 个，需人工审核"
            )
        return None

    @staticmethod
    def has_critical_failure(
        results: List[CleaningResult],
    ) -> bool:
        """检查是否存在关键失败。

        关键失败包括：
        - 输出文件无法打开（需要外部检查）
        - NODE_NOT_FOUND 类型的失败

        Returns:
            是否存在关键失败。
        """
        for result in results:
            if result.status == CleaningStatus.FAILED:
                meta = result.metadata or {}
                reason = meta.get("reason", "")
                if reason == "NODE_NOT_FOUND":
                    return True
        return False
