# MF-001 文档清理引擎

# Claude Code 开发任务 Task-003

# PDF 水印检测模块（PDF Watermark Detector）

---

# 1. Task目标

实现 PDF 文档检测能力。

本任务负责：

1. 扫描 PDF 内可能存在的非主体元素；
2. 识别候选水印对象；
3. 输出统一 `DetectionResult`；
4. 为后续 Risk Engine 和 Cleaning Plan 提供输入。

---

本任务只负责：

> 检测（Detect）

不负责：

* 判断最终是否删除；
* 修改 PDF；
* 执行清理。

---

# 2. 当前任务上下文

当前流程：

```text
PDF文件

↓

Task-002 PDF Analyzer

↓

Task-003 PDF Detector

↓

Task-004 Risk Engine

↓

Cleaner
```

Task-003回答：

> “PDF中有哪些元素可能属于水印、页眉、页脚？”

---

# 3. 技术约束

## 必须使用

PDF解析：

```text
PyMuPDF (fitz)
```

---

辅助：

```text
hashlib
statistics
```

---

禁止：

❌ OCR
❌ AI模型识别
❌ 修改PDF内容
❌ 使用pikepdf删除对象

---

# 4. 文件结构

新增：

```text
document_cleaning_engine/

├── detector/

│   ├── __init__.py
│   ├── pdf_detector.py
│   ├── annotation_detector.py
│   ├── artifact_detector.py
│   ├── image_detector.py
│   ├── text_detector.py
│   └── header_footer_detector.py

└── tests/

    └── test_pdf_detector.py

```

---

# 5. Detector统一接口

文件：

```text
detector/pdf_detector.py
```

---

实现：

```python
class PDFDetector:
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

内部调用：

```text
PDFDetector

    |
    |
    +-- AnnotationDetector

    +-- ArtifactDetector

    +-- ImageDetector

    +-- TextDetector

    +-- HeaderFooterDetector

```

---

最终统一返回：

```python
list[DetectionResult]
```

---

# 6. Annotation检测模块

文件：

```text
annotation_detector.py
```

---

目标：

检测：

PDF Annotation对象。

---

读取：

```python
page.annots()
```

---

检测信息：

获取：

* annotation类型；
* 内容；
* bbox。

---

输出：

```python
DetectionResult(
    type="annotation",
    page=1,
    bbox=(x0,y0,x1,y1),
    content="xxx",
    confidence=1.0
)
```

---

置信度：

固定：

```text
1.0
```

原因：

Annotation属于结构化对象。

---

# 7. Artifact Watermark检测模块

文件：

```text
artifact_detector.py
```

---

目标：

检测：

PDF Artifact中的Watermark。

---

检测范围：

支持：

```text
/Subtype /Watermark
```

---

实现要求：

读取PDF结构信息。

---

输出：

```python
DetectionResult(
    type="artifact",
    confidence=1.0
)
```

---

限制：

只检测：

Watermark Artifact。

不处理：

```text
Header

Footer

Pagination
```

---

# 8. 图片水印检测模块

文件：

```text
image_detector.py
```

---

目标：

发现：

重复出现的图片对象。

例如：

* Logo；
* 平台标识；
* 半透明图片。

---

## 检测流程

```text
页面图片对象

↓

提取图片信息

↓

计算图片hash

↓

统计出现次数

↓

评分

↓

输出DetectionResult

```

---

# 9. 图片水印评分模型

评分：

100分制。

---

## 跨页重复

权重：

40%

规则：

同一图片：

出现页面比例。

例如：

100页中出现90页：

高分。

---

## 面积占比

权重：

25%

计算：

```text
图片面积 / 页面面积
```

---

## 中央位置

权重：

20%

判断：

是否位于：

```text
页面中央区域
```

---

## 透明度

权重：

15%

判断：

图片alpha。

---

综合：

```python
confidence = score / 100
```

---

阈值：

```text
>=0.8

候选水印

```

---

输出：

```python
DetectionResult(
type="image",
confidence=0.85
)
```

---

# 10. 文本水印检测模块

文件：

```text
text_detector.py
```

---

目标：

检测：

文本型水印候选。

---

使用：

PyMuPDF：

```python
page.get_text("dict")
```

---

提取：

TextBlock：

包括：

```text
text

bbox

font

size

origin

```

---

检测规则：

综合评分。

---

# 11. 文本水印评分模型

## 关键词匹配

权重：

30%

词库：

初始：

```text
机密

内部资料

Confidential

Draft

Sample

版权所有

Copyright

禁止传播

```

---

## 位置评分

权重：

25%

高风险区域：

```text
页面中央

斜向区域

边缘区域

```

---

## 跨页重复

权重：

30%

判断：

相同文本：

多页出现。

---

## 样式评分

权重：

15%

判断：

* 字体大小；
* 旋转角度；
* 透明效果。

---

最终：

```python
confidence>=0.8
```

输出候选。

---

# 12. 页眉页脚检测模块

文件：

```text
header_footer_detector.py
```

---

检测区域：

顶部：

```text
0%-15%
```

底部：

```text
85%-100%
```

---

检测：

文本块。

---

评分：

| 指标    |  权重 |
| ----- | --: |
| 跨页重复率 | 40% |
| 位置    | 25% |
| 字体大小  | 15% |
| 距离正文  | 10% |
| 文本长度  | 10% |

---

输出：

类型：

```text
header

footer
```

---

# 13. DetectionResult输出规范

所有Detector必须返回：

```python
DetectionResult(
    type="text",

    page=5,

    bbox=(0,0,100,50),

    content="内部资料",

    confidence=0.92,

    metadata={
        "font_size":20
    }
)
```

---

# 14. 单元测试要求

文件：

```text
tests/test_pdf_detector.py
```

---

测试：

## Case 1 Annotation

输入：

带Annotation PDF。

期望：

检测数量 >0。

---

## Case 2 图片Logo

输入：

多页重复Logo PDF。

期望：

识别image。

---

## Case 3 文本水印

输入：

中央重复：

"内部资料"

期望：

confidence >=0.8。

---

## Case 4 页眉

输入：

每页顶部：

固定文本。

期望：

header检测成功。

---

# 15. 验收标准

## 功能

✅ Annotation检测完成
✅ Artifact检测完成
✅ 图片水印候选检测完成
✅ 文本水印候选检测完成
✅ 页眉页脚候选检测完成

---

## 接口

必须：

所有检测结果统一：

```python
list[DetectionResult]
```

---

## 性能

要求：

100页PDF：

检测时间：

<10秒（普通电脑）

---

# 16. Claude Code输出要求

完成后输出：

1. 新增文件列表；
2. Detector实现说明；
3. DetectionResult示例；
4. 测试结果；
5. 当前无法处理的情况。

---

# 17. 禁止事项

本任务禁止：

❌ 删除任何PDF对象
❌ 修改Content Stream
❌ 使用pikepdf
❌ OCR处理扫描PDF
❌ 处理Form XObject递归内容

---

# Task-003完成标志

达到：

> 系统能够扫描PDF并输出所有高概率非主体元素，为后续风险判断和安全删除提供标准化检测结果。

---

下一任务：

# Task-004：Risk Engine 与 Cleaning Plan 生成模块

实现：

* 检测结果风险评分；
* AUTO / CONFIRM / IGNORE 三等级策略；
* 生成 CleaningPlan JSON；
* 用户确认前的 Dry-run 输出。
