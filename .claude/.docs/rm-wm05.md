# MF-001 文档清理引擎

# Claude Code 开发任务 Task-005

# PDF 结构化对象清理模块（Annotation / Artifact Cleaner）

---

# 1. Task目标

实现 PDF 中**高确定性结构化对象删除能力**。

本任务负责：

1. 删除 PDF Annotation 水印；
2. 删除 PDF Artifact Watermark；
3. 实现 Cleaner 执行框架；
4. 输出 CleaningResult；
5. 支持失败隔离。

---

本任务只处理：

```text
结构化PDF对象
```

不处理：

* 图片水印；
* 文本水印；
* 页眉页脚；
* Content Stream文本删除。

---

# 2. 当前任务上下文

当前流程：

```text
PDF文件

↓

Analyzer

↓

Detector

↓

Risk Engine

↓

CleaningPlan

↓

Task-005 Cleaner

↓

Validator
```

---

Task-005解决：

> 对已经确认安全的 CleaningAction 执行删除。

---

# 3. 技术约束

## 必须使用

PDF修改：

```text
pikepdf
```

---

原因：

* 适合PDF结构修改；
* 支持对象级删除；
* 保留PDF结构；
* 后续Content Stream处理也依赖。

---

辅助：

```text
PyMuPDF
```

用于：

* 页面定位；
* 验证。

---

禁止：

❌ 使用白色覆盖
❌ 使用redaction擦除
❌ OCR处理
❌ 修改文本流
❌ 删除未知对象

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/

├── cleaner/

│   ├── __init__.py
│   ├── pdf_cleaner.py
│   ├── annotation_cleaner.py
│   ├── artifact_cleaner.py
│   └── cleaner_utils.py


└── tests/

    └── test_pdf_cleaner.py

```

---

# 5. Cleaner基础接口

文件：

```text
cleaner/pdf_cleaner.py
```

---

实现：

```python
class PDFCleaner:
```

---

入口：

```python
def clean(
    self,
    input_path:str,
    plan:CleaningPlan,
    output_path:str
)->list[CleaningResult]:
```

---

流程：

```text
打开PDF

↓

读取CleaningPlan

↓

遍历CleaningAction

↓

调用对应Cleaner

↓

记录CleaningResult

↓

保存PDF

↓

返回结果

```

---

# 6. Action路由

根据：

```python
action_type
```

分发。

规则：

| Action            | 执行模块              |
| ----------------- | ----------------- |
| REMOVE_ANNOTATION | AnnotationCleaner |
| REMOVE_ARTIFACT   | ArtifactCleaner   |
| 其他                | SKIPPED           |

---

示例：

```python
if action.action_type=="REMOVE_ANNOTATION":

    annotation_cleaner.clean(action)

```

---

# 7. Annotation Cleaner

文件：

```text
cleaner/annotation_cleaner.py
```

---

实现：

```python
class AnnotationCleaner:
```

---

方法：

```python
def clean(
    self,
    pdf,
    action
)->CleaningResult:
```

---

# 8. Annotation删除逻辑

PDF结构：

```text
Page

└── /Annots

      ├── Annot1

      ├── Annot2

```

---

处理流程：

```text
读取页面

↓

定位Annots数组

↓

匹配target_ref

↓

删除对象引用

↓

保存

```

---

删除：

仅删除：

```text
/Annots数组中的目标对象
```

---

不修改：

* 页面内容；
* 文本；
* 图片。

---

# 9. Annotation执行结果

成功：

```python
CleaningResult(
    status="SUCCESS"
)
```

---

失败：

例如：

对象不存在：

```python
CleaningResult(
    status="FAILED",
    error="annotation target not found",
    fallback_action="manual_review"
)
```

---

# 10. Artifact Cleaner

文件：

```text
cleaner/artifact_cleaner.py
```

---

实现：

```python
class ArtifactCleaner:
```

---

方法：

```python
def clean(
    self,
    pdf,
    action
)->CleaningResult:
```

---

# 11. Artifact删除逻辑

处理范围：

仅：

```text
/Subtype /Watermark
```

---

流程：

```text
扫描页面内容结构

↓

定位Artifact Watermark

↓

删除对应结构

↓

保存

```

---

禁止：

删除：

```text
Header

Footer

Pagination

```

---

原因：

这些属于内容结构，不属于Watermark Artifact。

---

# 12. CleaningResult标准

所有执行必须返回：

```python
CleaningResult(
    action=action,

    status="SUCCESS",

    error=None,

    fallback_action=None,

    metadata={}
)
```

---

状态：

```text
SUCCESS

FAILED

SKIPPED
```

---

# 13. 失败处理策略

## 单个Action失败

例如：

Annotation不存在。

处理：

```text
记录ERROR

↓

继续执行下一Action

```

---

不允许：

整个文件任务失败。

---

## 页面多个Action失败

规则：

同一页面：

> 失败Action >=3

标记：

```text
PARTIAL_SUCCESS
```

---

## 文件级失败

例如：

* PDF损坏；
* 保存失败。

结果：

```text
FAILED
```

---

# 14. 安全保护

执行前检查：

## Action类型

必须属于：

```text
REMOVE_ANNOTATION

REMOVE_ARTIFACT

```

否则：

跳过。

---

## target_ref

必须存在。

否则：

```text
SKIPPED
```

---

# 15. 单元测试要求

文件：

```text
tests/test_pdf_cleaner.py
```

---

## Case 1 Annotation删除

输入：

带Annotation PDF。

执行：

REMOVE_ANNOTATION

验证：

重新打开PDF：

Annotation数量减少。

---

## Case 2 不影响正文

验证：

删除前后：

页数一致。

---

## Case 3 Artifact Watermark

输入：

Watermark Artifact。

执行：

REMOVE_ARTIFACT

验证：

Artifact不存在。

---

## Case 4 Action失败隔离

模拟：

不存在对象。

期望：

```text
FAILED

但继续执行其他Action

```

---

# 16. 验收标准

## 功能

✅ Annotation删除完成
✅ Artifact Watermark删除完成
✅ Cleaner框架完成
✅ CleaningResult输出完成
✅ 单Action失败隔离完成

---

## 安全

必须保证：

| 项目   | 要求  |
| ---- | --- |
| 页数   | 不减少 |
| 正文   | 不修改 |
| 图片   | 不修改 |
| 未知对象 | 不删除 |

---

# 17. Claude Code输出要求

完成后输出：

1. 修改文件列表；
2. Cleaner架构说明；
3. 支持Action类型；
4. 删除前后验证结果；
5. 测试结果；
6. 当前限制。

---

# 18. 禁止事项

本任务禁止：

❌ 实现文本水印删除
❌ 实现图片水印删除
❌ 实现页眉页脚删除
❌ 使用PyMuPDF redaction
❌ 修改Content Stream
❌ 处理Form XObject递归

---

# Task-005完成标志

达到：

> 系统能够安全删除PDF中确定性的Annotation和Artifact Watermark对象，并通过CleaningResult记录每一次执行结果，为后续复杂清理能力提供稳定执行框架。

---

下一任务：

# Task-006：PDF图片水印检测与删除模块

实现：

* 图片XObject识别；
* 图片Hash重复分析；
* 图片水印评分；
* 安全删除图片水印引用；
* 图片删除后的完整性验证。
