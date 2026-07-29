# MF-001 文档清理引擎

# Claude Code 开发任务 Task-012

# Cleaning Plan 与 Dry-run 报告模块

（Cleaning Plan Generator & Dry-run Report System）

---

# 1. Task目标

建立文档清理流程中的**检测结果汇总与执行计划生成模块**。

本任务解决：

检测模块只负责发现问题，但不能直接删除。

需要增加中间层：

```
Detector

↓

DetectionResult

↓

Risk Engine

↓

CleaningPlan

↓

Cleaner执行

```

---

本任务负责：

✅ 汇总PDF/Word检测结果
✅ 风险等级计算
✅ 自动/确认/忽略决策
✅ 生成CleaningPlan JSON
✅ Dry-run报告生成
✅ 用户确认数据结构

---

本任务不负责：

❌ 实际删除文件
❌ PDF清理执行
❌ Word清理执行
❌ UI界面开发
❌ 文件预览渲染

---

# 2. 当前任务上下文

完整流程：

```
Document Input

↓

Analyzer

↓

Detector

↓

DetectionResult

↓

Task-012

Cleaning Plan

↓

Cleaner

↓

Validator
```

---

已完成：

| 任务           | 能力       |
| ------------ | -------- |
| Task-005~008 | PDF检测模块  |
| Task-009     | Word结构分析 |
| Task-010     | Word文本清理 |
| Task-011     | Word对象清理 |

---

新增：

```
Risk Engine

+

Cleaning Plan Generator

+

Dry-run Reporter
```

---

# 3. 核心设计原则

## 原则1：Detector与Cleaner解耦

Detector：

只回答：

> 发现了什么？

Cleaner：

只回答：

> 如何删除？

中间：

CleaningPlan：

负责：

> 删除哪些、为什么删除、风险是多少。

---

## 原则2：Dry-run就是Plan生成

V1不单独创建：

```
PlanGenerator

DryRunGenerator
```

---

统一：

```
Dry-run输出

=

CleaningPlan JSON
```

---

流程：

```
扫描

↓

生成Plan

↓

用户确认

↓

Cleaner执行

```

---

# 4. 文件结构

新增：

```
document_cleaning_engine/


├── plan/

│
├── cleaning_plan.py
├── plan_generator.py
│
├── risk/

│
├── risk_engine.py
│
├── report/

│
├── dry_run_report.py
│
├── models/

│
├── cleaning_action.py
├── cleaning_result.py
│
└── tests/

    ├── test_plan_generator.py
    └── test_risk_engine.py

```

---

# 5. 核心数据模型

## 5.1 CleaningAction

文件：

```
models/cleaning_action.py
```

---

定义：

```python
@dataclass
class CleaningAction:
```

---

字段：

```python
action_id:str

action_type:str

page:int|None

bbox:tuple|None

target_ref:str|None

target_type:str

confidence:float

risk_level:str

metadata:dict
```

---

## action_type

支持：

```text
REMOVE_ANNOTATION

REMOVE_ARTIFACT

REMOVE_IMAGE

REMOVE_HEADER

REMOVE_FOOTER

REMOVE_TEXT

REMOVE_SHAPE

REMOVE_DRAWING
```

---

## target_ref

用于定位删除目标。

示例：

| 类型         | target_ref    |
| ---------- | ------------- |
| Annotation | annot_ref_xxx |
| Image      | xref_123      |
| Word Shape | xml_path      |
| Text       | node_hash     |

---

# 6. CleaningPlan模型

文件：

```
models/cleaning_plan.py
```

---

定义：

```python
@dataclass
class CleaningPlan:
```

---

字段：

```python
plan_id:str

file_path:str

document_type:str

created_time:str

actions:list[CleaningAction]

summary:dict

risk_level:str

status:str
```

---

status：

```text
DRAFT

WAIT_CONFIRM

CONFIRMED

EXECUTING

COMPLETED

FAILED
```

---

# 7. CleaningResult模型

文件：

```
models/cleaning_result.py
```

---

定义：

```python
@dataclass
class CleaningResult:
```

---

字段：

```python
action_id:str

status:str

error:str|None

fallback_action:str|None

metadata:dict
```

---

status：

```text
SUCCESS

FAILED

SKIPPED
```

---

fallback_action：

```text
MANUAL_REVIEW

RETRY

SKIP
```

---

# 8. Risk Engine设计

文件：

```
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
    detection:DetectionResult
)->CleaningAction:
```

---

# 9. 风险等级模型

三级策略：

---

## AUTO

自动删除。

条件：

```
confidence >=0.9
```

并且：

满足安全条件：

```
非正文区域

对象明确

删除范围小
```

---

示例：

Annotation水印：

```
confidence=0.98
```

结果：

```
AUTO
```

---

## CONFIRM

人工确认。

范围：

```
0.6 <= confidence <0.9
```

---

示例：

版权文本：

```
Copyright 2026
```

---

## IGNORE

忽略。

条件：

```
confidence <0.6
```

---

# 10. 风险评分规则

基础：

```
Detection confidence
```

---

调整因素：

## 删除面积

增加：

```
+20风险
```

---

## 删除对象数量

大量删除：

增加：

```
+20风险
```

---

## 正文覆盖

如果：

```
正文区域
```

增加：

```
+40风险
```

---

最终：

```python
risk_score=0-100
```

---

映射：

| 分数     | 等级     |
| ------ | ------ |
| 0-30   | LOW    |
| 30-70  | MEDIUM |
| 70-100 | HIGH   |

---

# 11. Plan Generator

文件：

```
plan/plan_generator.py
```

---

实现：

```python
class PlanGenerator:
```

---

入口：

```python
def generate(
    detections:list[DetectionResult]
)->CleaningPlan:
```

---

流程：

```
DetectionResult

↓

RiskEngine

↓

CleaningAction

↓

过滤IGNORE

↓

生成Plan

```

---

# 12. CleaningPlan JSON格式

输出：

```
cleaning_plan.json
```

---

示例：

```json
{
 "file":"test.pdf",

 "risk_level":"LOW",

 "actions":[

  {
   "action_type":"REMOVE_TEXT",

   "page":1,

   "target_ref":"text_hash_001",

   "confidence":0.95

  }

 ]

}
```

---

# 13. Dry-run报告

文件：

```
report/dry_run_report.py
```

---

实现：

```python
class DryRunReporter:
```

---

入口：

```python
def generate(
    plan:CleaningPlan
)->dict:
```

---

输出内容：

---

## 文件信息

```json
{
"name":"xxx.pdf",

"type":"PDF",

"pages":100
}
```

---

## 检测结果

例如：

```json
{
"type":"text_watermark",

"content":"内部资料",

"page":"all",

"confidence":0.95
}
```

---

## 建议动作

```json
{
"action":"REMOVE",

"mode":"AUTO"
}
```

---

## 风险提示

```json
{
"risk":"LOW",

"message":"高置信水印，可自动处理"
}
```

---

# 14. 用户确认流程数据

V1：

不实现UI。

只提供状态。

流程：

```
WAIT_CONFIRM

↓

用户确认

↓

CONFIRMED

```

---

接口：

```python
def confirm_plan(
    plan_id:str
)
```

---

修改：

```text
status:

WAIT_CONFIRM

↓

CONFIRMED
```

---

# 15. 多检测结果合并

例如：

同一个对象：

检测：

```
Text Detector

+

Header Detector
```

---

合并规则：

相同：

```
page

+

bbox

+

content
```

---

合并：

提高confidence。

---

# 16. 异常处理

## 无检测结果

返回：

```
EMPTY_PLAN
```

---

## Plan生成失败

记录：

```
PLAN_GENERATE_ERROR
```

---

## JSON序列化失败

返回：

```
REPORT_ERROR
```

---

# 17. 单元测试

## Test Risk Engine

### Case1 高置信Annotation

输入：

```
confidence=0.98
```

期望：

```
AUTO
```

---

### Case2 版权文本

输入：

```
confidence=0.75
```

期望：

```
CONFIRM
```

---

### Case3 正文关键词

输入：

```
confidence=0.3
```

期望：

```
IGNORE
```

---

# Test Plan Generator

验证：

输入：

10个DetectionResult。

输出：

```
CleaningPlan

actions数量正确

ignore未进入plan
```

---

# Test JSON

验证：

可以：

```
json.dumps(plan)
```

---

# 18. 验收标准

## 数据层

必须完成：

✅ CleaningAction
✅ CleaningPlan
✅ CleaningResult

---

## 风险层

必须完成：

✅ AUTO
✅ CONFIRM
✅ IGNORE

---

## Dry-run

必须输出：

✅ 检测列表
✅ 删除建议
✅ 风险等级
✅ JSON文件

---

## 扩展性

必须支持：

未来新增：

```
OCR Detector

AI Detector

```

无需修改Cleaner。

---

# 19. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. 数据模型说明；
3. Risk Engine规则；
4. CleaningPlan示例；
5. Dry-run输出示例；
6. 测试结果；
7. 当前限制。

---

# 20. 禁止事项

本任务禁止：

❌ 执行删除
❌ 修改PDF/Word文件
❌ UI开发
❌ 引入插件系统
❌ 动态模块加载

---

# Task-012完成标志

达到：

> 系统具备统一的检测结果决策能力，可以将 PDF/Word 检测结果转换为标准 CleaningPlan，并通过 Dry-run 模式让用户确认后进入清理执行阶段。

---

下一任务：

# Task-013：Cleaner执行器与任务状态管理模块

实现：

* CleaningPlan执行；
* PDF Cleaner接入；
* Word Cleaner接入；
* CleaningResult记录；
* 单Action失败隔离；
* 批处理任务状态同步。
