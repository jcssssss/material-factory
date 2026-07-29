# 需求概览
MF-001 文档清理引擎（Document Cleaning Engine）PRD V1.0


1. 需求背景
1.1 业务背景

AI资料素材工厂用于自动化处理考试资料、课程资料、电子文档等虚拟商品素材。

当前资料处理流程中，经常存在：

PDF版权水印
Word页眉页脚
文档来源标记
内部资料标识
下载平台水印
页码干扰
扫描件水印

这些内容会影响：

商品展示效果
仿打印图片生成效果
用户购买体验
资料标准化程度

目前人工处理方式：

下载资料

↓

人工打开PDF/Word

↓

寻找水印

↓

删除

↓

导出

↓

检查

存在：

效率低
批量处理困难
容易漏删
不适合大量商品生产

因此需要建设：

自动检测并处理文档中的水印、页眉、页脚等非主体内容的文档清理引擎。

2. 产品目标
2.1 核心目标

实现：

对 PDF、Word 文档中的高置信度非主体元素进行自动检测、风险评估、安全删除，并输出标准化文档。

2.2 V1目标

支持：

Word

✅ 水印删除
✅ 页眉删除
✅ 页脚删除
✅ 图片/形状水印删除

PDF

✅ Annotation水印删除
✅ Artifact Watermark删除
✅ 图片水印检测删除
✅ 页眉页脚检测删除
✅ 高置信文本水印处理

同时：

提供：

Dry-run检测模式
删除预览
风险提示
删除后质量验证
3. 非目标范围（V1不做）

以下内容不属于V1：

类型	原因
扫描PDF自动擦除水印	需要OCR+图像修复
隐形数字水印	需要专用算法
频域水印	超出业务范围
复杂XObject递归修改	风险高
加密PDF破解	安全限制
OCR擦除水印	容易破坏资料
4. 用户场景
场景1：单文件清理

用户：

上传一个PDF资料。

系统：

检测：

发现：

中央文本水印：
"内部资料"

置信度：
92%

建议：
删除

用户：

确认。

系统：

输出：

clean_xxx.pdf
场景2：批量商品资料处理

输入：

商品A/

├── 真题.pdf
├── 答案.docx

商品B/

├── 教材.pdf

系统：

逐文件处理。

异常：

商品B/教材.pdf

检测：
扫描PDF

状态：
待人工处理

不中断其他任务。

5. 产品流程
总流程
输入文件夹（含pdf\word）

↓

文档分析

↓

类型识别

↓

元素扫描

↓

风险评分

↓

Dry-run报告

↓

用户确认

↓

执行清理

↓

质量验证

↓

输出文件夹



# 任务拆分
## 项目基础架构与核心数据模型
1. Task目标

建立 Document Cleaning Engine 基础工程结构。

完成：

创建模块目录结构；
建立核心数据模型；
建立模块之间的基础接口；
为后续 PDF / Word 清理模块提供统一数据结构。

本任务不实现任何检测和清理逻辑。

2. 当前任务上下文

MF-001 文档清理引擎整体流程：

文件输入

↓

Document Analyzer

↓

Detector

↓

Risk Engine

↓

Cleaning Plan

↓

Cleaner

↓

Validator

↓

Output

Task-001 只负责：

基础结构

+

数据模型

+

接口定义
3. 技术约束
技术栈

必须使用：

Python 3.11+
dataclasses 或 Pydantic（二选一）

推荐：

使用：

dataclasses

原因：

依赖少；
本地桌面应用适合；
性能足够；
后续可迁移 Pydantic。
4. 项目目录要求

创建：

document_cleaning_engine/

├── analyzer/
│   └── __init__.py
│
├── detector/
│   └── __init__.py
│
├── cleaner/
│   └── __init__.py
│
├── validator/
│   └── __init__.py
│
├── risk/
│   └── __init__.py
│
├── pipeline/
│   └── __init__.py
│
├── models/
│   ├── __init__.py
│   ├── detection.py
│   ├── cleaning_action.py
│   ├── cleaning_plan.py
│   ├── cleaning_result.py
│   └── validation.py
│
├── reports/
│   └── __init__.py
│
├── logger/
│   └── __init__.py
│
├── tests/
│   └── test_models.py
│
└── main.py

5. 核心数据模型实现
5.1 DetectionResult

文件：

models/detection.py

用途：

保存检测模块输出结果。

实现：

DetectionResult

字段：

type: str

page: int

bbox: tuple | None

content: str | None

confidence: float

metadata: dict

字段说明：

字段	说明
type	检测类型
page	页码，1-based
bbox	元素位置
content	检测内容
confidence	置信度0-1
metadata	扩展信息

type 示例：

annotation

artifact

image

text

header

footer

5.2 CleaningAction

文件：

models/cleaning_action.py

用途：

描述一次删除动作。

实现：

CleaningAction

字段：

action_type: str

page: int | None

bbox: tuple | None

target_ref: str | None

target_type: str

confidence: float

metadata: dict


action_type：

示例：

REMOVE_ANNOTATION

REMOVE_ARTIFACT

REMOVE_IMAGE

REMOVE_TEXT

REMOVE_HEADER

REMOVE_FOOTER

target_type：

示例：

annotation

artifact

image_xref

text_block

header_xml

5.3 CleaningPlan

文件：

models/cleaning_plan.py

用途：

Dry-run阶段生成的执行计划。

注意：

CleaningPlan不是独立业务模块。

它是：

Dry-run输出结果

供 Cleaner 使用。

字段：

file_path: str

actions: list[CleaningAction]

created_time: str

risk_level: str

metadata: dict

risk_level：

LOW

MEDIUM

HIGH
5.4 CleaningResult

文件：

models/cleaning_result.py

用途：

记录Action执行结果。

字段：

action: CleaningAction

status: str

error: str | None

fallback_action: str | None

metadata: dict


status：

SUCCESS

FAILED

SKIPPED


fallback_action：

示例：

manual_review

retry

skip

5.5 ValidationReport

文件：

models/validation.py

用途：

保存清理后验证结果。

字段：

passed: bool

page_check: bool

content_check: bool

watermark_check: bool

warnings: list[str]

metadata: dict

6. 基础接口定义

创建：

pipeline/interfaces.py

定义：

Detector接口
class Detector:

    def detect(self, document):
        pass


返回：

list[DetectionResult]
Cleaner接口
class Cleaner:

    def clean(
        self,
        plan
    ):
        pass


返回：

list[CleaningResult]
Validator接口
class Validator:

    def validate(
        self,
        original,
        cleaned
    ):
        pass


返回：

ValidationReport
7. 单元测试要求

文件：

tests/test_models.py

测试：

DetectionResult

验证：

可以创建；
字段正常。
CleaningAction

验证：

action_type正常；
metadata为空时默认{}。
CleaningPlan

验证：

可以保存多个Action。
CleaningResult

验证：

success状态。
8. 本任务输出结果

完成后代码应该具备：

document_cleaning_engine

可以被import

↓

models可实例化

↓

接口存在

↓

测试通过

9. 验收标准

Claude Code 完成后必须满足：

代码

✅ 项目目录创建完成
✅ 所有model文件存在
✅ 所有class可以import
✅ 无循环依赖

测试

执行：

pytest tests/

结果：

PASS
输出说明

Claude Code需要提交：

修改文件列表；
实现内容摘要；
测试结果；
当前未实现内容。
10. 禁止事项

本任务禁止：

❌ 实现PDF解析
❌ 实现水印检测
❌ 引入FastAPI
❌ 引入数据库
❌ 修改MF-001整体架构
❌ 自行增加插件系统
❌ 创建复杂依赖管理系统

Task-001完成标志

达到：

文档清理引擎具备稳定的数据基础层，后续所有检测器、清理器、验证器均可以基于统一模型开发。

下一任务：

Task-002：PDF文档分析模块开发

目标：

实现 PDF 类型识别：

TEXT_PDF
SCAN_PDF
MIXED_PDF
ENCRYPTED_PDF

并建立 PDF Analyzer 基础能力。