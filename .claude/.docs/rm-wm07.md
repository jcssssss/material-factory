# MF-001 文档清理引擎

# Claude Code 开发任务 Task-007

# PDF 文本水印检测与删除模块（Text Watermark Detector & Cleaner）

---

# 1. Task目标

实现 PDF **文本型水印检测与安全删除能力**。

这是 MF-001 文档清理引擎 V1.0 中技术复杂度最高的模块。

本任务负责：

1. 检测 PDF 中疑似文本水印；
2. 判断文本是否属于非主体内容；
3. 定位文本绘制指令；
4. 使用 pikepdf 删除对应 Content Stream 指令；
5. 对无法安全定位的情况降级人工处理。

---

本任务处理：

✅ 中央文本水印
✅ 对角文本水印
✅ 重复版权文本
✅ 内部资料标记
✅ Confidential / Draft 类水印

---

本任务不处理：

❌ 扫描PDF图片文字水印
❌ OCR擦除
❌ 白色覆盖
❌ PDF Redaction
❌ Form XObject递归解析

---

# 2. 当前任务上下文

当前流程：

```text
PDF

↓

Analyzer

↓

Detector

↓

Risk Engine

↓

CleaningPlan

↓

Cleaner

↓

Validator
```

---

已有：

Task-003：

检测框架

Task-004：

风险评分

Task-005：

结构化对象删除

Task-006：

图片水印删除

---

Task-007新增：

```text
TextWatermarkDetector

+

TextWatermarkCleaner
```

---

# 3. 技术原则（必须遵守）

核心原则：

> 检测可以宽松，删除必须精准。

---

检测：

允许：

候选水印。

---

删除：

必须：

能够定位PDF绘制指令。

---

如果无法建立：

```
文本块

↓

Content Stream指令

```

映射：

必须：

```
SKIPPED
```

进入人工确认。

---

# 4. 技术栈

## 文本提取

使用：

```text
PyMuPDF
```

---

用途：

获取：

* text block
* span
* bbox
* font
* size
* origin
* rotation

---

## PDF修改

使用：

```text
pikepdf
```

---

用途：

修改：

Content Stream。

---

禁止：

```text
page.add_redact_annot()

page.apply_redactions()
```

---

原因：

会导致：

* 内容重建；
* 文字结构变化；
* 搜索能力下降。

---

# 5. 文件结构

新增：

```text
document_cleaning_engine/


├── detector/

│   └── text_detector.py


├── cleaner/

│   ├── text_cleaner.py
│   ├── content_stream_parser.py
│   └── text_matcher.py


├── models/

│   └── text_block.py


└── tests/

    ├── test_text_detector.py
    └── test_text_cleaner.py

```

---

# 6. TextBlock数据模型

文件：

```text
models/text_block.py
```

---

实现：

```python
class TextBlock:
```

---

字段：

```python
page:int

text:str

bbox:tuple

font_size:float

font_name:str

origin:tuple

rotation:float

metadata:dict
```

---

用途：

保存：

PyMuPDF提取出的文本结构。

---

# 7. 文本检测模块

文件：

```text
detector/text_detector.py
```

---

实现：

```python
class TextWatermarkDetector:
```

---

入口：

```python
def detect(
    self,
    pdf_path:str
)->list[DetectionResult]:
```

---

流程：

```text
打开PDF

↓

提取text dict

↓

生成TextBlock

↓

关键词分析

↓

位置分析

↓

重复分析

↓

评分

↓

输出DetectionResult

```

---

# 8. 文本提取

使用：

```python
page.get_text("dict")
```

---

获取：

```text
blocks

 └── lines

       └── spans

```

---

span信息：

必须保存：

```text
text

size

font

origin

bbox

```

---

# 9. 水印关键词检测

文件：

```text
detector/text_detector.py
```

---

建立：

```python
WATERMARK_KEYWORDS
```

---

初始词库：

```text
机密

内部资料

内部文件

禁止传播

版权所有

Copyright

Confidential

Draft

Sample

Preview

```

---

评分：

命中：

增加：

30分。

---

# 10. 位置评分

权重：

25分。

判断区域：

## 中央区域

页面：

```text
30%-70%
```

范围。

---

得分：

高。

---

## 对角区域

检测：

文本旋转角：

```text
30°-60°
```

---

得分：

高。

---

## 页边区域

顶部：

```text
0%-15%
```

底部：

```text
85%-100%
```

---

可能属于：

页眉页脚。

降低水印判断。

---

# 11. 跨页重复分析

权重：

30分。

规则：

相同文本：

出现多个页面。

例如：

100页：

```
内部资料
```

出现：

95页。

---

计算：

```python
repeat_rate =
appear_pages/page_count
```

---

评分：

```text
repeat_rate ×30
```

---

# 12. 样式评分

权重：

15分。

判断：

## 字体大小

异常大：

加分。

---

## 旋转

旋转：

> 20°

加分。

---

## 独立文本块

单独存在：

加分。

---

# 13. 综合评分

公式：

```
score=

keyword_score

+

position_score

+

repeat_score

+

style_score

```

---

转换：

```python
confidence=score/100
```

---

输出阈值：

## 高风险

```text
confidence >=0.9
```

进入：

AUTO候选。

---

## 中风险

```text
0.6-0.9
```

进入：

CONFIRM。

---

## 低风险

```text
<0.6
```

IGNORE。

---

# 14. DetectionResult输出

示例：

```python
DetectionResult(

type="text",

page=5,

bbox=(100,200,400,260),

content="内部资料",

confidence=0.95,

metadata={

"font_size":48,

"rotation":45,

"origin":(120,220)

}

)
```

---

# 15. 文本删除核心方案

## 原则

不覆盖。

不重建。

直接删除：

Content Stream绘制指令。

---

流程：

```
DetectionResult

↓

获取origin/bbox

↓

解析页面Content Stream

↓

定位文本绘制操作

↓

删除对应Tj/TJ指令

↓

重新写回Stream

```

---

# 16. Content Stream匹配策略

## 第一阶段

匹配：

文本绘制矩阵。

PDF文本：

通常：

```
BT

Tm

Tj/TJ

ET
```

结构。

---

重点匹配：

```
Tm矩阵中的坐标

↓

DetectionResult.origin

```

---

例如：

检测：

```text
origin=(100,200)
```

寻找：

```text
Tm ... 100 200
```

---

匹配成功：

删除：

对应：

```
Tj/TJ
```

---

# 17. Content Stream限制

V1只支持：

页面直接Content Stream：

```text
Page

 └── Contents

      └── BT/Tm/Tj
```

---

不支持：

```text
Page

 └── Form XObject

       └── Contents

            └── Text
```

---

处理：

输出：

```text
SKIPPED

reason:

FORM_XOBJECT_TEXT
```

---

# 18. TextWatermarkCleaner

文件：

```text
cleaner/text_cleaner.py
```

---

实现：

```python
class TextWatermarkCleaner:
```

---

入口：

```python
def clean(
    self,
    pdf,
    action
)->CleaningResult
```

---

流程：

```
读取action

↓

获取origin

↓

Content Stream定位

↓

删除指令

↓

保存

↓

返回结果

```

---

# 19. 删除失败策略

## 情况1

找不到匹配指令

结果：

```python
FAILED
```

fallback：

```text
manual_review
```

---

## 情况2

存在Form XObject

结果：

```text
SKIPPED
```

原因：

```text
complex_structure
```

---

## 情况3

删除后结构异常

交给：

Validator。

---

# 20. 单元测试

## test_text_detector.py

---

### Case1

输入：

中央：

```
内部资料
```

100页重复。

期望：

```text
confidence >0.9
```

---

### Case2

正文：

```
版权说明
```

只出现一次。

期望：

IGNORE。

---

## test_text_cleaner.py

---

### Case3

简单Content Stream：

删除前：

```text
BT

(内部资料) Tj

ET
```

---

执行：

REMOVE_TEXT

验证：

Tj删除。

---

### Case4

Form XObject文本

期望：

```text
SKIPPED
```

---

# 21. 验收标准

## 检测

✅ 文本块提取完成
✅ 关键词识别完成
✅ 位置评分完成
✅ 跨页重复分析完成

---

## 删除

✅ pikepdf Content Stream处理完成
✅ Tj/TJ删除完成
✅ Form XObject跳过完成

---

## 安全

必须保证：

| 项目    | 要求  |
| ----- | --- |
| 页面数量  | 不变化 |
| 正文文本  | 不删除 |
| PDF结构 | 可打开 |
| 无法定位  | 不删除 |

---

# 22. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. 文本检测算法说明；
3. Content Stream匹配方案；
4. 删除前后示例；
5. 测试结果；
6. 当前限制。

---

# 23. 禁止事项

本任务禁止：

❌ 使用redaction
❌ 白色矩形覆盖
❌ OCR
❌ Form XObject递归
❌ 修改字体资源
❌ 重建PDF页面

---

# Task-007完成标志

达到：

> 系统能够识别高置信度文本水印，并通过PDF Content Stream级别精准删除；无法安全定位的文本水印必须降级人工处理。

---

下一任务：

# Task-008：PDF页眉页脚检测与清理模块

实现：

* Header/Footer检测；
* 重复文本分析；
* 页眉页脚风险判断；
* 安全删除策略；
* 与文本水印模块区分处理。
