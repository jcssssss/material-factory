"""Word 清理器基础框架。

V1 只建立框架接口，暂不执行实际删除操作。
后续 Task-010、Task-011 在此基础实现具体清理逻辑。
"""

from __future__ import annotations

import logging
from typing import List

from risk import CleaningPlan

from . import CleaningResult, CleaningStatus

logger = logging.getLogger(__name__)


class WordCleaner:
    """Word 清理器。

    V1 只建立接口框架，所有操作返回 NOT_IMPLEMENTED。
    """

    def clean(
        self,
        docx_path: str,
        plan: CleaningPlan,
        output_path: str,
    ) -> List[CleaningResult]:
        """执行 Word 清理计划。

        V1 暂不执行实际删除。

        Args:
            docx_path: 输入 DOCX 文件路径。
            plan: 清理计划。
            output_path: 输出 DOCX 文件路径。

        Returns:
            清理执行结果列表。
        """
        logger.info(
            "WordCleaner: received plan with %d actions (not implemented)",
            len(plan.actions),
        )

        results = []
        for action in plan.actions:
            results.append(
                CleaningResult(
                    action=action,
                    status=CleaningStatus.SKIPPED,
                    error="not implemented in V1",
                    fallback_action="skip",
                    metadata={"reason": "NOT_IMPLEMENTED"},
                )
            )

        return results
