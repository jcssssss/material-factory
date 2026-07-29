# MF-001 文档清理引擎

# Claude Code 开发任务 Task-015

# 批处理任务集成与日志系统模块

（Batch Cleaning Pipeline & Logging System）

---

# 1. Task目标

将文档清理引擎接入 MF-001 的批处理任务体系，实现：

> 多商品、多文件批量清理时，单个文件失败不影响整体流程，并提供完整执行日志和最终汇总报告。

---

本任务负责：

✅ 批量文件任务创建
✅ 商品级任务隔离
✅ 文件级任务隔离
✅ 异常跳过继续执行
✅ 批处理状态管理
✅ 日志系统
✅ 批处理报告生成
✅ 与 MF-001 Task System 对接

---

本任务不负责：

❌ 文件扫描导入
❌ 商品目录识别
❌ PDF/Word清理算法
❌ Detector实现
❌ UI日志展示

---

# 2. 当前任务上下文

完整流程：

```text
商品目录

↓

文件扫描

↓

Batch Task

↓

Cleaning Task

↓

Cleaning Executor

↓

Validator

↓

Batch Report

```

---

已完成：

| Task         | 能力           |
| ------------ | ------------ |
| Task-009~011 | Word/PDF清理能力 |
| Task-012     | CleaningPlan |
| Task-013     | 执行器          |
| Task-014     | 验证器          |

---

新增：

```text
Batch Manager

+

Logger

+

Report Generator

```

---

# 3. 核心设计原则

## 原则1：失败隔离

批量任务：

输入：

```text
商品A

├── 资料1.pdf

├── 资料2.docx


商品B

├── 错误文件.pdf

├── 资料3.pdf

```

执行：

```text
资料1 成功

↓

资料2 成功

↓

错误文件失败

↓

记录日志

↓

继续资料3

```

---

禁止：

```text
一个文件失败

↓

整个批次停止
```

---

# 4. 任务层级设计

采用三级任务模型：

```text
BatchTask

    |

    +-- ProductTask

            |

            +-- FileCleaningTask

```

---

## BatchTask

一次批量处理。

例如：

```text
20260730_batch_001
```

---

## ProductTask

一个商品资料包。

例如：

```text
自考00088资料包
```

---

## FileCleaningTask

单个文件。

例如：

```text
真题.pdf
```

---

# 5. 文件结构

新增：

```text
document_cleaning_engine/


├── batch/

│
├── batch_manager.py
├── batch_task.py
├── product_task.py
│
├── logging/

│
├── logger.py
├── log_formatter.py
│
├── report/

│
├── batch_report.py
│
├── models/

│
├── task_status.py
│
└── tests/

    ├── test_batch_manager.py
    └── test_logger.py

```

---

# 6. BatchTask模型

文件：

```text
models/batch_task.py
```

---

定义：

```python
@dataclass
class BatchTask:
```

---

字段：

```python
batch_id:str

created_time:str

total_products:int

total_files:int

completed_files:int

failed_files:int

status:str

metadata:dict
```

---

状态：

```text
CREATED

RUNNING

COMPLETED

COMPLETED_WITH_ERROR

FAILED

CANCELLED

```

---

# 7. ProductTask模型

文件：

```text
models/product_task.py
```

---

字段：

```python
product_id:str

product_name:str

file_tasks:list

status:str

success_count:int

failed_count:int

```

---

状态：

```text
WAITING

RUNNING

COMPLETED

FAILED

COMPLETED_WITH_ERROR

```

---

# 8. FileCleaningTask模型

字段：

```python
file_id:str

file_path:str

document_type:str

status:str

error:str|None

validation_status:str|None

```

---

状态：

```text
WAITING

ANALYZING

CLEANING

VALIDATING

COMPLETED

FAILED

SKIPPED

```

---

# 9. BatchManager

文件：

```text
batch/batch_manager.py
```

---

实现：

```python
class BatchManager:
```

---

入口：

```python
def run_batch(
    batch_task:BatchTask
):
```

---

流程：

```text
BatchTask

↓

遍历ProductTask

↓

遍历FileTask

↓

执行Cleaning Pipeline

↓

记录结果

↓

生成BatchReport

```

---

# 10. 文件失败隔离机制

核心逻辑：

```python
for file in files:

    try:

        process(file)


    except Exception:

        log_error(file)

        mark_failed(file)

        continue

```

---

要求：

任何：

* PDF损坏；
* Word异常；
* Cleaner失败；
* Validator失败；

都：

记录。

不中断。

---

# 11. 商品级状态规则

## 商品全部成功

例如：

```text
10/10文件成功
```

状态：

```text
COMPLETED
```

---

## 部分失败

例如：

```text
9成功

1失败

```

状态：

```text
COMPLETED_WITH_ERROR
```

---

## 全部失败

例如：

```text
0成功

10失败
```

状态：

```text
FAILED
```

---

# 12. 日志系统设计

文件：

```text
logging/logger.py
```

---

采用：

Python标准：

```python
logging
```

---

日志等级：

---

## DEBUG

详细检测过程：

例如：

```text
Found annotation object xref=123
```

---

## INFO

任务状态：

例如：

```text
Task started
```

---

## WARNING

降级：

例如：

```text
Form XObject skipped
```

---

## ERROR

失败：

例如：

```text
PDF open failed
```

---

# 13. 日志格式

统一：

JSON日志。

示例：

```json
{
"time":
"2026-07-30 10:00:00",

"level":
"ERROR",

"task_id":
"xxx",

"file":
"test.pdf",

"event":
"VALIDATION_FAILED",

"message":
"page count changed"

}
```

---

# 14. Logger接口

实现：

```python
class MFLogger:
```

---

方法：

```python
info()

warning()

error()

debug()

```

---

统一自动增加：

```text
task_id

file_id

product_id

timestamp

```

---

# 15. Batch Report

文件：

```text
report/batch_report.py
```

---

输出：

```json
{
"batch_id":"001",

"summary":

{

"total_files":100,

"success":95,

"failed":3,

"manual_review":2

}

}

```

---

# 16. 错误报告

失败文件：

生成：

```text
failed/

├── xxx_error.json

```

---

内容：

```json
{

"file":

"test.pdf",


"status":

"FAILED",


"reason":

"PDF_OPEN_ERROR",


"suggestion":

"manual_check"

}
```

---

# 17. Cancel机制集成

支持：

批处理取消。

流程：

```text
用户取消

↓

BatchManager收到信号

↓

停止创建新任务

↓

当前文件完成

↓

保存状态

```

---

状态：

```text
CANCELLED
```

---

# 18. 并发策略

V1：

采用：

顺序执行。

原因：

文档处理：

CPU/IO混合。

同时：

* 更稳定；
* 更容易控制内存；
* 日志更清晰。

---

V2：

再考虑：

Worker Pool。

---

# 19. 单元测试

## Test Batch Manager

### Case1 全部成功

输入：

10文件。

结果：

```text
COMPLETED
```

---

### Case2 一个失败

输入：

10文件。

其中：

1个损坏。

结果：

```text
9成功

1失败

COMPLETED_WITH_ERROR

```

---

### Case3 全部失败

结果：

```text
FAILED
```

---

# Test Logger

验证：

## INFO

生成日志。

## ERROR

包含：

error信息。

## JSON格式正确。

---

# 20. 验收标准

## 批处理能力

必须：

✅ 多文件执行
✅ 文件失败隔离
✅ 商品状态统计
✅ 批次状态统计

---

## 日志能力

必须：

✅ DEBUG
✅ INFO
✅ WARNING
✅ ERROR

---

## 报告能力

必须：

输出：

✅ 成功数量
✅ 失败数量
✅ 人工处理数量
✅ 错误详情

---

# 21. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Batch任务结构说明；
3. 失败隔离机制；
4. 日志格式说明；
5. Batch Report示例；
6. 测试结果；
7. 当前限制。

---

# 22. 禁止事项

本任务禁止：

❌ 多线程优化
❌ UI日志页面
❌ 文件导入模块
❌ 修改Cleaner算法
❌ 修改Validator逻辑

---

# Task-015完成标志

达到：

> 文档清理引擎具备生产级批处理能力，能够稳定处理大量商品资料文件，单个文件异常不会影响整体任务，并提供完整可追踪日志和结果报告。

---

下一任务：

# Task-016：MF-001文档清理引擎整体集成测试与Qoder/Claude Code验收任务

实现：

* PDF完整流程测试；
* Word完整流程测试；
* Batch端到端测试；
* 异常场景测试；
* 性能基准测试；
* V1.0交付验收。
