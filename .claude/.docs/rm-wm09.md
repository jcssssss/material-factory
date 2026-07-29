# MF-001 文档清理引擎

# Claude Code 开发任务 Task-009

# Word 文档分析与清理基础模块（Word Analyzer & Cleaning Framework）

---

# 1. Task目标

建立 Word 文档清理基础框架，实现：

1. DOCX 文件类型识别；
2. Word 文档结构解析；
3. Section 遍历；
4. Header/Footer 元素扫描；
5. Word 清理任务基础模型；
6. 为后续水印、Shape、DrawingML删除任务提供基础能力。

---

本任务负责：

✅ DOCX结构解析
✅ Section分析
✅ Header/Footer遍历
✅ XML结构访问能力
✅ 清理Action生成框架

---

本任务不负责：

❌ 具体文字水印删除
❌ Shape删除
❌ 图片水印删除
❌ DrawingML删除
❌ DOC格式处理

（以上进入 Task-010、Task-011）

---

# 2. 当前任务上下文

当前系统：

```text
Document Cleaning Engine

        |

        +-- PDF Pipeline

        |

        +-- Word Pipeline
```

PDF部分：

已完成：

```
Task-005 Annotation/Artifact

Task-006 Image Watermark

Task-007 Text Watermark

Task-008 Header/Footer
```

Word部分：

开始建设：

```
Task-009
Word基础解析框架
```

---

# 3. 技术原则

Word处理采用：

> python-docx负责高层结构，lxml负责底层XML。

原因：

python-docx：

优势：

* API稳定；
* 易读取文档结构；
* 适合普通文本。

限制：

无法完整处理：

* Shape；
* TextBox；
* DrawingML；
* 部分水印对象。

因此：

采用双层方案：

```
python-docx

    |

    +-- 普通结构


lxml

    |

    +-- XML深度处理

```

---

# 4. 技术栈

## Word解析

使用：

```text
python-docx
```

---

## XML处理

使用：

```text
lxml
```

---

## 文件操作

使用：

```text
zipfile
```

---

## 数据模型

Python dataclass：

```text
dataclasses
```

---

# 5. 文件结构

新增：

```
document_cleaning_engine/


├── word/

│
├── analyzer/

│   ├── word_analyzer.py
│   ├── section_analyzer.py
│
├── detector/

│   └── word_detector.py
│
├── cleaner/

│   └── word_cleaner.py
│
├── models/

│   ├── word_document.py
│   └── word_element.py
│
└── tests/

    ├── test_word_analyzer.py

```

---

# 6. WordDocument模型

文件：

```
models/word_document.py
```

---

实现：

```python
@dataclass
class WordDocument:
```

---

字段：

```python
file_path:str

paragraph_count:int

section_count:int

header_count:int

footer_count:int

has_shapes:bool

has_drawing:bool

metadata:dict
```

---

用途：

保存：

Word文档分析结果。

---

# 7. WordElement模型

文件：

```
models/word_element.py
```

---

实现：

```python
@dataclass
class WordElement:
```

---

字段：

```python
element_type:str

location:str

content:str|None

xml_path:str|None

confidence:float

metadata:dict
```

---

element_type：

支持：

```text
paragraph

header

footer

shape

picture

drawing

textbox

```

---

# 8. WordAnalyzer

文件：

```
analyzer/word_analyzer.py
```

---

实现：

```python
class WordAnalyzer:
```

---

入口：

```python
def analyze(
    self,
    docx_path:str
)->WordDocument:
```

---

流程：

```
输入DOCX

↓

打开document

↓

统计基础信息

↓

解析Section

↓

扫描XML结构

↓

输出WordDocument

```

---

# 9. DOCX加载

使用：

```python
from docx import Document
```

---

示例：

```python
doc = Document(path)
```

---

读取：

```python
doc.paragraphs

doc.sections
```

---

统计：

段落数量：

```python
len(doc.paragraphs)
```

---

Section数量：

```python
len(doc.sections)
```

---

# 10. Section分析

文件：

```
analyzer/section_analyzer.py
```

---

实现：

```python
class SectionAnalyzer:
```

---

入口：

```python
def analyze(
    self,
    document
)->list:
```

---

遍历：

```python
for section in document.sections:
```

---

获取：

Header：

```python
section.header
```

Footer：

```python
section.footer
```

---

记录：

```text
section_index

header_exists

footer_exists

different_first_page

different_odd_even

```

---

# 11. Header/Footer扫描

扫描：

```
Section

↓

Header/Footer

↓

Paragraph

```

---

提取：

```python
paragraph.text
```

---

生成：

WordElement：

例如：

```python
WordElement(

element_type="header",

content="内部资料"

)
```

---

# 12. Same As Previous处理

Word支持：

```
Same as Previous
```

---

含义：

多个Section共享：

同一个Header/Footer。

---

V1策略：

记录引用关系。

不复制内容。

数据：

```python
metadata={

"linked_previous":True

}

```

---

原因：

避免重复删除。

---

# 13. XML扫描框架

DOCX本质：

ZIP文件。

结构：

```
xxx.docx

 |

 + word/

      |

      + document.xml

      + header1.xml

      + footer1.xml

      + media/

```

---

使用：

```python
zipfile.ZipFile
```

---

扫描：

```text
word/document.xml

word/header*.xml

word/footer*.xml

```

---

# 14. XML节点检测

使用：

```python
lxml.etree
```

---

命名空间：

```python
w:
http://schemas.openxmlformats.org/wordprocessingml/2006/main
```

---

基础检测：

寻找：

```xml
<w:drawing>
```

---

记录：

```python
has_drawing=True
```

---

寻找：

```xml
<w:pict>
```

---

记录：

```python
has_shapes=True
```

---

# 15. Word Detector基础接口

文件：

```
detector/word_detector.py
```

---

实现：

```python
class WordDetector:
```

---

入口：

```python
def detect(
    self,
    docx_path:str
)->list[DetectionResult]:
```

---

V1当前：

只负责：

基础扫描。

---

输出：

```python
DetectionResult(

type="word_element",

content="",

confidence=0,

metadata={}

)

```

---

后续：

Task-010：

文字水印检测。

Task-011：

Shape/Drawing检测。

---

# 16. Word Cleaner基础接口

文件：

```
cleaner/word_cleaner.py
```

---

实现：

```python
class WordCleaner:
```

---

入口：

```python
def clean(
    self,
    docx_path,
    cleaning_plan
)->CleaningResult:
```

---

当前：

只建立框架。

暂不执行删除。

---

返回：

```python
CleaningResult(

status="NOT_IMPLEMENTED",

metadata={}

)
```

---

# 17. 异常处理

必须支持：

## 文件损坏

检测：

```python
Document(path)
```

异常。

返回：

```text
FAILED

reason:
INVALID_DOCX
```

---

## 非DOCX

例如：

doc。

返回：

```text
UNSUPPORTED_FORMAT
```

---

## 加密Word

无法打开。

返回：

```text
ENCRYPTED_DOCUMENT
```

---

# 18. 单元测试

文件：

```
tests/test_word_analyzer.py
```

---

## Case 1 普通DOCX

输入：

普通文档。

验证：

```
section_count >0

paragraph_count >0

```

---

## Case 2 多Section

包含：

两个Section。

验证：

```
section_count=2

```

---

## Case 3 Header/Footer

包含：

页眉：

测试文字。

验证：

检测：

```
header_count=1

```

---

## Case 4 Drawing

包含：

图片。

验证：

```
has_drawing=True

```

---

# 19. 验收标准

## 分析能力

必须完成：

✅ DOCX读取
✅ Section解析
✅ Header/Footer扫描
✅ XML扫描
✅ Drawing检测

---

## 架构要求

必须保证：

* python-docx与lxml分层；
* 不修改原文件；
* 输出统一模型；
* 后续Task可直接扩展。

---

# 20. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Word解析架构说明；
3. python-docx/lxml分工说明；
4. 数据模型说明；
5. 测试结果；
6. 当前限制。

---

# 21. 禁止事项

本任务禁止：

❌ 删除Word内容
❌ 修改XML节点
❌ 删除Header/Footer
❌ 删除Shape
❌ 删除图片
❌ 处理DOC格式

---

# Task-009完成标志

达到：

> 系统具备稳定的 DOCX 文档结构分析能力，能够识别 Section、Header/Footer、Drawing 等结构，为后续 Word 水印清理功能提供统一基础框架。

---

下一任务：

# Task-010：Word文字水印检测与删除模块

实现：

* Word文字水印识别；
* Header/Footer文本删除；
* 水印文本定位；
* XML节点安全删除；
* 多Section处理；
* Same as Previous兼容。
