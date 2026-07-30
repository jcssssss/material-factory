"""Logger 和 LogFormatter 单元测试。"""

from __future__ import annotations

import json
import logging
from unittest.mock import MagicMock, patch

import pytest

from logutil import JSONFormatter, MFLogger


class TestJSONFormatter:
    """JSONFormatter 格式化测试。"""

    def setup_method(self) -> None:
        self.formatter = JSONFormatter()

    def test_basic_format(self) -> None:
        """基本日志应包含 time/level/message。"""
        record = logging.LogRecord(
            name="test", level=logging.INFO,
            pathname="test.py", lineno=1,
            msg="Hello World", args=(),
            exc_info=None,
        )
        output = self.formatter.format(record)
        parsed = json.loads(output)

        assert "time" in parsed
        assert parsed["level"] == "INFO"
        assert parsed["message"] == "Hello World"

    def test_extra_fields(self) -> None:
        """附加字段应出现在 JSON 中。"""
        record = logging.LogRecord(
            name="test", level=logging.ERROR,
            pathname="test.py", lineno=1,
            msg="Failed", args=(),
            exc_info=None,
        )
        record.task_id = "task-001"
        record.file = "test.pdf"
        record.event = "VALIDATION_FAILED"

        output = self.formatter.format(record)
        parsed = json.loads(output)

        assert parsed["task_id"] == "task-001"
        assert parsed["file"] == "test.pdf"
        assert parsed["event"] == "VALIDATION_FAILED"
        assert parsed["level"] == "ERROR"

    def test_no_extra(self) -> None:
        """无附加字段时不添加空字段。"""
        record = logging.LogRecord(
            name="test", level=logging.DEBUG,
            pathname="test.py", lineno=1,
            msg="debug info", args=(),
            exc_info=None,
        )
        output = self.formatter.format(record)
        parsed = json.loads(output)

        assert "task_id" not in parsed
        assert parsed["level"] == "DEBUG"
        assert parsed["message"] == "debug info"


class TestMFLogger:
    """MFLogger 功能测试。"""

    def setup_method(self) -> None:
        self.logger = MFLogger("test_logger")

    def test_logger_creation(self) -> None:
        """应能创建 Logger。"""
        assert self.logger._logger.name == "test_logger"
        assert self.logger._logger.level == logging.DEBUG

    def test_info_log(self) -> None:
        """info 应生成日志。"""
        # MFLogger 使用标准 logging，验证 handler 被调用
        with patch.object(self.logger._logger, "log") as mock_log:
            self.logger.info(
                "Task started",
                task_id="t1",
                event="TASK_START",
            )
            mock_log.assert_called_once()
            args = mock_log.call_args
            assert args[0][0] == logging.INFO
            assert args[0][1] == "Task started"
            # extra 参数
            assert args[1]["extra"]["task_id"] == "t1"
            assert args[1]["extra"]["event"] == "TASK_START"

    def test_error_log(self) -> None:
        """error 应包含错误信息。"""
        with patch.object(self.logger._logger, "log") as mock_log:
            self.logger.error(
                "PDF open failed",
                file="test.pdf",
                event="OPEN_FAILED",
            )
            mock_log.assert_called_once()
            args = mock_log.call_args
            assert args[0][0] == logging.ERROR
            assert args[1]["extra"]["file"] == "test.pdf"
            assert args[1]["extra"]["event"] == "OPEN_FAILED"

    def test_warning_log(self) -> None:
        """warning 应正常记录。"""
        with patch.object(self.logger._logger, "log") as mock_log:
            self.logger.warning("Form XObject skipped")
            mock_log.assert_called_once()

    def test_debug_log(self) -> None:
        """debug 日志应正常记录。"""
        with patch.object(self.logger._logger, "log") as mock_log:
            self.logger.debug(
                "Found annotation xref=123",
                product_id="p1",
            )
            mock_log.assert_called_once()
            args = mock_log.call_args
            assert args[1]["extra"]["product_id"] == "p1"

    def test_empty_context(self) -> None:
        """无 context 时应正常记录。"""
        with patch.object(self.logger._logger, "log") as mock_log:
            self.logger.info("simple message")
            mock_log.assert_called_once()
            args = mock_log.call_args
            assert "extra" not in args[1] or args[1]["extra"] == {}
