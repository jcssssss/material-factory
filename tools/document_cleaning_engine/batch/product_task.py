"""ProductTask — 商品级任务数据模型。

表示一个商品资料包的清理任务，包含多个 FileCleaningTask。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from models.task_status import (
    PRODUCT_STATUS_WAITING,
    PRODUCT_STATUS_COMPLETED,
    PRODUCT_STATUS_FAILED,
    PRODUCT_STATUS_COMPLETED_WITH_ERROR,
)


@dataclass
class FileCleaningTask:
    """文件级清理任务。

    状态流转：
    WAITING → ANALYZING → CLEANING → VALIDATING → COMPLETED / FAILED / SKIPPED
    """

    file_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    """文件唯一标识。"""

    file_path: str = ""
    """文件路径。"""

    document_type: str = "PDF"
    """文档类型。"""

    status: str = "WAITING"
    """任务状态。"""

    error: Optional[str] = None
    """错误信息（失败时）。"""

    validation_status: Optional[str] = None
    """验证状态（PASS / WARNING / FAILED）。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""


@dataclass
class ProductTask:
    """商品级任务。

    包含属于同一商品的所有文件任务。
    状态流转：
    WAITING → RUNNING → COMPLETED / COMPLETED_WITH_ERROR / FAILED
    """

    product_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    """商品唯一标识。"""

    product_name: str = ""
    """商品名称。"""

    file_tasks: List[FileCleaningTask] = field(default_factory=list)
    """文件任务列表。"""

    status: str = PRODUCT_STATUS_WAITING
    """任务状态。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""

    @property
    def success_count(self) -> int:
        """成功文件数。"""
        return sum(1 for f in self.file_tasks if f.status == "COMPLETED")

    @property
    def failed_count(self) -> int:
        """失败文件数。"""
        return sum(1 for f in self.file_tasks if f.status == "FAILED")

    @property
    def total_files(self) -> int:
        """总文件数。"""
        return len(self.file_tasks)

    def update_status(self) -> None:
        """根据文件任务结果更新商品状态。"""
        total = self.total_files
        if total == 0:
            self.status = PRODUCT_STATUS_COMPLETED
            return

        success = self.success_count
        failed = self.failed_count

        if failed == 0:
            self.status = PRODUCT_STATUS_COMPLETED
        elif success > 0:
            self.status = PRODUCT_STATUS_COMPLETED_WITH_ERROR
        else:
            self.status = PRODUCT_STATUS_FAILED
