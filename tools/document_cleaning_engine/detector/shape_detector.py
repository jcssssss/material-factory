"""VML Shape / TextBox 检测器。"""

from __future__ import annotations

import zipfile
from typing import List, Optional
from xml.etree import ElementTree as ET

from models.word_object import WordObject

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_V = "urn:schemas-microsoft-com:vml"


class ShapeDetector:
    """VML Shape 检测器。"""

    def detect(self, docx_path: str) -> List[WordObject]:
        """检测 DOCX 中的 VML Shape 和 TextBox。"""
        objects: List[WordObject] = []

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                xml_files = [
                    n for n in zf.namelist()
                    if n.startswith("word/") and n.endswith(".xml")
                    and not n.startswith("word/_rels")
                    and not n.startswith("word/theme")
                    and n not in (
                        "word/styles.xml", "word/settings.xml",
                        "word/fontTable.xml", "word/webSettings.xml",
                    )
                ]

                for xml_path in xml_files:
                    try:
                        content = zf.read(xml_path)
                        root = ET.fromstring(content)
                        objects.extend(self._scan_xml(root, xml_path))
                    except Exception:
                        continue
        except Exception:
            pass

        return objects

    def _scan_xml(self, root: ET.Element, xml_path: str) -> List[WordObject]:
        """扫描 XML 中的 Shape 和 TextBox。"""
        objects: List[WordObject] = []
        ns_v = f"{{{NS_V}}}"

        # v:shape
        for shape in root.iter(f"{ns_v}shape"):
            shape_id = shape.get("id", "")
            style = shape.get("style", "")
            texts = self._extract_texts(shape)

            objects.append(WordObject(
                object_type="shape",
                xml_file=xml_path,
                content=" ".join(texts) if texts else None,
                confidence=0.8,
                metadata={
                    "shape_id": shape_id,
                    "style": style[:200] if style else "",
                    "node": "v:shape",
                },
            ))

        # v:textbox
        for textbox in root.iter(f"{ns_v}textbox"):
            texts = self._extract_texts(textbox)
            content = " ".join(texts) if texts else None

            objects.append(WordObject(
                object_type="textbox",
                xml_file=xml_path,
                content=content,
                confidence=0.7,
                metadata={"node": "v:textbox"},
            ))

        # w:pict (VML picture wrapper)
        for pict in root.iter(f"{{{NS_W}}}pict"):
            objects.append(WordObject(
                object_type="vml",
                xml_file=xml_path,
                confidence=0.6,
                metadata={"node": "w:pict"},
            ))

        return objects

    @staticmethod
    def _extract_texts(elem: ET.Element) -> List[str]:
        """提取元素内的所有 w:t 文本。"""
        texts = []
        for t in elem.iter(f"{{{NS_W}}}t"):
            if t.text:
                texts.append(t.text)
        return texts
