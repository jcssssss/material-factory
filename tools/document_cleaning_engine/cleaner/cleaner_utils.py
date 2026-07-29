"""Cleaner 工具函数。

提供 PyMuPDF 验证工具函数。
"""

from __future__ import annotations

import fitz


def verify_annotation_count(fitz_path: str) -> int:
    """使用 PyMuPDF 验证 PDF 中的 Annotation 数量。

    Args:
        fitz_path: PDF 文件路径。

    Returns:
        Annotation 总数。
    """
    count = 0
    doc = fitz.open(fitz_path)
    try:
        for page in doc:
            annots = page.annots()
            if annots:
                count += sum(1 for _ in annots)
    finally:
        doc.close()
    return count


def verify_page_count(fitz_path: str) -> int:
    """使用 PyMuPDF 验证 PDF 页数。

    Args:
        fitz_path: PDF 文件路径。

    Returns:
        总页数。
    """
    doc = fitz.open(fitz_path)
    try:
        return doc.page_count
    finally:
        doc.close()
