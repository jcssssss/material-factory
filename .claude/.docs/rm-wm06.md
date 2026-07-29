# MF-001 文档清理引擎

# Claude Code 开发任务 Task-006

# PDF 图片水印检测与删除模块（Image Watermark Detector & Cleaner）

---

# 1. Task目标

实现 PDF 中**图片型水印的检测与安全删除能力**。

本任务负责：

1. 提取 PDF 页面图片对象；
2. 分析图片重复特征；
3. 判断图片是否可能为水印；
4. 生成图片删除 Action；
5. 执行图片 XObject 删除；
6. 输出清理结果。

---

本任务处理：

✅ Logo水印
✅ 平台标识图片
✅ 半透明图片水印
✅ 多页重复图片水印

---

本任务不处理：

❌ 扫描PDF中的图片内容擦除
❌ OCR识别图片文字
❌ 图片修复填充
❌ Form XObject递归图片处理

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

Cleaner

↓

Validator
```

---

已完成：

* Task-003：检测框架
* Task-004：风险评估
* Task-005：结构化对象删除

---

Task-006新增：

```text
ImageDetector

+

ImageCleaner
```

---

# 3. 技术约束

## PDF解析

必须：

```text
PyMuPDF (fitz)
```

---

## PDF修改

使用：

```text
pikepdf
```

---

辅助：

```text
hashlib
PIL(optional)
```

---

禁止：

❌ 使用OCR
❌ 图像AI分类模型
❌ OpenCV复杂视觉算法
❌ 删除扫描PDF图片内容
❌ 自动擦除图片内部文字

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/

├── detector/

│   ├── image_detector.py
│
├── cleaner/

│   ├── image_cleaner.py
│
├── models/

│   └── image_info.py
│
└── tests/

    ├── test_image_detector.py
    └── test_image_cleaner.py

```

---

# 5. ImageInfo数据模型

文件：

```text
models/image_info.py
```

---

实现：

```python
class ImageInfo:
```

---

字段：

```python
xref: int

page: int

width: int

height: int

bbox: tuple

image_hash: str

opacity: float | None

metadata: dict
```

---

说明：

| 字段         | 说明        |
| ---------- | --------- |
| xref       | PDF图片对象编号 |
| page       | 所在页       |
| width      | 图片宽度      |
| height     | 图片高度      |
| bbox       | 页面位置      |
| image_hash | 图片唯一hash  |
| opacity    | 透明度       |
| metadata   | 扩展信息      |

---

# 6. 图片对象提取模块

文件：

```text
detector/image_detector.py
```

---

实现：

```python
class ImageDetector:
```

---

入口：

```python
def detect(
    self,
    pdf_path:str
)->list[DetectionResult]:
```

---

流程：

```text
打开PDF

↓

遍历页面

↓

获取图片对象

↓

生成ImageInfo

↓

图片特征分析

↓

水印评分

↓

输出DetectionResult

```

---

# 7. PDF图片提取

使用：

```python
page.get_images(full=True)
```

---

获取：

```text
xref
width
height
```

---

通过：

```python
doc.extract_image(xref)
```

获取图片数据。

---

# 8. 图片Hash计算

目的：

判断：

> 是否同一个图片对象重复出现。

---

算法：

```python
hashlib.sha256()
```

---

输入：

图片二进制。

输出：

```text
image_hash
```

---

示例：

```text
a8f93d8xxxx
```

---

# 9. 图片重复分析

统计：

```text
image_hash

出现次数

出现页面比例

```

---

示例：

PDF：

100页

图片A：

出现：

95页

判断：

高重复图片。

---

计算：

```python
repeat_rate =
appear_pages / total_pages
```

---

# 10. 图片水印评分模型

采用PRD定义：

100分制。

公式：

```
score =
repeat_score
+
area_score
+
position_score
+
opacity_score
```

---

## 10.1 跨页重复

权重：

40%

计算：

```text
repeat_rate × 40
```

---

示例：

出现90%页面：

36分。

---

## 10.2 面积占比

权重：

25%

计算：

```
image_area/page_area
```

---

规则：

面积适中：

高分。

避免：

整页扫描图片误判。

---

## 10.3 中央位置

权重：

20%

判断：

图片中心点：

是否位于：

```text
页面中央区域
```

---

## 10.4 透明度

权重：

15%

透明：

加分。

---

# 11. 输出DetectionResult

检测成功：

```python
DetectionResult(
    type="image",

    page=5,

    bbox=(100,100,300,200),

    confidence=0.86,

    metadata={
        "xref":123,
        "image_hash":"xxx",
        "score":86
    }
)
```

---

阈值：

```
confidence >=0.8

进入CleaningPlan
```

---

# 12. Image Cleaner

文件：

```text
cleaner/image_cleaner.py
```

---

实现：

```python
class ImageCleaner:
```

---

入口：

```python
def clean(
    self,
    pdf,
    action
)->CleaningResult:
```

---

# 13. 图片删除策略

删除目标：

不是删除图片文件本身。

而是：

```text
删除页面引用关系
```

---

流程：

```text
CleaningAction

↓

target_ref=xref

↓

定位Image XObject

↓

删除引用

↓

保存PDF
```

---

# 14. 安全限制

V1只处理：

## 独立Image XObject

支持：

```
Page
 |
 +-- Image XObject
```

---

不处理：

```
Page

 |
 +-- Form XObject

        |
        +-- Image
```

---

原因：

Form内部递归结构复杂。

---

处理：

输出：

```text
SKIPPED

reason:
FORM_XOBJECT_IMAGE
```

---

# 15. Image Cleaner执行结果

成功：

```python
CleaningResult(
    status="SUCCESS"
)
```

---

失败：

```python
CleaningResult(
    status="FAILED",

    error="image reference not found",

    fallback_action="manual_review"
)
```

---

# 16. 图片删除风险控制

执行前检查：

---

## 检查1

图片重复率：

必须：

```
>=0.5
```

否则：

跳过。

---

## 检查2

图片覆盖面积：

如果：

```
>20%页面面积
```

停止删除。

原因：

可能是正文图片。

---

## 检查3

扫描PDF保护

如果：

PDF类型：

```text
SCAN_PDF
```

禁止：

REMOVE_IMAGE。

---

# 17. 单元测试要求

## test_image_detector.py

---

### Case 1 重复Logo

输入：

100页PDF

Logo出现90页。

期望：

检测：

```text
type=image

confidence>0.8
```

---

### Case 2 普通插图

输入：

每页不同图片。

期望：

不生成水印。

---

### Case 3 大面积图片

输入：

整页图片。

期望：

低风险。

---

# test_image_cleaner.py

---

### Case 4 删除图片引用

验证：

删除前：

```
image_count=10
```

删除后：

```
image_count=9
```

---

### Case 5 删除失败隔离

模拟：

不存在xref。

期望：

```text
FAILED

不中断其他Action
```

---

# 18. 验收标准

## 检测

✅ 图片对象提取完成
✅ 图片Hash计算完成
✅ 跨页重复分析完成
✅ 图片水印评分完成

---

## 删除

✅ Image XObject引用删除完成
✅ CleaningResult输出完成
✅ Form XObject自动跳过

---

## 安全

必须保证：

| 项目    | 要求  |
| ----- | --- |
| 页数    | 不变化 |
| 文本    | 不变化 |
| 非目标图片 | 不删除 |
| 扫描PDF | 不处理 |

---

# 19. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. ImageDetector实现说明；
3. 图片评分规则；
4. 删除策略说明；
5. 测试结果；
6. 当前限制。

---

# 20. 禁止事项

本任务禁止：

❌ 删除图片内部水印内容
❌ OCR识别图片
❌ AI图片分类
❌ Form XObject递归
❌ 扫描PDF图片擦除
❌ 修改图片像素

---

# Task-006完成标志

达到：

> 系统能够识别PDF中高概率图片型水印，并安全删除独立Image XObject引用，同时保证正文内容和页面结构不受影响。

---

下一任务：

# Task-007：PDF文本水印检测与删除模块

实现：

* 文本块定位；
* 水印关键词识别；
* 跨页重复分析；
* Content Stream定位；
* pikepdf指令级删除；
* Form XObject跳过策略。

（该任务是整个文档清理引擎技术难度最高的核心任务。）
