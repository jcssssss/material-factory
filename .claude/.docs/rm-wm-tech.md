> **MF-001 V1 不应该以“水印评分器”为核心，而应该以“PDF结构重建 + 对象关系分析 + 模式识别 + 安全删除 + 删除验证”为核心。**
>
> 评分只作为**未知候选对象的辅助置信度**，不是主算法。

pikepdf 本身可以解析 PDF Content Stream、操作符和 Form XObject；其文档明确说明 Content Stream 描述文字、图片和矢量绘制，且 parser 适合分析、低层 TokenFilter 更适合修改。([pikepdf.readthedocs.io][1]) qpdf 则负责 PDF 对象层面的读写、对象流、交叉引用等底层细节。([qpdf][2]) PyMuPDF 适合做页面级文本、图片、坐标、渲染和最终视觉验证。([PyMuPDF][3])

---

# 一、最终架构

我建议 MF-001 PDF Watermark Engine V1 采用 **六层架构**：

```text
                    PDF
                     │
                     ▼
┌─────────────────────────────────────┐
│  Layer 1  PDF Structural Parser     │
│  PDF结构解析                         │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Layer 2  Object & Content Analyzer │
│  对象 / Content Stream 分析          │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Layer 3  Pattern Detection Engine  │
│  跨页模式 / 关系 / 聚类分析           │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Layer 4  Watermark Classifier      │
│  水印 / 页眉 / 页脚分类               │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Layer 5  Safe Removal Engine       │
│  安全删除 / 结构修复                  │
└──────────────────┬──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│  Layer 6  Validation Engine         │
│  删除验证 / 完整性验证                │
└─────────────────────────────────────┘
```

这里最重要的是：

**检测和删除必须彻底分离。**

不能：

```text
发现可疑对象
↓
马上删除
```

必须：

```text
发现候选
↓
建立证据
↓
分类
↓
生成 Removal Plan
↓
安全删除
↓
验证
```

---

# 二、底层技术路线

我建议不要只使用一个 PDF 库。

采用：

### `qpdf`

负责：

> PDF底层结构与文件安全重写

### `pikepdf`

负责：

> Python 层 PDF Object / Content Stream 操作

### `PyMuPDF`

负责：

> 页面级几何信息、文本、图片、渲染、视觉验证

三者职责不要混。

---

## 推荐关系

```text
                  MF-001
                     │
          ┌──────────┼──────────┐
          │          │          │
       pikepdf      qpdf     PyMuPDF
          │          │          │
       对象分析    底层重写    页面分析
       Content     PDF结构    文本
       Stream      修复        图片
       XObject                 坐标
                              Render
```

pikepdf 官方也明确定位为更适合**检查、编辑和转换已有 PDF**，而不是从零生成 PDF。([pikepdf.readthedocs.io][4])

---

# 三、第一层：PDF Structural Parser

这里不要急着判断水印。

第一件事情是：

> **把 PDF 变成一个可以被算法分析的“结构数据库”。**

例如：

```text
PDFDocument
│
├── Pages
│
├── Catalog
│
├── Resources
│
├── Fonts
│
├── XObjects
│
├── Images
│
├── Annotations
│
├── OCG
│
└── ContentStreams
```

---

# 四、建立统一 Object Model

这是整个项目最重要的设计之一。

不要让后面的检测器直接操作 pikepdf 对象。

建立自己的：

```text
PdfElement
```

例如：

```text
PdfElement {
    id
    page_id
    xref
    element_type
    bbox
    matrix
    z_order
    content_ref
    resource_ref
    fingerprint
}
```

类型：

```text
TEXT
IMAGE
FORM_XOBJECT
VECTOR
ANNOTATION
ARTIFACT
OCG
UNKNOWN
```

这样以后换底层库，Watermark Engine 不需要重写。

---

# 五、第二层：Content Stream Analyzer

这是参考 oPDF 思路最重要的部分。

PDF页面不是简单的“文字+图片”。

它实际上是：

```text
Content Stream

q
...
cm
...
BT
...
Tj
...
ET

Do

...
Q
```

pikepdf 官方文档也明确说明 Content Stream 是由操作符和操作数组成的绘制指令流，负责描述文字、图片和矢量绘制。([pikepdf.readthedocs.io][1])

因此我们应该解析：

```text
q
Q
cm
BT
ET
Tj
TJ
Tf
Tm
Td
Do
gs
BDC
EMC
```

重点追踪：

### Text

```text
BT ... ET
```

### Image / Form

```text
/Name Do
```

### Graphics State

```text
gs
```

### Transformation

```text
cm
```

### Artifact

```text
BDC
EMC
```

---

# 六、不要只看对象，要建立“绘制事件”

例如：

```text
Page 1

Event #001
TEXT
bbox=(50,700,200,720)
text="XXX大学"

Event #002
TEXT
bbox=(300,350,700,420)
text="内部资料"

Event #003
IMAGE
bbox=(500,50,550,100)
```

这样才能进行真正的布局分析。

---

# 七、第三层：Pattern Detection Engine

这里是整个算法的核心。

不使用：

> “每个对象打一个分”

而是先寻找：

> **重复模式、共享关系、空间模式、内容模式。**

---

# 算法一：跨页重复模式检测

这是我认为 MF-001 最值得做的算法。

例如：

100页：

```text
Page 1:
中心 → 内部资料

Page 2:
中心 → 内部资料

Page 3:
中心 → 内部资料

...

Page 100:
中心 → 内部资料
```

建立：

```text
Fingerprint
↓
Page Frequency
↓
Spatial Consistency
↓
Style Consistency
```

如果：

```text
出现页数 = 100 / 100
位置差异 ≈ 0
内容相同
字体相同
透明度相同
```

那么它已经不是简单“评分”。

而是：

> **强结构模式证据。**

---

# 八、算法二：对象引用图

这是比简单评分更高级的地方。

例如：

```text
Page 1 ─┐
Page 2 ─┤
Page 3 ─┤
Page 4 ─┤──> Form XObject #37
Page 5 ─┤
...     │
Page 100┘
```

发现：

```text
XObject #37

被100页引用
```

再发现：

```text
固定位置
固定矩阵
透明
```

那么几乎可以确定：

> 这是共享水印对象。

---

# 九、算法三：对象指纹

对每个对象生成：

```text
Structural Fingerprint
```

例如：

```text
TEXT:
normalized_text
font
font_size
color
opacity
rotation

IMAGE:
width
height
hash
color_space
smask

FORM:
content_hash
resource_hash
bbox
```

例如：

```text
TEXT_FP =
SHA256(
  text
  font
  size
  rotation
  color
)
```

这样可以识别：

> 同一个水印在不同页面被重复使用。

---

# 十、算法四：空间模式检测

对于页眉/页脚尤其重要。

建立页面坐标归一化：

```text
x' = x / page_width
y' = y / page_height
```

这样：

A4：

```text
595 × 842
```

和：

Letter：

```text
612 × 792
```

都可以比较。

---

例如：

```text
y' < 0.10
```

可能是 Header。

```text
y' > 0.90
```

可能是 Footer。

然后再判断：

```text
跨页重复
+
位置稳定
+
内容稳定
```

而不是单纯：

> “顶部=页眉”。

---

# 十一、算法五：内容相似度

解决：

```text
内部资料-01
内部资料-02
内部资料-03
```

这种水印。

不能只做字符串完全匹配。

可以做：

```text
Normalization
↓
Token Similarity
↓
Edit Distance
↓
SimHash
```

例如：

```text
内部资料 001
内部资料 002
内部资料 003
```

识别为同一水印族。

---

# 十二、第四层：Watermark Classifier

经过前面分析以后，才进入分类。

分类不是：

```text
score = 83
```

而是：

```text
Candidate
│
├── Explicit Watermark
├── Shared Watermark
├── Text Watermark
├── Image Watermark
├── Form XObject Watermark
├── Artifact
├── Layer
├── Header
├── Footer
└── Unknown
```

---

# 十三、建立“证据链”

每一个候选对象必须有：

```text
Evidence
```

例如：

```text
Candidate #27

Type:
TEXT

Evidence:

✓ 出现 120/120 页
✓ 页面位置一致
✓ rotation = 45°
✓ opacity = 0.20
✓ 字体明显大于正文
✓ 文本为“内部资料”
✓ 与正文区域重叠
```

然后：

```text
Classification:
WATERMARK

Removal:
SAFE
```

---

# 十四、评分还要不要？

**要，但只能作为最后一层。**

例如：

```text
Evidence Engine
        ↓
Rules
        ↓
Pattern
        ↓
Classification
        ↓
Confidence
```

最终可以：

```text
confidence = 0.997
```

但是这个数字不是：

```text
位置30
+
透明20
+
旋转20
```

这种简单加分。

而是：

> **对多种证据综合后的置信度。**

V1甚至可以先不使用 ML。

---

# 十五、V1最推荐的决策体系

我建议直接采用三态：

```text
DETERMINISTIC
HIGH_CONFIDENCE
UNKNOWN
```

而不是：

```text
0-100分
```

---

## DETERMINISTIC

例如：

```text
/Watermark Annotation

/Artifact

明确 OCG Watermark
```

直接：

```text
AUTO_REMOVE
```

---

## HIGH_CONFIDENCE

例如：

```text
XObject

100页重复

位置固定

透明

相同Hash
```

可以：

```text
AUTO_REMOVE
```

---

## UNKNOWN

例如：

```text
某段文字
出现3页
位置不稳定
```

：

```text
DO_NOT_REMOVE
```

---

# 十六、第五层：Removal Planner

这个模块非常重要。

**检测器不负责删除。**

检测器只输出：

```text
Candidate
```

然后：

```text
Removal Planner
```

生成：

```text
Removal Plan
```

例如：

```text
RemovalPlan

Target #001
type = Annotation
action = DELETE_OBJECT

Target #002
type = FormXObject
action = REMOVE_REFERENCE

Target #003
type = Text
action = REMOVE_CONTENT_RANGE
```

---

# 十七、为什么需要 Removal Plan？

因为一个水印可能涉及：

```text
Page
 ↓
Content Stream
 ↓
Do
 ↓
Form XObject
 ↓
Image
 ↓
SMask
```

你不能只删除：

```text
Image
```

否则：

```text
Do
```

还在那里。

甚至可能造成：

```text
PDF损坏
```

所以必须：

> **对象 + 引用 + Resource 三者联动删除。**

---

# 十八、第六层：Safe Removal Engine

按照不同类型使用不同删除器。

---

## Remover A

### Annotation

```text
Page.Annots
↓
Remove
```

---

## Remover B

### Artifact

删除：

```text
BDC
...
EMC
```

对应内容块。

---

## Remover C

### Text

删除对应：

```text
BT
...
ET
```

或者精确的：

```text
Tj
TJ
```

但这里必须非常谨慎。

因为 pikepdf 官方明确提醒：Content Stream parser 适合分析，而不应该直接拿解析结果去重建/编辑内容流；底层 TokenFilter 更适合精确修改。([pikepdf.readthedocs.io][5])

所以：

> **分析层和修改层使用不同机制。**

这是技术架构中必须写死的原则。

---

# 十九、Form XObject

如果：

```text
Page
 ↓
Do /Fm1
 ↓
Form XObject
```

而 `/Fm1` 被确定为水印：

需要：

```text
删除 Do 调用
+
清理 Resource
+
必要时删除 XObject
```

而不是简单：

```text
delete /Fm1
```

---

# 二十、Image Object

如果：

```text
Image Object
```

是独立水印：

```text
Do
 ↓
Image
```

删除：

```text
Do
+
Image Resource
```

如果图片还有：

```text
SMask
```

也要检查引用关系。

---

# 二十一、Layer / OCG

如果确定：

```text
OCG = Watermark
```

需要同时处理：

```text
OCProperties
+
Content Stream中的OC标记
```

避免产生残留引用。

---

# 二十二、删除之后必须做两级验证

这是 MF-001 和普通 PDF 去水印脚本最应该拉开差距的地方。

---

# Level 1：结构验证

检查：

```text
PDF可以重新打开
```

然后：

```text
页数是否一致
Page Tree是否正常
XRef是否正常
Object是否正常
字体是否正常
```

qpdf 的设计目标之一就是隐藏对象位置、增量更新、对象流、过滤器和加密等底层 bookkeeping，让应用层可以安全读写 PDF。([qpdf][6])

---

# Level 2：视觉验证

必须：

```text
Before Render
        ↓
After Render
        ↓
Image Diff
```

---

# 二十三、Diff 不是判断“水印消失”的唯一标准

因为删除水印以后：

```text
Before:
水印存在

After:
水印不存在
```

Diff本来就会有变化。

所以要做：

### Expected Diff

删除区域：

```text
Candidate Bounding Box
```

允许变化。

### Unexpected Diff

正文区域：

```text
不能发生异常变化
```

---

# 二十四、建立“正文保护区”

例如：

```text
Watermark bbox:

x=200
y=300
w=300
h=100
```

验证：

```text
允许变化区域：
Watermark bbox

保护区域：
正文其他区域
```

如果正文区域发生大量像素变化：

```text
VALIDATION_FAILED
```

---

# 二十五、最终完整 Pipeline

我建议最终定成：

```text
                PDF
                 │
                 ▼
        ┌────────────────┐
        │ PDF Loader     │
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │ Structure      │
        │ Parser         │
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │ Content Stream │
        │ Analyzer       │
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │ Object Model    │
        └───────┬────────┘
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
  Object Analysis   Page Analysis
        │                │
        └───────┬────────┘
                ▼
       Pattern Detection
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
   Deterministic    Pattern Based
   Detection        Detection
        │                │
        └───────┬────────┘
                ▼
        Watermark Classifier
                │
                ▼
          Evidence Builder
                │
                ▼
        ┌─────────────────┐
        │ Removal Planner │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Safe Remover    │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Structural QC   │
        └────────┬────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Render & Visual │
        │ Validation      │
        └────────┬────────┘
                 │
          ┌──────┴───────┐
          ▼              ▼
       PASS           FAIL
          │              │
          ▼              ▼
      Clean PDF      Original PDF
```

---

# 二十六、V1到底实现哪些算法？

我建议**不要一开始上机器学习**。

第一版采用：

### P0：确定性结构检测

```text
Annotation
Artifact
OCG
明确 Watermark Metadata
```

### P0：对象关系分析

```text
XObject Reference Graph
Resource Reference
Page Reference
```

### P0：跨页模式检测

```text
Frequency
Position
Transformation
Style
Fingerprint
```

### P0：文本模式检测

```text
Normalized Text
Similarity
SimHash
```

### P0：空间模式检测

```text
Header
Footer
Center Watermark
Corner Logo
```

### P0：删除验证

```text
Structure QC
+
Render Diff
```

---

# 二十七、V1暂时不要做

## ❌ 不做深度学习水印检测

原因不是做不到。

而是：

**没有必要。**

你的业务资料具有非常强的结构规律。

---

## ❌ 不做 AI 图像擦除

例如：

```text
扫描图片
+
水印
```

这种应该进入另一个：

```text
Image Watermark Removal Engine
```

而不是污染 PDF Structural Engine。

学术上的可见水印移除方法确实存在“定位水印 + 背景恢复”的深度学习路线，但它本质上已经是图像修复问题，而不是 PDF 结构清理问题。([arXiv][7])

---

# 二十八、我对 MF-001 V1 的最终建议

把整个 PDF 去水印系统定义为：

## `MF-PDF-WE-001`

### PDF Watermark Engine

下面拆：

```text
MF-PDF-WE-001
PDF Loader

MF-PDF-WE-002
Structure Parser

MF-PDF-WE-003
Content Stream Analyzer

MF-PDF-WE-004
PDF Object Model

MF-PDF-WE-005
Reference Graph Analyzer

MF-PDF-WE-006
Fingerprint Engine

MF-PDF-WE-007
Cross-Page Pattern Detector

MF-PDF-WE-008
Header/Footer Detector

MF-PDF-WE-009
Watermark Classifier

MF-PDF-WE-010
Evidence Engine

MF-PDF-WE-011
Removal Planner

MF-PDF-WE-012
Safe Removal Engine

MF-PDF-WE-013
Structural Validator

MF-PDF-WE-014
Visual Validator

MF-PDF-WE-015
Removal Report
```

---

## 最重要的设计原则

我建议把下面这句话直接写进技术规范：

> **MF-001 不以“判断一个对象是不是水印的单一评分”为核心，而以 PDF 结构证据、对象引用关系、跨页重复模式、空间一致性和内容相似性构建多证据检测体系；只有确定性规则或多证据一致的高置信度候选才允许自动删除，所有删除操作必须生成 Removal Plan，并经过结构验证与视觉验证。**

这样设计以后，MF-001 的目标就从：

> “做一个去水印脚本”

升级成了真正的：

> **PDF Document Cleaning Engine。**

而且这条路线与 pikepdf/qpdf 的实际能力边界是吻合的：pikepdf 负责结构和 Content Stream 操作，qpdf负责底层 PDF 重写，PyMuPDF负责页面级分析和渲染验证。([pikepdf.readthedocs.io][1])
