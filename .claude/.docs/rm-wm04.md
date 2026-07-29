# MF-001 文档清理引擎

# Claude Code 开发任务 Task-004

# Risk Engine 与 Cleaning Plan 生成模块

---

# 1. Task目标

实现检测结果到清理计划的转换能力。

本任务负责：

1. 对 `DetectionResult` 进行风险评估；
2. 根据风险等级决定处理策略；
3. 生成标准化 `CleaningPlan`；
4. 支持 Dry-run 模式输出。

---

本任务**不执行删除操作**。

不负责：

* 修改PDF；
* 删除对象；
* Word处理；
* 实际Cleaner执行。

---

# 2. 当前任务上下文

当前流程：

```text
PDF文件

↓

Task-002 PDF Analyzer

↓

Task-003 Detector

↓

Task-004 Risk Engine

↓

CleaningPlan

↓

Task-005 Cleaner
```

---

Task-004解决的问题：

检测模块只知道：

> “发现了什么。”

Risk Engine负责：

> “是否应该删除，以及如何删除。”

---

# 3. 技术约束

必须使用：

Python 3.11+

已有模型：

```python
DetectionResult

CleaningAction

CleaningPlan
```

---

禁止：

❌ 直接调用PDF修改库
❌ 删除PDF对象
❌ 生成最终PDF
❌ 引入机器学习模型

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/

├── risk/

│   ├── __init__.py
│   ├── risk_engine.py
│   ├── risk_rules.py
│   └── scoring.py

├── reports/

│   ├── __init__.py
│   └── dry_run_report.py

└── tests/

    └── test_risk_engine.py

```

---

# 5. Risk Engine设计

文件：

```text
risk/risk_engine.py
```

---

实现：

```python
class RiskEngine:
```

---

入口：

```python
def evaluate(
    self,
    detections:list[DetectionResult]
)->CleaningPlan:
```

---

流程：

```text
DetectionResult列表

↓

逐个风险评分

↓

生成CleaningAction

↓

生成CleaningPlan

```

---

# 6. 风险策略模型

V1采用三级策略：

```text
AUTO

CONFIRM

IGNORE
```

---

## AUTO

自动执行删除。

要求：

高置信度。

---

## CONFIRM

生成计划：

等待用户确认。

---

## IGNORE

保留。

---

# 7. 风险等级规则

## 7.1 Annotation

规则：

```text
confidence = 1.0
```

处理：

```text
AUTO
```

---

原因：

Annotation属于结构化对象。

---

## 7.2 Artifact Watermark

规则：

```text
confidence = 1.0
```

处理：

```text
AUTO
```

---

## 7.3 图片水印

判断：

```text
confidence >= 0.8
```

---

结果：

```text
AUTO
```

---

如果：

```text
0.6 <= confidence <0.8
```

结果：

```text
CONFIRM
```

---

低于：

```text
<0.6
```

结果：

```text
IGNORE
```

---

## 7.4 文本水印

更谨慎。

规则：

### 自动删除

必须同时满足：

```text
confidence >=0.9

+

关键词命中

+

非正文区域

+

独立文本块

```

---

否则：

```text
CONFIRM
```

---

## 7.5 页眉页脚

规则：

```text
confidence >=0.8

```

进入：

```text
CONFIRM
```

---

原因：

页眉页脚可能包含有效内容。

---

# 8. Risk评分模型

文件：

```text
risk/scoring.py
```

---

统一：

0-100分。

公式：

```text
RiskScore =

Detection Confidence * 50

+

Object Type Score * 30

+

Position Score * 20

```

---

示例：

文本水印：

```text
confidence=0.95

type_score=30

position_score=20
```

结果：

```text
47.5+30+20

=97.5
```

---

# 9. CleaningAction生成

检测结果：

转换：

```python
DetectionResult

↓

CleaningAction
```

---

示例：

输入：

```python
DetectionResult(
type="annotation",
page=1,
confidence=1.0
)
```

---

输出：

```python
CleaningAction(
action_type="REMOVE_ANNOTATION",

page=1,

target_type="annotation",

confidence=1.0
)
```

---

# 10. Action映射规则

| Detection Type | Action Type       |
| -------------- | ----------------- |
| annotation     | REMOVE_ANNOTATION |
| artifact       | REMOVE_ARTIFACT   |
| image          | REMOVE_IMAGE      |
| text           | REMOVE_TEXT       |
| header         | REMOVE_HEADER     |
| footer         | REMOVE_FOOTER     |

---

# 11. CleaningPlan生成

输出：

```python
CleaningPlan
```

---

示例：

```json
{
"file_path":
"test.pdf",

"risk_level":
"MEDIUM",

"actions":[

{
"action_type":
"REMOVE_TEXT",

"page":
3,

"confidence":
0.95

}

]

}
```

---

# 12. Dry-run报告

文件：

```text
reports/dry_run_report.py
```

---

实现：

```python
class DryRunReport:
```

---

输入：

```python
CleaningPlan
```

---

输出：

JSON报告。

---

示例：

```json
{
"file":

"exam.pdf",

"summary":

{
"total_detected":5,

"auto_remove":3,

"confirm":2,

"ignore":0

},

"actions":[

{
"type":
"text",

"page":5,

"confidence":0.93,

"decision":
"CONFIRM"

}

]

}
```

---

# 13. 单元测试要求

文件：

```text
tests/test_risk_engine.py
```

---

## Case 1 Annotation

输入：

```text
annotation

confidence=1.0
```

期望：

```text
AUTO
```

生成：

```text
REMOVE_ANNOTATION
```

---

## Case 2 高置信文本水印

输入：

```text
内部资料

confidence=0.95
```

期望：

```text
AUTO
```

---

## Case 3 低置信文本

输入：

```text
普通文本

confidence=0.5
```

期望：

```text
IGNORE
```

---

## Case 4 页眉

输入：

header：

confidence=0.85

期望：

```text
CONFIRM
```

---

# 14. 验收标准

## 功能

✅ DetectionResult可转换CleaningAction
✅ 风险评分完成
✅ AUTO/CONFIRM/IGNORE完成
✅ CleaningPlan生成完成
✅ Dry-run报告生成完成

---

## 数据

输出必须符合：

```python
CleaningPlan
```

模型。

---

# 15. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Risk Engine规则说明；
3. CleaningPlan示例；
4. Dry-run报告示例；
5. 单元测试结果。

---

# 16. 禁止事项

本任务禁止：

❌ 修改PDF
❌ 调用pikepdf
❌ 调用Cleaner
❌ 实际删除水印
❌ 自动处理扫描PDF
❌ 引入AI模型判断

---

# Task-004完成标志

达到：

> 系统可以将检测结果转换为安全可执行的清理计划，并明确哪些内容自动删除、哪些内容需要人工确认、哪些内容保持不变。

---
