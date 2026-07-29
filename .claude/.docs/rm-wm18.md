# MF-001 文档清理引擎

# Claude Code 开发任务 Task-018

# 文档清理引擎 V1.0 文档与开发规范整理

（Documentation & Development Standardization）

---

# 1. Task目标

整理 MF-001 文档清理引擎 V1.0 的工程文档，使后续：

* Claude Code；
* Qoder；
* AI开发工程师；
* 人类开发人员；

能够快速理解、维护和扩展该模块。

---

本任务目标：

> 建立文档清理引擎的工程知识库，避免后续开发依赖聊天上下文。

---

本任务负责：

✅ 模块架构文档
✅ 目录结构说明
✅ API接口文档
✅ 数据模型说明
✅ 开发规范
✅ 调试指南
✅ 测试说明
✅ 部署说明
✅ V1.0限制说明

---

本任务不负责：

❌ 修改代码逻辑
❌ 新增功能
❌ 架构重构
❌ 性能优化
❌ UI文档

---

# 2. 当前状态

已完成：

```text
Task-001 ~ Task-017
```

形成：

```text
MF-001 Document Cleaning Engine V1.0
```

---

当前问题：

代码已经具备：

* Detector；
* Risk Engine；
* CleaningPlan；
* Cleaner；
* Validator；
* Batch；
* Service；

但缺少：

工程说明。

---

# 3. 输出文档结构

新增：

```text
docs/


├── document-cleaning-engine/

│
├── README.md

├── architecture.md

├── api.md

├── data-model.md

├── development-guide.md

├── testing-guide.md

├── debugging-guide.md

├── deployment-guide.md

└── limitations.md

```

---

# 4. README.md

文件：

```text
docs/document-cleaning-engine/README.md
```

---

内容：

必须包含：

## 模块介绍

示例：

```markdown
# Document Cleaning Engine

MF-001 AI资料素材工厂文档清理模块。

用于自动检测和清理：

- PDF水印
- Word页眉页脚
- 文档非主体元素

```

---

## 核心能力

列表：

```text
PDF:

✓ Annotation
✓ Artifact
✓ Image watermark
✓ Text watermark
✓ Header/Footer


Word:

✓ Header
✓ Footer
✓ Shape
✓ DrawingML

```

---

## Pipeline

展示：

```text
Analyze

↓

Detect

↓

Risk

↓

Plan

↓

Clean

↓

Validate

```

---

# 5. architecture.md

记录：

系统架构。

---

内容：

## 模块关系

```text
document_cleaning_engine/


├── analyzer

├── detector

├── risk

├── planner

├── cleaner

├── validator

├── batch

└── service

```

---

## 数据流

```text
Document

↓

DetectionResult

↓

CleaningPlan

↓

CleaningAction

↓

CleaningResult

↓

ValidationReport

```

---

## 设计原则

记录：

### 1.

检测与删除分离。

### 2.

高风险操作必须确认。

### 3.

失败隔离。

### 4.

验证优先。

---

# 6. api.md

记录：

对外接口。

---

## DocumentCleaningService

主要接口：

---

## clean_document()

```python
clean_document(
    file_path,
    mode
)

```

---

参数：

| 参数        | 说明                |
| --------- | ----------------- |
| file_path | 文件路径              |
| mode      | dry_run / execute |

---

返回：

```python
CleaningTask
```

---

## clean_batch()

```python
clean_batch(
    folder_path
)

```

---

返回：

```python
BatchTask
```

---

## cancel()

```python
cancel(
 task_id
)

```

---

作用：

取消任务。

---

# 7. data-model.md

记录核心数据结构。

---

## DetectionResult

```python
class DetectionResult:

    type:str

    page:int

    bbox:tuple

    content:str

    confidence:float

    metadata:dict

```

---

## CleaningAction

```python
class CleaningAction:

    action_type:str

    page:int

    bbox:tuple

    target_ref:str

    target_type:str

    confidence:float

    metadata:dict

```

---

## CleaningPlan

包含：

```python
plan_id

file_id

actions

risk_level

estimated_loss

```

---

## CleaningResult

包含：

```python
action

status

error

fallback_action

```

---

## ValidationReport

包含：

```python
status

file_check

structure_check

content_check

watermark_check

```

---

# 8. development-guide.md

开发规范。

---

## 代码原则

必须：

### 高内聚

例如：

Detector：

只负责检测。

---

### 低耦合

禁止：

Cleaner调用Detector。

---

## 新增检测器规范

V1：

直接新增：

```python
detect_xxx()

```

返回：

```python
List[DetectionResult]

```

---

禁止：

引入：

* 注册系统；
* 动态插件。

---

## 新增Cleaner规范

必须：

输入：

```python
CleaningAction

```

输出：

```python
CleaningResult

```

---

# 9. testing-guide.md

测试规范。

---

测试分层：

## Unit Test

测试：

单模块。

例如：

```text
test_detector.py

test_validator.py

```

---

## Integration Test

测试：

完整流程。

例如：

```text
Document

↓

Output

```

---

## Regression Test

每次修改必须运行：

```bash
pytest tests/
```

---

# 10. debugging-guide.md

调试指南。

---

## 日志位置

例如：

```text
logs/

├── application.log

├── error.log

```

---

## 调试模式

开启：

```yaml
logging:

 level: DEBUG

```

---

## 常见问题

---

### PDF无法打开

检查：

```text
文件损坏

加密

版本兼容

```

---

### 水印删除失败

检查：

```text
是否Form XObject

是否图片扫描

是否结构复杂

```

---

### Word删除异常

检查：

```text
header XML

drawingML

relationship

```

---

# 11. deployment-guide.md

部署说明。

---

内容：

## 环境要求

Python：

```text
3.11+
```

---

依赖：

```text
PyMuPDF

pikepdf

python-docx

lxml

PyYAML

```

---

## 安装

```bash
pip install -r requirements.txt
```

---

## 启动测试

```bash
pytest
```

---

# 12. limitations.md

明确V1边界。

---

## 不支持

### 扫描PDF擦除

原因：

需要：

OCR + 图像修复。

---

### 隐形数字水印

原因：

需要专用算法。

---

### Form XObject递归修改

策略：

跳过。

---

### 加密PDF破解

策略：

人工处理。

---

# 13. 版本记录

新增：

```text
CHANGELOG.md
```

---

内容：

```markdown
## V1.0

Initial release


Features:

- PDF cleaning
- Word cleaning
- Batch processing
- Validation
- Logging

```

---

# 14. Claude Code输出要求

完成后输出：

## 1. 文档目录

例如：

```text
docs/

document-cleaning-engine/

```

---

## 2. 文档列表

说明：

每个文件用途。

---

## 3. 文档一致性检查

确认：

* API与代码一致；
* 数据模型一致；
* 状态机一致。

---

## 4. V1.0开发归档说明

输出：

```text
Document Cleaning Engine V1.0 READY

```

---

# 15. 禁止事项

本任务禁止：

❌ 修改代码架构
❌ 修改接口定义
❌ 新增功能
❌ 重构模块
❌ 修改PRD范围

---

# Task-018完成标志

达到：

> MF-001 文档清理引擎 V1.0 具备完整工程文档，任何新开发人员或AI Agent无需阅读历史聊天记录即可理解、维护和继续开发。

---

# 后续任务规划

如果进入下一阶段：

## Task-019：MF-001 文档清理引擎 V1.0 发布准备与Git版本管理

目标：

* 代码整理；
* 分支策略；
* Release Tag；
* CHANGELOG；
* V1.0归档；
* 后续V1.1开发入口。
