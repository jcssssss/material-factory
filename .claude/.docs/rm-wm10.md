# MF-001 文档清理引擎

# Claude Code 开发任务 Task-010

# Word 文字水印检测与删除模块（Word Text Watermark Detector & Cleaner）

---

# 1. Task目标

实现 DOCX 文档中文字型水印、页眉页脚文本标识的检测与安全删除能力。

本任务负责：

1. 检测 Word 中的文字水印；
2. 检测 Header/Footer 中的重复文本；
3. 判断文本是否属于非主体内容；
4. 生成 CleaningAction；
5. 通过 XML 层安全删除目标文本；
6. 支持多 Section 和 Same As Previous。

---

本任务处理：

✅ Word文字水印
✅ Header文本水印
✅ Footer文本水印
✅ 内部资料标识
✅ Copyright标识
✅ Confidential/Draft标识

---

本任务不处理：

❌ Word Shape水印
❌ TextBox水印
❌ 图片水印
❌ DrawingML图片对象
❌ 浮动对象删除

（进入 Task-011）

---

# 2. 当前任务上下文

Word Pipeline：

```text
DOCX

↓

WordAnalyzer

↓

WordDetector

↓

Risk Engine

↓

CleaningPlan

↓

WordCleaner

↓

Validator
```

---

已完成：

| 任务       | 能力         |
| -------- | ---------- |
| Task-009 | Word基础解析框架 |

---

Task-010新增：

```text
WordTextDetector

+

WordTextCleaner
```

---

# 3. 技术原则

核心原则：

> Word文本删除优先修改XML节点，不进行文档重建。

原因：

避免：

* 样式丢失；
* Section异常；
* 格式变化。

---

删除优先级：

```text
高置信

↓

直接删除XML文本节点


低置信

↓

生成人工确认Action

```

---

# 4. 技术栈

Word解析：

```text
python-docx
```

---

XML修改：

```text
lxml
```

---

DOCX操作：

```text
zipfile
```

---

# 5. 文件结构

新增：

```text
document_cleaning_engine/


├── detector/

│   └── word_text_detector.py


├── cleaner/

│   ├── word_text_cleaner.py
│
├── matcher/

│   └── word_text_matcher.py
│
├── models/

│   └── word_text_block.py
│
└── tests/

    ├── test_word_text_detector.py

    └── test_word_text_cleaner.py

```

---

# 6. WordTextBlock模型

文件：

```text
models/word_text_block.py
```

---

实现：

```python
@dataclass
class WordTextBlock:
```

---

字段：

```python
element_type:str

text:str

xml_path:str

section_index:int | None

location:str

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

watermark
```

---

location：

例如：

```text
document.xml

header1.xml

footer1.xml
```

---

# 7. WordTextDetector

文件：

```text
detector/word_text_detector.py
```

---

实现：

```python
class WordTextDetector:
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

流程：

```text
DOCX

↓

读取XML

↓

提取文本节点

↓

关键词匹配

↓

重复分析

↓

风险评分

↓

DetectionResult

```

---

# 8. DOCX XML文本结构

普通文本：

```xml
<w:p>

    <w:r>

        <w:t>
        内部资料
        </w:t>

    </w:r>

</w:p>
```

---

检测目标：

```xml
<w:t>
```

---

路径：

```text
word/document.xml

word/header*.xml

word/footer*.xml

```

---

# 9. 文本提取规则

使用：

```python
lxml.etree
```

---

XPath：

```python
//w:t
```

---

提取：

```text
文本内容

XML文件位置

父节点路径

```

---

示例：

输出：

```python
WordTextBlock(

text="内部资料",

location="header1.xml"

)
```

---

# 10. 水印关键词检测

建立：

```python
WORD_WATERMARK_KEYWORDS
```

---

初始词库：

```text
内部资料

内部文件

禁止传播

机密

Confidential

Draft

Sample

Preview

Copyright

版权所有

```

---

评分：

命中：

+40分

---

# 11. Header/Footer判断

重点扫描：

```text
header*.xml

footer*.xml
```

---

规则：

Header/Footer天然具有：

高风险概率。

---

评分：

增加：

30分。

---

示例：

```
header1.xml

文本:

内部资料

```

评分：

70。

---

# 12. 重复文本分析

目的：

判断：

> 是否多个页面重复出现。

---

Word特点：

没有PDF页面概念。

因此：

采用：

结构重复判断。

---

规则：

同一文本：

存在于：

多个Header/Footer XML。

例如：

```text
header1.xml

header2.xml

header3.xml
```

---

计算：

```python
repeat_rate =
出现section数量 / section总数
```

---

# 13. 风险评分模型

总分：

100。

---

## 关键词匹配

40分。

---

## Header/Footer位置

30分。

---

## 重复率

20分。

---

## 文本长度异常

10分。

---

公式：

```text
score=

keyword

+

location

+

repeat

+

length

```

---

转换：

```python
confidence=score/100
```

---

# 14. DetectionResult输出

示例：

```python
DetectionResult(

type="word_text",

content="内部资料",

confidence=0.95,

metadata={

"xml":"header1.xml",

"section":1

}

)
```

---

# 15. WordTextCleaner

文件：

```text
cleaner/word_text_cleaner.py
```

---

实现：

```python
class WordTextCleaner:
```

---

入口：

```python
def clean(
    self,
    docx_path,
    action
)->CleaningResult:
```

---

流程：

```text
CleaningAction

↓

定位XML节点

↓

删除<w:t>

↓

清理空<w:r>

↓

保存DOCX

↓

验证

```

---

# 16. XML删除策略

## 普通文本

原：

```xml
<w:r>

<w:t>
内部资料
</w:t>

</w:r>
```

---

删除：

```xml
<w:t>
```

---

结果：

```xml
<w:r/>

```

---

后处理：

删除空节点。

---

# 17. Header/Footer删除

流程：

```text
header1.xml

↓

定位<w:t>

↓

删除目标节点

↓

保存XML

```

---

支持：

```text
header1.xml

header2.xml

footer1.xml

```

---

---

# 18. Same As Previous处理

Word：

多个Section可能共享Header。

例如：

```
Section1

 |

Header1


Section2

 |

same header
```

---

处理策略：

删除：

实际XML源。

不要：

重复操作。

---

检测：

通过：

```xml
<w:headerReference>
```

判断。

---

# 19. 删除失败策略

## 情况1

XML节点不存在

返回：

```text
FAILED

reason:
NODE_NOT_FOUND
```

---

## 情况2

文本匹配多个位置

例如：

正文和Header都有：

"Copyright"

处理：

```text
CONFIRM
```

---

## 情况3

XML结构异常

返回：

```text
FAILED

reason:
INVALID_XML
```

---

# 20. 单元测试

## test_word_text_detector.py

---

### Case 1 Header水印

输入：

Header：

```
内部资料
```

---

期望：

```text
type=header

confidence>0.8
```

---

### Case 2 正文关键词

正文：

```
版权所有
```

只出现一次。

期望：

IGNORE。

---

### Case 3 多Section共享Header

验证：

只生成一个Action。

---

# test_word_text_cleaner.py

---

### Case 4 删除Header文字

删除：

```
内部资料
```

---

验证：

XML不存在：

```xml
<w:t>
内部资料
</w:t>
```

---

### Case 5 删除失败

模拟：

不存在节点。

期望：

```text
FAILED
```

---

# 21. 验收标准

## 检测

必须完成：

✅ XML文本读取
✅ Header/Footer扫描
✅ 关键词匹配
✅ 重复分析
✅ 风险评分

---

## 删除

必须完成：

✅ XML节点删除
✅ 空节点清理
✅ 多Section兼容
✅ Same As Previous兼容

---

## 安全

保证：

| 项目          | 要求 |
| ----------- | -- |
| 文档可打开       | 必须 |
| 格式不破坏       | 必须 |
| Section数量不变 | 必须 |
| 正文不误删       | 必须 |

---

# 22. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Word XML解析方案；
3. 文本检测规则；
4. 删除策略说明；
5. 测试结果；
6. 当前限制。

---

# 23. 禁止事项

本任务禁止：

❌ 删除Shape
❌ 删除图片
❌ 修改DrawingML
❌ 重建DOCX
❌ 删除正文相同关键词
❌ 使用Word转PDF后处理

---

# Task-010完成标志

达到：

> 系统能够检测 DOCX 中高置信度文字水印及页眉页脚文本，并通过 XML 节点级删除方式安全清理，同时保持 Word 文档结构稳定。

---

下一任务：

# Task-011：Word Shape / TextBox / DrawingML 水印清理模块

实现：

* Shape对象检测；
* TextBox检测；
* DrawingML节点分析；
* 图片水印删除；
* VML水印删除；
* XML安全移除策略。
