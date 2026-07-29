// 水印/页眉/页脚检测与移除模块。
//
// 架构遵循 warp.rs 先例：
//   - 纯逻辑函数（无 IPC 依赖）→ 便于单元测试
//   - Tauri 命令包装层（薄 IPC 转发）
//
// 检测策略：
//   1. 文本水印：内容流文本提取 + 跨页频次分析（正文区重复文本）
//   2. 图片水印：Image XObject 跨页频次分析
//   3. Form 水印：Form XObject 跨页频次分析 + BDC/EMC Artifact 标记检测
//   4. Annotation 水印：直接读取 /Annots 数组
//   5. 页眉/页脚：y 坐标阈值
//
// 移除策略：
//   - 文本/图片水印：白块覆盖（追加白色矩形填充指令）
//   - Form 水印：清空内容流（一处修改，全文档水印消失）
//   - Annotation 水印：直接从 /Annots 数组中删除

use std::collections::{BTreeMap, HashMap, HashSet};

use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::{Deserialize, Serialize};

// ─── 数据结构（前后端共用，通过 serde 序列化经 Tauri IPC 传输）───

/// 水印/页眉/页脚检测报告。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkReport {
    /// 是否检测到水印（正文区重复文本/图片/Form/Annotation）
    pub has_watermark: bool,
    /// 是否检测到页眉
    pub has_header: bool,
    /// 是否检测到页脚
    pub has_footer: bool,
    /// 检测到的区域详情
    pub regions: Vec<RegionInfo>,
    /// PDF 总页数
    pub page_count: u32,
    /// 简短摘要（前端展示用）
    pub summary: String,
}

/// 单个检测区域。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegionInfo {
    /// 出现的页码（1-based）
    pub page_number: u32,
    /// 文本内容 / 描述
    pub text: String,
    /// 区域类型
    #[serde(rename = "type")]
    pub region_type: RegionType,
    /// 归一化矩形 (x0, y0, x1, y1)，坐标 0.0~1.0 相对于页面尺寸
    pub bbox: (f64, f64, f64, f64),
    /// XObject 的对象编号（仅 Image/Form 水印有效），用于移除阶段精确定位
    pub xobject_id: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RegionType {
    Header,
    Footer,
    Watermark,
    PageNumber,
    #[serde(rename = "image_watermark")]
    ImageWatermark,
    #[serde(rename = "annotation_watermark")]
    AnnotationWatermark,
    #[serde(rename = "form_watermark")]
    FormWatermark,
}

/// 水印移除结果。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkRemovalResult {
    /// 输出 PDF 路径
    pub output_path: String,
    /// 是否移除了页眉
    pub removed_header: bool,
    /// 是否移除了页脚
    pub removed_footer: bool,
    /// 是否移除了水印
    pub removed_watermark: bool,
    /// 移除的元素数量
    pub removed_count: usize,
}

/// 批量处理请求项。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkRequest {
    pub input_path: String,
    pub output_path: String,
}

/// 批量处理结果项。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkResult {
    pub input_path: String,
    pub output_path: String,
    pub success: bool,
    pub error: Option<String>,
    pub report: Option<WatermarkReport>,
    pub removal: Option<WatermarkRemovalResult>,
}

// ─── 内部类型 ───

/// 单个页面中提取的文本元素。
#[derive(Debug, Clone)]
struct TextElement {
    text: String,
    x0: f64, y0: f64, x1: f64, y1: f64,
}

/// CTM（Current Transformation Matrix），用于追踪 PDF 内容流中的当前变换矩阵。
#[derive(Debug, Clone, Copy)]
struct Ctm {
    a: f64, b: f64, c: f64, d: f64, e: f64, f: f64,
}

impl Ctm {
    fn identity() -> Self {
        Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 }
    }

    /// 后乘：CTM = CTM * other（PDF 行向量约定）
    fn concat(&mut self, other: &Ctm) {
        let a = self.a * other.a + self.c * other.b;
        let b = self.b * other.a + self.d * other.b;
        let c = self.a * other.c + self.c * other.d;
        let d = self.b * other.c + self.d * other.d;
        let e = self.a * other.e + self.c * other.f + self.e;
        let f = self.b * other.e + self.d * other.f + self.f;
        *self = Self { a, b, c, d, e, f };
    }

    /// 将图像空间点 (x, y) 变换到用户空间
    fn transform(&self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y + self.e, self.b * x + self.d * y + self.f)
    }

    /// 单位正方形 [0,1]×[0,1] 变换后的包围盒
    fn unit_bbox(&self) -> (f64, f64, f64, f64) {
        let bl = self.transform(0.0, 0.0);
        let br = self.transform(1.0, 0.0);
        let tl = self.transform(0.0, 1.0);
        let tr = self.transform(1.0, 1.0);
        let xs = [bl.0, br.0, tl.0, tr.0];
        let ys = [bl.1, br.1, tl.1, tr.1];
        let x0 = xs.iter().cloned().fold(f64::INFINITY, f64::min);
        let x1 = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let y0 = ys.iter().cloned().fold(f64::INFINITY, f64::min);
        let y1 = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        (x0, y0, x1, y1)
    }
}

/// 从内容流中提取的图片 XObject 元素。
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct ImageElement {
    xobject_name: String,
    xobject_id: ObjectId,
    x0: f64, y0: f64, x1: f64, y1: f64,
    pixel_width: u32,
    pixel_height: u32,
}

/// 从内容流中提取的 Form XObject 元素。
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct FormElement {
    xobject_name: String,
    xobject_id: ObjectId,
    x0: f64, y0: f64, x1: f64, y1: f64,
}

/// 页面内容信息（文本 + 图片 + Form + Artifact 水印）。
struct PageText {
    page_number: u32,
    height: f64,
    width: f64,
    text_elements: Vec<TextElement>,
    image_elements: Vec<ImageElement>,
    form_elements: Vec<FormElement>,
    artifact_regions: Vec<RegionInfo>,
}

// ─── 常量 ───

/// 页眉区域：y > page_height * HEADER_THRESHOLD
const HEADER_THRESHOLD: f64 = 0.85;
/// 页脚区域：y < page_height * FOOTER_THRESHOLD
const FOOTER_THRESHOLD: f64 = 0.12;
/// 水印检测：文本/图片/Form 在 ≥ WATERMARK_PAGE_RATIO 比例的页面上出现则判定为水印
const WATERMARK_PAGE_RATIO: f64 = 0.60;

/// 标准化文本：去首尾空白，截取前 50 字符用于匹配
fn trim_text(s: &str) -> String {
    s.trim().chars().take(50).collect()
}

// ─── 辅助函数 ───

fn get_number(obj: &Object) -> f64 {
    match obj {
        Object::Real(n) => *n as f64,
        Object::Integer(i) => *i as f64,
        _ => 0.0,
    }
}

fn object_to_string(obj: &Object) -> String {
    match obj {
        Object::String(bytes, _format) => {
            if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
                let utf16: Vec<u16> = bytes[2..]
                    .chunks(2)
                    .take_while(|c| c.len() == 2)
                    .map(|c| ((c[0] as u16) << 8) | (c[1] as u16))
                    .collect();
                String::from_utf16_lossy(&utf16)
            } else {
                String::from_utf8(bytes.to_vec())
                    .unwrap_or_else(|_| bytes.iter().map(|&b| b as char).collect())
            }
        }
        Object::Name(name_bytes) => String::from_utf8_lossy(name_bytes).to_string(),
        _ => String::new(),
    }
}

fn get_page_dimensions(doc: &Document, page_id: ObjectId) -> Result<(f64, f64), ()> {
    let media_box = doc
        .get_object(page_id).ok()
        .and_then(|obj| obj.as_dict().ok())
        .and_then(|dict| dict.get(b"MediaBox").ok());
    match media_box {
        Some(Object::Array(arr)) if arr.len() >= 4 => {
            Ok((get_number(&arr[2]), get_number(&arr[3])))
        }
        Some(Object::Reference(ref_id)) => {
            if let Ok(Object::Array(arr)) = doc.get_object((ref_id.0, ref_id.1)) {
                if arr.len() >= 4 {
                    return Ok((get_number(&arr[2]), get_number(&arr[3])));
                }
            }
            Ok((595.28, 841.89))
        }
        _ => {
            if let Ok(page_obj) = doc.get_object(page_id) {
                if let Ok(dict) = page_obj.as_dict() {
                    if let Ok(Object::Array(arr)) = dict.get(b"CropBox") {
                        if arr.len() >= 4 {
                            return Ok((get_number(&arr[2]), get_number(&arr[3])));
                        }
                    }
                }
            }
            Ok((595.28, 841.89))
        }
    }
}

fn classify_position_by_y(norm_y: f64) -> RegionType {
    if norm_y > HEADER_THRESHOLD { RegionType::Header }
    else if norm_y < FOOTER_THRESHOLD { RegionType::Footer }
    else { RegionType::Watermark }
}

// ─── XObject Resource 查找 ───

fn get_xobject_from_res_dict<'a>(
    doc: &'a Document,
    res_dict: &'a Dictionary,
) -> Option<&'a Dictionary> {
    match res_dict.get(b"XObject").ok()? {
        Object::Reference(id) => doc.get_dictionary(*id).ok(),
        Object::Dictionary(dict) => Some(dict),
        _ => None,
    }
}

fn build_xobject_lookup(
    doc: &Document,
    page_id: ObjectId,
) -> HashMap<String, (ObjectId, u32, u32)> {
    let mut lookup = HashMap::new();
    let (resource_dict, resource_ids) =
        doc.get_page_resources(page_id).ok().unwrap_or((None, vec![]));
    let mut xobj_dict_opt = None;
    if let Some(res_dict) = resource_dict {
        xobj_dict_opt = get_xobject_from_res_dict(doc, res_dict);
    }
    if xobj_dict_opt.is_none() {
        for &res_id in &resource_ids {
            if let Ok(res_dict) = doc.get_dictionary(res_id) {
                xobj_dict_opt = get_xobject_from_res_dict(doc, res_dict);
                if xobj_dict_opt.is_some() { break; }
            }
        }
    }
    if let Some(xobj_dict) = xobj_dict_opt {
        for (name_bytes, value) in xobj_dict.iter() {
            if let Ok(xobj_ref) = value.as_reference() {
                if let Ok(obj) = doc.get_object(xobj_ref) {
                    if let Ok(stream) = obj.as_stream() {
                        let is_image = stream.dict.get(b"Subtype").ok()
                            .and_then(|o| o.as_name().ok())
                            .map(|n| n == b"Image").unwrap_or(false);
                        if is_image {
                            let w = stream.dict.get(b"Width").ok()
                                .and_then(|o| o.as_i64().ok()).unwrap_or(0) as u32;
                            let h = stream.dict.get(b"Height").ok()
                                .and_then(|o| o.as_i64().ok()).unwrap_or(0) as u32;
                            lookup.insert(String::from_utf8_lossy(name_bytes).to_string(), (xobj_ref, w, h));
                        }
                    }
                }
            }
        }
    }
    lookup
}

fn build_form_xobject_lookup(doc: &Document, page_id: ObjectId) -> HashMap<String, ObjectId> {
    let mut lookup = HashMap::new();
    let (resource_dict, resource_ids) =
        doc.get_page_resources(page_id).ok().unwrap_or((None, vec![]));
    let mut xobj_dict_opt = None;
    if let Some(res_dict) = resource_dict {
        xobj_dict_opt = get_xobject_from_res_dict(doc, res_dict);
    }
    if xobj_dict_opt.is_none() {
        for &res_id in &resource_ids {
            if let Ok(res_dict) = doc.get_dictionary(res_id) {
                xobj_dict_opt = get_xobject_from_res_dict(doc, res_dict);
                if xobj_dict_opt.is_some() { break; }
            }
        }
    }
    if let Some(xobj_dict) = xobj_dict_opt {
        for (name_bytes, value) in xobj_dict.iter() {
            if let Ok(xobj_ref) = value.as_reference() {
                if let Ok(obj) = doc.get_object(xobj_ref) {
                    if let Ok(stream) = obj.as_stream() {
                        let is_form = stream.dict.get(b"Subtype").ok()
                            .and_then(|o| o.as_name().ok())
                            .map(|n| n == b"Form").unwrap_or(false);
                        if is_form {
                            lookup.insert(String::from_utf8_lossy(name_bytes).to_string(), xobj_ref);
                        }
                    }
                }
            }
        }
    }
    lookup
}

// ─── 内容流提取 ───

fn extract_text_elements(ops: &[Operation]) -> Vec<TextElement> {
    let mut elements = Vec::new();
    let mut tx = 0.0;
    let mut ty = 0.0;
    let mut font_size = 10.0;

    for op in ops {
        match op.operator.as_ref() {
            "Tm" => {
                if op.operands.len() >= 6 {
                    tx = get_number(&op.operands[4]);
                    ty = get_number(&op.operands[5]);
                }
            }
            "Tf" => {
                if op.operands.len() >= 2 {
                    font_size = get_number(&op.operands[1]).max(1.0);
                }
            }
            "Tj" => {
                if let Some(first) = op.operands.first() {
                    let text = object_to_string(first);
                    if !text.is_empty() {
                        elements.push(TextElement { text, x0: tx, y0: ty, x1: tx + font_size * 10.0, y1: ty + font_size });
                    }
                }
            }
            "TJ" => {
                if let Some(Object::Array(arr)) = op.operands.first() {
                    let combined: String = arr.iter().filter_map(|item| {
                        if let Object::String(bytes, _) = item {
                            String::from_utf8(bytes.to_vec()).ok()
                        } else { None }
                    }).collect();
                    if !combined.is_empty() {
                        elements.push(TextElement { text: combined, x0: tx, y0: ty, x1: tx + font_size * 10.0, y1: ty + font_size });
                    }
                }
            }
            "'" | "\"" => {
                if let Some(Object::String(ref bytes, _)) = op.operands.first() {
                    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                        if !text.is_empty() {
                            elements.push(TextElement { text, x0: tx, y0: ty, x1: tx + font_size * 10.0, y1: ty + font_size });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    elements
}

fn extract_xobject_elements(
    ops: &[Operation],
    xobject_lookup: &HashMap<String, (ObjectId, u32, u32)>,
) -> Vec<ImageElement> {
    let mut elements = Vec::new();
    let mut ctm = Ctm::identity();
    let mut gs_stack: Vec<Ctm> = Vec::new();

    for op in ops {
        match op.operator.as_ref() {
            "q" => gs_stack.push(ctm),
            "Q" => { if let Some(saved) = gs_stack.pop() { ctm = saved; } }
            "cm" => {
                if op.operands.len() >= 6 {
                    ctm.concat(&Ctm {
                        a: get_number(&op.operands[0]), b: get_number(&op.operands[1]),
                        c: get_number(&op.operands[2]), d: get_number(&op.operands[3]),
                        e: get_number(&op.operands[4]), f: get_number(&op.operands[5]),
                    });
                }
            }
            "Do" => {
                if let Some(operand) = op.operands.first() {
                    let name = object_to_string(operand);
                    if let Some(&(obj_id, pw, ph)) = xobject_lookup.get(&name) {
                        let (x0, y0, x1, y1) = ctm.unit_bbox();
                        elements.push(ImageElement { xobject_name: name, xobject_id: obj_id, x0, y0, x1, y1, pixel_width: pw, pixel_height: ph });
                    }
                }
            }
            _ => {}
        }
    }
    elements
}

fn extract_form_elements(
    ops: &[Operation],
    form_lookup: &HashMap<String, ObjectId>,
) -> Vec<FormElement> {
    let mut elements = Vec::new();
    let mut ctm = Ctm::identity();
    let mut gs_stack: Vec<Ctm> = Vec::new();

    for op in ops {
        match op.operator.as_ref() {
            "q" => gs_stack.push(ctm),
            "Q" => { if let Some(saved) = gs_stack.pop() { ctm = saved; } }
            "cm" => {
                if op.operands.len() >= 6 {
                    ctm.concat(&Ctm {
                        a: get_number(&op.operands[0]), b: get_number(&op.operands[1]),
                        c: get_number(&op.operands[2]), d: get_number(&op.operands[3]),
                        e: get_number(&op.operands[4]), f: get_number(&op.operands[5]),
                    });
                }
            }
            "Do" => {
                if let Some(operand) = op.operands.first() {
                    let name = object_to_string(operand);
                    if let Some(&obj_id) = form_lookup.get(&name) {
                        let (x0, y0, x1, y1) = ctm.unit_bbox();
                        elements.push(FormElement { xobject_name: name, xobject_id: obj_id, x0, y0, x1, y1 });
                    }
                }
            }
            _ => {}
        }
    }
    elements
}

/// 提取 BDC/EMC 标记的水印制品（Artifact）区域。
///
/// PDF 允许通过 /Artifact <</Subtype/Watermark>>BDC ... EMC 显式标记水印。
/// WPS Office 等生成器为每页创建独立的 Form/Image XObject 副本，
/// 跨页频次分析会因 ObjectId 不同而漏检。Artifact 标记是识别此类水印的可靠机制。
fn extract_artifact_watermarks(
    ops: &[Operation],
    image_lookup: &HashMap<String, (ObjectId, u32, u32)>,
    form_lookup: &HashMap<String, ObjectId>,
    page_width: f64, page_height: f64,
    page_number: u32,
) -> Vec<RegionInfo> {
    let mut regions = Vec::new();
    let mut in_artifact = false;
    let mut depth = 0u32;
    let mut ctm = Ctm::identity();
    let mut gs_stack: Vec<Ctm> = Vec::new();

    for op in ops {
        match op.operator.as_ref() {
            "q" => gs_stack.push(ctm),
            "Q" => { if let Some(saved) = gs_stack.pop() { ctm = saved; } }
            "cm" => {
                if op.operands.len() >= 6 {
                    ctm.concat(&Ctm {
                        a: get_number(&op.operands[0]), b: get_number(&op.operands[1]),
                        c: get_number(&op.operands[2]), d: get_number(&op.operands[3]),
                        e: get_number(&op.operands[4]), f: get_number(&op.operands[5]),
                    });
                }
            }
            "BDC" => {
                if is_watermark_artifact_bdc(op) {
                    in_artifact = true; depth = 1;
                } else if in_artifact { depth += 1; }
            }
            "BMC" => { if in_artifact { depth += 1; } }
            "EMC" => {
                if in_artifact {
                    if depth > 1 { depth -= 1; } else { in_artifact = false; depth = 0; }
                }
            }
            "Do" => {
                if !in_artifact { continue; }
                if let Some(operand) = op.operands.first() {
                    let name = object_to_string(operand);
                    if let Some(&obj_id) = form_lookup.get(&name) {
                        let (x0, y0, x1, y1) = ctm.unit_bbox();
                        if page_width > 0.0 && page_height > 0.0 {
                            regions.push(RegionInfo {
                                page_number, text: format!("Form #{}", obj_id.0),
                                region_type: RegionType::FormWatermark,
                                bbox: (x0 / page_width, y0 / page_height, x1 / page_width, y1 / page_height),
                                xobject_id: Some(obj_id.0),
                            });
                        }
                    } else if let Some(&(img_id, _, _)) = image_lookup.get(&name) {
                        let (x0, y0, x1, y1) = ctm.unit_bbox();
                        if page_width > 0.0 && page_height > 0.0 {
                            regions.push(RegionInfo {
                                page_number, text: format!("Image #{}", img_id.0),
                                region_type: RegionType::ImageWatermark,
                                bbox: (x0 / page_width, y0 / page_height, x1 / page_width, y1 / page_height),
                                xobject_id: Some(img_id.0),
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    regions
}

fn is_watermark_artifact_bdc(op: &Operation) -> bool {
    if op.operands.len() < 2 { return false; }
    let tag_is_artifact = match &op.operands[0] {
        Object::Name(bytes) => bytes == b"Artifact",
        _ => false,
    };
    if !tag_is_artifact { return false; }
    match &op.operands[1] {
        Object::Dictionary(dict) => {
            dict.get(b"Subtype").ok()
                .and_then(|o| o.as_name().ok())
                .map(|name| name == b"Watermark")
                .unwrap_or(false)
        }
        _ => false,
    }
}

/// 提取 Annotation 水印区域。
fn extract_annotation_regions(doc: &Document) -> Vec<RegionInfo> {
    let pages = doc.get_pages();
    let page_ids: Vec<ObjectId> = pages.values().copied().collect();
    let mut regions = Vec::new();

    for (idx, &page_id) in page_ids.iter().enumerate() {
        let page_number = (idx + 1) as u32;
        let (page_w, page_h) = match get_page_dimensions(doc, page_id) {
            Ok(dim) => dim,
            Err(_) => continue,
        };
        let annotations = match doc.get_page_annotations(page_id) {
            Ok(a) => a,
            Err(_) => continue,
        };
        for annot in annotations {
            let subtype = annot.get(b"Subtype").ok().and_then(|o| o.as_name().ok());
            if subtype != Some(b"Watermark") && subtype != Some(b"Stamp") { continue; }
            let bbox = match annot.get(b"Rect") {
                Ok(Object::Array(arr)) if arr.len() >= 4 => {
                    let llx = get_number(&arr[0]); let lly = get_number(&arr[1]);
                    let urx = get_number(&arr[2]); let ury = get_number(&arr[3]);
                    if page_w > 0.0 && page_h > 0.0 {
                        (llx / page_w, lly / page_h, urx / page_w, ury / page_h)
                    } else { continue; }
                }
                _ => continue,
            };
            let text = annot.get(b"Contents").ok().and_then(|o| {
                if let Object::String(bytes, _) = o { String::from_utf8(bytes.to_vec()).ok() } else { None }
            }).unwrap_or_else(|| format!("Annotation #{}", page_number));
            regions.push(RegionInfo {
                page_number, text, region_type: RegionType::AnnotationWatermark,
                bbox, xobject_id: None,
            });
        }
    }
    regions
}

// ─── 页面内容提取（整合）───

fn extract_pages_text(pdf_path: &str) -> Result<Vec<PageText>, String> {
    let mut doc = Document::load(pdf_path).map_err(|e| format!("无法打开 PDF 文件：{e}"))?;
    doc.decompress();

    let pages = doc.get_pages();
    let page_ids: Vec<u32> = pages.keys().copied().collect();
    let mut result = Vec::with_capacity(page_ids.len());

    for (idx, &page_id) in page_ids.iter().enumerate() {
        let page_number = (idx + 1) as u32;
        let obj_id: ObjectId = (page_id, 0);
        let (width, height) = get_page_dimensions(&doc, obj_id).unwrap_or((0.0, 0.0));

        let content_bytes = match doc.get_page_content(obj_id) {
            Ok(b) => b,
            Err(_) => { result.push(PageText { page_number, width, height, text_elements: vec![], image_elements: vec![], form_elements: vec![], artifact_regions: vec![] }); continue; }
        };
        let content = match Content::decode(&content_bytes) {
            Ok(c) => c,
            Err(_) => { result.push(PageText { page_number, width, height, text_elements: vec![], image_elements: vec![], form_elements: vec![], artifact_regions: vec![] }); continue; }
        };

        let text_elements = extract_text_elements(&content.operations);
        let xobject_lookup = build_xobject_lookup(&doc, obj_id);
        let image_elements = extract_xobject_elements(&content.operations, &xobject_lookup);
        let form_lookup = build_form_xobject_lookup(&doc, obj_id);
        let form_elements = extract_form_elements(&content.operations, &form_lookup);
        let artifact_regions = extract_artifact_watermarks(&content.operations, &xobject_lookup, &form_lookup, width, height, page_number);

        result.push(PageText { page_number, width, height, text_elements, image_elements, form_elements, artifact_regions });
    }
    Ok(result)
}

// ─── 水印检测分析 ───

type PositionKey = (String, i32);

fn analyze_document(pages: &[PageText]) -> (Vec<RegionInfo>, bool, bool, bool) {
    let total_pages = pages.len() as f64;
    if total_pages == 0.0 { return (vec![], false, false, false); }

    let mut regions = Vec::new();
    let mut has_header = false;
    let mut has_footer = false;
    let mut has_watermark = false;

    // Pass 1: 页眉/页脚检测（基于位置）
    for page in pages {
        for elem in &page.text_elements {
            if elem.text.trim().is_empty() || page.height <= 0.0 { continue; }
            let norm_y = elem.y1 / page.height;
            let region_type = classify_position_by_y(norm_y);
            match region_type {
                RegionType::Header => {
                    has_header = true;
                    regions.push(RegionInfo {
                        page_number: page.page_number, text: trim_text(&elem.text),
                        region_type: RegionType::Header,
                        bbox: (elem.x0 / page.width, elem.y0 / page.height, elem.x1 / page.width, elem.y1 / page.height),
                        xobject_id: None,
                    });
                }
                RegionType::Footer | RegionType::PageNumber => {
                    has_footer = true;
                    let rt = if trim_text(&elem.text).chars().all(|c| c.is_ascii_digit() || c == '/' || c == '-') {
                        RegionType::PageNumber
                    } else { RegionType::Footer };
                    regions.push(RegionInfo {
                        page_number: page.page_number, text: trim_text(&elem.text), region_type: rt,
                        bbox: (elem.x0 / page.width, elem.y0 / page.height, elem.x1 / page.width, elem.y1 / page.height),
                        xobject_id: None,
                    });
                }
                RegionType::Watermark => {}
                RegionType::ImageWatermark => {}
                RegionType::AnnotationWatermark => {}
                RegionType::FormWatermark => {}
            }
        }
    }

    // Pass 2: 文本水印检测（跨页重复的正文区文本）
    if total_pages >= 2.0 {
        let mut text_occurrences: HashMap<PositionKey, Vec<(u32, f64, f64, f64, f64)>> = HashMap::new();
        for page in pages {
            for elem in &page.text_elements {
                if elem.text.trim().is_empty() || page.height <= 0.0 { continue; }
                let norm_y = elem.y1 / page.height;
                if norm_y > HEADER_THRESHOLD || norm_y < FOOTER_THRESHOLD { continue; }
                let y_bucket = (norm_y * 200.0).floor() as i32;
                let normalized = trim_text(&elem.text);
                if normalized.is_empty() { continue; }
                text_occurrences.entry((normalized, y_bucket)).or_default().push((
                    page.page_number, elem.x0 / page.width, elem.y0 / page.height, elem.x1 / page.width, elem.y1 / page.height,
                ));
            }
        }
        for (_key, occurrences) in &text_occurrences {
            let page_ratio = occurrences.len() as f64 / total_pages;
            if occurrences.len() < 2 || page_ratio < WATERMARK_PAGE_RATIO { continue; }
            has_watermark = true;
            for &(pn, x0, y0, x1, y1) in occurrences {
                regions.push(RegionInfo {
                    page_number: pn, text: _key.0.clone(),
                    region_type: RegionType::Watermark,
                    bbox: (x0, y0, x1, y1), xobject_id: None,
                });
            }
        }
    }

    // Pass 3: 图片水印检测
    let img_regions = analyze_image_watermarks(pages, total_pages);
    if !img_regions.is_empty() { has_watermark = true; }
    regions.extend(img_regions);

    // Pass 4: Form XObject 水印检测（跨页频次 + Artifact 标记）
    let form_regions = analyze_form_watermarks(pages, total_pages);
    if !form_regions.is_empty() { has_watermark = true; }
    regions.extend(form_regions);

    (regions, has_watermark, has_header, has_footer)
}

fn analyze_image_watermarks(pages: &[PageText], total_pages: f64) -> Vec<RegionInfo> {
    let mut regions = Vec::new();
    if total_pages < 2.0 { return regions; }

    let mut occurrences: HashMap<(ObjectId, i32), Vec<(u32, f64, f64, f64, f64)>> = HashMap::new();
    for page in pages {
        for img in &page.image_elements {
            if page.height <= 0.0 { continue; }
            let center_y = (img.y0 + img.y1) / 2.0;
            let norm_y = center_y / page.height;
            if norm_y > HEADER_THRESHOLD || norm_y < FOOTER_THRESHOLD { continue; }
            let y_bucket = (norm_y * 200.0).floor() as i32;
            occurrences.entry((img.xobject_id, y_bucket)).or_default().push((
                page.page_number, img.x0 / page.width, img.y0 / page.height, img.x1 / page.width, img.y1 / page.height,
            ));
        }
    }
    for ((xobj_id, _), occ) in &occurrences {
        let ratio = occ.len() as f64 / total_pages;
        if occ.len() < 2 || ratio < WATERMARK_PAGE_RATIO { continue; }
        for &(pn, x0, y0, x1, y1) in occ {
            regions.push(RegionInfo {
                page_number: pn, text: format!("Image #{}", xobj_id.0),
                region_type: RegionType::ImageWatermark,
                bbox: (x0, y0, x1, y1), xobject_id: Some(xobj_id.0),
            });
        }
    }
    regions
}

fn analyze_form_watermarks(pages: &[PageText], total_pages: f64) -> Vec<RegionInfo> {
    let mut regions = Vec::new();
    if total_pages < 2.0 { return regions; }

    let mut occurrences: HashMap<(ObjectId, i32), Vec<(u32, f64, f64, f64, f64)>> = HashMap::new();
    for page in pages {
        for form in &page.form_elements {
            if page.height <= 0.0 { continue; }
            let center_y = (form.y0 + form.y1) / 2.0;
            let norm_y = center_y / page.height;
            if norm_y > HEADER_THRESHOLD || norm_y < FOOTER_THRESHOLD { continue; }
            let y_bucket = (norm_y * 200.0).floor() as i32;
            occurrences.entry((form.xobject_id, y_bucket)).or_default().push((
                page.page_number, form.x0 / page.width, form.y0 / page.height, form.x1 / page.width, form.y1 / page.height,
            ));
        }
    }
    for ((xobj_id, _), occ) in &occurrences {
        let ratio = occ.len() as f64 / total_pages;
        if occ.len() < 2 || ratio < WATERMARK_PAGE_RATIO { continue; }
        for &(pn, x0, y0, x1, y1) in occ {
            regions.push(RegionInfo {
                page_number: pn, text: format!("Form #{}", xobj_id.0),
                region_type: RegionType::FormWatermark,
                bbox: (x0, y0, x1, y1), xobject_id: Some(xobj_id.0),
            });
        }
    }
    regions
}

fn build_summary(report: &WatermarkReport) -> String {
    let mut parts = Vec::new();
    if report.has_watermark {
        let has_text = report.regions.iter().any(|r| r.region_type == RegionType::Watermark);
        let has_img = report.regions.iter().any(|r| r.region_type == RegionType::ImageWatermark);
        let has_annot = report.regions.iter().any(|r| r.region_type == RegionType::AnnotationWatermark);
        let has_form = report.regions.iter().any(|r| r.region_type == RegionType::FormWatermark);
        if has_form { parts.push("检测到 Form 水印"); }
        else if has_text && has_img { parts.push("检测到文字+图片水印"); }
        else if has_annot { parts.push("检测到标注水印"); }
        else if has_img { parts.push("检测到图片水印"); }
        else { parts.push("检测到水印"); }
    }
    if report.has_header { parts.push("检测到页眉"); }
    if report.has_footer { parts.push("检测到页脚"); }
    if parts.is_empty() { "无水印/页眉/页脚".to_string() }
    else { format!("{}（共 {} 处）", parts.join("、"), report.regions.len()) }
}

// ─── 水印移除 ───

fn remove_regions_from_pdf(
    input_path: &str, output_path: &str, regions: &[RegionInfo],
) -> Result<WatermarkRemovalResult, String> {
    let mut doc = Document::load(input_path).map_err(|e| format!("无法打开 PDF 文件：{e}"))?;
    doc.decompress();

    let mut regions_by_page: BTreeMap<u32, Vec<&RegionInfo>> = BTreeMap::new();
    for region in regions { regions_by_page.entry(region.page_number).or_default().push(region); }

    let pages = doc.get_pages();
    let page_ids: Vec<u32> = pages.keys().copied().collect();
    let mut total_covered = 0usize;
    let mut removed_header = false;
    let mut removed_footer = false;
    let mut removed_watermark = false;

    // Phase 1: 清空所有 Form XObject 水印的内容流（跨页共享对象，一处修改全文档生效）
    {
        let form_ids: HashSet<u32> = regions.iter()
            .filter(|r| r.region_type == RegionType::FormWatermark)
            .filter_map(|r| r.xobject_id).collect();
        for &fid in &form_ids {
            let obj_id: ObjectId = (fid, 0);
            if let Ok(obj) = doc.get_object_mut(obj_id) {
                if let Object::Stream(ref mut stream) = *obj {
                    stream.content.clear();
                    removed_watermark = true;
                    total_covered += 1;
                }
            }
        }
    }

    // Phase 2: 白块覆盖（逐页追加白色矩形，覆盖水印区域）
    for (idx, &page_id) in page_ids.iter().enumerate() {
        let page_number = (idx + 1) as u32;
        let obj_id: ObjectId = (page_id, 0);
        let page_regions = match regions_by_page.get(&page_number) { Some(r) => r, None => continue };
        let (width, height) = match get_page_dimensions(&doc, obj_id) { Ok(dim) => dim, Err(_) => continue };
        let original_bytes = match doc.get_page_content(obj_id) { Ok(b) => b, Err(_) => continue };

        let mut new_bytes = original_bytes.clone();
        for region in page_regions {
            // Form 水印已通过清空内容流处理，跳过白块覆盖
            if region.region_type == RegionType::FormWatermark { continue; }
            let x = region.bbox.0 * width;
            let y = region.bbox.1 * height;
            let w = (region.bbox.2 - region.bbox.0) * width;
            let h = (region.bbox.3 - region.bbox.1) * height;
            let overlay = format!("\nq 1 1 1 rg {:.1} {:.1} {:.1} {:.1} re f Q\n", x, y, w, h);
            new_bytes.extend_from_slice(overlay.as_bytes());

            match region.region_type {
                RegionType::Header => removed_header = true,
                RegionType::Footer | RegionType::PageNumber => removed_footer = true,
                RegionType::Watermark | RegionType::ImageWatermark | RegionType::AnnotationWatermark | RegionType::FormWatermark => removed_watermark = true,
            }
            total_covered += 1;
        }

        if new_bytes.len() > original_bytes.len() {
            let stream = lopdf::Stream::new(lopdf::Dictionary::new(), new_bytes);
            let content_id = doc.add_object(Object::Stream(stream));
            if let Ok(page_obj) = doc.get_object_mut(obj_id) {
                if let Ok(dict) = page_obj.as_dict_mut() {
                    dict.set(b"Contents", Object::Reference(content_id));
                }
            }
        }
    }

    // Phase 3: 删除 Annotation 水印
    {
        let mut any_removed = false;
        let page_ids_annot: Vec<ObjectId> = doc.get_pages().values().copied().collect();
        for page_id in &page_ids_annot {
            let annots = doc.get_dictionary(*page_id).ok()
                .and_then(|d| d.get(b"Annots").ok())
                .and_then(|o| if let Object::Array(a) = o { Some(a.clone()) }
                    else if let Object::Reference(r) = o { doc.get_object(*r).ok().and_then(|obj| obj.as_array().ok().cloned()) }
                    else { None });
            let annots = match annots { Some(a) => a, None => continue };
            if annots.is_empty() { continue; }
            let filtered: Vec<Object> = annots.iter().filter(|item| {
                let Ok(ref_id) = item.as_reference() else { return true };
                doc.get_dictionary(ref_id).ok().and_then(|d| d.get(b"Subtype").ok().and_then(|o| o.as_name().ok())).map(|n| n != b"Watermark" && n != b"Stamp").unwrap_or(true)
            }).cloned().collect();
            if filtered.len() < annots.len() {
                any_removed = true;
                if let Ok(page_obj) = doc.get_object_mut(*page_id) {
                    if let Ok(dict) = page_obj.as_dict_mut() {
                        dict.set(b"Annots", Object::Array(filtered));
                    }
                }
            }
        }
        if any_removed {
            removed_watermark = true;
            // 统计被删除的 Annotation 数量
            let annot_count = regions.iter().filter(|r| r.region_type == RegionType::AnnotationWatermark).count();
            total_covered += annot_count;
        }
    }

    doc.save(output_path).map_err(|e| format!("无法保存 PDF 文件：{e}"))?;

    Ok(WatermarkRemovalResult { output_path: output_path.to_string(), removed_header, removed_footer, removed_watermark, removed_count: total_covered })
}

// ─── 公共入口函数 ───

pub fn detect_watermarks(pdf_path: &str) -> Result<WatermarkReport, String> {
    let pages = extract_pages_text(pdf_path)?;
    let page_count = pages.len() as u32;
    let (mut regions, mut has_watermark, has_header, has_footer) = analyze_document(&pages);

    // 合并 Artifact 水印
    for page in &pages {
        if !page.artifact_regions.is_empty() {
            has_watermark = true;
            regions.extend(page.artifact_regions.clone());
        }
    }

    // Annotation 水印
    if let Ok(doc) = Document::load(pdf_path) {
        let annot_regions = extract_annotation_regions(&doc);
        if !annot_regions.is_empty() { has_watermark = true; }
        regions.extend(annot_regions);
    }

    let report = WatermarkReport { has_watermark, has_header, has_footer, regions, page_count, summary: String::new() };
    let summary = build_summary(&report);
    Ok(WatermarkReport { summary, ..report })
}

pub fn remove_watermarks_from_pdf(pdf_path: &str, output_path: &str, regions: &[RegionInfo]) -> Result<WatermarkRemovalResult, String> {
    remove_regions_from_pdf(pdf_path, output_path, regions)
}

// ─── Tauri 命令 ───

#[tauri::command]
pub fn detect_watermark_info(pdf_path: String) -> Result<WatermarkReport, String> {
    detect_watermarks(&pdf_path)
}

#[tauri::command]
pub fn remove_watermarks(pdf_path: String, output_path: String) -> Result<WatermarkRemovalResult, String> {
    let report = detect_watermarks(&pdf_path)?;
    if report.has_watermark || report.has_header || report.has_footer {
        remove_watermarks_from_pdf(&pdf_path, &output_path, &report.regions)
    } else {
        Ok(WatermarkRemovalResult { output_path, removed_header: false, removed_footer: false, removed_watermark: false, removed_count: 0 })
    }
}

#[tauri::command]
pub fn batch_remove_watermarks(requests: Vec<WatermarkRequest>) -> Result<Vec<WatermarkResult>, String> {
    let mut results = Vec::with_capacity(requests.len());
    for req in &requests {
        match detect_watermarks(&req.input_path) {
            Ok(report) => {
                if report.has_watermark || report.has_header || report.has_footer {
                    match remove_watermarks_from_pdf(&req.input_path, &req.output_path, &report.regions) {
                        Ok(removal) => results.push(WatermarkResult {
                            input_path: req.input_path.clone(), output_path: req.output_path.clone(),
                            success: true, error: None, report: Some(report), removal: Some(removal),
                        }),
                        Err(e) => results.push(WatermarkResult {
                            input_path: req.input_path.clone(), output_path: req.output_path.clone(),
                            success: false, error: Some(e), report: Some(report), removal: None,
                        }),
                    }
                } else {
                    results.push(WatermarkResult {
                        input_path: req.input_path.clone(), output_path: req.output_path.clone(),
                        success: true, error: None, report: Some(report), removal: None,
                    });
                }
            }
            Err(e) => results.push(WatermarkResult {
                input_path: req.input_path.clone(), output_path: req.output_path.clone(),
                success: false, error: Some(e), report: None, removal: None,
            }),
        }
    }
    Ok(results)
}

// ─── 测试 ───

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::Content;

    // ─── 文本提取 ───

    #[test]
    fn test_extract_text_basic() {
        let c = Content::decode(b"BT /F1 12 Tf 1 0 0 1 0 0 Tm 1 0 0 1 72 800 Tm (Header) Tj 1 0 0 1 72 30 Tm (Footer) Tj 1 0 0 1 72 500 Tm (Body) Tj ET").unwrap();
        let elems = extract_text_elements(&c.operations);
        assert_eq!(elems.len(), 3);
        assert!(elems.iter().any(|e| e.text == "Body"));
        assert!(elems.iter().any(|e| e.text == "Header"));
    }

    #[test]
    fn test_extract_tj_array() {
        let c = Content::decode(b"BT 1 0 0 1 72 300 Tm [(Hello) 10 (World)] TJ ET").unwrap();
        let elems = extract_text_elements(&c.operations);
        assert_eq!(elems.len(), 1);
        assert!(elems[0].text.contains("Hello"));
        assert!(elems[0].text.contains("World"));
    }

    // ─── 检测算法 ───

    #[test]
    fn test_detect_header_footer() {
        let pages = vec![PageText {
            page_number: 1, width: 595.0, height: 842.0,
            text_elements: vec![
                TextElement { text: "Header".into(), x0: 72.0, y0: 800.0, x1: 120.0, y1: 820.0 },
                TextElement { text: "Footer".into(), x0: 72.0, y0: 20.0, x1: 120.0, y1: 40.0 },
                TextElement { text: "1".into(), x0: 500.0, y0: 20.0, x1: 510.0, y1: 40.0 },
                TextElement { text: "Body".into(), x0: 72.0, y0: 500.0, x1: 120.0, y1: 520.0 },
            ], image_elements: vec![], form_elements: vec![], artifact_regions: vec![],
        }];
        let (_, _, h, f) = analyze_document(&pages);
        assert!(h); assert!(f);
    }

    #[test]
    fn test_detect_multi_page_watermark() {
        let pages: Vec<PageText> = (1..=3).map(|i| PageText {
            page_number: i, width: 595.0, height: 842.0,
            text_elements: vec![
                TextElement { text: format!("Title {}", i), x0: 72.0, y0: 800.0, x1: 140.0, y1: 820.0 },
                TextElement { text: "CONFIDENTIAL".into(), x0: 200.0, y0: 400.0, x1: 350.0, y1: 420.0 },
                TextElement { text: format!("Body {}", i), x0: 72.0, y0: 500.0, x1: 140.0, y1: 520.0 },
                TextElement { text: i.to_string(), x0: 500.0, y0: 20.0, x1: 510.0, y1: 40.0 },
            ], image_elements: vec![], form_elements: vec![], artifact_regions: vec![],
        }).collect();
        let (_, wm, h, f) = analyze_document(&pages);
        assert!(h); assert!(f); assert!(wm);
    }

    #[test]
    fn test_clean_no_issues() {
        let pages = vec![PageText {
            page_number: 1, width: 595.0, height: 842.0,
            text_elements: vec![TextElement { text: "Body".into(), x0: 72.0, y0: 500.0, x1: 200.0, y1: 520.0 }],
            image_elements: vec![], form_elements: vec![], artifact_regions: vec![],
        }];
        let (_, wm, h, f) = analyze_document(&pages);
        assert!(!h); assert!(!f); assert!(!wm);
    }

    #[test]
    fn test_classify_edge() {
        assert_eq!(classify_position_by_y(0.95), RegionType::Header);
        assert_eq!(classify_position_by_y(0.05), RegionType::Footer);
        assert_eq!(classify_position_by_y(0.50), RegionType::Watermark);
        assert_eq!(classify_position_by_y(0.86), RegionType::Header);
        assert_eq!(classify_position_by_y(0.84), RegionType::Watermark);
        assert_eq!(classify_position_by_y(0.11), RegionType::Footer);
        assert_eq!(classify_position_by_y(0.13), RegionType::Watermark);
    }

    // ─── CTM ───

    #[test]
    fn test_ctm_basic() {
        let c = Ctm::identity();
        let (x, y) = c.transform(0.5, 0.5);
        assert!((x - 0.5).abs() < 0.001);
        assert!((y - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_ctm_translate_scale() {
        let mut c = Ctm::identity();
        c.concat(&Ctm { a: 150.0, b: 0.0, c: 0.0, d: 50.0, e: 72.0, f: 500.0 });
        let (x0, y0, x1, _) = c.unit_bbox();
        assert!((x0 - 72.0).abs() < 0.001);
        assert!((y0 - 500.0).abs() < 0.001);
        assert!((x1 - 222.0).abs() < 0.001);
    }

    // ─── Form XObject ───

    #[test]
    fn test_form_watermark_detected() {
        let fid: ObjectId = (5, 0);
        let pages: Vec<PageText> = (1..=3).map(|i| PageText {
            page_number: i, width: 595.0, height: 842.0,
            text_elements: vec![TextElement { text: format!("Body {}", i), x0: 72.0, y0: 500.0, x1: 150.0, y1: 520.0 }],
            image_elements: vec![],
            form_elements: vec![FormElement { xobject_name: "Fm0".into(), xobject_id: fid, x0: 200.0, y0: 300.0, x1: 400.0, y1: 350.0 }],
            artifact_regions: vec![],
        }).collect();
        let regions = analyze_form_watermarks(&pages, 3.0);
        assert!(!regions.is_empty());
        assert_eq!(regions[0].region_type, RegionType::FormWatermark);
        assert_eq!(regions[0].xobject_id, Some(5));
    }

    #[test]
    fn test_form_low_frequency_skipped() {
        let fid: ObjectId = (5, 0);
        let mut pages: Vec<PageText> = vec![PageText {
            page_number: 1, width: 595.0, height: 842.0,
            text_elements: vec![], image_elements: vec![],
            form_elements: vec![FormElement { xobject_name: "Fm0".into(), xobject_id: fid, x0: 200.0, y0: 300.0, x1: 400.0, y1: 350.0 }],
            artifact_regions: vec![],
        }];
        for i in 2..=3 {
            pages.push(PageText { page_number: i, width: 595.0, height: 842.0, text_elements: vec![], image_elements: vec![], form_elements: vec![], artifact_regions: vec![] });
        }
        assert!(analyze_form_watermarks(&pages, 3.0).is_empty());
    }

    // ─── Image XObject ───

    fn make_img_page(n: u32, oid: ObjectId) -> PageText {
        PageText {
            page_number: n, width: 600.0, height: 800.0, text_elements: vec![],
            image_elements: vec![ImageElement { xobject_name: format!("Im{}", oid.0), xobject_id: oid, x0: 180.0, y0: 320.0, x1: 360.0, y1: 400.0, pixel_width: 100, pixel_height: 50 }],
            form_elements: vec![], artifact_regions: vec![],
        }
    }

    #[test]
    fn test_image_watermark_detected() {
        let pages: Vec<PageText> = (1..=3).map(|i| make_img_page(i, (5, 0))).collect();
        let r = analyze_image_watermarks(&pages, 3.0);
        assert!(!r.is_empty());
    }

    #[test]
    fn test_image_low_frequency() {
        let mut pages = vec![make_img_page(1, (5, 0))];
        for i in 2..=3 { pages.push(PageText { page_number: i, width: 600.0, height: 800.0, text_elements: vec![], image_elements: vec![], form_elements: vec![], artifact_regions: vec![] }); }
        assert!(analyze_image_watermarks(&pages, 3.0).is_empty());
    }

    // ─── Annotation ───

    fn build_annot_pdf() -> Vec<u8> {
        let mut doc = Document::new();
        let mut ad = Dictionary::new();
        ad.set(b"Type", Object::Name(b"Annot".to_vec()));
        ad.set(b"Subtype", Object::Name(b"Watermark".to_vec()));
        ad.set(b"Contents", Object::String(b"CONFIDENTIAL".to_vec(), lopdf::StringFormat::Literal));
        ad.set(b"Rect", Object::Array(vec![Object::Integer(100), Object::Integer(600), Object::Integer(500), Object::Integer(700)]));
        let aid = doc.add_object(Object::Dictionary(ad));
        let cid = doc.add_object(Object::Stream(lopdf::Stream::new(lopdf::Dictionary::new(), vec![])));
        let mut pd = Dictionary::new();
        pd.set(b"Type", Object::Name(b"Page".to_vec()));
        pd.set(b"MediaBox", Object::Array(vec![Object::Integer(0), Object::Integer(0), Object::Integer(595), Object::Integer(842)]));
        pd.set(b"Annots", Object::Array(vec![Object::Reference(aid)]));
        pd.set(b"Contents", Object::Reference(cid));
        let pid = doc.add_object(Object::Dictionary(pd));
        let mut p2 = Dictionary::new();
        p2.set(b"Type", Object::Name(b"Pages".to_vec()));
        p2.set(b"Kids", Object::Array(vec![Object::Reference(pid)]));
        p2.set(b"Count", Object::Integer(1));
        let p2id = doc.add_object(Object::Dictionary(p2));
        if let Ok(p_obj) = doc.get_object_mut(pid) { if let Ok(d) = p_obj.as_dict_mut() { d.set(b"Parent", Object::Reference(p2id)); } }
        let mut cat = Dictionary::new();
        cat.set(b"Type", Object::Name(b"Catalog".to_vec()));
        cat.set(b"Pages", Object::Reference(p2id));
        let cat_id = doc.add_object(Object::Dictionary(cat));
        doc.trailer.set(b"Root", Object::Reference(cat_id));
        let mut buf = vec![]; doc.save_to(&mut buf).unwrap(); buf
    }

    #[test]
    fn test_extract_annotation() {
        let data = build_annot_pdf();
        let p = "/tmp/test_annot.pdf"; std::fs::write(p, &data).unwrap();
        let doc = Document::load(p).unwrap();
        let r = extract_annotation_regions(&doc);
        assert_eq!(r.len(), 1); assert_eq!(r[0].region_type, RegionType::AnnotationWatermark);
        let _ = std::fs::remove_file(p);
    }

    // ─── Missing file ───

    #[test]
    fn test_missing_file_error() {
        let r = detect_watermarks("/nonexistent_file_xyz.pdf");
        assert!(r.is_err());
    }

    // ─── Summary ───

    #[test]
    fn test_summary_clean() {
        assert_eq!(build_summary(&WatermarkReport { has_watermark: false, has_header: false, has_footer: false, regions: vec![], page_count: 1, summary: String::new() }), "无水印/页眉/页脚");
    }

    #[test]
    fn test_summary_with_issues() {
        let s = build_summary(&WatermarkReport {
            has_watermark: true, has_header: true, has_footer: false,
            regions: vec![RegionInfo { page_number: 1, text: "CONFIDENTIAL".into(), region_type: RegionType::Watermark, bbox: (0.3, 0.4, 0.7, 0.5), xobject_id: None }],
            page_count: 3, summary: String::new(),
        });
        assert!(s.contains("水印")); assert!(s.contains("页眉"));
    }

    #[test]
    fn test_summary_form() {
        let s = build_summary(&WatermarkReport {
            has_watermark: true, has_header: false, has_footer: false,
            regions: vec![RegionInfo { page_number: 1, text: "Form #5".into(), region_type: RegionType::FormWatermark, bbox: (0.3, 0.4, 0.6, 0.5), xobject_id: Some(5) }],
            page_count: 1, summary: String::new(),
        });
        assert!(s.contains("Form 水印"));
    }

    // ─── Extract XObject elements ───

    #[test]
    fn test_extract_xobject_basic() {
        let c = Content::decode(b"q 150 0 0 50 72 500 cm /Im0 Do Q").unwrap();
        let mut l = HashMap::new();
        l.insert("Im0".to_string(), ((12, 0), 300, 100));
        let e = extract_xobject_elements(&c.operations, &l);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].xobject_name, "Im0");
    }

    #[test]
    fn test_extract_xobject_unknown_ignored() {
        let c = Content::decode(b"q 150 0 0 50 72 500 cm /Unknown Do Q").unwrap();
        let e = extract_xobject_elements(&c.operations, &HashMap::new());
        assert!(e.is_empty());
    }
}
