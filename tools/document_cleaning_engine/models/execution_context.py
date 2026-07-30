"""ExecutionContext — 清理任务执行上下文。

保存一次清理任务运行时的所有环境信息，
包括文件路径、文档类型、取消标志等。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict


@dataclass
class ExecutionContext:
    """清理任务执行上下文。

    一次清理任务从开始到结束的运行时环境。
    包含输入/输出路径、文档类型、取消标志等。
    """

    task_id: str
    """任务唯一标识。"""

    input_file: str
    """输入源文件路径（原始文件，不会被修改）。"""

    output_file: str
    """输出文件路径（清理后的文件）。"""

    document_type: str
    """文档类型：PDF / WORD。"""

    cancel_requested: bool = False
    """是否请求取消。

    执行循环在每次 Action 执行前检查此标志。
    为 True 时停止执行后续 Action。
    """

    metadata: Dict[str, object] = field(default_factory=dict)
    """扩展信息。

    可以包含：
    - working_dir: 工作目录路径
    - output_dir: 输出目录路径
    - original_size: 原始文件大小
    """
