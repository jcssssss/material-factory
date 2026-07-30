"""TaskManager 和 CleaningTask 单元测试。"""

from __future__ import annotations

import pytest

from cleaner import CleaningResult, CleaningStatus
from risk import CleaningAction, CleaningPlan, RiskLevel
from task import CleaningTask, TaskManager


class TestCleaningTask:
    """CleaningTask 数据模型测试。"""

    def test_create_task(self) -> None:
        """应能创建任务。"""
        task = CleaningTask(
            plan_id="plan-001",
            file_path="test.pdf",
            document_type="PDF",
            total_actions=5,
        )
        assert task.task_id
        assert task.plan_id == "plan-001"
        assert task.file_path == "test.pdf"
        assert task.document_type == "PDF"
        assert task.total_actions == 5
        assert task.status == "CREATED"
        assert task.progress == 0

    def test_default_values(self) -> None:
        """默认值应正确。"""
        task = CleaningTask()
        assert task.task_id
        assert task.status == "CREATED"
        assert task.document_type == "PDF"
        assert task.progress == 0
        assert task.results == []

    def test_update_status_all_success(self) -> None:
        """全部成功应得到 COMPLETED。"""
        task = CleaningTask(total_actions=3)
        action = CleaningAction(
            action_type="REMOVE_TEXT", target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        for _ in range(3):
            task.results.append(
                CleaningResult(action=action, status=CleaningStatus.SUCCESS)
            )
        task.update_status()
        assert task.status == "COMPLETED"
        assert task.progress == 100

    def test_update_status_partial_success(self) -> None:
        """部分失败应得到 PARTIAL_SUCCESS。"""
        task = CleaningTask(total_actions=3)
        action = CleaningAction(
            action_type="REMOVE_TEXT", target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        task.results.append(
            CleaningResult(action=action, status=CleaningStatus.SUCCESS)
        )
        task.results.append(
            CleaningResult(
                action=action, status=CleaningStatus.FAILED,
                error="NODE_NOT_FOUND",
            )
        )
        task.results.append(
            CleaningResult(action=action, status=CleaningStatus.SUCCESS)
        )
        task.update_status()
        assert task.status == "PARTIAL_SUCCESS"

    def test_update_status_all_failed(self) -> None:
        """全部失败应得到 FAILED。"""
        task = CleaningTask(total_actions=2)
        action = CleaningAction(
            action_type="REMOVE_TEXT", target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        task.results.append(
            CleaningResult(
                action=action, status=CleaningStatus.FAILED, error="err"
            )
        )
        task.results.append(
            CleaningResult(
                action=action, status=CleaningStatus.FAILED, error="err"
            )
        )
        task.update_status()
        assert task.status == "FAILED"

    def test_count_properties(self) -> None:
        """计数属性应正确。"""
        task = CleaningTask()
        action = CleaningAction(
            action_type="REMOVE_TEXT", target_type="text",
            confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
        )
        task.results.append(
            CleaningResult(action=action, status=CleaningStatus.SUCCESS)
        )
        task.results.append(
            CleaningResult(
                action=action, status=CleaningStatus.FAILED, error="e"
            )
        )
        task.results.append(
            CleaningResult(
                action=action, status=CleaningStatus.SKIPPED,
            )
        )
        assert task.success_count == 1
        assert task.failed_count == 1
        assert task.skipped_count == 1

    def test_empty_results_update_status(self) -> None:
        """空结果列表应为 COMPLETED。"""
        task = CleaningTask()
        task.update_status()
        assert task.status == "COMPLETED"
        assert task.progress == 100


class TestTaskManager:
    """TaskManager 测试。"""

    def setup_method(self) -> None:
        self.manager = TaskManager()
        self.plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT", target_type="text",
                    confidence=0.95, risk_level=RiskLevel.AUTO, risk_score=80.0,
                ),
            ],
        )

    def test_create_task(self) -> None:
        """应能从 Plan 创建任务。"""
        task = self.manager.create_task(self.plan, file_path="doc.pdf")
        assert task.plan_id == self.plan.plan_id
        assert task.file_path == "doc.pdf"
        assert task.total_actions == 1
        assert task.status == "CREATED"

        # 应存储并可获取
        retrieved = self.manager.get_task(task.task_id)
        assert retrieved is not None
        assert retrieved.task_id == task.task_id

    def test_create_task_default_path(self) -> None:
        """不传 file_path 时应使用 plan 中的路径。"""
        task = self.manager.create_task(self.plan)
        assert task.file_path == "test.pdf"

    def test_set_ready(self) -> None:
        """CREATED 应能转为 READY。"""
        task = self.manager.create_task(self.plan)
        self.manager.set_ready(task)
        assert task.status == "READY"

    def test_set_ready_invalid_state(self) -> None:
        """RUNNING 状态不能转为 READY。"""
        task = self.manager.create_task(self.plan)
        self.manager.set_ready(task)
        self.manager.start(task)
        with pytest.raises(ValueError, match="无法从"):
            self.manager.set_ready(task)

    def test_start(self) -> None:
        """READY 应能转为 RUNNING。"""
        task = self.manager.create_task(self.plan)
        self.manager.set_ready(task)
        self.manager.start(task)
        assert task.status == "RUNNING"
        assert task.progress == 0

    def test_start_invalid_state(self) -> None:
        """CREATED 状态不能直接 start。"""
        task = self.manager.create_task(self.plan)
        with pytest.raises(ValueError, match="只有 READY"):
            self.manager.start(task)

    def test_request_cancel(self) -> None:
        """取消任务应设为 CANCELLED。"""
        task = self.manager.create_task(self.plan)
        self.manager.request_cancel(task)
        assert task.status == "CANCELLED"

    def test_set_need_review(self) -> None:
        """应能设为 NEED_REVIEW。"""
        task = self.manager.create_task(self.plan)
        self.manager.set_need_review(task, "页面 5 失败过多")
        assert task.status == "NEED_REVIEW"
        assert task.error == "页面 5 失败过多"

    def test_set_failed(self) -> None:
        """应能设为 FAILED。"""
        task = self.manager.create_task(self.plan)
        self.manager.set_failed(task, "文件无法打开")
        assert task.status == "FAILED"
        assert task.error == "文件无法打开"

    def test_add_results(self) -> None:
        """应能添加结果并自动完成状态计算。"""
        task = self.manager.create_task(self.plan)
        action = self.plan.actions[0]
        results = [
            CleaningResult(action=action, status=CleaningStatus.SUCCESS),
        ]
        self.manager.add_results(task, results)
        assert len(task.results) == 1

    def test_complete_all_success(self) -> None:
        """全部成功应 COMPLETED。"""
        task = self.manager.create_task(self.plan)
        action = self.plan.actions[0]
        self.manager.add_results(task, [
            CleaningResult(action=action, status=CleaningStatus.SUCCESS),
        ])
        self.manager.complete(task)
        assert task.status == "COMPLETED"

    def test_complete_with_failures(self) -> None:
        """部分失败应 PARTIAL_SUCCESS。"""
        task = self.manager.create_task(self.plan)
        action = self.plan.actions[0]
        self.manager.add_results(task, [
            CleaningResult(action=action, status=CleaningStatus.SUCCESS),
            CleaningResult(
                action=action, status=CleaningStatus.FAILED, error="err"
            ),
        ])
        self.manager.complete(task)
        assert task.status == "PARTIAL_SUCCESS"

    def test_get_nonexistent_task(self) -> None:
        """不存在的 task_id 应返回 None。"""
        assert self.manager.get_task("nonexistent") is None
