"""CleaningExecutor — 清理执行器主入口。

协调任务的创建、执行、状态管理和报告生成。
是文档清理引擎的执行层入口。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from typing import Dict, List, Optional

from cleaner import CleaningResult, CleaningStatus
from models.execution_context import ExecutionContext
from risk import CleaningPlan, RiskLevel
from reports import DryRunReport
from task import CleaningTask, TaskManager

from .action_executor import ActionExecutor

logger = logging.getLogger(__name__)


class CleaningExecutor:
    """清理执行器。

    职责：
    1. 加载和验证 CleaningPlan
    2. 创建任务（Task）
    3. 复制源文件到工作目录
    4. 调度 ActionExecutor 执行清理
    5. 收集执行结果
    6. 检查页面级失败和关键失败
    7. 更新任务状态
    8. 生成执行报告

    流程：
    CleaningPlan → Task → 复制文件 → 执行 Action → 检查结果 → 报告
    """

    def __init__(self, output_base_dir: str = "") -> None:
        self._task_manager = TaskManager()
        self._action_executor = ActionExecutor()
        self._dry_run_reporter = DryRunReport()
        self._output_base_dir = output_base_dir or self._default_output_dir()

    @staticmethod
    def _default_output_dir() -> str:
        """默认输出目录。"""
        return os.path.join(tempfile.gettempdir(), "cleaning_engine_output")

    def execute(
        self,
        plan: CleaningPlan,
        file_path: str = "",
        document_type: str = "",
    ) -> CleaningTask:
        """执行清理计划。

        这是 CleaningExecutor 的主入口方法。
        同步执行，返回包含结果的 CleaningTask。

        Args:
            plan: 清理计划（必须是 CONFIRMED 状态）。
            file_path: 源文件路径（可选，覆盖 plan 中的路径）。
            document_type: 文档类型（可选，覆盖 plan 中的类型）。

        Returns:
            执行完成的 CleaningTask。
        """
        # 确定文件路径和文档类型
        src_path = file_path or plan.file_path
        doc_type = document_type or plan.document_type

        # 1. 创建任务
        task = self._task_manager.create_task(
            plan=plan,
            file_path=src_path,
            document_type=doc_type,
        )

        # 2. 创建输出目录
        output_dir = self._prepare_output_dir(task.task_id)
        clean_dir = os.path.join(output_dir, "clean")
        report_dir = os.path.join(output_dir, "report")
        failed_dir = os.path.join(output_dir, "failed")
        os.makedirs(clean_dir, exist_ok=True)
        os.makedirs(report_dir, exist_ok=True)
        os.makedirs(failed_dir, exist_ok=True)

        # 生成输出文件名
        output_filename = self._output_filename(src_path, doc_type)
        output_path = os.path.join(clean_dir, output_filename)

        # 3. 复制源文件到工作目录（保护原始文件）
        working_path = self._copy_to_working(src_path, task.task_id)
        if not working_path:
            self._task_manager.set_failed(task, "无法复制源文件到工作目录")
            return task

        # 4. 创建执行上下文
        context = ExecutionContext(
            task_id=task.task_id,
            input_file=working_path,
            output_file=output_path,
            document_type=doc_type,
            metadata={
                "output_dir": output_dir,
                "clean_dir": clean_dir,
                "report_dir": report_dir,
                "failed_dir": failed_dir,
                "working_path": working_path,
            },
        )

        # 5. 设为 READY → RUNNING
        try:
            self._task_manager.set_ready(task)
            self._task_manager.start(task)
        except ValueError as e:
            self._task_manager.set_failed(task, str(e))
            return task

        # 6. 执行 Action
        results = self._action_executor.execute(plan, context)

        # 7. 记录结果
        self._task_manager.add_results(task, results)

        # 8. 检查关键失败
        if ActionExecutor.has_critical_failure(results):
            logger.warning("Critical failure detected in task: %s", task.task_id)
            # 继续执行，但最终状态会反映部分失败

        # 9. 检查页面级失败
        page_issue = ActionExecutor.check_page_failures(results)
        if page_issue:
            self._task_manager.set_need_review(task, page_issue)
        else:
            # 正常完成状态计算
            self._task_manager.complete(task)

        # 10. 保存原始 CleaningPlan JSON
        self._save_plan_json(plan, report_dir)

        # 11. 生成执行报告
        self._save_execution_report(task, report_dir)

        # 12. 保存失败详情
        self._save_failed_details(task, failed_dir)

        return task

    def request_cancel(self, task_id: str) -> bool:
        """请求取消任务。

        Executor 内部不直接支持取消（同步执行），
        此方法用于在下次执行前检查取消标志。
        """
        task = self._task_manager.get_task(task_id)
        if task and task.status == "RUNNING":
            self._task_manager.request_cancel(task)
            return True
        return False

    def get_task(self, task_id: str) -> Optional[CleaningTask]:
        """获取任务。"""
        return self._task_manager.get_task(task_id)

    # ── 内部方法 ──────────────────────────────────────────────────────

    def _prepare_output_dir(self, task_id: str) -> str:
        """准备输出目录。"""
        output_dir = os.path.join(self._output_base_dir, task_id)
        os.makedirs(output_dir, exist_ok=True)
        return output_dir

    @staticmethod
    def _output_filename(src_path: str, doc_type: str) -> str:
        """生成输出文件名。"""
        base = os.path.splitext(os.path.basename(src_path))[0]
        ext = ".pdf" if doc_type.upper() == "PDF" else ".docx"
        return f"{base}_clean{ext}"

    @staticmethod
    def _copy_to_working(src_path: str, task_id: str) -> Optional[str]:
        """复制源文件到工作目录。

        确保原始文件不会被修改。
        """
        if not src_path or not os.path.exists(src_path):
            logger.error("Source file not found: %s", src_path)
            return None

        working_dir = os.path.join(
            tempfile.gettempdir(), "cleaning_working", task_id
        )
        os.makedirs(working_dir, exist_ok=True)

        base_name = os.path.basename(src_path)
        working_path = os.path.join(working_dir, base_name)

        try:
            shutil.copy2(src_path, working_path)
            logger.info("Copied source to working: %s", working_path)
            return working_path
        except Exception as e:
            logger.error("Failed to copy source file: %s", e)
            return None

    @staticmethod
    def _save_plan_json(plan: CleaningPlan, report_dir: str) -> None:
        """保存 CleaningPlan JSON。"""
        try:
            plan_path = os.path.join(report_dir, "cleaning_plan.json")
            plan_data = {
                "plan_id": plan.plan_id,
                "file_path": plan.file_path,
                "document_type": plan.document_type,
                "risk_level": plan.risk_level.value,
                "status": plan.status,
                "created_time": plan.created_time,
                "summary": plan.summary,
                "actions": [
                    {
                        "action_id": a.action_id,
                        "action_type": a.action_type,
                        "page": a.page,
                        "target_type": a.target_type,
                        "confidence": a.confidence,
                        "risk_level": a.risk_level.value,
                        "risk_score": a.risk_score,
                        "target_ref": a.target_ref,
                        "content": a.content,
                    }
                    for a in plan.actions
                ],
            }
            with open(plan_path, "w", encoding="utf-8") as f:
                json.dump(plan_data, f, ensure_ascii=False, indent=2)
            logger.info("Plan saved to %s", plan_path)
        except Exception as e:
            logger.error("Failed to save plan JSON: %s", e)

    @staticmethod
    def _save_execution_report(
        task: CleaningTask, report_dir: str
    ) -> None:
        """生成并保存执行报告。"""
        try:
            report_path = os.path.join(report_dir, "execution_report.json")

            failed_actions: List[Dict[str, object]] = []
            for r in task.results:
                if r.status == CleaningStatus.FAILED:
                    failed_actions.append({
                        "action_id": r.action.action_id,
                        "action_type": r.action.action_type,
                        "page": r.action.page,
                        "error": r.error,
                        "fallback_action": r.fallback_action,
                    })

            report = {
                "task_id": task.task_id,
                "plan_id": task.plan_id,
                "file_path": task.file_path,
                "status": task.status,
                "total_actions": task.total_actions,
                "success": task.success_count,
                "failed": task.failed_count,
                "skipped": task.skipped_count,
                "error": task.error,
                "created_time": task.created_time,
                "updated_time": task.updated_time,
            }

            if failed_actions:
                report["failed_actions"] = failed_actions

            with open(report_path, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            logger.info("Report saved to %s", report_path)
        except Exception as e:
            logger.error("Failed to save execution report: %s", e)

    @staticmethod
    def _save_failed_details(
        task: CleaningTask, failed_dir: str
    ) -> None:
        """保存失败详情。"""
        failed_results = [
            r for r in task.results if r.status == CleaningStatus.FAILED
        ]
        if not failed_results:
            return

        try:
            error_path = os.path.join(failed_dir, f"{task.task_id}_error.json")
            details = [
                {
                    "action_id": r.action.action_id,
                    "action_type": r.action.action_type,
                    "page": r.action.page,
                    "error": r.error,
                    "fallback_action": r.fallback_action,
                }
                for r in failed_results
            ]
            with open(error_path, "w", encoding="utf-8") as f:
                json.dump(details, f, ensure_ascii=False, indent=2)
            logger.info("Failed details saved to %s", error_path)
        except Exception as e:
            logger.error("Failed to save error details: %s", e)
