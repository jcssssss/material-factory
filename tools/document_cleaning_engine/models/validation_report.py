"""ValidationReport — 清理验证结果数据模型。

记录对清理后文件的逐项验证结果。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class ValidationReport:
    """清理验证报告。

    记录文件级、结构级、内容级和水印级验证结果。
    状态映射：
    - PASS             → 全部合格
    - WARNING          → 有警告（文本/图片变化略超预期）
    - FAILED           → 结构/文件级失败
    - NEED_REVIEW      → 需人工判断
    """

    task_id: str
    """清理任务 ID。"""

    file_path: str
    """源文件路径。"""

    cleaned_path: str
    """清理后文件路径。"""

    status: str = "PASS"
    """验证状态：PASS / WARNING / FAILED / NEED_REVIEW。"""

    file_check: Dict[str, object] = field(default_factory=dict)
    """文件级检查结果。

    {
        "open_success": true,
        "page_count_match": true,
        "original_pages": 10,
        "cleaned_pages": 10,
        "file_size_ok": true,
        "original_size": 1024000,
        "cleaned_size": 980000,
    }
    """

    structure_check: Dict[str, object] = field(default_factory=dict)
    """结构级检查结果。

    PDF: page_size_match
    Word: section_count, header_count, footer_count 等
    """

    content_check: Dict[str, object] = field(default_factory=dict)
    """内容级检查结果。

    {
        "text_loss_rate": 0.03,
        "expected_loss": 0.02,
        "image_loss_rate": 0.0,
        "text_changed": true,
    }
    """

    watermark_check: Dict[str, object] = field(default_factory=dict)
    """水印复检结果。

    {
        "remaining_count": 0,
        "watermarks_cleared": true,
        "details": [],
    }
    """

    warnings: List[str] = field(default_factory=list)
    """警告列表（非致命问题）。"""

    errors: List[str] = field(default_factory=list)
    """错误列表（致命问题）。"""

    def set_status(self) -> None:
        """根据 errors/warnings 自动设置状态。

        优先级：errors → FAILED, warnings → WARNING, 否则 PASS。
        """
        if self.errors:
            # 检查是否有结构级错误
            has_structural = any(
                "page" in e.lower() or "open" in e.lower()
                or "structure" in e.lower() or "zip" in e.lower()
                or "output" in e.lower()
                for e in self.errors
            )
            self.status = "FAILED" if has_structural else "NEED_REVIEW"
        elif self.warnings:
            self.status = "WARNING"
        else:
            self.status = "PASS"
