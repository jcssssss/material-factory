"""BatchReportGenerator — 批处理报告生成器。

根据 BatchTask 的执行结果生成最终汇总报告。
"""

from __future__ import annotations

import json
import logging
import os
from typing import Dict, List

from batch import BatchTask, ProductTask

logger = logging.getLogger(__name__)


class BatchReportGenerator:
    """批处理报告生成器。

    输出包含汇总信息和失败详情的结构化 JSON 报告。
    """

    def generate(
        self,
        batch: BatchTask,
        products: List[ProductTask],
        output_dir: str = "",
    ) -> Dict[str, object]:
        """生成批处理报告。

        Args:
            batch: 批次任务。
            products: 商品任务列表。
            output_dir: 可选的输出目录（报告将写入此目录）。

        Returns:
            报告字典。
        """
        # 商品级汇总
        product_summaries: List[Dict[str, object]] = []
        for product in products:
            product_summaries.append({
                "product_id": product.product_id,
                "product_name": product.product_name,
                "status": product.status,
                "total_files": product.total_files,
                "success": product.success_count,
                "failed": product.failed_count,
                "files": [
                    {
                        "file_id": f.file_id,
                        "file_path": f.file_path,
                        "document_type": f.document_type,
                        "status": f.status,
                        "error": f.error,
                        "validation_status": f.validation_status,
                    }
                    for f in product.file_tasks
                ],
            })

        # 失败文件
        failed_files = []
        for product in products:
            for ft in product.file_tasks:
                if ft.status == "FAILED":
                    failed_files.append({
                        "file": ft.file_path,
                        "status": ft.status,
                        "reason": ft.error or "UNKNOWN",
                        "suggestion": "manual_check",
                        "product_id": product.product_id,
                    })

        report = {
            "batch_id": batch.batch_id,
            "status": batch.status,
            "summary": {
                "total_products": batch.total_products,
                "total_files": batch.total_files,
                "completed_files": batch.completed_files,
                "failed_files": batch.failed_files,
                "progress": batch.progress,
            },
            "products": product_summaries,
        }

        if failed_files:
            report["failed_files"] = failed_files

        # 写入文件
        if output_dir:
            self._write_report(report, output_dir, failed_files)

        return report

    @staticmethod
    def _write_report(
        report: Dict[str, object],
        output_dir: str,
        failed_files: List[Dict[str, object]],
    ) -> None:
        """写入报告到文件。"""
        os.makedirs(output_dir, exist_ok=True)

        # 主报告
        report_path = os.path.join(output_dir, "batch_report.json")
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        # 失败详情
        if failed_files:
            failed_dir = os.path.join(output_dir, "failed")
            os.makedirs(failed_dir, exist_ok=True)
            for ff in failed_files:
                file_name = os.path.splitext(
                    os.path.basename(str(ff.get("file", "unknown")))
                )[0]
                err_path = os.path.join(
                    failed_dir, f"{file_name}_error.json"
                )
                with open(err_path, "w", encoding="utf-8") as f:
                    json.dump(ff, f, ensure_ascii=False, indent=2)

        logger.info("报告已生成: %s", report_path)
