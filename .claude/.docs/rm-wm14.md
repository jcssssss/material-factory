# MF-001 文档清理引擎

# Claude Code 开发任务 Task-014

# 清理结果验证器模块

（Cleaning Validator & Quality Assurance System）

---

# 1. Task目标

实现文档清理后的**质量验证层**。

本任务负责：

在 Cleaner 执行完成后，对输出文件进行自动检查：

```text
 id="validator-flow"
Clean Result

↓

Validator

↓

Quality Report

↓

Final Task Status
```

---

核心目标：

> 确保文档清理过程中没有破坏原始资料结构，同时确认目标水印/非主体元素已经被处理。

---

本任务负责：

✅ PDF完整性验证
✅ Word完整性验证
✅ 页数一致性检查
✅ 文件可打开验证
✅ 文本变化检测
✅ 图片变化检测
✅ expected_loss风险判断
✅ 水印复检
✅ 生成ValidationReport

---

本任务不负责：

❌ 删除操作
❌ Detector算法
❌ Cleaner执行
❌ UI展示

---

# 2. 当前任务上下文

完整Pipeline：

```text
Document

↓

Analyzer

↓

Detector

↓

Risk Engine

↓

CleaningPlan

↓

Cleaner Executor

↓

Task-014

Validator

↓

Final Result

```

---

已完成：

| Task         | 能力           |
| ------------ | ------------ |
| Task-009~011 | PDF/Word清理能力 |
| Task-012     | CleaningPlan |
| Task-013     | Executor     |

---

本任务：

建立质量保障闭环。

---

# 3. 技术原则

## 原则1：验证优先保护资料完整性

判断优先级：

```text
文件可打开

↓

结构完整

↓

内容变化合理

↓

目标清理完成

```

---

## 原则2：不要使用固定阈值误判

错误：

```text
文本减少20%=失败
```

---

正确：

根据：

```text
预期删除内容

+

实际变化

```

比较。

---

核心：

expected_loss模型。

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/


├── validator/

│
├── validator.py
├── pdf_validator.py
├── word_validator.py
├── watermark_recheck.py
│
├── models/

│
├── validation_report.py
│
└── tests/

    ├── test_pdf_validator.py
    ├── test_word_validator.py
    └── test_validation.py

```

---

# 5. ValidationReport模型

文件：

```text
models/validation_report.py
```

---

定义：

```python
@dataclass
class ValidationReport:
```

---

字段：

```python
task_id:str

file_path:str

status:str

file_check:dict

structure_check:dict

content_check:dict

watermark_check:dict

warnings:list

errors:list
```

---

status：

```text
PASS

WARNING

FAILED

NEED_REVIEW

```

---

# 6. Validator主入口

文件：

```text
validator/validator.py
```

---

实现：

```python
class Validator:
```

---

入口：

```python
def validate(
    self,
    original_file:str,
    cleaned_file:str,
    cleaning_plan:CleaningPlan
)->ValidationReport:
```

---

流程：

```text
输入:

原文件

清理文件

Plan


↓

识别类型


↓

调用PDF/Word Validator


↓

水印复检


↓

生成Report


↓

返回结果

```

---

# 7. 文件类型路由

规则：

```python
if extension == ".pdf":

    PDFValidator


elif extension in [".docx"]:

    WordValidator

```

---

不支持：

```text
.doc

扫描图片

加密文件

```

---

# 8. PDF Validator

文件：

```text
validator/pdf_validator.py
```

---

实现：

```python
class PDFValidator:
```

---

入口：

```python
def validate(
    original,
    cleaned
)->dict:
```

---

# 9. PDF文件完整性检查

## 检查1：是否可打开

使用：

```python
pymupdf.open()
```

---

失败：

```json
{
"status":"FAILED",
"reason":"PDF_OPEN_ERROR"
}
```

---

## 检查2：页数一致

比较：

```text
original.pages

vs

cleaned.pages

```

---

要求：

必须：

```text
100%一致
```

---

否则：

FAILED。

---

原因：

删除水印不能改变文档页结构。

---

# 10. PDF页面尺寸检查

比较：

每页：

```text
width

height
```

---

允许：

```text
完全一致
```

---

异常：

```text
PAGE_SIZE_CHANGED
```

---

# 11. PDF文本变化检测

目的：

判断：

删除内容是否符合预期。

---

采集：

原：

```python
page.get_text()
```

---

新：

```python
page.get_text()
```

---

计算：

```text
text_loss_rate

=

删除文本量

/

原文本量

```

---

但不直接判失败。

---

结合：

CleaningPlan：

例如：

计划删除：

```text
内部资料

```

实际：

删除：

```text
内部资料

```

正常。

---

# 12. expected_loss模型

定义：

```text
expected_loss

=

计划删除对象预计影响比例

```

---

例如：

Plan：

删除：

* 10页页眉
* 每页20字符

预计：

```text
expected_loss=3%
```

---

实际：

```text
text_loss=5%
```

---

判断：

正常。

---

规则：

```text
actual_loss <= expected_loss + 15%

PASS


actual_loss >

expected_loss + 15%

WARNING


actual_loss >

expected_loss +30%

FAILED

```

---

# 13. PDF图片变化检测

比较：

图片数量：

```text
before_images

after_images
```

---

允许：

下降数量：

<=

Plan删除图片数量。

---

例如：

Plan：

删除2个水印图片。

结果：

减少2张。

PASS。

---

如果：

减少20张。

WARNING。

---

# 14. PDF水印复检

执行：

重新调用：

Detector。

流程：

```text
cleaned.pdf

↓

WatermarkDetector

↓

检测目标水印

```

---

判断：

Plan目标：

是否仍存在。

---

结果：

## 已消失

PASS。

---

## 仍存在

WARNING：

```text
WATERMARK_REMAINED
```

---

# 15. Word Validator

文件：

```text
validator/word_validator.py
```

---

实现：

```python
class WordValidator:
```

---

入口：

```python
def validate(
original,
cleaned
)->dict:
```

---

# 16. Word结构检查

比较：

## Section数量

必须：

```text
一致
```

---

## Header数量

允许：

根据Plan减少。

---

## Footer数量

允许：

根据Plan减少。

---

## Paragraph数量

变化：

需要结合删除计划。

---

# 17. Word文件打开验证

使用：

```python
Document(cleaned_path)
```

---

失败：

```text
DOCX_OPEN_ERROR
```

---

# 18. Word XML完整性检查

检查：

ZIP结构。

必须存在：

```text
word/document.xml

word/styles.xml

word/_rels

```

---

缺失：

FAILED。

---

# 19. Word文本变化检测

比较：

原：

```python
paragraph.text
```

---

新：

```python
paragraph.text
```

---

计算：

```text
text_loss_rate
```

---

结合：

CleaningPlan：

判断：

是否合理。

---

# 20. 水印复检模块

文件：

```text
validator/watermark_recheck.py
```

---

实现：

```python
class WatermarkRechecker:
```

---

入口：

```python
def check(
cleaned_file,
original_plan
)
```

---

检查：

计划删除目标。

---

例如：

Plan：

```text
REMOVE_TEXT

内部资料

```

---

重新检测：

不存在。

---

结果：

```text
PASS
```

---

# 21. 最终状态映射

Validator结果：

映射：

| 验证结果      | Task状态                 |
| --------- | ---------------------- |
| 全部PASS    | COMPLETED              |
| 存在WARNING | COMPLETED_WITH_WARNING |
| 结构失败      | FAILED                 |
| 需要人工判断    | NEED_REVIEW            |

---

# 22. 异常处理

## 输出文件不存在

返回：

```text
OUTPUT_NOT_FOUND
```

---

## 文件大小异常

例如：

原：

10MB

输出：

10KB

判断：

WARNING。

---

## 页数减少

直接：

FAILED。

---

## 文档无法打开

直接：

FAILED。

---

# 23. 单元测试

## PDF测试

### Case1 正常清理

输入：

删除Annotation。

验证：

PASS。

---

### Case2 页数变化

模拟：

100页→90页。

结果：

FAILED。

---

### Case3 文本减少超过预期

结果：

WARNING/FAILED。

---

## Word测试

### Case4 Header删除

验证：

Section保持。

---

### Case5 XML损坏

结果：

FAILED。

---

# 24. 验收标准

## 文件完整性

必须：

✅ PDF可打开
✅ Word可打开
✅ 页数一致
✅ 页面尺寸一致

---

## 内容保护

必须：

✅ 正文变化可解释
✅ 图片变化可解释
✅ 结构未破坏

---

## 清理验证

必须：

✅ 删除目标复检
✅ 输出ValidationReport

---

# 25. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Validator架构说明；
3. expected_loss实现方式；
4. PDF/Word验证规则；
5. ValidationReport示例；
6. 测试结果；
7. 当前限制。

---

# 26. 禁止事项

本任务禁止：

❌ 修改Cleaner逻辑
❌ 修改Detector逻辑
❌ 自动修复文档
❌ OCR检测
❌ 图像修复

---

# Task-014完成标志

达到：

> 系统能够自动验证 PDF/Word 清理结果，在保证文档结构完整的前提下判断清理是否成功，并通过风险模型避免误判资料损坏。

---

下一任务：

# Task-015：批处理任务集成与日志系统模块

实现：

* 多文件批量清理；
* 商品级任务隔离；
* 单文件失败跳过；
* 日志记录；
* 批处理报告；
* 与 MF-001 Task System 集成。
