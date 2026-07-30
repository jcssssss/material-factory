"""CleaningTask — 清理任务数据模型。

表示一次完整的清理任务，包含状态、进度、执行结果等。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

from cleaner import CleaningResult


@dataclass
class CleaningTask:
    """清理任务。

    任务状态流转：
    CREATED → WAIT_CONFIRM → READY → RUNNING → COMPLETED
                                                  → PARTIAL_SUCCESS
                                                  → FAILED
                                                  → CANCELLED
                                                  → NEED_REVIEW
    """

    task_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    """任务唯一标识（UUID）。"""

    plan_id: str = ""
    """关联的 CleaningPlan ID。"""

    file_path: str = ""
    """源文件路径。"""

    status: str = "CREATED"
    """任务状态。

    CREATED         — 任务已创建
    WAIT_CONFIRM    — 等待用户确认
    READY           — 已就绪，可以执行
    RUNNING         — 执行中
    COMPLETED       — 全部成功
    PARTIAL_SUCCESS — 部分 Action 失败
    FAILED          — 关键失败
    CANCELLED       — 用户取消
    NEED_REVIEW     — 需人工介入
    """

    document_type: str = "PDF"
    """文档类型。"""

    progress: int = 0
    """执行进度百分比（0-100）。"""

    total_actions: int = 0
    """计划执行的 Action 总数。"""

    results: List[CleaningResult] = field(default_factory=list)
    """执行结果列表。"""

    error: Optional[str] = None
    """错误信息（关键失败时）。"""

    created_time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    """任务创建时间。"""

    updated_time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    """最后更新时间。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""

    def update_status(self) -> None:
        """根据执行结果自动计算最终状态。"""
        if not self.results:
            self.status = "COMPLETED"
            self.progress = 100
            return

        success_count = sum(
            1 for r in self.results if r.status.value == "SUCCESS"
        )
        failed_count = sum(
            1 for r in self.results if r.status.value == "FAILED"
        )
        skipped_count = sum(
            1 for r in self.results if r.status.value == "SKIPPED"
        )

        if failed_count == 0:
            self.status = "COMPLETED"
            self.progress = 100
        elif success_count == 0:
            self.status = "FAILED"
        else:
            self.status = "PARTIAL_SUCCESS"

        if self.results:
            self.progress = int(success_count / len(self.results) * 100)

        self._update_timestamp()

    def _update_timestamp(self) -> None:
        """更新时间戳。"""
        self.updated_time = datetime.now(timezone.utc).isoformat()

    @property
    def success_count(self) -> int:
        """成功数。"""
        return sum(1 for r in self.results if r.status.value == "SUCCESS")

    @property
    def failed_count(self) -> int:
        """失败数。"""
        return sum(1 for r in self.results if r.status.value == "FAILED")

    @property
    def skipped_count(self) -> int:
        """跳过数。"""
        return sum(1 for r in self.results if r.status.value == "SKIPPED")
