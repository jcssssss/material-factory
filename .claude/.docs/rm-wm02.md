# MF-001 文档清理引擎

# Claude Code 开发任务 Task-002

## PDF 文档分析模块（PDF Analyzer）

---

# 1. Task目标

实现 PDF 文档基础分析能力。

本任务负责：

1. 判断 PDF 类型；
2. 获取 PDF 基础信息；
3. 建立 PDF 分析结果模型；
4. 为后续 Detector 模块提供统一输入。

---

本任务**不实现：**

* 水印检测；
* 页眉页脚检测；
* PDF删除；
* Content Stream修改。

---

# 2. 当前任务上下文

文档清理流程：

```text
PDF文件

↓

Task-002 PDF Analyzer

↓

Detection模块

↓

Risk Engine

↓

Cleaner
```

Task-002负责回答：

> “这个PDF是什么类型？是否可以进入结构化清理流程？”

---

# 3. 技术约束

## 必须使用

Python：

```
3.11+
```

PDF解析库：

```
PyMuPDF (fitz)
```

---

原因：

* 成熟稳定；
* 支持文本对象读取；
* 支持图片对象读取；
* 后续文本水印检测依赖；
* 性能满足桌面应用需求。

---

禁止：

❌ 自研PDF解析器
❌ 使用OCR判断PDF类型
❌ 使用图像识别替代结构分析

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/

├── analyzer/

│   ├── __init__.py
│   ├── pdf_analyzer.py
│   └── document_info.py

└── tests/

    └── test_pdf_analyzer.py
```

---

# 5. 创建 PDFDocumentInfo 数据模型

文件：

```
analyzer/document_info.py
```

---

实现：

```python
class PDFDocumentInfo:
```

---

字段：

```python
file_path: str

page_count: int

pdf_type: str

is_encrypted: bool

has_text: bool

has_images: bool

metadata: dict
```

---

# 字段说明

| 字段           | 说明     |
| ------------ | ------ |
| file_path    | 文件路径   |
| page_count   | PDF页数  |
| pdf_type     | PDF类型  |
| is_encrypted | 是否加密   |
| has_text     | 是否包含文本 |
| has_images   | 是否包含图片 |
| metadata     | 扩展信息   |

---

# pdf_type枚举

固定：

```text
TEXT_PDF

SCAN_PDF

MIXED_PDF

ENCRYPTED_PDF

UNKNOWN
```

---

# 6. 实现 PDFAnalyzer

文件：

```
analyzer/pdf_analyzer.py
```

---

创建：

```python
class PDFAnalyzer:
```

---

入口方法：

```python
def analyze(
    self,
    file_path:str
)->PDFDocumentInfo:
```

---

流程：

```text
打开PDF

↓

检测加密

↓

统计页面内容

↓

判断PDF类型

↓

返回PDFDocumentInfo

```

---

# 7. PDF打开逻辑

使用：

```python
import fitz
```

---

示例：

```python
doc = fitz.open(file_path)
```

---

异常处理：

捕获：

```python
fitz.FileDataError
```

---

返回：

```text
UNKNOWN
```

并记录错误。

---

# 8. PDF加密检测

检测：

```python
doc.is_encrypted
```

---

如果：

```python
True
```

返回：

```text
ENCRYPTED_PDF
```

---

处理规则：

不尝试破解。

状态：

后续交由任务系统处理：

```
NEED_MANUAL_REVIEW
```

---

# 9. 页面内容统计

逐页分析：

```python
for page in doc:
```

---

统计：

## 文本数量

使用：

```python
page.get_text()
```

判断：

```python
len(text.strip())
```

---

## 图片数量

使用：

```python
page.get_images()
```

---

记录：

```python
text_pages

image_pages
```

---

# 10. PDF类型判断算法

## 10.1 TEXT_PDF

条件：

页面满足：

```
存在文本对象

+

文本占主要内容
```

---

例如：

```text
100页

100页都有文本

```

结果：

```
TEXT_PDF
```

---

# 10.2 SCAN_PDF

条件：

满足：

```
图片页面占比 >=90%

+

文本对象接近0
```

---

例如：

```text
100页

98页图片

2页文本

```

结果：

```
SCAN_PDF
```

---

# 10.3 MIXED_PDF

条件：

同时存在：

```
文本页面

+

图片页面
```

---

例如：

```text
第一页目录(Text)

后面扫描图片

```

结果：

```
MIXED_PDF
```

---

# 10.4 UNKNOWN

无法判断：

返回：

```
UNKNOWN
```

---

# 11. 分析结果示例

输入：

```
exam.pdf
```

输出：

```python
PDFDocumentInfo(
    file_path="exam.pdf",

    page_count=120,

    pdf_type="TEXT_PDF",

    is_encrypted=False,

    has_text=True,

    has_images=False,

    metadata={
        "text_pages":120,
        "image_pages":0
    }
)
```

---

# 12. 与后续模块接口要求

Task-002输出：

必须可以被 Detector 使用。

后续：

Task-003调用：

```python
analyzer.analyze(
    file
)
```

获取：

```python
PDFDocumentInfo
```

---

# 13. 单元测试要求

文件：

```
tests/test_pdf_analyzer.py
```

---

测试案例：

## Case 1：文本PDF

输入：

普通电子PDF。

期望：

```text
TEXT_PDF
```

---

## Case 2：扫描PDF

输入：

图片扫描PDF。

期望：

```text
SCAN_PDF
```

---

## Case 3：混合PDF

输入：

部分文本+部分图片。

期望：

```text
MIXED_PDF
```

---

## Case 4：加密PDF

输入：

密码保护PDF。

期望：

```text
ENCRYPTED_PDF
```

---

# 14. 验收标准

## 代码要求

✅ PDFAnalyzer类完成
✅ PDFDocumentInfo模型完成
✅ PyMuPDF调用正常
✅ 异常处理完成

---

## 测试要求

执行：

```bash
pytest tests/test_pdf_analyzer.py
```

结果：

```
PASS
```

---

# 15. Claude Code输出要求

完成后输出：

1. 修改文件列表；
2. PDFAnalyzer实现说明；
3. PDF类型判断规则；
4. 测试结果；
5. 已知限制。

---

# 16. 禁止事项

本任务禁止：

❌ 添加水印检测逻辑
❌ 添加图片相似度算法
❌ 添加OCR
❌ 修改PDF内容
❌ 实现Cleaner
❌ 引入数据库

---

# Task-002完成标志

达到：

> 系统能够可靠识别输入PDF属于文本型、扫描型、混合型或加密型，并为后续清理流程提供标准化分析结果。

---
