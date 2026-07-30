"""Risk Engine 与 Cleaning Plan 单元测试。"""

from __future__ import annotations

import json

import pytest

from detector import DetectionResult
from risk import (
    ACTION_TYPE_MAP,
    ActionType,
    CleaningAction,
    CleaningPlan,
    RiskEngine,
    RiskLevel,
)
from risk.risk_rules import RiskRules
from risk.scoring import RiskScorer
from reports.dry_run_report import DryRunReport


class TestRiskRules:
    """风险等级规则测试。"""

    def setup_method(self) -> None:
        self.rules = RiskRules()

    # ── Case 1: Annotation → AUTO ───────────────────────────────────

    def test_annotation_auto(self) -> None:
        """Annotation 应始终为 AUTO。"""
        detection = DetectionResult(
            type="annotation", page=1, confidence=1.0
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.AUTO

    # ── Case 2: Artifact → AUTO ─────────────────────────────────────

    def test_artifact_auto(self) -> None:
        """Artifact 应始终为 AUTO。"""
        detection = DetectionResult(
            type="artifact", page=1, confidence=1.0
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.AUTO

    # ── Case 3: 文本水印 → 始终 CONFIRM ──────────────────────────────

    def test_high_conf_text_confirm(self) -> None:
        """文本水印应始终为 CONFIRM（不再根据关键词判断）。"""
        detection = DetectionResult(
            type="text",
            page=5,
            confidence=0.95,
            content="内部资料",
            metadata={"keyword_score": 30},
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    # ── Case 4: 低置信文本 → 也是 CONFIRM（所有候选都上报）────────

    def test_low_conf_text_confirm(self) -> None:
        """低置信度文本水印也为 CONFIRM（所有候选都上报）。"""
        detection = DetectionResult(
            type="text",
            page=3,
            confidence=0.5,
            content="普通内容",
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    # ── Case 5: 文本水印无关键词 → CONFIRM ─────────────────────────

    def test_text_without_keyword_confirm(self) -> None:
        """文本水印始终为 CONFIRM。"""
        detection = DetectionResult(
            type="text",
            page=2,
            confidence=0.85,
            content="普通页面文本",
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    # ── Case 6: 页眉 → CONFIRM ───────────────────────────────

    def test_header_confirm(self) -> None:
        """页眉应为 CONFIRM。"""
        detection = DetectionResult(
            type="header",
            page=1,
            confidence=0.85,
            content="Monthly Report",
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    # ── Case 7: 页脚 → CONFIRM ────────────────────────────────

    def test_low_conf_footer_confirm(self) -> None:
        """页脚应为 CONFIRM（所有候选都上报）。"""
        detection = DetectionResult(
            type="footer", page=1, confidence=0.5
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    # ── Case 8: 图片水印 → 始终 CONFIRM ──────────────────────

    def test_image_always_confirm(self) -> None:
        """图片水印应为 CONFIRM（不再根据置信度分级）。"""
        detection = DetectionResult(
            type="image", page=1, confidence=0.85
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    def test_image_medium_conf_confirm(self) -> None:
        """中等置信图片也为 CONFIRM。"""
        detection = DetectionResult(
            type="image", page=1, confidence=0.7
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM

    def test_image_low_conf_confirm(self) -> None:
        """低置信图片也为 CONFIRM。"""
        detection = DetectionResult(
            type="image", page=1, confidence=0.5
        )
        level = self.rules.evaluate(detection)
        assert level == RiskLevel.CONFIRM


class TestRiskScorer:
    """风险评分测试。"""

    def setup_method(self) -> None:
        self.scorer = RiskScorer()

    def test_annotation_score(self) -> None:
        """Annotation 风险评分应较高。"""
        detection = DetectionResult(
            type="annotation",
            page=1,
            confidence=1.0,
            bbox=(100, 100, 200, 200),
        )
        score = self.scorer.score(detection)
        # 1.0*50 + 30 + 位置分
        assert 80 <= score <= 100

    def test_text_watermark_score(self) -> None:
        """文本水印风险评分应在合理范围。"""
        detection = DetectionResult(
            type="text",
            page=5,
            confidence=0.95,
            content="Confidential",
            bbox=(200, 350, 400, 450),
            metadata={"total_score": 85},
        )
        score = self.scorer.score(detection)
        assert 60 <= score <= 100

    def test_low_confidence_low_score(self) -> None:
        """低置信度应得到低风险评分。"""
        detection = DetectionResult(
            type="text",
            page=1,
            confidence=0.3,
            bbox=(10, 10, 50, 30),
        )
        score = self.scorer.score(detection)
        assert score < 50


class TestActionTypeMapping:
    """操作类型映射测试。"""

    def test_all_detection_types_mapped(self) -> None:
        """所有检测类型都应有对应的操作类型。"""
        assert ACTION_TYPE_MAP["annotation"] == ActionType.REMOVE_ANNOTATION
        assert ACTION_TYPE_MAP["artifact"] == ActionType.REMOVE_ARTIFACT
        assert ACTION_TYPE_MAP["image"] == ActionType.REMOVE_IMAGE
        assert ACTION_TYPE_MAP["text"] == ActionType.REMOVE_TEXT
        assert ACTION_TYPE_MAP["header"] == ActionType.REMOVE_HEADER
        assert ACTION_TYPE_MAP["footer"] == ActionType.REMOVE_FOOTER


class TestRiskEngine:
    """RiskEngine 集成测试。"""

    def setup_method(self) -> None:
        self.engine = RiskEngine()

    def test_empty_detections(self) -> None:
        """空检测列表应返回 IGNORE 计划。"""
        plan = self.engine.evaluate([], file_path="test.pdf")
        assert plan.risk_level == RiskLevel.IGNORE
        assert len(plan.actions) == 0
        assert plan.file_path == "test.pdf"

    def test_annotation_auto_action(self) -> None:
        """Annotation 应生成 REMOVE_ANNOTATION + AUTO。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
        ]
        plan = self.engine.evaluate(detections, file_path="test.pdf")
        assert len(plan.actions) == 1
        action = plan.actions[0]
        assert action.action_type == "REMOVE_ANNOTATION"
        assert action.risk_level == RiskLevel.AUTO
        assert action.page == 1
        assert action.target_type == "annotation"

    def test_text_watermark_auto_action(self) -> None:
        """文本水印应生成 REMOVE_TEXT + CONFIRM。"""
        detections = [
            DetectionResult(
                type="text",
                page=3,
                confidence=0.95,
                content="Confidential",
            ),
        ]
        plan = self.engine.evaluate(detections, file_path="doc.pdf")
        assert len(plan.actions) == 1
        action = plan.actions[0]
        assert action.action_type == "REMOVE_TEXT"
        assert action.risk_level == RiskLevel.CONFIRM
        assert action.risk_score > 0

    def test_mixed_detections(self) -> None:
        """混合检测结果 — 所有类型都上报。"""
        detections = [
            DetectionResult(type="annotation", page=1, confidence=1.0),
            DetectionResult(type="header", page=1, confidence=0.85, content="Header"),
            DetectionResult(type="image", page=1, confidence=0.5),
        ]
        plan = self.engine.evaluate(detections, file_path="mix.pdf")
        assert len(plan.actions) == 3

        levels = {a.risk_level for a in plan.actions}
        assert RiskLevel.AUTO in levels  # annotation
        assert RiskLevel.CONFIRM in levels  # header + image（不再有 IGNORE）

        # 整体风险应为 AUTO
        assert plan.risk_level == RiskLevel.AUTO

    def test_all_confirm_plan_risk(self) -> None:
        """只有 CONFIRM 时整体风险应为 CONFIRM。"""
        detections = [
            DetectionResult(type="header", page=1, confidence=0.85),
            DetectionResult(type="footer", page=1, confidence=0.8),
        ]
        plan = self.engine.evaluate(detections)
        assert plan.risk_level == RiskLevel.CONFIRM

    def test_all_confirm_plan_risk_v2(self) -> None:
        """所有检测结果都是 CONFIRM 时整体应为 CONFIRM。"""
        detections = [
            DetectionResult(type="image", page=1, confidence=0.3),
        ]
        plan = self.engine.evaluate(detections)
        assert plan.risk_level == RiskLevel.CONFIRM

    def test_cleaning_action_fields(self) -> None:
        """CleaningAction 字段应正确填充。"""
        detection = DetectionResult(
            type="annotation",
            page=2,
            confidence=1.0,
            bbox=(0, 0, 100, 50),
            content="Test",
            metadata={"key": "value"},
        )
        plan = self.engine.evaluate([detection])
        action = plan.actions[0]

        assert action.action_type == "REMOVE_ANNOTATION"
        assert action.page == 2
        assert action.target_type == "annotation"
        assert action.confidence == 1.0
        assert action.content == "Test"
        assert action.bbox == (0, 0, 100, 50)
        assert action.metadata.get("key") == "value"


class TestDryRunReport:
    """Dry-run 报告测试。"""

    def test_generate_report(self) -> None:
        """应生成符合格式的 JSON 报告。"""
        plan = CleaningPlan(
            file_path="exam.pdf",
            risk_level=RiskLevel.AUTO,
            actions=[
                CleaningAction(
                    action_type="REMOVE_TEXT",
                    page=5,
                    target_type="text",
                    confidence=0.95,
                    risk_level=RiskLevel.AUTO,
                    risk_score=85.0,
                    content="Confidential",
                    bbox=(100, 200, 300, 250),
                ),
                CleaningAction(
                    action_type="REMOVE_HEADER",
                    page=1,
                    target_type="header",
                    confidence=0.85,
                    risk_level=RiskLevel.CONFIRM,
                    risk_score=65.0,
                    content="Header",
                ),
            ],
        )

        reporter = DryRunReport()
        report_str = reporter.generate(plan)
        report = json.loads(report_str)

        # 验证结构
        assert report["file"] == "exam.pdf"
        assert report["summary"]["total_detected"] == 2
        assert report["summary"]["auto_remove"] == 1
        assert report["summary"]["confirm"] == 1
        assert report["summary"]["ignore"] == 0
        assert report["summary"]["overall_risk"] == "AUTO"

        assert len(report["actions"]) == 2
        a0 = report["actions"][0]
        assert a0["type"] == "text"
        assert a0["action"] == "REMOVE_TEXT"
        assert a0["decision"] == "AUTO"

        a1 = report["actions"][1]
        assert a1["decision"] == "CONFIRM"

    def test_empty_plan_report(self) -> None:
        """空计划应生成空报告。"""
        plan = CleaningPlan(
            file_path="empty.pdf",
            risk_level=RiskLevel.IGNORE,
            actions=[],
        )
        reporter = DryRunReport()
        report_str = reporter.generate(plan)
        report = json.loads(report_str)

        assert report["summary"]["total_detected"] == 0
        assert report["summary"]["auto_remove"] == 0
        assert len(report["actions"]) == 0


class TestCleaningPlanModel:
    """CleaningPlan 数据模型测试。"""

    def test_create_plan(self) -> None:
        """应能创建 CleaningPlan。"""
        plan = CleaningPlan(
            file_path="test.pdf",
            risk_level=RiskLevel.CONFIRM,
            actions=[
                CleaningAction(
                    action_type="REMOVE_HEADER",
                    page=1,
                    target_type="header",
                    confidence=0.85,
                    risk_level=RiskLevel.CONFIRM,
                    risk_score=65.0,
                ),
            ],
        )
        assert plan.file_path == "test.pdf"
        assert plan.risk_level == RiskLevel.CONFIRM
        assert len(plan.actions) == 1
