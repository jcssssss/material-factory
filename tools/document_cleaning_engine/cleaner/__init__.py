"""PDF Cleaner Module.

提供 PDF 结构化对象清理能力（Annotation / Artifact Watermark / Image 删除）。
使用 PyMuPDF 进行 PDF 结构修改与验证。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from risk import CleaningAction


class CleaningStatus(str, Enum):
    """清理执行状态。"""

    SUCCESS = "SUCCESS"
    """执行成功。"""

    FAILED = "FAILED"
    """执行失败（如目标不存在）。"""

    SKIPPED = "SKIPPED"
    """跳过（不支持的 Action 类型或缺少 target_ref）。"""

    PARTIAL_SUCCESS = "PARTIAL_SUCCESS"
    """部分成功（同一页面失败 Action >= 3 个）。"""


@dataclass
class CleaningResult:
    """单个清理操作的执行结果。"""

    action: CleaningAction
    """原始清理操作。"""

    status: CleaningStatus
    """执行状态。"""

    error: Optional[str] = None
    """错误信息（失败时）。"""

    fallback_action: Optional[str] = None
    """建议的后续处理: manual_review / retry / skip。"""

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。"""


__all__ = [
    "CleaningStatus",
    "CleaningResult",
]

from .pdf_cleaner import PDFCleaner
from .image_cleaner import ImageCleaner
