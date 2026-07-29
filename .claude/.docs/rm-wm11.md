# MF-001 文档清理引擎

# Claude Code 开发任务 Task-011

# Word Shape / TextBox / DrawingML 水印清理模块

（Word Object Watermark Detector & Cleaner）

---

# 1. Task目标

实现 DOCX 中**非文本对象型水印检测与删除能力**。

本任务解决 Word 中无法通过普通文本节点处理的水印类型：

* Shape 水印；
* TextBox 文本框水印；
* VML 水印；
* DrawingML 图片对象；
* 浮动图片水印。

---

本任务负责：

✅ Shape检测
✅ TextBox检测
✅ DrawingML检测
✅ 图片水印检测
✅ VML节点删除
✅ Drawing节点删除
✅ 生成CleaningAction
✅ 安全删除XML节点

---

本任务不处理：

❌ 图片内部内容擦除
❌ OCR识别图片文字
❌ 扫描PDF图片处理
❌ 复杂Word宏对象
❌ 加密DOCX破解

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
| Task-009 | Word结构分析   |
| Task-010 | Word文本水印清理 |

---

Task-011新增：

```text
WordObjectDetector

+

WordObjectCleaner
```

---

# 3. 技术原则

核心原则：

> 删除对象节点，不修改图片像素，不重建文档。

---

处理策略：

```text
检测对象

↓

判断是否水印

↓

生成Action

↓

删除XML节点

↓

验证DOCX结构
```

---

# 4. 技术方案

Word对象来源：

DOCX内部：

```text
xxx.docx

↓

ZIP

↓

word/

    document.xml

    header*.xml

    footer*.xml

    media/

```

---

对象主要存储：

## VML Shape

路径：

```text
word/header*.xml
word/footer*.xml
```

节点：

```xml
<w:pict>
```

---

## DrawingML

节点：

```xml
<w:drawing>
```

---

## 图片对象

关系：

```text
document.xml

↓

_rId

↓

media/imageX.png

```

---

# 5. 文件结构

新增：

```text
document_cleaning_engine/


├── detector/

│   ├── word_object_detector.py
│   ├── shape_detector.py
│   └── drawing_detector.py
│
├── cleaner/

│   ├── word_object_cleaner.py
│   ├── shape_cleaner.py
│   └── drawing_cleaner.py
│
├── models/

│   └── word_object.py
│
└── tests/

    ├── test_shape_detector.py
    ├── test_drawing_detector.py
    └── test_word_object_cleaner.py

```

---

# 6. WordObject模型

文件：

```text
models/word_object.py
```

---

实现：

```python
@dataclass
class WordObject:
```

---

字段：

```python
object_type:str

xml_file:str

xml_path:str

relation_id:str | None

content:str | None

bbox:tuple | None

confidence:float

metadata:dict
```

---

object_type：

支持：

```text
shape

textbox

drawing

picture

vml
```

---

# 7. WordObjectDetector

文件：

```text
detector/word_object_detector.py
```

---

实现：

```python
class WordObjectDetector:
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
读取DOCX ZIP

↓

扫描XML

↓

发现对象节点

↓

提取属性

↓

水印评分

↓

输出DetectionResult

```

---

# 8. XML扫描范围

必须扫描：

```text
word/document.xml

word/header*.xml

word/footer*.xml

word/_rels/*.rels

```

---

原因：

水印经常放在：

* 页眉；
* 页脚；
* Header Reference。

---

# 9. Shape检测

## 检测节点

VML：

```xml
<w:pict>
```

内部：

```xml
<v:shape>
```

---

XPath：

```python
//w:pict

//v:shape
```

---

提取：

```text
shape id

style

position

rotation

textpath

```

---

示例：

```xml
<v:shape
id="Watermark"
style="rotation:315"
/>
```

---

判断：

高概率水印。

---

# 10. TextBox检测

TextBox通常：

存在于：

```xml
<v:textbox>
```

---

检测：

```python
//v:textbox
```

---

提取：

内部文本：

```xml
<w:t>
```

---

示例：

```text
内部资料
```

---

处理：

交给：

Task-011对象清理。

---

# 11. DrawingML检测

检测：

```xml
<w:drawing>
```

---

包含：

```xml
wp:inline

wp:anchor
```

---

判断：

## inline

普通图片。

## anchor

浮动对象。

水印通常：

```text
anchor
+
透明
+
大尺寸
```

---

# 12. 图片对象检测

图片关系：

读取：

```text
word/_rels/*.rels
```

---

获取：

```text
rId

↓

media/imageX.png
```

---

生成：

```python
WordObject(
object_type="picture"
)
```

---

# 13. 水印风险评分模型

总分：

100。

---

## 13.1 位置评分

30分。

判断：

对象是否位于：

* 页面中央；
* 页眉；
* 页脚。

---

## 13.2 重复评分

30分。

判断：

同一个对象：

是否多个Section重复出现。

---

## 13.3 透明度评分

20分。

DrawingML：

读取：

```xml
a:alpha
```

---

透明对象：

增加风险。

---

## 13.4 尺寸评分

20分。

判断：

大面积对象：

风险提高。

---

# 14. DetectionResult输出

示例：

```python
DetectionResult(

type="word_object",

confidence=0.92,

metadata={

"object_type":"shape",

"xml":"header1.xml",

"node":"v:shape",

"id":"Watermark"

}

)
```

---

# 15. Risk策略

## 自动删除

条件：

```text
confidence >=0.9
```

并且：

满足：

```text
Header/Footer

+

重复对象

+

明显水印属性
```

---

## 人工确认

```text
0.6-0.9
```

---

## 忽略

```text
<0.6
```

---

# 16. WordObjectCleaner

文件：

```text
cleaner/word_object_cleaner.py
```

---

实现：

```python
class WordObjectCleaner:
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

删除节点

↓

保存DOCX

↓

重新压缩ZIP

↓

验证

```

---

# 17. Shape删除策略

删除：

整个：

```xml
<v:shape>
```

---

示例：

删除前：

```xml
<w:pict>

<v:shape>

水印内容

</v:shape>

</w:pict>
```

---

删除：

```xml
<w:pict/>
```

---

后处理：

删除空节点。

---

# 18. DrawingML删除策略

删除：

```xml
<w:drawing>
```

---

同时检查：

关系文件：

```text
_rels
```

---

注意：

不要立即删除：

```text
media/imageX.png
```

---

原因：

可能被其他位置引用。

---

只删除：

引用关系。

---

# 19. 图片资源清理

V1策略：

不删除孤立图片资源。

原因：

风险低。

后续：

V2垃圾资源清理。

---

# 20. 异常处理

## 节点不存在

返回：

```text
FAILED

NODE_NOT_FOUND
```

---

## XML损坏

返回：

```text
FAILED

INVALID_XML
```

---

## 图片被多个位置引用

返回：

```text
SKIPPED

SHARED_RESOURCE
```

---

# 21. 单元测试

## test_shape_detector.py

### Case 1 Shape水印

输入：

Header:

VML Shape。

期望：

```text
object_type=shape

confidence>0.8
```

---

### Case 2 普通图片

正文图片。

期望：

IGNORE。

---

## test_drawing_detector.py

### Case 3 Anchor图片

浮动透明图片。

期望：

检测。

---

## test_cleaner.py

### Case 4 删除Shape

验证：

XML不存在：

```xml
<v:shape>
```

---

### Case 5 删除Drawing

验证：

```xml
<w:drawing>
```

删除。

---

# 22. 验收标准

## 检测能力

必须完成：

✅ VML Shape检测
✅ TextBox检测
✅ DrawingML检测
✅ 图片对象检测

---

## 删除能力

必须完成：

✅ XML节点删除
✅ ZIP重新打包
✅ DOCX可打开

---

## 安全要求

必须保证：

| 项目        | 要求  |
| --------- | --- |
| 正文文本      | 不变化 |
| Section数量 | 不变化 |
| 图片资源      | 不误删 |
| 无法判断对象    | 跳过  |

---

# 23. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Word对象检测方案；
3. XML节点处理方式；
4. 删除策略；
5. 测试结果；
6. 当前限制。

---

# 24. 禁止事项

本任务禁止：

❌ 修改图片内容
❌ OCR识别
❌ 删除所有Drawing
❌ 删除所有Shape
❌ 清理media资源
❌ 重建DOCX

---

# Task-011完成标志

达到：

> 系统能够识别 DOCX 中高概率 Shape、TextBox、DrawingML 类型水印，并通过 XML 节点级删除方式安全移除，同时保持 Word 文档结构稳定。

---

下一任务：

# Task-012：Cleaning Plan 与 Dry-run 报告模块

实现：

* 汇总 PDF/Word 检测结果；
* 生成统一 CleaningPlan JSON；
* 用户确认流程；
* 风险等级展示；
* 为 Cleaner 执行提供标准输入。
