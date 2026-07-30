"""DrawingML 检测器。

检测 DOCX 中的 w:drawing 元素（图片、浮动对象等）。
"""

from __future__ import annotations

import zipfile
from typing import Dict, List, Optional
from xml.etree import ElementTree as ET

from models.word_object import WordObject

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"


class DrawingDetector:
    """DrawingML 检测器。

    检测 w:drawing 元素，区分 inline（行内）和 anchor（浮动）对象。
    """

    def detect(self, docx_path: str) -> List[WordObject]:
        """检测 DOCX 中的 DrawingML 对象。

        Args:
            docx_path: DOCX 文件路径。

        Returns:
            WordObject 列表。
        """
        objects: List[WordObject] = []

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                rels = self._load_rels(zf)

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
                        objects.extend(
                            self._scan_drawings(root, xml_path, rels)
                        )
                    except Exception:
                        continue
        except Exception:
            pass

        return objects

    def _scan_drawings(
        self, root: ET.Element, xml_path: str, rels: Dict[str, str]
    ) -> List[WordObject]:
        """扫描 XML 中的 w:drawing 元素。"""
        objects: List[WordObject] = []

        for drawing in root.iter(f"{{{NS_W}}}drawing"):
            is_anchor = False
            img_size = None
            relation_id = None
            has_alpha = False
            has_shape = False

            # 检查是 anchor（浮动）还是 inline（行内）
            anchor = drawing.find(f".//{{{NS_WP}}}anchor")
            inline = drawing.find(f".//{{{NS_WP}}}inline")

            if anchor is not None:
                is_anchor = True
                # 读取尺寸
                ext = anchor.find(f".//{{{NS_A}}}ext")
                if ext is not None:
                    try:
                        cx = int(ext.get("cx", "0"))
                        cy = int(ext.get("cy", "0"))
                        img_size = (cx, cy)
                    except (ValueError, TypeError):
                        pass

                # 读取透明度
                alpha = anchor.find(f".//{{{NS_A}}}alpha")
                if alpha is not None:
                    val = alpha.get("val", "100000")
                    try:
                        has_alpha = int(val) < 100000
                    except (ValueError, TypeError):
                        pass

                # 读取图片关系
                blip = anchor.find(f".//{{{NS_A}}}blip")
                if blip is not None:
                    embed = blip.get(f"{{{NS_R}}}embed", "")
                    if embed:
                        relation_id = embed

            elif inline is not None:
                blip = inline.find(f".//{{{NS_A}}}blip")
                if blip is not None:
                    embed = blip.get(f"{{{NS_R}}}embed", "")
                    if embed:
                        relation_id = embed

            # 评分
            confidence = self._score(is_anchor, has_alpha, img_size)

            obj_type = "drawing"
            if is_anchor:
                obj_type = "drawing_anchor"

            metadata: Dict = {
                "node": "w:drawing",
                "is_anchor": is_anchor,
                "has_alpha": has_alpha,
            }
            if relation_id:
                metadata["relation_id"] = relation_id
                # 查找实际图片路径
                img_path = rels.get(relation_id, "")
                if img_path:
                    metadata["image_path"] = img_path
            if img_size:
                metadata["size"] = f"{img_size[0]}x{img_size[1]}"

            objects.append(WordObject(
                object_type=obj_type,
                xml_file=xml_path,
                relation_id=relation_id,
                confidence=round(confidence, 2),
                metadata=metadata,
            ))

        return objects

    @staticmethod
    def _score(is_anchor: bool, has_alpha: bool, size) -> float:
        """简单评分 (0-1)。"""
        score = 0.0
        if is_anchor:
            score += 0.4  # 浮动对象
        if has_alpha:
            score += 0.3  # 透明
        if size:
            cx, cy = size
            if cx > 500000 or cy > 500000:  # EMU，约 1.4cm
                score += 0.2  # 大尺寸
        return min(1.0, score)

    @staticmethod
    def _load_rels(zf: zipfile.ZipFile) -> Dict[str, str]:
        """加载关系文件。"""
        rels: Dict[str, str] = {}
        rel_files = [n for n in zf.namelist() if n.endswith(".rels")]
        ns_rel = "http://schemas.openxmlformats.org/package/2006/relationships"

        for rel_path in rel_files:
            try:
                content = zf.read(rel_path)
                root = ET.fromstring(content)
                for rel_elem in root:
                    r_id = rel_elem.get("Id", "")
                    target = rel_elem.get("Target", "")
                    if r_id and target:
                        rels[r_id] = target
            except Exception:
                continue

        return rels
