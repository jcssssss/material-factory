"""CleaningResult 数据模型。

清理操作的执行结果记录。
由 Cleaner 在执行 CleaningAction 后生成。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class CleaningResult:
    """单个清理操作的执行结果。

    记录一次清理操作是否成功执行，以及在失败时的
    回退建议和错误信息。
    """

    action_id: str
    """对应的 CleaningAction action_id。"""

    status: str
    """执行状态。

    SUCCESS  — 清理成功
    FAILED   — 清理失败
    SKIPPED  — 跳过的操作（如忽略的操作）
    """

    error: Optional[str] = None
    """错误信息（仅 status 为 FAILED 时）。"""

    fallback_action: Optional[str] = None
    """失败时的回退建议。

    MANUAL_REVIEW  — 需要人工处理
    RETRY          — 可以重试
    SKIP           — 跳过，不影响整体
    """

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。

    可以包含：
    - execution_time: 执行耗时（秒）
    - bytes_removed: 删除的数据量
    - original_size: 操作前大小
    """
