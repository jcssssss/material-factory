# MF-001 文档清理引擎

# Claude Code 开发任务 Task-013

# Cleaner执行器与任务状态管理模块

（Cleaning Executor & Task Execution Manager）

---

# 1. Task目标

实现文档清理流程中的**执行层**。

本任务负责将：

```text
CleaningPlan

↓

Cleaner Executor

↓

PDF Cleaner / Word Cleaner

↓

CleaningResult

↓

Task Status

```

连接起来。

---

核心目标：

> 根据用户确认后的 CleaningPlan，安全执行清理动作，并实现单Action失败隔离、任务状态记录、异常恢复。

---

本任务负责：

✅ CleaningPlan加载
✅ Action执行调度
✅ PDF Cleaner接入
✅ Word Cleaner接入
✅ CleaningResult记录
✅ Action级失败隔离
✅ Task状态更新
✅ Cancel机制基础支持

---

本任务不负责：

❌ PDF具体删除算法
❌ Word具体删除算法
❌ UI任务展示
❌ 批量商品目录扫描

（由其他模块负责）

---

# 2. 当前任务上下文

完整架构：

```text
                 Detection

                    ↓

             DetectionResult

                    ↓

              Risk Engine

                    ↓

             CleaningPlan

                    ↓

             Task-013

          Cleaning Executor

                    ↓

        ┌───────────┴───────────┐

        ↓                       ↓

 PDF Cleaner              Word Cleaner

        ↓                       ↓

        CleaningResult

                    ↓

              Validator

```

---

已完成：

| Task         | 能力             |
| ------------ | -------------- |
| Task-005~008 | PDF检测模块        |
| Task-009~011 | Word分析与清理模块    |
| Task-012     | CleaningPlan生成 |

---

本任务：

建立统一执行入口。

---

# 3. 技术原则

## 原则1：Executor不负责删除逻辑

Executor只负责：

```
什么时候执行

执行什么Action

如何记录结果
```

---

具体删除：

由：

```
PDFCleaner

WordCleaner
```

完成。

---

## 原则2：Action失败不能导致整个任务失败

例如：

```
Action1 成功

Action2 失败

Action3 成功
```

结果：

```
PARTIAL_SUCCESS
```

---

## 原则3：执行前必须复制源文件

禁止：

直接修改输入文件。

流程：

```
source.pdf

↓

working/

↓

clean_xxx.pdf

```

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/


├── executor/

│
├── cleaning_executor.py
├── action_executor.py
│
├── task/

│
├── cleaning_task.py
├── task_manager.py
│
├── models/

│
├── execution_context.py
│
└── tests/

    ├── test_executor.py
    └── test_task_manager.py

```

---

# 5. ExecutionContext模型

文件：

```
models/execution_context.py
```

---

定义：

```python
@dataclass
class ExecutionContext:
```

---

字段：

```python
task_id:str

input_file:str

output_file:str

document_type:str

cancel_requested:bool

metadata:dict
```

---

用途：

保存：

一次清理任务运行环境。

---

# 6. CleaningTask模型

文件：

```
task/cleaning_task.py
```

---

定义：

```python
@dataclass
class CleaningTask:
```

---

字段：

```python
task_id:str

plan_id:str

file_path:str

status:str

progress:int

results:list[CleaningResult]

error:str|None
```

---

# 7. Task状态定义

状态：

```text
CREATED

↓

WAIT_CONFIRM

↓

READY

↓

RUNNING

↓

COMPLETED


异常：

PARTIAL_SUCCESS

FAILED

CANCELLED

NEED_REVIEW

```

---

说明：

## CREATED

任务创建。

---

## WAIT_CONFIRM

等待用户确认CleaningPlan。

---

## READY

Plan确认完成。

---

## RUNNING

执行中。

---

## COMPLETED

全部Action成功。

---

## PARTIAL_SUCCESS

部分Action失败。

---

## NEED_REVIEW

需要人工处理。

---

## CANCELLED

用户取消。

---

# 8. CleaningExecutor

文件：

```
executor/cleaning_executor.py
```

---

实现：

```python
class CleaningExecutor:
```

---

入口：

```python
def execute(
    self,
    plan:CleaningPlan
)->CleaningTask:
```

---

流程：

```
加载Plan

↓

创建Task

↓

初始化输出文件

↓

遍历Actions

↓

执行Action

↓

记录Result

↓

更新状态

↓

返回Task
```

---

# 9. Action执行流程

单Action：

```
CleaningAction

↓

判断document_type

↓

选择Cleaner

↓

执行

↓

返回CleaningResult

```

---

例如：

PDF：

```python
if action.action_type=="REMOVE_ANNOTATION":

    PDFCleaner.clean(action)

```

---

Word：

```python
if action.action_type=="REMOVE_SHAPE":

    WordObjectCleaner.clean(action)

```

---

# 10. ActionExecutor

文件：

```
executor/action_executor.py
```

---

实现：

```python
class ActionExecutor:
```

---

入口：

```python
def execute_action(
    self,
    action,
    context
)->CleaningResult:
```

---

职责：

1. Action路由；
2. 调用对应Cleaner；
3. 捕获异常；
4. 返回Result。

---

# 11. Cleaner注册方式

V1：

不使用插件系统。

采用：

简单条件映射。

例如：

```python
CLEANER_MAP={

"PDF":
PDFCleaner(),

"WORD":
WordCleaner()

}

```

---

原因：

V1 Cleaner数量固定。

避免：

动态加载复杂度。

---

# 12. Action失败处理

## 单Action失败

例如：

```
REMOVE_TEXT失败
```

处理：

```
记录ERROR日志

↓

保存CleaningResult

↓

继续下一个Action

```

---

Result：

```json
{
"status":"FAILED",

"error":"NODE_NOT_FOUND",

"fallback_action":"MANUAL_REVIEW"

}
```

---

# 13. 页面级失败策略

如果：

同一页面：

超过3个Action失败。

例如：

```
page=5

failed actions=4
```

---

处理：

```
标记页面异常

↓

任务状态:

NEED_REVIEW

```

---

# 14. 关键Action失败

以下属于关键失败：

## 页数变化

检测：

```
output_pages != input_pages
```

---

## 文件无法打开

检测：

```
PDF/DOCX reopen failed
```

---

处理：

```
任务FAILED

```

---

# 15. Cancel机制

支持：

轻量取消。

模型：

ExecutionContext：

```python
cancel_requested=True
```

---

执行循环：

```python
for action in actions:

    if context.cancel_requested:

        break

```

---

取消策略：

当前Action：

允许完成。

之后：

停止。

---

状态：

```
CANCELLED
```

---

# 16. 输出目录

Executor生成：

```
output/


clean/

    xxx_clean.pdf

    xxx_clean.docx


report/

    cleaning_plan.json

    execution_report.json


failed/

    xxx_error.json

```

---

# 17. Execution Report

输出：

```json
{
"task_id":"xxx",

"status":"COMPLETED",

"total_actions":10,

"success":10,

"failed":0,

"skipped":0
}
```

---

失败：

```json
{
"status":"PARTIAL_SUCCESS",

"failed_actions":[

{
"type":"REMOVE_TEXT",

"error":"NODE_NOT_FOUND"

}

]

}
```

---

# 18. 与Validator接口

Executor完成：

不直接判断质量。

调用：

```
Validator.validate(output)

```

---

流程：

```
Cleaner

↓

Validator

↓

最终状态

```

---

# 19. 单元测试

## test_executor.py

---

### Case 1 全部成功

输入：

10 Actions。

Mock Cleaner：

全部Success。

期望：

```
COMPLETED
```

---

### Case 2 单Action失败

输入：

3 Actions。

结果：

```
Success

Failed

Success

```

期望：

```
PARTIAL_SUCCESS
```

---

### Case 3 Cancel

执行中：

设置：

cancel_requested=True。

期望：

```
CANCELLED
```

---

### Case 4 Cleaner异常

模拟：

Cleaner抛异常。

期望：

捕获。

任务继续。

---

# 20. 验收标准

## 执行能力

必须完成：

✅ CleaningPlan执行
✅ Action路由
✅ Cleaner调用
✅ Result记录

---

## 稳定性

必须保证：

✅ 单Action失败不影响任务
✅ 异常捕获
✅ Cancel支持
✅ 输出报告

---

## 架构要求

必须保证：

Executor不包含：

* PDF解析代码；
* Word XML代码；
* 删除算法。

---

# 21. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Executor架构说明；
3. Action执行流程；
4. 状态机说明；
5. 测试结果；
6. 当前限制。

---

# 22. 禁止事项

本任务禁止：

❌ 修改Detector逻辑
❌ 修改Risk Engine
❌ 编写新的删除算法
❌ UI开发
❌ 批量商品处理

---

# Task-013完成标志

达到：

> 系统具备统一 CleaningPlan 执行能力，可以安全调度 PDF/Word Cleaner，支持 Action 级失败隔离、任务状态管理和基础取消机制。

---

下一任务：

# Task-014：清理结果验证器（Validator）模块

实现：

* PDF/Word输出完整性验证；
* 页数一致性检查；
* 文本/图片变化检测；
* expected_loss风险验证；
* 水印复检；
* 最终任务状态判定。
