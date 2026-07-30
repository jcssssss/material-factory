"""PlanGenerator 单元测试。

测试 CleaningPlan 的生成过程：
- 检测结果汇总
- 重复合并
- IGNORE 过滤
- 风险等级计算
- 用户确认流程
- JSON 序列化
"""

from __future__ import annotations

import json

import pytest

from detector import DetectionResult
from plan import PlanGenerator
from risk import CleaningAction, CleaningPlan, RiskLevel


class TestPlanGeneratorBasic:
    """PlanGenerator 基础功能测试。"""

    def setup_method(self) -> None:
        self.generator = PlanGenerator()

    # ── 空检测列表 ────────────────────────────────────────────────────

    def test_empty_detections(self) -> None:
        """空检测列表应返回 IGNORE 等级的空计划。"""
        plan = self.generator.generate([], file_path="test.pdf")
        assert plan.file_path == "test.pdf"
        assert plan.document_type == "PDF"
        assert plan.risk_level == RiskLevel.IGNORE
        assert len(plan.actions) == 0
        assert plan.status == "DRAFT"

    # ── 基本生成 ──────────────────────────────────────────────────────

    def test_single_annotation(self) -> None:
        """单个 Annotation 应生成 AUTO + WAIT_CONFIRM 计划。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
        ]
        plan = self.generator.generate(detections, file_path="doc.pdf")
        assert len(plan.actions) == 1
        assert plan.actions[0].action_type == "REMOVE_ANNOTATION"
        assert plan.actions[0].risk_level == RiskLevel.AUTO
        assert plan.risk_level == RiskLevel.AUTO
        assert plan.status == "WAIT_CONFIRM"  # 有操作时始终 WAIT_CONFIRM

    def test_with_confirm_actions(self) -> None:
        """有 CONFIRM 操作时状态应为 WAIT_CONFIRM。"""
        detections = [
            DetectionResult(type="header", page=1, confidence=0.85, content="Header"),
        ]
        plan = self.generator.generate(detections, file_path="doc.pdf")
        assert len(plan.actions) == 1
        assert plan.actions[0].risk_level == RiskLevel.CONFIRM
        assert plan.status == "WAIT_CONFIRM"

    def test_mixed_risk_levels(self) -> None:
        """混合风险等级应正确保留。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
            DetectionResult(type="header", page=1, confidence=0.85, content="H"),
            DetectionResult(type="image", page=1, confidence=0.5),
        ]
        plan = self.generator.generate(detections, file_path="mix.pdf")

        levels = {a.risk_level for a in plan.actions}
        assert RiskLevel.AUTO in levels   # annotation
        assert RiskLevel.CONFIRM in levels  # header + image

    # ── 全部候选上报（不再过滤 IGNORE）───────────────────────────────────

    def test_all_candidates_kept(self) -> None:
        """所有检测候选都应出现在计划中（不再过滤）。"""
        detections = [
            DetectionResult(type="image", page=1, confidence=0.3),
            DetectionResult(type="image", page=2, confidence=0.2),
        ]
        plan = self.generator.generate(detections, file_path="low.pdf")
        # 现在所有候选都保留
        assert len(plan.actions) == 2
        assert plan.risk_level == RiskLevel.CONFIRM

    def test_mixed_all_kept(self) -> None:
        """混合检测中所有候选都保留。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
            DetectionResult(type="image", page=2, confidence=0.3),
            DetectionResult(type="header", page=1, confidence=0.85, content="H"),
        ]
        plan = self.generator.generate(detections, file_path="mix.pdf")
        assert len(plan.actions) == 3  # annotation + image + header
        action_types = {a.action_type for a in plan.actions}
        assert "REMOVE_ANNOTATION" in action_types
        assert "REMOVE_IMAGE" in action_types
        assert "REMOVE_HEADER" in action_types

    # ── 10个检测结果的批量测试 ────────────────────────────────────────

    def test_batch_detections(self) -> None:
        """10个检测结果应生成正确数量的操作。"""
        detections = [
            DetectionResult(type="annotation", page=i, confidence=1.0)
            for i in range(1, 6)
        ] + [
            DetectionResult(type="header", page=i, confidence=0.85, content=f"H{i}")
            for i in range(1, 6)
        ]
        plan = self.generator.generate(detections, file_path="batch.pdf")
        # 10 个检测，全部保留
        assert len(plan.actions) == 10
        assert plan.file_path == "batch.pdf"

    def test_all_candidates_batch(self) -> None:
        """10 个低置信检测全部作为候选保留。"""
        detections = [
            DetectionResult(type="image", page=i, confidence=0.3)
            for i in range(10)
        ]
        plan = self.generator.generate(detections, file_path="all_candidates.pdf")
        assert len(plan.actions) == 10  # 全部保留
        assert plan.risk_level == RiskLevel.CONFIRM

    # ── 文档类型 ──────────────────────────────────────────────────────

    def test_word_document_type(self) -> None:
        """应支持 WORD 文档类型。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
        ]
        plan = self.generator.generate(
            detections, file_path="doc.docx", document_type="WORD"
        )
        assert plan.document_type == "WORD"

    def test_invalid_document_type(self) -> None:
        """未知文档类型默认回落为 PDF。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
        ]
        plan = self.generator.generate(
            detections, file_path="test.xyz", document_type="XYZ"
        )
        assert plan.document_type == "PDF"

    # ── 无效输入 ──────────────────────────────────────────────────────

    def test_invalid_file_path_type(self) -> None:
        """file_path 类型错误应抛出异常。"""
        with pytest.raises(ValueError, match="必须是字符串"):
            self.generator.generate([], file_path=123)  # type: ignore[arg-type]


class TestPlanGeneratorDedup:
    """重复检测合并测试。"""

    def setup_method(self) -> None:
        self.generator = PlanGenerator()

    def test_exact_duplicates_merged(self) -> None:
        """完全相同的检测应合并为一条。"""
        detections = [
            DetectionResult(
                type="text", page=1, confidence=0.9, content="Confidential",
                bbox=(100, 200, 300, 250),
            ),
            DetectionResult(
                type="text", page=1, confidence=0.95, content="Confidential",
                bbox=(100, 200, 300, 250),
            ),
        ]
        plan = self.generator.generate(detections, file_path="dup.pdf")
        # 应合并为一条，取最高置信度 0.95
        assert len(plan.actions) == 1
        assert plan.actions[0].confidence == 0.95

    def test_different_pages_not_merged(self) -> None:
        """不同页面的相同内容不应合并。"""
        detections = [
            DetectionResult(
                type="text", page=1, confidence=0.9, content="Confidential",
            ),
            DetectionResult(
                type="text", page=2, confidence=0.9, content="Confidential",
            ),
        ]
        plan = self.generator.generate(detections, file_path="diff_page.pdf")
        assert len(plan.actions) == 2

    def test_different_content_not_merged(self) -> None:
        """不同内容不应合并。"""
        detections = [
            DetectionResult(
                type="text", page=1, confidence=0.9, content="Confidential",
            ),
            DetectionResult(
                type="text", page=1, confidence=0.9, content="Internal Only",
            ),
        ]
        plan = self.generator.generate(detections, file_path="diff_content.pdf")
        assert len(plan.actions) == 2


class TestPlanGeneratorConfirm:
    """用户确认流程测试。"""

    def setup_method(self) -> None:
        self.generator = PlanGenerator()

    def test_confirm_waits(self) -> None:
        """有 CONFIRM 操作的计划应处于 WAIT_CONFIRM 状态。"""
        detections = [
            DetectionResult(type="header", page=1, confidence=0.85, content="H"),
        ]
        plan = self.generator.generate(detections, file_path="needs_confirm.pdf")
        assert plan.status == "WAIT_CONFIRM"

    def test_confirm_plan(self) -> None:
        """确认操作应将状态从 WAIT_CONFIRM 改为 CONFIRMED。"""
        detections = [
            DetectionResult(type="header", page=1, confidence=0.85, content="H"),
        ]
        plan = self.generator.generate(detections)
        assert plan.status == "WAIT_CONFIRM"

        self.generator.confirm_plan(plan)
        assert plan.status == "CONFIRMED"

    def test_confirm_already_confirmed_raises(self) -> None:
        """已 CONFIRMED 的计划再次确认应报错。"""
        detections = [
            DetectionResult(type="header", page=1, confidence=0.85, content="H"),
        ]
        plan = self.generator.generate(detections)
        self.generator.confirm_plan(plan)  # 第一次确认
        assert plan.status == "CONFIRMED"

        with pytest.raises(ValueError, match="只有 WAIT_CONFIRM"):
            self.generator.confirm_plan(plan)  # 重复确认应报错

    def test_confirm_draft_plan_raises(self) -> None:
        """WAIT_CONFIRM 状态的计划才能 confirm。"""
        # 空计划是 DRAFT
        plan_empty = self.generator.generate([])
        assert plan_empty.status == "DRAFT"

        with pytest.raises(ValueError, match="只有 WAIT_CONFIRM"):
            self.generator.confirm_plan(plan_empty)

        # WAIT_CONFIRM 状态的计划可以 confirm
        detections = [DetectionResult(type="header", page=1, confidence=0.85, content="H")]
        plan_wait = self.generator.generate(detections)
        assert plan_wait.status == "WAIT_CONFIRM"
        self.generator.confirm_plan(plan_wait)
        assert plan_wait.status == "CONFIRMED"

        with pytest.raises(ValueError, match="只有 WAIT_CONFIRM"):
            self.generator.confirm_plan(plan_wait)


class TestPlanGeneratorSummary:
    """计划摘要测试。"""

    def setup_method(self) -> None:
        self.generator = PlanGenerator()

    def test_summary_counts(self) -> None:
        """摘要应正确统计各风险等级数量。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
            DetectionResult(type="annotation", page=2, confidence=1.0),
            DetectionResult(type="header", page=1, confidence=0.85, content="H"),
            DetectionResult(type="image", page=1, confidence=0.5),  # now CONFIRM
        ]
        plan = self.generator.generate(detections, file_path="summary.pdf")

        # 所有候选都保留: 2 AUTO + 2 CONFIRM
        assert plan.summary["total_detected"] == 4
        assert plan.summary["auto_count"] == 2
        assert plan.summary["confirm_count"] == 2
        assert plan.summary["ignore_count"] == 0

    def test_empty_plan_summary(self) -> None:
        """空计划的摘要应为零。"""
        plan = self.generator.generate([], file_path="empty.pdf")
        assert plan.summary["total_detected"] == 0
        assert plan.summary["auto_count"] == 0


class TestPlanJSON:
    """CleaningPlan JSON 序列化测试。"""

    def test_plan_json_serializable(self) -> None:
        """CleaningPlan 应可序列化为 JSON。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT",
                    page=1,
                    target_type="text",
                    confidence=0.95,
                    risk_level=RiskLevel.AUTO,
                    risk_score=85.0,
                    content="Confidential",
                    bbox=(100, 200, 300, 250),
                ),
            ],
        )
        plan.update_summary()

        # 序列化
        plan_json = json.dumps({
            "file": plan.file_path,
            "plan_id": plan.plan_id,
            "risk_level": plan.risk_level.value,
            "status": plan.status,
            "document_type": plan.document_type,
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
                    "content": a.content,
                    "bbox": list(a.bbox) if a.bbox else None,
                    "target_ref": a.target_ref,
                }
                for a in plan.actions
            ],
        }, ensure_ascii=False, indent=2)

        # 验证 JSON 结构
        parsed = json.loads(plan_json)
        assert parsed["file"] == "test.pdf"
        assert parsed["risk_level"] == "AUTO"
        assert parsed["status"] == "DRAFT"
        assert parsed["document_type"] == "PDF"
        assert len(parsed["actions"]) == 1

        action = parsed["actions"][0]
        assert action["action_type"] == "REMOVE_TEXT"
        assert action["confidence"] == 0.95
        assert action["risk_level"] == "AUTO"
        assert action["risk_score"] == 85.0
        assert action["target_ref"] is None

    def test_json_output_example(self) -> None:
        """验证符合 spec 示例的输出格式。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT",
                    page=1,
                    target_type="text",
                    confidence=0.95,
                    risk_level=RiskLevel.AUTO,
                    risk_score=85.0,
                    content="内部资料",
                ),
            ],
        )
        plan.update_summary()
        plan_json = json.dumps({
            "file": plan.file_path,
            "risk_level": plan.risk_level.value,
            "actions": [
                {
                    "action_type": a.action_type,
                    "page": a.page,
                    "target_ref": a.target_ref,
                    "confidence": a.confidence,
                }
                for a in plan.actions
            ],
        }, ensure_ascii=False, indent=2)

        parsed = json.loads(plan_json)
        assert parsed["file"] == "test.pdf"
        assert parsed["risk_level"] == "AUTO"
        assert parsed["actions"][0]["action_type"] == "REMOVE_TEXT"
        assert parsed["actions"][0]["confidence"] == 0.95


class TestPlanGeneratorEdgeCases:
    """边界情况测试。"""

    def setup_method(self) -> None:
        self.generator = PlanGenerator()

    def test_no_file_path(self) -> None:
        """不传 file_path 应正常工作。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
        ]
        plan = self.generator.generate(detections)
        assert plan.file_path == ""
        assert len(plan.actions) == 1

    def test_single_page_actions(self) -> None:
        """单页多类型检测应正确归集。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
            DetectionResult(type="header", page=1, confidence=0.9, content="Header"),
            DetectionResult(type="footer", page=1, confidence=0.85, content="Page 1"),
        ]
        plan = self.generator.generate(detections, file_path="single_page.pdf")
        assert len(plan.actions) == 3
        assert all(a.page == 1 for a in plan.actions)
