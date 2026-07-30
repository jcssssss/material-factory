"""测试 fixtures：生成各类检测用 PDF。"""

from __future__ import annotations

import os
import tempfile
from typing import Generator

import fitz
import pytest


# ── Task-002 fixtures ─────────────────────────────────────────────────


@pytest.fixture
def text_pdf_path() -> Generator[str, None, None]:
    """生成纯文本 PDF（10 页，每页均有文本内容，无图片）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        for i in range(10):
            page = doc.new_page()
            page.insert_text(
                (50, 100),
                f"这是文本页面第 {i + 1} 页。本页包含纯文本内容，没有嵌入图片。",
                fontsize=12,
            )
        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def scan_pdf_path() -> Generator[str, None, None]:
    """生成扫描 PDF（10 页，每页包含图片，无文本内容）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 300))
        pix.clear_with()
        for _ in range(10):
            page = doc.new_page()
            page.insert_image(page.rect, pixmap=pix)
        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def mixed_pdf_path() -> Generator[str, None, None]:
    """生成混合 PDF（10 页：前 3 页文本，后 7 页图片）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        # 前 3 页文本
        for i in range(3):
            page = doc.new_page()
            page.insert_text(
                (50, 100),
                f"这是目录/文本页 {i + 1}，包含纯文本内容。",
                fontsize=12,
            )

        # 后 7 页图片
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 300))
        pix.clear_with()
        for _ in range(7):
            page = doc.new_page()
            page.insert_image(page.rect, pixmap=pix)

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def encrypted_pdf_path() -> Generator[str, None, None]:
    """生成加密 PDF（密码保护，无法读取内容）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        page = doc.new_page()
        page.insert_text((50, 100), "这是加密文档的内容。", fontsize=12)
        doc.save(
            path,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            user_pw="test_password",
            owner_pw="test_password",
        )
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def empty_pdf_path() -> Generator[str, None, None]:
    """生成内容为空的 PDF（1 页，无文本无图片）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        doc.new_page()  # 1 页空白页
        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def invalid_pdf_path() -> Generator[str, None, None]:
    """生成无效 PDF（非 PDF 格式的文本文件）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    with open(path, "w") as f:
        f.write("这不是一个有效的 PDF 文件内容。")

    yield path
    os.unlink(path)


# ── Task-003 fixtures ─────────────────────────────────────────────────


@pytest.fixture
def annotation_pdf_path() -> Generator[str, None, None]:
    """生成带 Annotation 的 PDF（文本批注 + 高亮 + 印章）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        page = doc.new_page()
        page.insert_text((50, 50), "Normal content", fontsize=12)

        # Text annotation
        annot = page.add_text_annot((100, 100), "Text annotation test")
        annot.update()

        # Highlight annotation
        annot2 = page.add_highlight_annot(fitz.Rect(50, 50, 150, 100))
        annot2.update()

        # Stamp annotation
        annot3 = page.add_stamp_annot(fitz.Rect(200, 200, 300, 300))
        annot3.update()

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def artifact_pdf_path() -> Generator[str, None, None]:
    """生成带 Artifact Watermark 的 PDF（通过 Content Stream 注入）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        page = doc.new_page()
        page.insert_text((50, 50), "Normal content", fontsize=12)

        # Inject /Artifact <</Subtype /Watermark>> into content stream
        xrefs = page.get_contents()
        if xrefs:
            xref = xrefs[0]
            orig = doc.xref_stream(xref) or b""
            artifact = b"""
/Artifact <</Subtype /Watermark>>
BDC
q
0.5 g
BT
/F1 48 Tf
200 400 Td
(Confidential) Tj
ET
Q
EMC
"""
            doc.update_stream(xref, orig + artifact)

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def image_logo_pdf_path() -> Generator[str, None, None]:
    """生成多页重复 Logo 图片的 PDF（模拟图片水印）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        # 创建较大图片模拟水印
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 80))
        pix.clear_with()

        for _ in range(5):
            page = doc.new_page()
            # 图片位于页面中央区域
            page.insert_image(fitz.Rect(200, 350, 400, 430), pixmap=pix)
            page.insert_text(
                (50, 100), "Normal page content here", fontsize=11
            )

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def text_watermark_pdf_path() -> Generator[str, None, None]:
    """生成多页重复文本水印的 PDF（中央"Confidential"水印）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        for i in range(5):
            page = doc.new_page()
            # 中央水印文本
            page.insert_text((150, 420), "Confidential", fontsize=48)
            # 正常内容
            page.insert_text(
                (50, 100),
                f"This is normal content on page {i+1}.",
                fontsize=11,
            )

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def header_pdf_path() -> Generator[str, None, None]:
    """生成带页眉的 PDF（每页顶部固定文本）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        for i in range(5):
            page = doc.new_page()
            # 页眉（顶部区域 0-15%）
            page.insert_text((20, 30), "Monthly Report 2024", fontsize=10)
            # 正文
            page.insert_text(
                (50, 200),
                f"This is the main body content on page {i+1}. "
                "It contains the actual document text that users "
                "are supposed to read.",
                fontsize=11,
            )

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)


@pytest.fixture
def footer_pdf_path() -> Generator[str, None, None]:
    """生成带页脚的 PDF（每页底部固定文本，模拟真实页脚场景）。"""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)

    doc = fitz.open()
    try:
        for i in range(5):
            page = doc.new_page()
            # 正文
            page.insert_text(
                (50, 200),
                f"This is the main body content on page {i+1}.",
                fontsize=11,
            )
            # 页脚（底部区域 82-100%），每页相同内容
            page.insert_text((200, 810), "Confidential - Page Footer", fontsize=9)

        doc.save(path)
        yield path
    finally:
        doc.close()
        os.unlink(path)
