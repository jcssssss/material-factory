"""TaskManager — 任务生命周期管理器。

管理 CleaningTask 的创建、状态更新、进度追踪。
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from cleaner import CleaningResult
from risk import CleaningPlan

from .cleaning_task import CleaningTask

logger = logging.getLogger(__name__)


class TaskManager:
    """任务管理器。

    负责任务的创建和状态管理。
    """

    def __init__(self) -> None:
        self._tasks: Dict[str, CleaningTask] = {}

    def create_task(
        self,
        plan: CleaningPlan,
        file_path: str = "",
        document_type: str = "PDF",
    ) -> CleaningTask:
        """从 CleaningPlan 创建任务。

        Args:
            plan: 清理计划。
            file_path: 源文件路径（覆盖 plan 中的路径）。
            document_type: 文档类型（覆盖 plan 中的类型）。

        Returns:
            创建的 CleaningTask。
        """
        task = CleaningTask(
            plan_id=plan.plan_id,
            file_path=file_path or plan.file_path,
            document_type=document_type,
            total_actions=len(plan.actions),
            status="CREATED",
        )
        self._tasks[task.task_id] = task
        logger.info("Task created: %s (plan=%s)", task.task_id, plan.plan_id)
        return task

    def get_task(self, task_id: str) -> Optional[CleaningTask]:
        """获取任务。"""
        return self._tasks.get(task_id)

    def set_ready(self, task: CleaningTask) -> None:
        """将任务设为 READY 状态。"""
        if task.status not in ("CREATED", "WAIT_CONFIRM"):
            raise ValueError(
                f"无法从 {task.status} 转为 READY"
            )
        task.status = "READY"
        task._update_timestamp()
        logger.info("Task ready: %s", task.task_id)

    def start(self, task: CleaningTask) -> None:
        """将任务设为 RUNNING 状态。"""
        if task.status != "READY":
            raise ValueError(
                f"只有 READY 状态的任务可以启动，当前: {task.status}"
            )
        task.status = "RUNNING"
        task.progress = 0
        task._update_timestamp()
        logger.info("Task started: %s", task.task_id)

    def complete(self, task: CleaningTask) -> None:
        """完成任务，自动计算最终状态。"""
        task.update_status()
        task._update_timestamp()
        logger.info(
            "Task completed: %s (status=%s, success=%d, failed=%d)",
            task.task_id, task.status,
            task.success_count, task.failed_count,
        )

    def add_results(
        self,
        task: CleaningTask,
        results: List[CleaningResult],
    ) -> None:
        """添加执行结果。"""
        task.results.extend(results)
        task._update_timestamp()

    def request_cancel(self, task: CleaningTask) -> None:
        """请求取消任务。"""
        task.status = "CANCELLED"
        task._update_timestamp()
        logger.info("Task cancelled: %s", task.task_id)

    def set_need_review(self, task: CleaningTask, reason: str = "") -> None:
        """将任务设为 NEED_REVIEW。"""
        task.status = "NEED_REVIEW"
        task.error = reason
        task._update_timestamp()
        logger.warning("Task needs review: %s (reason=%s)", task.task_id, reason)

    def set_failed(self, task: CleaningTask, error: str) -> None:
        """将任务设为 FAILED。"""
        task.status = "FAILED"
        task.error = error
        task._update_timestamp()
        logger.error("Task failed: %s (error=%s)", task.task_id, error)
