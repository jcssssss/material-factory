"""PDF Content Stream 解析器。

解析 PDF 页面内容流中的操作符，支持文本操作符的定位与删除。
使用 token 逐词解析，不依赖复杂正则。
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple


# 操作符识别（PDF 操作符是以字母开头的关键字）
OP_RE = re.compile(rb"^[a-zA-Z_*'\"][a-zA-Z0-9_*'\"]*$")

# 十六进制字符串
HEX_STRING_RE = re.compile(rb"^<([0-9a-fA-F\s]+)>$")


class PDFOperator:
    """PDF Content Stream 操作符。"""

    def __init__(self, operator: str, operands: List[bytes]) -> None:
        self.operator = operator
        self.operands = operands

    def __repr__(self) -> str:
        return f"PDFOp({self.operator}, {self.operands})"


class TextBlockInstruction:
    """BT...ET 文本块指令。"""

    def __init__(self) -> None:
        self.ops: List[PDFOperator] = []
        self.tm: Optional[Tuple[float, float, float, float, float, float]] = None
        self.tlm: Optional[Tuple[float, float, float, float, float, float]] = None

    @property
    def origin(self) -> Optional[Tuple[float, float]]:
        if self.tm:
            return (self.tm[4], self.tm[5])
        return None

    def has_text_ops(self) -> bool:
        for op in self.ops:
            if op.operator in ("Tj", "TJ", "'", '"'):
                return True
        return False

    def extract_text(self) -> str:
        texts: List[str] = []
        for op in self.ops:
            if op.operator == "Tj" and op.operands:
                texts.append(_decode_pdf_string(op.operands[0]))
            elif op.operator == "TJ" and op.operands:
                texts.extend(_decode_tj_array(op.operands[0]))
        return "".join(texts)


class ContentStreamParser:
    """PDF Content Stream 解析器。"""

    def parse(self, content: bytes) -> List[PDFOperator]:
        """解析内容流为操作符列表。"""
        tokens = self._tokenize(content)
        ops: List[PDFOperator] = []
        i = 0

        while i < len(tokens):
            token = tokens[i]

            # 跳过注释
            if token == b"%" and i + 1 < len(tokens):
                # 跳过到行尾
                while i < len(tokens) and tokens[i] != b"\n":
                    i += 1
                i += 1
                continue

            # 检查是否为操作符
            if OP_RE.match(token):
                operator = token.decode("latin-1")
                ops.append(PDFOperator(operator, []))
                i += 1
            else:
                # 收集操作数直到遇到操作符
                operands: List[bytes] = [token]
                i += 1

                while i < len(tokens):
                    if OP_RE.match(tokens[i]):
                        break
                    operands.append(tokens[i])
                    i += 1

                if i < len(tokens):
                    operator = tokens[i].decode("latin-1")
                    ops.append(PDFOperator(operator, operands))
                    i += 1

        return ops

    def _tokenize(self, content: bytes) -> List[bytes]:
        """将内容流拆分为 token。"""
        tokens: List[bytes] = []
        i = 0
        n = len(content)

        while i < n:
            b = content[i : i + 1]

            # 跳过空白
            if b in (b" ", b"\n", b"\r", b"\t", b"\x00", b"\f"):
                i += 1
                continue

            # 注释
            if b == b"%":
                while i < n and content[i : i + 1] != b"\n":
                    i += 1
                continue

            # 字符串 (...)
            if b == b"(":
                depth = 1
                start = i
                i += 1
                while i < n and depth > 0:
                    c = content[i : i + 1]
                    if c == b"\\":
                        i += 2  # 转义字符
                        continue
                    if c == b"(":
                        depth += 1
                    elif c == b")":
                        depth -= 1
                    i += 1
                tokens.append(content[start:i])
                continue

            # 十六进制字符串 <...>
            if b == b"<":
                start = i
                i += 1
                while i < n and content[i : i + 1] != b">":
                    i += 1
                if i < n:
                    i += 1  # 跳过 >
                tokens.append(content[start:i])
                continue

            # 数组 [...]
            if b == b"[":
                start = i
                depth = 1
                i += 1
                while i < n and depth > 0:
                    c = content[i : i + 1]
                    if c == b"[":
                        depth += 1
                    elif c == b"]":
                        depth -= 1
                    elif c == b"(":
                        # 字符串内的括号不算
                        while i < n and content[i : i + 1] != b")":
                            if content[i : i + 1] == b"\\":
                                i += 1
                            i += 1
                    i += 1
                tokens.append(content[start:i])
                continue

            # 名称 /Name
            if b == b"/":
                start = i
                i += 1
                while i < n and content[i : i + 1] not in (
                    b" ", b"\n", b"\r", b"\t", b"[", b"]",
                    b"(", b")", b"<", b">", b"/",
                    b"\x00", b"\f",
                ):
                    i += 1
                tokens.append(content[start:i])
                continue

            # 字母序列（操作符关键字）
            if b.isalpha() or b == b"*" or b == b"'":
                start = i
                i += 1
                while i < n and (
                    content[i : i + 1].isalpha()
                    or content[i : i + 1] in (b"*", b"'", b'"')
                ):
                    i += 1
                tokens.append(content[start:i])
                continue

            # 数字：包含数字、小数点、正负号
            if b.isdigit() or b in (b"-", b"+", b"."):
                start = i
                i += 1
                while i < n and (
                    content[i : i + 1].isdigit()
                    or content[i : i + 1] in (b".", b"-", b"+", b"e", b"E")
                ):
                    i += 1
                tokens.append(content[start:i])
                continue

            # 单个字符 token
            tokens.append(b)
            i += 1

        return tokens

    def find_text_blocks(self, ops: List[PDFOperator]) -> List[TextBlockInstruction]:
        """从操作符列表中提取文本块 (BT...ET)。"""
        blocks: List[TextBlockInstruction] = []
        current = None

        for op in ops:
            if op.operator == "BT":
                current = TextBlockInstruction()
            elif op.operator == "ET" and current is not None:
                if current.has_text_ops():
                    blocks.append(current)
                current = None
            elif current is not None:
                current.ops.append(op)
                if op.operator == "Tm" and len(op.operands) >= 6:
                    current.tm = _parse_tm(op.operands)
                elif op.operator == "Td" and len(op.operands) >= 2:
                    tx = _parse_float(op.operands[0])
                    ty = _parse_float(op.operands[1])
                    if current.tm:
                        a, b, c, d, e, f = current.tm
                        current.tm = (a, b, c, d, e + tx, f + ty)
                    else:
                        current.tm = (1, 0, 0, 1, tx, ty)
                    current.tlm = current.tm

        if current is not None and current.has_text_ops():
            blocks.append(current)

        return blocks

    def serialize(self, ops: List[PDFOperator]) -> bytes:
        """将操作符列表序列化为内容流。"""
        result = b""
        for op in ops:
            line = b""
            for operand in op.operands:
                line += operand + b" "
            line += op.operator.encode("latin-1") + b"\n"
            result += line
        return result

    @staticmethod
    def remove_text_op(
        ops: List[PDFOperator],
        target_tm: Tuple[float, float, float, float, float, float],
    ) -> int:
        """从操作符列表中移除匹配指定 Tm 的文本操作。"""
        removed = 0
        i = 0
        while i < len(ops):
            op = ops[i]
            if op.operator in ("Tj", "TJ", "'", '"'):
                if _matches_tm(ops, i, target_tm):
                    ops.pop(i)
                    removed += 1
                    continue
            i += 1
        return removed


def _parse_tm(operands):
    a = _parse_float(operands[0]) if len(operands) > 0 else 1.0
    b = _parse_float(operands[1]) if len(operands) > 1 else 0.0
    c = _parse_float(operands[2]) if len(operands) > 2 else 0.0
    d = _parse_float(operands[3]) if len(operands) > 3 else 1.0
    e = _parse_float(operands[4]) if len(operands) > 4 else 0.0
    f = _parse_float(operands[5]) if len(operands) > 5 else 0.0
    return (a, b, c, d, e, f)


def _parse_float(data: bytes) -> float:
    try:
        return float(data.decode("latin-1").strip())
    except (ValueError, UnicodeDecodeError):
        return 0.0


def _decode_pdf_string(data: bytes) -> str:
    """解码 PDF 字符串（普通或十六进制）。"""
    if data.startswith(b"(") and data.endswith(b")"):
        return data[1:-1].decode("latin-1", errors="replace")
    if data.startswith(b"<") and data.endswith(b">"):
        hex_str = data[1:-1].strip()
        try:
            hex_clean = hex_str.replace(b" ", b"").replace(b"\n", b"")
            return bytes.fromhex(hex_clean.decode()).decode("utf-16-be", errors="replace")
        except Exception:
            return hex_str.decode("latin-1", errors="replace")
    return data.decode("latin-1", errors="replace")


def _decode_tj_array(data: bytes) -> List[str]:
    """解码 TJ 数组中的字符串。"""
    texts: List[str] = []
    s = data
    # 选取字符串 (\...) 和十六进制字符串 <...>
    for m in re.finditer(rb"\(([^)]*)\)|<([0-9a-fA-F\s]+)>", s):
        if m.group(1) is not None:
            texts.append(m.group(1).decode("latin-1", errors="replace"))
        elif m.group(2) is not None:
            try:
                hex_clean = m.group(2).replace(b" ", b"").replace(b"\n", b"")
                texts.append(bytes.fromhex(hex_clean.decode()).decode("utf-16-be", errors="replace"))
            except Exception:
                texts.append(m.group(2).decode("latin-1", errors="replace"))
    return texts


def _matches_tm(ops, op_idx, target_tm):
    """检查操作符是否在目标 Tm 上下文中。"""
    tolerance = 2.0
    tx, ty = target_tm[4], target_tm[5]

    for j in range(op_idx - 1, -1, -1):
        prev = ops[j]
        if prev.operator == "Tm" and len(prev.operands) >= 6:
            tm = _parse_tm(prev.operands)
            if abs(tm[4] - tx) <= tolerance and abs(tm[5] - ty) <= tolerance:
                return True
            return False
        elif prev.operator in ("BT", "ET"):
            return False
    return False
