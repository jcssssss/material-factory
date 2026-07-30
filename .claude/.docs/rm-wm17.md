# MF-001 文档清理引擎

# Claude Code 开发任务 Task-017

# 文档清理引擎与 MF-001 主程序架构集成

（Document Cleaning Engine Integration）

---

# 1. Task目标

将已经完成的：

```text
Document Cleaning Engine
```

正式接入：

```text
AI资料素材工厂（MF-001）
```

主程序架构。

---

目标：

建立：

```text
用户操作入口

↓

MF-001 Task System

↓

Document Cleaning Engine

↓

Output Manager

↓

结果展示

```

完整调用链。

---

本任务负责：

✅ 清理引擎模块化接入
✅ 主任务系统调用接口
✅ 文件输入输出规范统一
✅ 状态同步
✅ 结果回传
✅ 配置管理
✅ 模块生命周期管理

---

本任务不负责：

❌ GUI界面开发
❌ 文件上传组件
❌ 商品管理模块
❌ 新增清理算法
❌ 修改PDF/Word Cleaner

---

# 2. 当前系统架构

当前：

```text
MF-001

├── Document Import

├── Task System

├── Document Cleaning Engine

├── Image Pipeline

├── Output Manager

└── GUI

```

---

本任务完成后：

```text
                 GUI

                  |

                  ↓

            Task Manager

                  |

                  ↓

        Document Cleaning Service

                  |

        ┌─────────┴─────────┐

        ↓                   ↓

 PDF Cleaner          Word Cleaner

        ↓                   ↓

             Validator

                  |

                  ↓

           Output Manager

```

---

# 3. 集成原则

## 原则1：清理引擎作为独立服务模块

主程序：

不直接调用：

```python
PDFCleaner.xxx()

```

---

而调用：

```python
DocumentCleaningService.clean()

```

---

原因：

保持：

* 高内聚；
* 低耦合；
* 后续替换实现容易。

---

# 4. 新增目录结构

调整：

```text
MF-001/


├── app/

│
├── services/

│
│── document_cleaning_service.py
│
│
├── task/

│
│── task_manager.py
│
│
├── document_cleaning_engine/

│
│── detector/
│── cleaner/
│── validator/
│── batch/
│
│
├── config/

│
│── cleaning_config.yaml

```

---

# 5. DocumentCleaningService

新增：

```text
services/document_cleaning_service.py
```

---

定义：

```python
class DocumentCleaningService:
```

---

职责：

统一提供：

```python
clean_document()

clean_batch()

preview()

get_status()

cancel()

```

---

# 6. 单文件清理接口

接口：

```python
def clean_document(
    file_path:str,
    mode:str="dry_run"
)->CleaningTask:
```

---

参数：

| 参数        | 说明   |
| --------- | ---- |
| file_path | 输入文件 |
| mode      | 执行模式 |

---

mode：

```text
dry_run

execute

```

---

流程：

```text
file_path

↓

Analyzer

↓

Detector

↓

CleaningPlan

↓

return

```

---

execute：

```text
CleaningPlan

↓

Cleaner

↓

Validator

↓

Result

```

---

# 7. 批处理接口

接口：

```python
def clean_batch(
    folder_path:str
)->BatchTask:
```

---

输入：

例如：

```text
商品A/

├──资料1.pdf

├──资料2.docx

```

---

流程：

```text
扫描文件

↓

创建BatchTask

↓

执行BatchManager

↓

返回BatchReport

```

---

# 8. MF-001 Task System对接

已有状态：

```text
CREATED

SCANNING

WAITING

RUNNING

COMPLETED

COMPLETED_WITH_ERROR

FAILED

CANCELLED

```

---

清理引擎状态映射：

| Cleaning Engine | MF-001 Task          |
| --------------- | -------------------- |
| CREATED         | CREATED              |
| RUNNING         | RUNNING              |
| COMPLETED       | COMPLETED            |
| PARTIAL_SUCCESS | COMPLETED_WITH_ERROR |
| FAILED          | FAILED               |
| CANCELLED       | CANCELLED            |
| NEED_REVIEW     | WAITING              |

---

# 9. Task Event机制

增加：

```python
TaskEvent
```

---

模型：

```python
@dataclass
class TaskEvent:
```

---

字段：

```python
task_id:str

event_type:str

timestamp:str

message:str

metadata:dict
```

---

事件：

```text
TASK_CREATED

TASK_STARTED

TASK_PROGRESS

TASK_COMPLETED

TASK_FAILED

TASK_CANCELLED

```

---

用途：

未来：

* GUI进度展示；
* 日志；
* 通知系统。

---

# 10. 配置系统

新增：

```text
config/cleaning_config.yaml
```

---

示例：

```yaml
cleaning:

  dry_run_default: true

  auto_delete_threshold: 0.8

  enable_pdf_cleaning: true

  enable_word_cleaning: true


validation:

  page_check: true

  watermark_recheck: true


logging:

  level: INFO

```

---

# 11. 依赖管理

统一：

requirements.txt

新增：

```text
pymupdf

pikepdf

python-docx

lxml

pyyaml

pytest

```

---

版本固定：

例如：

```text
PyMuPDF==xxx

pikepdf==xxx

```

---

原因：

避免环境差异。

---

# 12. 异常统一处理

新增：

```python
CleaningException
```

---

异常分类：

```text
DocumentOpenError

UnsupportedDocumentError

CleaningFailedError

ValidationFailedError

TaskCancelledError

```

---

Service层统一捕获：

```python
try:

    execute()


except CleaningException:

    update_task_status()

    write_log()

```

---

# 13. 输出规范统一

所有清理输出：

进入：

```text
Output Manager
```

---

禁止：

Cleaner自行决定输出路径。

---

输出：

```text
output/


商品名/

    清理后文件/

        xxx_clean.pdf

    reports/

        cleaning_report.json

```

---

# 14. 与未来图片流水线连接

预留：

```text
Document Cleaning

↓

Image Pipeline

↓

仿打印

↓

商品图片生成

```

---

接口：

```python
get_cleaned_file()
```

---

返回：

```json
{
"path":

"xxx_clean.pdf",

"status":

"completed"

}

```

---

# 15. 单元测试

## Test Service

### Case1 Dry-run

输入：

PDF。

验证：

返回：

CleaningPlan。

---

### Case2 Execute

输入：

PDF。

验证：

返回：

CleaningResult。

---

### Case3 Batch

输入：

商品目录。

验证：

BatchReport。

---

### Case4 Cancel

执行中取消。

验证：

状态：

CANCELLED。

---

# 16. 集成测试

测试：

完整流程：

```text
GUI模拟请求

↓

Task Manager

↓

Cleaning Service

↓

Engine

↓

Output Manager

```

---

验证：

* 状态同步；
* 文件输出；
* 日志生成；
* 报告生成。

---

# 17. Claude Code输出要求

完成后输出：

## 1. 集成架构说明

说明：

主程序如何调用清理引擎。

---

## 2. 新增文件列表

例如：

```text
services/

config/

models/

```

---

## 3. API接口说明

列出：

```text
clean_document()

clean_batch()

cancel()

```

---

## 4. 状态映射说明

展示：

Engine状态 → MF-001状态。

---

## 5. 测试结果

包括：

* 单文件；
* 批处理；
* 异常流程。

---

# 18. 禁止事项

本任务禁止：

❌ 修改Cleaner内部逻辑
❌ 修改Detector算法
❌ 引入Web服务
❌ 开发GUI
❌ 开发数据库系统

---

# Task-017完成标志

达到：

> 文档清理引擎成为 MF-001 AI资料素材工厂的标准功能模块，可以被主程序统一调用，并具备后续接入图片生成、商品处理流水线的能力。

---

## 下一任务

# Task-018：文档清理引擎 V1.0 文档与开发规范整理

目标：

为 Claude Code/Qoder 后续维护建立：

* 模块说明文档；
* API文档；
* 开发约束；
* 调试指南；
* 部署说明；
* V1.0版本归档。
 刚在桌面端运行测试，输出文件在/Users/shijichang/Downloads/777/00041《基础会计学
  》复习资料。其中问题：1.00041《基础会计学》考前30天_clean.pdf，页眉页脚“更多资
  料请关注公众号【在爬坡的路上】“，文件有页眉页脚却没检测到。2.00041《基础会计学
  》章节练习题_clean.pdf，页眉页脚“更多资料请关注公众号【在爬坡的路上】“没有去除
  ，具体为文件第一页感觉像用白色覆盖了一半内容，页脚没去除，其他页的眉页脚没有处
  理。3.00041《基础会计学》名词解释_clean.pdf，问题和 2
  一样。4.00041《基础会计学》押题笔记资料_clean.pdf，文件有页眉，检测缺陷时无水印
  ，“更多资料请关注公众号【公众号:在爬坡的路上】“没有去除。5.00041《基础会计学》
  复习资料.pdf文件成功检测并去除。
─────────────────────────────────────