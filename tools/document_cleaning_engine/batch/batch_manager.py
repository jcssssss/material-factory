"""BatchManager — 批处理执行器。

协调多文件批量清理流程：
1. 遍历 ProductTask → 遍历 FileCleaningTask
2. 每个文件执行完整 Pipeline
3. 失败隔离（单文件失败不影响批次）
4. 生成 BatchReport
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Dict, List, Optional

from detector import PDFDetector
from detector.word_detector import WordDetector
from plan import PlanGenerator
from executor.cleaning_executor import CleaningExecutor
from validator import Validator
from report import BatchReportGenerator

from .batch_task import BatchTask
from .product_task import FileCleaningTask, ProductTask

from models.task_status import (
    BATCH_STATUS_RUNNING,
    FILE_STATUS_WAITING,
    FILE_STATUS_ANALYZING,
    FILE_STATUS_CLEANING,
    FILE_STATUS_VALIDATING,
    FILE_STATUS_COMPLETED,
    FILE_STATUS_FAILED,
    FILE_STATUS_SKIPPED,
    PRODUCT_STATUS_RUNNING,
)

logger = logging.getLogger(__name__)


class BatchManager:
    """批处理管理器。

    V1 采用顺序执行（单文件接单文件处理）。
    不修改原始文件，所有输出写入临时/输出目录。
    """

    def __init__(
        self,
        output_base_dir: str = "",
        skip_validation: bool = False,
    ) -> None:
        self._pdf_detector = PDFDetector()
        self._word_detector = WordDetector()
        self._plan_generator = PlanGenerator()
        self._executor = CleaningExecutor(output_base_dir=output_base_dir)
        self._validator = Validator()
        self._report_generator = BatchReportGenerator()
        self._skip_validation = skip_validation

        if not output_base_dir:
            self._output_base_dir = os.path.join(
                tempfile.gettempdir(), "batch_output"
            )
        else:
            self._output_base_dir = output_base_dir

    def run_batch(
        self,
        batch: BatchTask,
        products: List[ProductTask],
    ) -> BatchTask:
        """执行批处理任务。

        Args:
            batch: 批次任务（状态将被更新）。
            products: 商品任务列表（状态将被更新）。

        Returns:
            更新后的 BatchTask。
        """
        batch.status = BATCH_STATUS_RUNNING
        batch.total_products = len(products)

        # 统计总文件数
        total_files = sum(p.total_files for p in products)
        batch.total_files = total_files

        logger.info(
            "批处理开始: batch=%s, products=%d, files=%d",
            batch.batch_id, len(products), total_files,
        )

        # 创建批次输出目录
        batch_output_dir = os.path.join(
            self._output_base_dir, batch.batch_id
        )

        completed = 0
        failed = 0

        for product in products:
            product.status = PRODUCT_STATUS_RUNNING
            logger.info(
                "处理商品: %s (%s), files=%d",
                product.product_name, product.product_id, product.total_files,
            )

            for file_task in product.file_tasks:
                # 检查批次取消
                if batch.status == "CANCELLED":
                    logger.warning("批次已取消，跳过剩余文件")
                    break

                try:
                    self._process_file(file_task, product, batch_output_dir)
                except Exception as e:
                    file_task.status = FILE_STATUS_FAILED
                    file_task.error = f"batch error: {e}"
                    logger.error(
                        "文件处理异常: %s, error=%s",
                        file_task.file_path, e,
                    )

                # 更新计数
                if file_task.status == FILE_STATUS_COMPLETED:
                    completed += 1
                elif file_task.status == FILE_STATUS_FAILED:
                    failed += 1

                # 更新批次统计
                batch.completed_files = completed
                batch.failed_files = failed

            # 更新商品状态
            product.update_status()

        # 更新批次状态
        batch.update_status()

        # 生成报告
        report_dir = os.path.join(batch_output_dir, "report")
        self._report_generator.generate(batch, products, output_dir=report_dir)

        logger.info(
            "批处理完成: batch=%s, status=%s, success=%d, failed=%d",
            batch.batch_id, batch.status, completed, failed,
        )
        return batch

    def _process_file(
        self,
        file_task: FileCleaningTask,
        product: ProductTask,
        batch_output_dir: str,
    ) -> None:
        """处理单个文件的完整清理流程。

        Pipeline:
        Detector → PlanGenerator → CleaningExecutor → Validator
        """
        file_path = file_task.file_path
        ext = os.path.splitext(file_path)[1].lower()

        if ext == ".pdf":
            doc_type = "PDF"
        elif ext == ".docx":
            doc_type = "WORD"
        else:
            file_task.status = FILE_STATUS_SKIPPED
            file_task.error = f"不支持的文件格式: {ext}"
            logger.warning("跳过不支持的文件: %s", file_path)
            return

        file_task.document_type = doc_type

        # ── Step 1: 检测 ──────────────────────────────────────────
        file_task.status = FILE_STATUS_ANALYZING

        try:
            if doc_type == "PDF":
                detections = self._pdf_detector.detect(file_path)
            else:
                detections = self._word_detector.detect(file_path)
        except Exception as e:
            file_task.status = FILE_STATUS_FAILED
            file_task.error = f"DETECTION_FAILED: {e}"
            return

        # ── Step 2: 生成计划 ──────────────────────────────────────
        try:
            plan = self._plan_generator.generate(
                detections,
                file_path=file_path,
                document_type=doc_type,
            )
        except Exception as e:
            file_task.status = FILE_STATUS_FAILED
            file_task.error = f"PLAN_GENERATE_FAILED: {e}"
            return

        # 无操作 → 跳过
        if not plan.actions:
            file_task.status = FILE_STATUS_COMPLETED
            logger.info("无需清理: %s", file_path)
            return

        # ── Step 3: 执行清理 ──────────────────────────────────────
        file_task.status = FILE_STATUS_CLEANING

        try:
            # 确认计划并执行
            if plan.status == "WAIT_CONFIRM":
                plan = self._plan_generator.confirm_plan(plan)

            clean_task = self._executor.execute(
                plan,
                file_path=file_path,
                document_type=doc_type,
            )
        except Exception as e:
            file_task.status = FILE_STATUS_FAILED
            file_task.error = f"CLEANING_FAILED: {e}"
            return

        # 检查执行状态
        if clean_task.status in ("FAILED", "NEED_REVIEW"):
            file_task.status = FILE_STATUS_FAILED
            file_task.error = f"CLEANING_{clean_task.status}: {clean_task.error or 'unknown'}"
            return

        # ── Step 4: 验证 ──────────────────────────────────────────
        if not self._skip_validation:
            file_task.status = FILE_STATUS_VALIDATING

            try:
                # 找到输出文件
                output_path = clean_task.metadata.get("output_file", "")
                if not output_path:
                    # 从 executor 的输出目录拼接
                    output_path = os.path.join(
                        self._executor._output_base_dir,
                        clean_task.task_id,
                        "clean",
                        os.path.basename(file_path),
                    )
                    # 尝试替换扩展名
                    if doc_type == "PDF":
                        output_path = output_path.replace(".pdf", "_clean.pdf")
                    else:
                        output_path = output_path.replace(".docx", "_clean.docx")

                if os.path.exists(output_path):
                    vresult = self._validator.validate(
                        original_file=file_path,
                        cleaned_file=output_path,
                        cleaning_plan=plan,
                        task_id=clean_task.task_id,
                    )
                    file_task.validation_status = vresult.status

                    if vresult.status in ("FAILED", "NEED_REVIEW"):
                        file_task.status = FILE_STATUS_FAILED
                        file_task.error = (
                            f"VALIDATION_{vresult.status}: "
                            f"{'; '.join(vresult.errors) if vresult.errors else 'unknown'}"
                        )
                        return
                else:
                    logger.warning("输出文件不存在，跳过验证: %s", output_path)
            except Exception as e:
                file_task.status = FILE_STATUS_FAILED
                file_task.error = f"VALIDATION_FAILED: {e}"
                return

        # ── 完成 ──────────────────────────────────────────────────
        file_task.status = FILE_STATUS_COMPLETED
        logger.info("文件清理完成: %s", file_path)
