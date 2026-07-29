# MF-001 文档清理引擎

# Claude Code 开发任务 Task-008

# PDF 页眉页脚检测与清理模块（Header/Footer Detector & Cleaner）

---

# 1. Task目标

实现 PDF 页眉、页脚检测与清理能力。

本任务负责：

1. 识别 PDF 页面顶部/底部重复文本；
2. 判断是否属于页眉或页脚；
3. 生成 Header/Footer CleaningAction；
4. 执行安全删除；
5. 保证正文内容不受影响。

---

本任务处理：

✅ 固定页眉文本
✅ 固定页脚文本
✅ 页码区域
✅ 来源标识
✅ 下载平台信息
✅ 重复版权信息

---

本任务不处理：

❌ 正文中的相同文本
❌ 文本水印（Task-007负责）
❌ 图片页眉页脚
❌ Form XObject内容
❌ 扫描PDF页眉擦除

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

已完成：

| 任务       | 能力                    |
| -------- | --------------------- |
| Task-003 | 检测框架                  |
| Task-004 | 风险评分                  |
| Task-005 | Annotation/Artifact删除 |
| Task-006 | 图片水印                  |
| Task-007 | 文本水印                  |

---

Task-008新增：

```text
HeaderFooterDetector

+

HeaderFooterCleaner
```

---

# 3. 技术原则

页眉页脚与文本水印不同：

文本水印：

> 非主体内容，通常中央、重复、覆盖正文。

页眉页脚：

> 位于固定区域，可能包含有效信息。

因此：

删除策略更加保守：

```text
检测:

宽松

↓

风险:

严格

↓

删除:

必须确认
```

---

# 4. 技术栈

文本分析：

```text
PyMuPDF
```

---

PDF修改：

```text
pikepdf
```

---

禁止：

❌ Redaction
❌ 白色覆盖
❌ OCR
❌ 页面重建

---

# 5. 文件结构

新增：

```text
document_cleaning_engine/


├── detector/

│   └── header_footer_detector.py


├── cleaner/

│   ├── header_footer_cleaner.py
│
├── models/

│   └── header_footer.py


└── tests/

    ├── test_header_footer_detector.py
    └── test_header_footer_cleaner.py

```

---

# 6. HeaderFooterInfo数据模型

文件：

```text
models/header_footer.py
```

---

实现：

```python
class HeaderFooterInfo:
```

---

字段：

```python
type:str

text:str

pages:list[int]

bbox:tuple

repeat_rate:float

font_size:float

metadata:dict
```

---

type：

```text
header

footer
```

---

# 7. Header/Footer Detector

文件：

```text
detector/header_footer_detector.py
```

---

实现：

```python
class HeaderFooterDetector:
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

遍历页面

↓

提取TextBlock

↓

区域过滤

↓

重复分析

↓

评分

↓

输出DetectionResult

```

---

# 8. 页面区域划分

根据PRD：

---

## Header区域

页面顶部：

```text
0% - 15%
```

---

计算：

```python
page_height * 0.15
```

---

例如：

A4：

高度：

842pt

Header：

```text
0-126pt
```

---

## Footer区域

页面底部：

```text
85% - 100%
```

---

---

# 9. 文本块过滤

使用：

```python
page.get_text("dict")
```

---

获取：

```text
block

↓

line

↓

span
```

---

提取：

```text
text

bbox

font_size

origin
```

---

过滤：

只保留：

```text
bbox位于header/footer区域
```

---

# 10. 跨页重复分析

页眉页脚核心判断：

> 同一位置出现相同文本。

---

计算：

```python
repeat_rate =
出现页面数 / 总页面数
```

---

示例：

100页PDF：

顶部：

"某某考试资料"

出现：

100页。

结果：

```text
repeat_rate=1.0
```

---

# 11. Header/Footer评分模型

采用PRD定义。

总分：

100分。

---

## 11.1 跨页重复率

权重：

40%

公式：

```text
repeat_rate ×40
```

---

## 11.2 位置评分

权重：

25%

规则：

| 位置     | 得分 |
| ------ | -: |
| 顶部固定区域 | 25 |
| 底部固定区域 | 25 |
| 其他     |  0 |

---

## 11.3 字体大小

权重：

15%

判断：

页眉页脚通常：

* 小字体；
* 固定格式。

---

## 11.4 距离正文

权重：

10%

计算：

Header:

```text
header_bottom

↓

正文top
```

距离越大：

风险越高。

---

## 11.5 文本长度

权重：

10%

短文本：

例如：

```
内部资料
```

得分较高。

---

# 12. 输出DetectionResult

示例：

```python
DetectionResult(

type="header",

page=1,

bbox=(50,30,500,70),

content="内部资料",

confidence=0.92,

metadata={

"repeat_rate":1.0,

"font_size":9

}

)
```

---

# 13. Risk Engine策略

Header/Footer不自动删除。

规则：

---

## 高置信

```text
confidence >=0.8
```

进入：

```text
CONFIRM
```

---

## 中低置信

```text
<0.8
```

进入：

```text
IGNORE
```

---

原因：

避免删除有效章节标题。

---

# 14. Header/Footer Cleaner

文件：

```text
cleaner/header_footer_cleaner.py
```

---

实现：

```python
class HeaderFooterCleaner:
```

---

入口：

```python
def clean(
    self,
    pdf,
    action
)->CleaningResult:
```

---

# 15. 删除策略

采用：

Content Stream精准删除。

流程：

```text
CleaningAction

↓

获取bbox/origin

↓

Content Stream解析

↓

匹配文本绘制指令

↓

删除Tj/TJ

↓

保存

```

---

与Task-007区别：

Task-007：

目标：

文本水印。

Task-008：

目标：

固定区域文本。

底层删除方式：

一致。

---

# 16. 删除限制

V1支持：

页面直接：

```text
Page Contents

↓

BT

↓

Tm

↓

Tj/TJ

```

---

不支持：

```text
Form XObject

↓

Header/Footer

↓

Text
```

---

处理：

```text
SKIPPED

reason:

FORM_XOBJECT_HEADER_FOOTER
```

---

# 17. 页码特殊处理

页码属于Footer。

默认：

不自动删除。

原因：

页码可能属于：

* 正文结构；
* 目录引用；
* 资料阅读需要。

---

规则：

生成：

```text
CONFIRM
```

---

示例：

检测：

```
- 1 -
```

输出：

```json
{
"type":"footer",
"decision":"CONFIRM"
}
```

---

# 18. CleaningResult

成功：

```python
CleaningResult(

status="SUCCESS"

)
```

---

失败：

```python
CleaningResult(

status="FAILED",

error="text instruction not found",

fallback_action="manual_review"

)
```

---

# 19. 单元测试要求

## test_header_footer_detector.py

---

### Case 1 固定页眉

100页：

顶部：

```
内部资料
```

期望：

```text
type=header

confidence>=0.8
```

---

### Case 2 正文标题

第一页：

顶部标题。

只出现一次。

期望：

IGNORE。

---

### Case 3 页码

每页：

```
1
2
3
```

期望：

footer + CONFIRM。

---

## test_header_footer_cleaner.py

---

### Case 4 删除页眉

验证：

删除后：

* 页数一致；
* 正文存在。

---

### Case 5 Form XObject

输入：

Form中的Header。

期望：

```text
SKIPPED
```

---

# 20. 验收标准

## 检测

✅ Header检测完成
✅ Footer检测完成
✅ 重复率分析完成
✅ 风险评分完成

---

## 删除

✅ Content Stream删除完成
✅ 页眉页脚Action执行完成
✅ Form XObject跳过完成

---

## 安全

必须保证：

| 项目   | 要求  |
| ---- | --- |
| 页数   | 不变化 |
| 正文   | 不删除 |
| 目录   | 不破坏 |
| 无法定位 | 不处理 |

---

# 21. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Header/Footer算法说明；
3. 评分模型说明；
4. 删除策略说明；
5. 测试结果；
6. 当前限制。

---

# 22. 禁止事项

本任务禁止：

❌ 自动删除所有页码
❌ 使用OCR
❌ 页面截图重建
❌ Redaction覆盖
❌ Form XObject递归
❌ 删除正文区域文本

---

# Task-008完成标志

达到：

> 系统能够识别高概率页眉页脚，并通过人工确认后的 CleaningAction 安全删除固定区域非主体文本，同时避免误删正文内容。

---

下一任务：

# Task-009：Word 文档分析与清理基础模块

实现：

* DOC/DOCX类型识别；
* Section解析；
* Header/Footer遍历；
* python-docx + lxml分层处理架构；
* Word清理任务基础框架。
