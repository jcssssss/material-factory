"""BatchManager 和 Batch 模型单元测试。"""

from __future__ import annotations

import os
import tempfile
from unittest.mock import MagicMock, patch

import pytest

from batch import BatchManager, BatchTask, FileCleaningTask, ProductTask
from models.task_status import (
    BATCH_STATUS_CREATED,
    BATCH_STATUS_COMPLETED,
    BATCH_STATUS_COMPLETED_WITH_ERROR,
    BATCH_STATUS_FAILED,
    FILE_STATUS_COMPLETED,
    FILE_STATUS_FAILED,
    FILE_STATUS_SKIPPED,
    PRODUCT_STATUS_COMPLETED,
    PRODUCT_STATUS_COMPLETED_WITH_ERROR,
    PRODUCT_STATUS_FAILED,
    PRODUCT_STATUS_WAITING,
)
from report import BatchReportGenerator


# ── BatchTask 模型 ──────────────────────────────────────────────────────────


class TestBatchTask:
    """BatchTask 模型测试。"""

    def test_create(self) -> None:
        """应能创建批次任务。"""
        batch = BatchTask()
        assert batch.batch_id
        assert batch.status == BATCH_STATUS_CREATED
        assert batch.total_files == 0
        assert batch.progress == 0.0

    def test_update_status_all_success(self) -> None:
        """全部成功应为 COMPLETED。"""
        batch = BatchTask()
        batch.completed_files = 10
        batch.update_status()
        assert batch.status == BATCH_STATUS_COMPLETED

    def test_update_status_partial_fail(self) -> None:
        """部分失败应为 COMPLETED_WITH_ERROR。"""
        batch = BatchTask()
        batch.completed_files = 9
        batch.failed_files = 1
        batch.update_status()
        assert batch.status == BATCH_STATUS_COMPLETED_WITH_ERROR

    def test_update_status_all_fail(self) -> None:
        """全部失败应为 FAILED。"""
        batch = BatchTask()
        batch.failed_files = 5
        batch.update_status()
        assert batch.status == BATCH_STATUS_FAILED

    def test_progress_calculation(self) -> None:
        """进度计算应正确。"""
        batch = BatchTask()
        batch.total_files = 100
        batch.completed_files = 30
        batch.failed_files = 20
        assert batch.progress == 50.0


# ── ProductTask 模型 ────────────────────────────────────────────────────────


class TestProductTask:
    """ProductTask 模型测试。"""

    def test_create(self) -> None:
        """应能创建商品任务。"""
        product = ProductTask(product_name="自考00088")
        assert product.product_id
        assert product.product_name == "自考00088"
        assert product.status == PRODUCT_STATUS_WAITING

    def test_update_status_all_success(self) -> None:
        """全部成功应为 COMPLETED。"""
        product = ProductTask(file_tasks=[
            FileCleaningTask(status="COMPLETED"),
            FileCleaningTask(status="COMPLETED"),
        ])
        product.update_status()
        assert product.status == PRODUCT_STATUS_COMPLETED

    def test_update_status_partial(self) -> None:
        """部分成功应为 COMPLETED_WITH_ERROR。"""
        product = ProductTask(file_tasks=[
            FileCleaningTask(status="COMPLETED"),
            FileCleaningTask(status="FAILED"),
        ])
        product.update_status()
        assert product.status == PRODUCT_STATUS_COMPLETED_WITH_ERROR

    def test_update_status_all_failed(self) -> None:
        """全部失败应为 FAILED。"""
        product = ProductTask(file_tasks=[
            FileCleaningTask(status="FAILED"),
            FileCleaningTask(status="FAILED"),
        ])
        product.update_status()
        assert product.status == PRODUCT_STATUS_FAILED

    def test_count_properties(self) -> None:
        """计数属性应正确。"""
        product = ProductTask(file_tasks=[
            FileCleaningTask(status="COMPLETED"),
            FileCleaningTask(status="FAILED"),
            FileCleaningTask(status="FAILED"),
        ])
        assert product.success_count == 1
        assert product.failed_count == 2
        assert product.total_files == 3

    def test_empty_file_list(self) -> None:
        """空文件列表应为 COMPLETED。"""
        product = ProductTask(file_tasks=[])
        product.update_status()
        assert product.status == PRODUCT_STATUS_COMPLETED


# ── FileCleaningTask 模型 ──────────────────────────────────────────────────


class TestFileCleaningTask:
    """FileCleaningTask 模型测试。"""

    def test_create(self) -> None:
        """应能创建文件任务。"""
        task = FileCleaningTask(file_path="/tmp/test.pdf")
        assert task.file_id
        assert task.file_path == "/tmp/test.pdf"
        assert task.status == "WAITING"
        assert task.document_type == "PDF"

    def test_default_values(self) -> None:
        """默认值应正确。"""
        task = FileCleaningTask()
        assert task.status == "WAITING"
        assert task.document_type == "PDF"
        assert task.error is None
        assert task.validation_status is None


# ── BatchManager ────────────────────────────────────────────────────────────


class TestBatchManager:
    """BatchManager 测试（Mock 内部组件）。"""

    def test_run_batch_all_success(self) -> None:
        """全部成功应为 COMPLETED。"""
        with (
            patch.object(BatchManager, "_process_file") as mock_process,
        ):
            manager = BatchManager()
            batch = BatchTask()
            product = ProductTask(product_name="商品A", file_tasks=[
                FileCleaningTask(file_path="/tmp/a.pdf"),
                FileCleaningTask(file_path="/tmp/b.pdf"),
            ])
            products = [product]

            # Mock _process_file 设置文件为 COMPLETED
            def set_completed(file_task, *args, **kwargs):
                file_task.status = FILE_STATUS_COMPLETED
            mock_process.side_effect = set_completed

            result = manager.run_batch(batch, products)

            assert result.status == BATCH_STATUS_COMPLETED
            assert result.completed_files == 2
            assert result.failed_files == 0
            assert product.status == PRODUCT_STATUS_COMPLETED
            assert mock_process.call_count == 2

    def test_run_batch_one_fails(self) -> None:
        """一个文件失败应为 COMPLETED_WITH_ERROR。"""
        with patch.object(BatchManager, "_process_file") as mock_process:
            manager = BatchManager()
            batch = BatchTask()
            product = ProductTask(product_name="商品A", file_tasks=[
                FileCleaningTask(file_path="/tmp/good.pdf"),
                FileCleaningTask(file_path="/tmp/bad.pdf"),
                FileCleaningTask(file_path="/tmp/good2.pdf"),
            ])
            products = [product]

            call_count = [0]
            def process_side_effect(file_task, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] == 2:
                    file_task.status = FILE_STATUS_FAILED
                    file_task.error = "CORRUPTED"
                else:
                    file_task.status = FILE_STATUS_COMPLETED
            mock_process.side_effect = process_side_effect

            result = manager.run_batch(batch, products)

            assert result.status == BATCH_STATUS_COMPLETED_WITH_ERROR
            assert result.completed_files == 2
            assert result.failed_files == 1
            assert product.status == PRODUCT_STATUS_COMPLETED_WITH_ERROR

    def test_run_batch_all_fail(self) -> None:
        """全部失败应为 FAILED。"""
        with patch.object(BatchManager, "_process_file") as mock_process:
            manager = BatchManager()
            batch = BatchTask()
            product = ProductTask(product_name="商品A", file_tasks=[
                FileCleaningTask(file_path="/tmp/bad1.pdf"),
                FileCleaningTask(file_path="/tmp/bad2.pdf"),
            ])

            def set_failed(file_task, *args, **kwargs):
                file_task.status = FILE_STATUS_FAILED
                file_task.error = "FAILED"
            mock_process.side_effect = set_failed

            result = manager.run_batch(batch, [product])

            assert result.status == BATCH_STATUS_FAILED
            assert result.failed_files == 2

    def test_run_batch_exception_isolation(self) -> None:
        """process_file 抛异常时应隔离，不影响其他文件。"""
        with patch.object(BatchManager, "_process_file") as mock_process:
            manager = BatchManager()
            batch = BatchTask()
            product = ProductTask(product_name="商品A", file_tasks=[
                FileCleaningTask(file_path="/tmp/good.pdf"),
                FileCleaningTask(file_path="/tmp/crash.pdf"),
                FileCleaningTask(file_path="/tmp/good2.pdf"),
            ])

            call_count = [0]
            def side_effect(file_task, *args, **kwargs):
                call_count[0] += 1
                if call_count[0] == 2:
                    raise RuntimeError("Unexpected crash")
                file_task.status = FILE_STATUS_COMPLETED
            mock_process.side_effect = side_effect

            result = manager.run_batch(batch, [product])

            # 文件2 异常，但 1 和 3 成功
            assert result.completed_files == 2
            assert result.failed_files == 1
            # 异常的文件应为 FAILED
            assert product.file_tasks[1].status == FILE_STATUS_FAILED

    def test_unsupported_file_type(self) -> None:
        """不支持的文件格式应被 SKIPPED。"""
        manager = BatchManager()
        batch = BatchTask()
        ft = FileCleaningTask(file_path="/tmp/test.txt")
        product = ProductTask(file_tasks=[ft])

        manager.run_batch(batch, [product])

        assert ft.status == FILE_STATUS_SKIPPED
        assert "不支持的文件格式" in (ft.error or "")


# ── BatchReportGenerator ───────────────────────────────────────────────────


class TestBatchReportGenerator:
    """BatchReportGenerator 测试。"""

    def test_generate_report(self) -> None:
        """应生成正确结构的报告。"""
        batch = BatchTask()
        batch.completed_files = 8
        batch.failed_files = 2
        batch.total_files = 2
        batch.update_status()

        product = ProductTask(
            product_name="商品A",
            file_tasks=[
                FileCleaningTask(
                    file_path="/tmp/success.pdf",
                    status="COMPLETED",
                ),
                FileCleaningTask(
                    file_path="/tmp/fail.pdf",
                    status="FAILED",
                    error="CORRUPTED",
                ),
            ],
        )

        generator = BatchReportGenerator()
        report = generator.generate(batch, [product])

        assert report["batch_id"] == batch.batch_id
        assert report["status"] == BATCH_STATUS_COMPLETED_WITH_ERROR

        summary = report["summary"]
        assert summary["total_files"] == 2
        assert summary["completed_files"] == 8
        assert summary["failed_files"] == 2

        assert len(report["products"]) == 1
        assert len(report["failed_files"]) == 1
        assert report["failed_files"][0]["file"] == "/tmp/fail.pdf"
        assert report["failed_files"][0]["status"] == "FAILED"

    def test_generate_report_all_success(self) -> None:
        """全部成功时不包含 failed_files。"""
        batch = BatchTask()
        batch.completed_files = 3
        batch.total_files = 3
        batch.update_status()

        product = ProductTask(
            product_name="商品B",
            file_tasks=[
                FileCleaningTask(file_path="/tmp/a.pdf", status="COMPLETED"),
                FileCleaningTask(file_path="/tmp/b.pdf", status="COMPLETED"),
                FileCleaningTask(file_path="/tmp/c.pdf", status="COMPLETED"),
            ],
        )

        generator = BatchReportGenerator()
        report = generator.generate(batch, [product])

        assert "failed_files" not in report
        assert report["summary"]["total_files"] == 3
        assert report["summary"]["failed_files"] == 0

    def test_report_write_to_disk(self) -> None:
        """应写入文件和失败详情到磁盘。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            batch = BatchTask()
            batch.completed_files = 1
            batch.failed_files = 1
            batch.total_files = 2
            batch.update_status()

            product = ProductTask(
                product_name="商品C",
                file_tasks=[
                    FileCleaningTask(
                        file_path="/tmp/test.pdf",
                        status="FAILED",
                        error="PDF_OPEN_ERROR",
                    ),
                    FileCleaningTask(
                        file_path="/tmp/ok.pdf",
                        status="COMPLETED",
                    ),
                ],
            )

            generator = BatchReportGenerator()
            generator.generate(batch, [product], output_dir=tmpdir)

            # 检查主报告
            report_path = os.path.join(tmpdir, "batch_report.json")
            assert os.path.exists(report_path)

            # 检查失败详情
            failed_dir = os.path.join(tmpdir, "failed")
            assert os.path.exists(failed_dir)
            error_files = os.listdir(failed_dir)
            assert len(error_files) == 1


# ── BatchManager 集成测试 ──────────────────────────────────────────────────


class TestBatchManagerProcessFile:
    """BatchManager._process_file 集成测试。"""

    def test_unsupported_format_skipped(self) -> None:
        """不支持的文件格式应跳过。"""
        manager = BatchManager()
        product = ProductTask()
        ft = FileCleaningTask(file_path="/tmp/test.txt")

        manager._process_file(ft, product, "/tmp/output")
        assert ft.status == FILE_STATUS_SKIPPED
        assert "不支持的文件格式" in (ft.error or "")

    def test_pdf_detection_failure(self) -> None:
        """PDF 检测失败应标记为 FAILED。"""
        manager = BatchManager()
        with patch.object(manager._pdf_detector, "detect") as mock_detect:
            mock_detect.side_effect = RuntimeError("PDF corrupted")
            ft = FileCleaningTask(file_path="/tmp/test.pdf")

            manager._process_file(ft, ProductTask(), "/tmp/output")
            assert ft.status == FILE_STATUS_FAILED
            assert "DETECTION_FAILED" in (ft.error or "")

    def test_no_actions_skips_cleaning(self) -> None:
        """无检测结果时应跳过清理。"""
        manager = BatchManager()
        with patch.object(manager._pdf_detector, "detect") as mock_detect:
            mock_detect.return_value = []
            ft = FileCleaningTask(file_path="/tmp/test.pdf")

            manager._process_file(ft, ProductTask(), "/tmp/output")
            # 无 Action → COMPLETED（无需清理）
            assert ft.status == FILE_STATUS_COMPLETED
