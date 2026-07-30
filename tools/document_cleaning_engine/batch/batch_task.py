"""BatchTask — 批次任务数据模型。

表示一次完整的批量处理任务，包含多个 ProductTask。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List

from models.task_status import (
    BATCH_STATUS_CREATED,
    BATCH_STATUS_COMPLETED,
    BATCH_STATUS_COMPLETED_WITH_ERROR,
    BATCH_STATUS_FAILED,
)


@dataclass
class BatchTask:
    """批次任务。

    状态流转：
    CREATED → RUNNING → COMPLETED / COMPLETED_WITH_ERROR / FAILED / CANCELLED
    """

    batch_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    """批次唯一标识。"""

    created_time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    """创建时间。"""

    total_products: int = 0
    """商品总数。"""

    total_files: int = 0
    """文件总数。"""

    completed_files: int = 0
    """成功文件数。"""

    failed_files: int = 0
    """失败文件数。"""

    status: str = BATCH_STATUS_CREATED
    """批次状态。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""

    @property
    def progress(self) -> float:
        """计算进度百分比。"""
        if self.total_files == 0:
            return 0.0
        return round((self.completed_files + self.failed_files) / self.total_files * 100, 1)

    def update_status(self) -> None:
        """根据文件结果更新批次状态。"""
        if self.failed_files == 0:
            self.status = BATCH_STATUS_COMPLETED
        elif self.completed_files > 0:
            self.status = BATCH_STATUS_COMPLETED_WITH_ERROR
        else:
            self.status = BATCH_STATUS_FAILED
