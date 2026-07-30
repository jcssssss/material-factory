"""Word 非文本对象清理器主入口。

协调 ShapeCleaner 和 DrawingCleaner，根据 CleaningAction 执行删除。
"""

from __future__ import annotations

import logging
from typing import List

from risk import CleaningAction, CleaningPlan, RiskLevel

from . import CleaningResult, CleaningStatus
from .shape_cleaner import ShapeCleaner
from .drawing_cleaner import DrawingCleaner

logger = logging.getLogger(__name__)

# object_type → cleaner method 映射
SHAPE_TYPES = {"shape", "textbox", "vml"}
DRAWING_TYPES = {"drawing", "drawing_anchor"}


class WordObjectCleaner:
    """Word 非文本对象清理器。

    支持删除：
    - v:shape (VML Shape)
    - v:textbox (VML TextBox)
    - w:pict (VML Picture)
    - w:drawing (DrawingML)
    """

    def __init__(self) -> None:
        self._shape_cleaner = ShapeCleaner()
        self._drawing_cleaner = DrawingCleaner()

    def clean(
        self, docx_path: str, plan: CleaningPlan, output_path: str
    ) -> List[CleaningResult]:
        """执行 Word 非文本对象清理计划。

        Args:
            docx_path: 输入 DOCX 文件路径。
            plan: 清理计划。
            output_path: 输出 DOCX 文件路径。

        Returns:
            清理结果列表。
        """
        if not plan.actions:
            return []

        actions = [a for a in plan.actions if a.risk_level == RiskLevel.AUTO]
        if not actions:
            return []

        import os, shutil, tempfile
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".docx")
        os.close(tmp_fd)
        shutil.copy2(docx_path, tmp_path)

        results: List[CleaningResult] = []

        try:
            for action in actions:
                result = self._execute_action(tmp_path, action)
                results.append(result)

            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                shutil.copy2(tmp_path, output_path)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        return results

    def _execute_action(
        self, docx_path: str, action: CleaningAction
    ) -> CleaningResult:
        """执行单个清理操作。"""
        obj_type = action.metadata.get("object_type", "")

        try:
            if obj_type in SHAPE_TYPES:
                success = self._shape_cleaner.delete_shape_in_xml(docx_path)
                if success:
                    return CleaningResult(
                        action=action, status=CleaningStatus.SUCCESS,
                        metadata={"removed_type": "shape"},
                    )

            if obj_type in DRAWING_TYPES:
                success = self._drawing_cleaner.delete_drawing_in_xml(docx_path)
                if success:
                    return CleaningResult(
                        action=action, status=CleaningStatus.SUCCESS,
                        metadata={"removed_type": "drawing"},
                    )

            # 未知类型或操作失败
            return CleaningResult(
                action=action, status=CleaningStatus.FAILED,
                error=f"no matching cleaner for object_type={obj_type}",
                fallback_action="manual_review",
                metadata={"reason": "NODE_NOT_FOUND"},
            )

        except Exception as e:
            return CleaningResult(
                action=action, status=CleaningStatus.FAILED,
                error=f"clean failed: {e}",
                fallback_action="manual_review",
            )
