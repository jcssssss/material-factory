"""Task Module.

提供任务模型和任务管理器。
"""

from __future__ import annotations

from .cleaning_task import CleaningTask
from .task_manager import TaskManager

__all__ = ["CleaningTask", "TaskManager"]
