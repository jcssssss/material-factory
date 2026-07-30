"""MFLogger — 文档清理引擎结构化日志器。

封装 Python logging，自动注入 task_id / file_id / product_id 等上下文。
支持 JSON 格式输出。
"""

from __future__ import annotations

import logging
import sys
from typing import Dict, Optional

from .log_formatter import JSONFormatter


class MFLogger:
    """结构化日志器。

    用法：
        logger = MFLogger("cleaning_engine")
        logger.info("Task started", task_id="xxx")

    自动为每条日志添加 time 和 level 字段。
    """

    def __init__(
        self,
        name: str = "cleaning_engine",
        level: int = logging.DEBUG,
    ) -> None:
        self._logger = logging.getLogger(name)
        self._logger.setLevel(level)

        # 避免重复添加 handler
        if not self._logger.handlers:
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(JSONFormatter())
            self._logger.addHandler(handler)

    def debug(
        self,
        message: str,
        task_id: str = "",
        file_id: str = "",
        product_id: str = "",
        file: str = "",
        event: str = "",
    ) -> None:
        self._log(logging.DEBUG, message, task_id, file_id, product_id, file, event)

    def info(
        self,
        message: str,
        task_id: str = "",
        file_id: str = "",
        product_id: str = "",
        file: str = "",
        event: str = "",
    ) -> None:
        self._log(logging.INFO, message, task_id, file_id, product_id, file, event)

    def warning(
        self,
        message: str,
        task_id: str = "",
        file_id: str = "",
        product_id: str = "",
        file: str = "",
        event: str = "",
    ) -> None:
        self._log(logging.WARNING, message, task_id, file_id, product_id, file, event)

    def error(
        self,
        message: str,
        task_id: str = "",
        file_id: str = "",
        product_id: str = "",
        file: str = "",
        event: str = "",
    ) -> None:
        self._log(logging.ERROR, message, task_id, file_id, product_id, file, event)

    def _log(
        self,
        level: int,
        message: str,
        task_id: str,
        file_id: str,
        product_id: str,
        file: str,
        event: str,
    ) -> None:
        extra: Dict[str, object] = {}
        if task_id:
            extra["task_id"] = task_id
        if file_id:
            extra["file_id"] = file_id
        if product_id:
            extra["product_id"] = product_id
        if file:
            extra["file"] = file
        if event:
            extra["event"] = event
        self._logger.log(level, message, extra=extra)
