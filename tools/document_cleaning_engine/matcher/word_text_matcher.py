"""Word 文本匹配器。

在 DOCX 的 XML 文件中定位水印关键词文本节点。
支持跨 Section 的 Same As Previous 判断。
"""

from __future__ import annotations

import zipfile
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

from models.word_text_block import WordTextBlock

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class WordTextMatcher:
    """Word 文本匹配器。

    在 DOCX 的 XML 结构中搜索文本节点，用于检测和定位。
    """

    def find_text_nodes(
        self, docx_path: str, text: str, xml_path: str
    ) -> List[Tuple[str, ET.Element, ET.Element]]:
        """在指定 XML 中搜索文本节点。

        Args:
            docx_path: DOCX 文件路径。
            text: 要搜索的文本。
            xml_path: XML 文件路径（如 word/header1.xml）。

        Returns:
            [(xml_path, w:r 元素, w:t 元素)] 列表。
        """
        results: List[Tuple[str, ET.Element, ET.Element]] = []

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                if xml_path not in zf.namelist():
                    return []
                content = zf.read(xml_path)
                root = ET.fromstring(content)
                self._search_in_tree(root, text, xml_path, results)
        except Exception:
            pass

        return results

    def find_all_texts(
        self, docx_path: str
    ) -> Dict[str, List[WordTextBlock]]:
        """扫描所有 XML 文件，提取文本内容。

        Args:
            docx_path: DOCX 文件路径。

        Returns:
            {xml_path: [WordTextBlock]} 映射。
        """
        results: Dict[str, List[WordTextBlock]] = {}

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                xml_files = [
                    n for n in zf.namelist()
                    if n.startswith("word/")
                    and n.endswith(".xml")
                    and n
                    not in (
                        "word/styles.xml",
                        "word/webSettings.xml",
                        "word/fontTable.xml",
                        "word/settings.xml",
                        "word/theme/theme1.xml",
                    )
                ]

                for xml_path in xml_files:
                    try:
                        content = zf.read(xml_path)
                        root = ET.fromstring(content)
                        blocks = self._extract_blocks(root, xml_path)
                        if blocks:
                            results[xml_path] = blocks
                    except Exception:
                        continue
        except Exception:
            pass

        return results

    def _search_in_tree(
        self,
        root: ET.Element,
        text: str,
        xml_path: str,
        results: List,
    ) -> None:
        """在 XML 树中搜索指定文本。"""
        for p_elem in root.iter(f"{{{NS_W}}}p"):
            for r_elem in p_elem.iter(f"{{{NS_W}}}r"):
                for t_elem in r_elem.iter(f"{{{NS_W}}}t"):
                    if t_elem.text and text in t_elem.text:
                        results.append((xml_path, r_elem, t_elem))

    def _extract_blocks(
        self, root: ET.Element, xml_path: str
    ) -> List[WordTextBlock]:
        """从 XML 树中提取文本块。"""
        blocks: List[WordTextBlock] = []

        for p_elem in root.iter(f"{{{NS_W}}}p"):
            texts: List[str] = []
            for t_elem in p_elem.iter(f"{{{NS_W}}}t"):
                if t_elem.text:
                    texts.append(t_elem.text)

            full_text = "".join(texts).strip()
            if not full_text or len(full_text) < 2:
                continue

            # 确定元素类型
            elem_type = self._determine_type(xml_path)

            blocks.append(
                WordTextBlock(
                    element_type=elem_type,
                    text=full_text,
                    xml_path=xml_path,
                    location=xml_path.replace("word/", ""),
                    confidence=0.5,
                )
            )

        return blocks

    @staticmethod
    def _determine_type(xml_path: str) -> str:
        """根据 XML 路径确定元素类型。"""
        name = xml_path.lower()
        if "header" in name:
            return "header"
        if "footer" in name:
            return "footer"
        if "document" in name:
            return "paragraph"
        return "paragraph"

    @staticmethod
    def get_same_as_previous_info(
        docx_path: str,
    ) -> Dict[str, bool]:
        """检查 Header/Footer 的 Same As Previous 状态。

        Args:
            docx_path: DOCX 文件路径。

        Returns:
            {xml_path: True/False} 映射。
        """
        result: Dict[str, bool] = {}

        try:
            with zipfile.ZipFile(docx_path, "r") as zf:
                # 读取 document.xml 中的 headerReference/footerReference
                if "word/document.xml" in zf.namelist():
                    content = zf.read("word/document.xml")
                    root = ET.fromstring(content)

                    # 检查 sectPr 中的 headerReference
                    for sect_pr in root.iter(f"{{{NS_W}}}sectPr"):
                        for ref in sect_pr.iter(f"{{{NS_W}}}headerReference"):
                            ref_id = ref.get(f"{{{NS_W}}}id", "")
                            if ref_id:
                                result[ref_id] = False
                        for ref in sect_pr.iter(f"{{{NS_W}}}footerReference"):
                            ref_id = ref.get(f"{{{NS_W}}}id", "")
                            if ref_id:
                                result[ref_id] = False
        except Exception:
            pass

        return result
