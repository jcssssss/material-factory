"""JSONFormatter — JSON 格式日志格式化器。

将 Python 日志记录输出为结构化 JSON 格式。
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Dict


class JSONFormatter(logging.Formatter):
    """JSON 日志格式化器。

    输出格式：
    {
        "time": "2026-07-30 10:00:00",
        "level": "ERROR",
        "task_id": "xxx",
        "product_id": "xxx",
        "file": "test.pdf",
        "event": "VALIDATION_FAILED",
        "message": "page count changed"
    }
    """

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, object] = {
            "time": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).strftime("%Y-%m-%d %H:%M:%S"),
            "level": record.levelname,
            "message": record.getMessage(),
        }

        # 添加额外字段
        for key in ("task_id", "product_id", "file_id", "file", "event"):
            value = getattr(record, key, None)
            if value is not None:
                log_entry[key] = value

        # 添加异常信息
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = str(record.exc_info[1])

        return json.dumps(log_entry, ensure_ascii=False)
