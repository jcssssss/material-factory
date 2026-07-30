"""Word 文字水印清理器。

通过 XML 节点级删除清理 DOCX 中的文字水印。
使用 lxml 修改 XML，zipfile 操作 DOCX 包。
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import zipfile
from typing import List, Optional
from xml.etree import ElementTree as ET

from risk import CleaningAction, CleaningPlan, RiskLevel

from . import CleaningResult, CleaningStatus
from matcher.word_text_matcher import WordTextMatcher

logger = logging.getLogger(__name__)

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


class WordTextCleaner:
    """Word 文字水印清理器。

    操作流程：
    1. 定位 XML 节点
    2. 删除 <w:t> 节点
    3. 清理空 <w:r> 节点
    4. 保存 DOCX
    """

    def __init__(self) -> None:
        self._matcher = WordTextMatcher()

    def clean(
        self,
        docx_path: str,
        plan: CleaningPlan,
        output_path: str,
    ) -> List[CleaningResult]:
        """执行 Word 文字水印清理计划。

        Args:
            docx_path: 输入 DOCX 文件路径。
            plan: 清理计划（只处理 AUTO 级别的 Action）。
            output_path: 输出 DOCX 文件路径。

        Returns:
            清理结果列表。
        """
        if not plan.actions:
            return []

        # 只处理 AUTO 级别的 Action
        actions = [a for a in plan.actions if a.risk_level == RiskLevel.AUTO]
        if not actions:
            return []

        results: List[CleaningResult] = []

        # 复制到临时文件处理
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".docx")
        os.close(tmp_fd)
        shutil.copy2(docx_path, tmp_path)

        try:
            for action in actions:
                result = self._execute_action(tmp_path, action)
                results.append(result)

                # 如果成功且后续还有 Action，用修改后的文件继续处理
                if result.status == CleaningStatus.SUCCESS and len(results) < len(actions):
                    continue

            # 复制结果到输出路径
            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                shutil.copy2(tmp_path, output_path)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        return results

    def _execute_action(
        self, docx_path: str, action: CleaningAction
    ) -> CleaningResult:
        """执行单个清理操作。"""
        xml_path = action.metadata.get("xml", "")
        text = action.content

        if not xml_path or not text:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="missing xml_path or text in action",
                fallback_action="manual_review",
            )

        # 查找文本节点
        nodes = self._matcher.find_text_nodes(docx_path, text, xml_path)
        if not nodes:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error=f"text node not found in {xml_path}",
                fallback_action="manual_review",
                metadata={"reason": "NODE_NOT_FOUND"},
            )

        # 删除节点
        removed = 0
        errors: List[str] = []

        for node_xml_path, r_elem, t_elem in nodes:
            try:
                success = self._delete_text_node(docx_path, node_xml_path, r_elem, t_elem)
                if success:
                    removed += 1
                else:
                    errors.append(f"failed to delete in {node_xml_path}")
            except Exception as e:
                errors.append(f"{node_xml_path}: {e}")

        if removed == 0:
            return CleaningResult(
                action=action,
                status=CleaningStatus.FAILED,
                error="; ".join(errors) if errors else "delete failed",
                fallback_action="manual_review",
            )

        return CleaningResult(
            action=action,
            status=CleaningStatus.SUCCESS,
            metadata={"removed_nodes": removed},
        )

    def _delete_text_node(
        self,
        docx_path: str,
        xml_path: str,
        r_elem: ET.Element,
        t_elem: ET.Element,
    ) -> bool:
        """删除指定的文本节点并清理空父节点。"""
        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                all_files = {item.filename: zf.read(item) for item in zf.infolist()}
                if xml_path not in all_files:
                    return False
                raw = all_files[xml_path]

            # 解析 XML
            root = ET.fromstring(raw)

            # 找到并删除 w:t 节点
            found = False
            for p_elem in root.iter(f"{{{NS_W}}}p"):
                for r_el in list(p_elem):
                    if r_el.tag != f"{{{NS_W}}}r":
                        continue
                    for t_el in list(r_el):
                        if t_el.tag != f"{{{NS_W}}}t":
                            continue
                        if t_el.text and t_el.text.strip() == t_elem.text.strip():
                            # 删除 w:t
                            r_el.remove(t_el)
                            # 如果 w:r 空了，删除 w:r
                            if len(list(r_el)) == 0:
                                p_elem.remove(r_el)
                            found = True
                            break
                    if found:
                        break
                if found:
                    break

            if not found:
                return False

            # 序列化并写回
            new_raw = ET.tostring(root, xml_declaration=True, encoding="UTF-8")

            # 重建 DOCX
            tmp_fd2, tmp_path2 = tempfile.mkstemp(suffix=".docx")
            os.close(tmp_fd2)

            with zipfile.ZipFile(docx_path, "r") as zin:
                with zipfile.ZipFile(tmp_path2, "w") as zout:
                    for item in zin.infolist():
                        if item.filename == xml_path:
                            zout.writestr(item, new_raw)
                        else:
                            zout.writestr(item, zin.read(item.filename))

            shutil.move(tmp_path2, docx_path)
            return True

        except Exception as e:
            logger.error("XML deletion failed: %s", e)
            return False
