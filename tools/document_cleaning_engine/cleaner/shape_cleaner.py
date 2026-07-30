"""Shape/TextBox/VML 清理器。"""

from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from xml.etree import ElementTree as ET

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_V = "urn:schemas-microsoft-com:vml"


class ShapeCleaner:
    """Shape 清理器。

    删除文档中的 v:shape, v:textbox, w:pict 节点。
    """

    def delete_shape_in_xml(self, docx_path: str) -> bool:
        """从 DOCX 中删除所有 v:shape 节点。

        Args:
            docx_path: DOCX 文件路径（原地修改）。

        Returns:
            是否成功。
        """
        return self._delete_nodes(docx_path, f"{{{NS_V}}}shape")

    def delete_textbox_in_xml(self, docx_path: str) -> bool:
        """删除所有 v:textbox 节点。"""
        return self._delete_nodes(docx_path, f"{{{NS_V}}}textbox")

    def delete_pict_in_xml(self, docx_path: str) -> bool:
        """删除所有 w:pict 节点（含内部子节点）。"""
        return self._delete_nodes(docx_path, f"{{{NS_W}}}pict")

    def _delete_nodes(self, docx_path: str, tag: str) -> bool:
        """删除 XML 中所有匹配标签的节点。"""
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".docx")
        os.close(tmp_fd)
        shutil.copy2(docx_path, tmp_path)

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                files = {item.filename: zf.read(item) for item in zf.infolist()}

            modified = False
            for xml_path, raw in files.items():
                if not xml_path.endswith(".xml"):
                    continue
                try:
                    root = ET.fromstring(raw)
                    changed = self._remove_nodes(root, tag)
                    if changed:
                        files[xml_path] = ET.tostring(
                            root, xml_declaration=True, encoding="UTF-8"
                        )
                        modified = True
                except Exception:
                    continue

            if not modified:
                return False

            with zipfile.ZipFile(tmp_path, "w") as zout:
                for filename, data in files.items():
                    zout.writestr(filename, data)

            shutil.move(tmp_path, docx_path)
            return True
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            return False

    @staticmethod
    def _remove_nodes(root: ET.Element, tag: str) -> bool:
        """从 XML 树中删除所有匹配标签的节点。"""
        removed = False
        parents: list = []

        # 先收集所有要删除的节点（避免迭代中修改）
        to_remove = list(root.iter(tag))

        if not to_remove:
            return False

        for node in to_remove:
            parent = _find_parent(root, node)
            if parent is not None:
                parent.remove(node)
                removed = True

        return removed


def _find_parent(root: ET.Element, child: ET.Element):
    """在 XML 树中查找子节点的父节点。"""
    for parent in root.iter():
        for c in parent:
            if c is child:
                return parent
    return None
