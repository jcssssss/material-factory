"""DrawingML 清理器。"""

from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from xml.etree import ElementTree as ET

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class DrawingCleaner:
    """DrawingML 清理器。

    删除文档中的 w:drawing 节点。
    不删除 media 文件（可能被多处引用）。
    """

    def delete_drawing_in_xml(self, docx_path: str) -> bool:
        """删除 DOCX 中所有 w:drawing 节点。

        Args:
            docx_path: DOCX 文件路径（原地修改）。

        Returns:
            是否成功。
        """
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".docx")
        os.close(tmp_fd)
        shutil.copy2(docx_path, tmp_path)

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                files = {item.filename: zf.read(item) for item in zf.infolist()}

            modified = False
            tag = f"{{{NS_W}}}drawing"

            for xml_path, raw in files.items():
                if not xml_path.endswith(".xml"):
                    continue
                try:
                    root = ET.fromstring(raw)
                    to_remove = list(root.iter(tag))
                    if not to_remove:
                        continue

                    for node in to_remove:
                        parent = _find_parent(root, node)
                        if parent is not None:
                            parent.remove(node)
                            modified = True

                    if modified:
                        files[xml_path] = ET.tostring(
                            root, xml_declaration=True, encoding="UTF-8"
                        )
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


def _find_parent(root: ET.Element, child: ET.Element):
    """在 XML 树中查找子节点的父节点。"""
    for parent in root.iter():
        for c in parent:
            if c is child:
                return parent
    return None
