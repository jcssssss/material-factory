# MF-001 文档清理引擎

# Claude Code 开发任务 Task-016

# 文档清理引擎整体集成测试与 V1.0 验收任务

（End-to-End Integration Test & Release Validation）

---

# 1. Task目标

完成 MF-001 文档清理引擎 V1.0 的整体集成验证。

本任务不新增核心功能，而是验证：

> 从文件输入 → 检测 → 风险判断 → CleaningPlan → 清理执行 → 结果验证 → 批处理报告的完整链路是否稳定运行。

---

本任务负责：

✅ 模块集成检查
✅ PDF完整流程测试
✅ Word完整流程测试
✅ 批处理端到端测试
✅ 异常场景测试
✅ 回归测试
✅ 性能基准测试
✅ V1.0验收报告生成

---

本任务不负责：

❌ 新增检测算法
❌ 优化删除算法
❌ OCR能力开发
❌ UI功能开发
❌ 性能优化开发

---

# 2. 当前系统状态

已完成模块：

| Task     | 模块                   |
| -------- | -------------------- |
| Task-005 | PDF Annotation检测     |
| Task-006 | PDF Artifact检测       |
| Task-007 | PDF图片水印检测            |
| Task-008 | PDF文本/页眉页脚检测         |
| Task-009 | Word文档分析             |
| Task-010 | Word Header/Footer处理 |
| Task-011 | Word Shape/XML处理     |
| Task-012 | CleaningPlan生成       |
| Task-013 | Cleaner Executor     |
| Task-014 | Validator            |
| Task-015 | Batch + Logging      |

---

完整流程：

```text
输入文件

↓

Document Analyzer

↓

Detector

↓

DetectionResult

↓

Risk Engine

↓

CleaningPlan

↓

User Confirm

↓

Cleaner Executor

↓

Validator

↓

Batch Report

↓

输出文件

```

---

# 3. 测试原则

## 原则1：验证链路，不重新开发

本任务重点：

发现：

* 模块接口问题；
* 数据结构不一致；
* 状态流转错误；
* 异常处理缺陷。

---

## 原则2：真实资料优先

测试文件需要覆盖：

真实业务场景：

* 考试资料；
* 教材；
* 课程资料；
* PDF扫描件；
* Word模板。

---

# 4. 新增目录结构

新增：

```text
document_cleaning_engine/


├── integration_tests/

│
├── fixtures/
│
├── pdf_cases/
│
├── word_cases/
│
├── batch_cases/
│
├── test_full_pipeline.py
│
├── test_failure_cases.py
│
└── reports/

    └── test_report.json

```

---

# 5. 测试数据准备

## PDF测试集

至少准备：

---

## Case-PDF-001

### Annotation水印

输入：

```
sample_annotation.pdf
```

包含：

```
PDF Annotation Watermark
```

预期：

```
检测成功

↓

生成REMOVE_ANNOTATION

↓

删除成功

↓

Validator PASS
```

---

## Case-PDF-002

### Artifact Watermark

输入：

```
artifact_watermark.pdf
```

预期：

```
Artifact检测

↓

删除

↓

复检不存在

```

---

## Case-PDF-003

### 图片水印

输入：

```
image_watermark.pdf
```

包含：

Logo图片。

预期：

```
ImageDetector识别

↓

生成REMOVE_IMAGE

↓

删除
```

---

## Case-PDF-004

### 文本水印

例如：

```
内部资料

Confidential

禁止传播

```

预期：

```
TextDetector

↓

Risk评分

↓

CleaningPlan

↓

执行删除

```

---

## Case-PDF-005

### 扫描PDF

输入：

图片型PDF。

预期：

状态：

```
NEED_REVIEW

```

不能自动处理。

---

# 6. Word测试集

---

## Case-WORD-001

### 普通页眉

输入：

```
header.docx
```

包含：

```
公司名称
```

预期：

删除成功。

---

## Case-WORD-002

### 页脚页码

输入：

```
footer.docx
```

预期：

检测：

Footer。

---

## Case-WORD-003

### 图片水印

输入：

```
image_shape.docx
```

预期：

删除：

DrawingML对象。

---

## Case-WORD-004

### 多Section

包含：

```
Section1

Section2

Section3

```

预期：

每个Section正确处理。

---

# 7. Pipeline端到端测试

测试入口：

```python
run_cleaning_pipeline()
```

---

流程：

```text
输入

↓

Analyze

↓

Detect

↓

Risk

↓

Plan

↓

Execute

↓

Validate

↓

Report

```

---

验证：

每一步：

输入输出一致。

---

# 8. 批处理测试

模拟：

商品目录：

```text
products/


├── 商品A/

│
├── file1.pdf
├── file2.docx


├── 商品B/

│
├── bad.pdf
├── file3.pdf


```

---

预期：

结果：

```text
商品A

2成功


商品B

1失败

1成功

```

---

Batch状态：

```text
COMPLETED_WITH_ERROR
```

---

日志：

包含：

```
bad.pdf

PDF_OPEN_ERROR

```

---

# 9. 异常测试

## Exception-001

### 损坏PDF

输入：

```
broken.pdf
```

预期：

```
FAILED

继续任务
```

---

## Exception-002

### 加密PDF

输入：

```
encrypted.pdf
```

预期：

```
NEED_REVIEW
```

---

## Exception-003

### Form XObject复杂水印

输入：

```
complex_form.pdf
```

预期：

```
跳过

日志:

FORM_XOBJECT_NOT_SUPPORTED

```

---

## Exception-004

### 输出文件损坏

模拟：

Cleaner输出错误文件。

预期：

Validator：

```
FAILED
```

---

# 10. 数据一致性测试

检查：

## DetectionResult

确认：

所有Detector输出：

统一格式：

```python
DetectionResult
```

---

## CleaningAction

确认：

所有Action：

统一格式：

```python
CleaningAction
```

---

## CleaningResult

确认：

执行结果：

统一格式。

---

# 11. 性能基准测试

V1不要求极限性能。

测试：

---

## 单文件

测试：

100页PDF。

记录：

```
处理时间

内存占用

输出大小

```

---

## 批量

测试：

100个文件。

记录：

```
总耗时

失败数量

平均处理时间

```

---

# 12. 性能验收指标

V1目标：

---

## 稳定性优先

要求：

不能：

* 崩溃；
* 内存泄漏；
* 中途停止。

---

## 基准记录

输出：

```json
{
"files":100,

"success":98,

"failed":2,

"avg_time":"xx",

"memory":"xx"
}

```

---

# 13. 回归测试机制

以后修改：

必须执行：

```
pytest integration_tests/

```

---

覆盖：

* PDF；
* Word；
* Batch；
* Validator。

---

# 14. 测试报告生成

文件：

```
reports/test_report.json
```

---

结构：

```json
{
"version":"V1.0",

"date":"2026-07-30",

"summary":{

"total_cases":30,

"passed":29,

"failed":1

},

"details":[

{

"id":"PDF-001",

"status":"PASS"

}

]

}
```

---

# 15. V1.0验收清单

## PDF能力

| 功能           | 结果   |
| ------------ | ---- |
| Annotation删除 | 必须通过 |
| Artifact删除   | 必须通过 |
| 图片水印检测       | 必须通过 |
| 页眉页脚检测       | 必须通过 |
| 文本强水印处理      | 必须通过 |
| 扫描PDF识别      | 必须通过 |
| 复杂结构跳过       | 必须通过 |

---

## Word能力

| 功能          | 结果   |
| ----------- | ---- |
| Header删除    | 必须通过 |
| Footer删除    | 必须通过 |
| Shape删除     | 必须通过 |
| DrawingML处理 | 必须通过 |
| 多Section处理  | 必须通过 |

---

## 工程能力

| 能力           | 结果   |
| ------------ | ---- |
| Dry-run      | 必须通过 |
| CleaningPlan | 必须通过 |
| 失败隔离         | 必须通过 |
| 日志系统         | 必须通过 |
| 批处理          | 必须通过 |
| 验证系统         | 必须通过 |

---

# 16. Claude Code输出要求

完成后输出：

## 1. 测试环境

包括：

* Python版本；
* 依赖版本；
* 操作系统。

---

## 2. 测试结果

输出：

```
Total Cases:

Passed:

Failed:

Skipped:

```

---

## 3. 失败问题

每个失败：

包含：

```
Case:

Error:

原因:

修复建议:

```

---

## 4. V1.0状态判断

输出：

```
READY

/

NOT READY

```

---

# 17. 禁止事项

本任务禁止：

❌ 修改PRD范围
❌ 新增V1功能
❌ 引入新框架
❌ 大规模重构
❌ OCR开发

---

# Task-016完成标志

达到：

> MF-001 文档清理引擎 V1.0 完成完整链路验证，具备稳定处理PDF/Word资料清理任务的工程交付条件。

---

# 后续任务规划

如果测试通过，下一阶段进入：

## Task-017：MF-001 文档清理引擎与主程序架构集成

目标：

将文档清理引擎接入 AI资料素材工厂主系统：

```
GUI

↓

Task Manager

↓

Document Cleaning Engine

↓

Output Manager

```

实现正式产品模块化集成。
