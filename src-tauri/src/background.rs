use crate::db::Database;
use image::imageops::FilterType;
use image::RgbaImage;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager, State};
use tauri::ipc::{InvokeBody, Request, Response};

const OUTPUT_W: u32 = 1242;
const OUTPUT_H: u32 = 1656;
const OUTPUT_RATIO: f64 = OUTPUT_W as f64 / OUTPUT_H as f64; // 0.7527...
const RATIO_TOLERANCE: f64 = 0.02;

#[derive(serde::Serialize)]
pub struct SaveBackgroundResult {
    file_name: String,
    width: u32,
    height: u32,
    // 处理后的 JPEG 大小（1242×1656 缩放产物），供前端展示最终尺寸。
    file_size: u64,
}

fn thumbnail_file_name(original: &str) -> String {
    let stem = match original.rfind('.') {
        Some(idx) => &original[..idx],
        None => original,
    };
    format!("thumb_{stem}.jpg")
}

const THUMBNAIL_MAX_DIM: u32 = 600;

// 从已解码的图片生成最长边 THUMBNAIL_MAX_DIM 的 JPEG 缩略图。
// 复用解码结果，避免对已编码的主图再次全量解码。
fn make_thumbnail_from_image(img: &image::DynamicImage) -> Option<Vec<u8>> {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return None;
    }
    let (nw, nh) = if w > h {
        (THUMBNAIL_MAX_DIM, (h as f64 * THUMBNAIL_MAX_DIM as f64 / w as f64).round() as u32)
    } else {
        ((w as f64 * THUMBNAIL_MAX_DIM as f64 / h as f64).round() as u32, THUMBNAIL_MAX_DIM)
    };
    if nw == 0 || nh == 0 {
        return None;
    }
    let thumb = img.resize_exact(nw, nh, FilterType::Lanczos3);
    let mut buf: Vec<u8> = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg)
        .ok()?;
    Some(buf)
}

// 从原始字节生成缩略图（用于补齐历史模板缺失的缩略图）。
fn generate_thumbnail_bytes(bytes: &[u8]) -> Option<Vec<u8>> {
    let img = image::load_from_memory(bytes).ok()?;
    make_thumbnail_from_image(&img)
}

fn backgrounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败：{e}"))?;
    Ok(app_data.join("backgrounds").join("files"))
}

fn generate_background_id() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("bg_{}", duration.as_nanos())
}

// 处理结果：主图字节 + 尺寸 + 缩略图字节（基于同一次解码生成，避免二次解码）。
struct ProcessedBackground {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
    thumb: Option<Vec<u8>>,
}

/// 将任意尺寸的背景图片处理为 1242×1656 JPG，并基于同一次解码生成缩略图。
/// 3:4 图片直接缩放；其他比例等比缩放后居中放置，白底补齐。
// libheif 静态编译（embedded-libheif）在 Rust 内解码 HEIC → image::DynamicImage。
// 分发时无需用户预装 libheif；失败时由调用方回退 sips。
fn decode_heic_via_libheif(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let ctx = HeifContext::read_from_bytes(bytes)
        .map_err(|e| format!("libheif 解析失败：{e}"))?;
    let handle = ctx
        .primary_image_handle()
        .map_err(|e| format!("libheif 取主图失败：{e}"))?;
    let heif_image = LibHeif::new()
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| format!("libheif 解码失败：{e}"))?;
    let plane = heif_image
        .planes()
        .interleaved
        .ok_or_else(|| "无法获取 HEIC RGB 像素".to_string())?;
    // 行可能有 stride 对齐填充，逐行拷贝去除 padding。
    let width = plane.width as usize;
    let height = plane.height as usize;
    let stride = plane.stride;
    let row_bytes = width * 3;
    let mut rgb = Vec::with_capacity(row_bytes * height);
    for row in 0..height {
        let start = row * stride;
        rgb.extend_from_slice(&plane.data[start..start + row_bytes]);
    }
    image::RgbImage::from_raw(width as u32, height as u32, rgb)
        .map(image::DynamicImage::ImageRgb8)
        .ok_or_else(|| "HEIC 像素尺寸无效".to_string())
}

// macOS 内置 sips 转换 HEIC/HEIF → JPEG，用于 image crate 无法解码的格式。
// 仅 macOS 可用（Windows 无 HEIC 原生解码器，报清晰错误）。
fn decode_heic_via_sips(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    if cfg!(not(target_os = "macos")) {
        return Err("HEIC 图片当前仅支持 macOS 解码".into());
    }
    // sips 需要真实文件路径，写入临时文件后转换。
    let tmp = std::env::temp_dir().join(format!(
        "xhs_bg_{}.heic",
        generate_background_id()
    ));
    let out = tmp.with_extension("jpg");
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时 HEIC 失败：{e}"))?;
    let status = Command::new("sips")
        .args(["-s", "format", "jpeg"])
        .arg(&tmp)
        .arg("--out")
        .arg(&out)
        .status()
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("调用 sips 失败：{e}")
        })?;
    let _ = fs::remove_file(&tmp);
    if !status.success() {
        let _ = fs::remove_file(&out);
        return Err("sips 转换失败".into());
    }
    let jpeg = fs::read(&out).map_err(|e| {
        let _ = fs::remove_file(&out);
        format!("读取转换结果失败：{e}")
    })?;
    let _ = fs::remove_file(&out);
    image::load_from_memory(&jpeg).map_err(|e| format!("转换后图片解码失败：{e}"))
}

fn process_background_image(bytes: &[u8]) -> Result<ProcessedBackground, String> {
    // image crate 不原生支持 HEIC/HEIF（iPhone 默认格式）：
    // 优先 libheif（静态编译，快），失败回退 macOS sips。
    let img = match image::load_from_memory(bytes) {
        Ok(i) => i,
        Err(e) => decode_heic_via_libheif(bytes)
            .or_else(|_| decode_heic_via_sips(bytes))
            .map_err(|heic_err| format!("解码图片失败：{e}（HEIC 解码失败：{heic_err}）"))?,
    };
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err("图片尺寸无效".into());
    }

    let ratio = w as f64 / h as f64;
    let processed = if (ratio - OUTPUT_RATIO).abs() < RATIO_TOLERANCE {
        img.resize_exact(OUTPUT_W, OUTPUT_H, FilterType::Lanczos3)
    } else {
        let scale = f64::min(OUTPUT_W as f64 / w as f64, OUTPUT_H as f64 / h as f64);
        let nw = (w as f64 * scale).round() as u32;
        let nh = (h as f64 * scale).round() as u32;
        let resized = img.resize_exact(nw, nh, FilterType::Lanczos3);
        let mut canvas = RgbaImage::from_pixel(OUTPUT_W, OUTPUT_H, image::Rgba([255, 255, 255, 255]));
        let ox = (OUTPUT_W - nw) / 2;
        let oy = (OUTPUT_H - nh) / 2;
        image::imageops::overlay(&mut canvas, &resized, ox.into(), oy.into());
        image::DynamicImage::ImageRgba8(canvas)
    };

    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 85);
    encoder
        .encode(processed.as_bytes(), OUTPUT_W, OUTPUT_H, processed.color())
        .map_err(|e| format!("JPEG 编码失败：{e}"))?;

    let thumb = make_thumbnail_from_image(&img);

    Ok(ProcessedBackground {
        bytes: buf,
        width: OUTPUT_W,
        height: OUTPUT_H,
        thumb,
    })
}

#[command]
pub async fn save_background_file(
    app: AppHandle,
    request: Request<'_>,
) -> Result<SaveBackgroundResult, String> {
    // 前端以 invoke 顶层传 Uint8Array 走 octet-stream 二进制 body（零 JSON 序列化）。
    let bytes: Vec<u8> = match request.body() {
        InvokeBody::Raw(v) => v.clone(),
        InvokeBody::Json(_) => {
            return Err(
                "save_background_file 需要 octet-stream 二进制 body，请用 invoke 顶层传 Uint8Array"
                    .to_string(),
            );
        }
    };
    // 图片解码/缩放/编码较重，放到阻塞线程池执行，避免冻结 UI 线程。
    tauri::async_runtime::spawn_blocking(move || save_background_file_sync(&app, bytes))
        .await
        .map_err(|e| format!("后台处理失败：{e}"))?
}

/// 直接按路径上传并处理为 1242×1656：内部 fs::read + save_background_file_sync，
/// 前端只传路径字符串，避免把原图字节在前端中转（减少一次大字节 IPC 往返）。
#[command]
pub async fn save_background_file_from_path(
    app: AppHandle,
    path: String,
) -> Result<SaveBackgroundResult, String> {
    // 读字节 + 处理放阻塞线程池执行，避免占用主线程/IPC 异步运行时。
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&path).map_err(|e| format!("读取图片失败：{path} - {e}"))?;
        save_background_file_sync(&app, bytes)
    })
    .await
    .map_err(|e| format!("后台处理失败：{e}"))?
}

fn save_background_file_sync(
    app: &AppHandle,
    bytes: Vec<u8>,
) -> Result<SaveBackgroundResult, String> {
    let dir = backgrounds_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建背景目录失败：{e}"))?;

    let file_id = generate_background_id();
    let file_name = format!("{file_id}.jpg");
    let file_path = dir.join(&file_name);

    let processed = process_background_image(&bytes)?;
    fs::write(&file_path, &processed.bytes).map_err(|e| format!("写入背景文件失败：{e}"))?;
    if let Some(thumb_bytes) = processed.thumb {
        let _ = fs::write(dir.join(thumbnail_file_name(&file_name)), &thumb_bytes);
    }

    Ok(SaveBackgroundResult {
        file_name,
        width: processed.width,
        height: processed.height,
        file_size: processed.bytes.len() as u64,
    })
}

#[command]
pub async fn read_background_file(
    app: AppHandle,
    file_name: String,
) -> Result<Response, String> {
    // fs::read 放阻塞线程池执行，避免占用主线程/IPC 异步运行时。
    tauri::async_runtime::spawn_blocking(move || {
        let dir = backgrounds_dir(&app)?;
        let file_path = dir.join(&file_name);

        if !file_path.exists() {
            return Err(format!("背景文件不存在：{file_name}"));
        }

        let bytes = fs::read(&file_path).map_err(|e| format!("读取背景文件失败：{e}"))?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| format!("读取背景文件后台执行失败：{e}"))?
}

/// 读取缓存的缩略图。若不存在则报错（由 ensure 命令预先批量生成）。
/// 走二进制通道（tauri::ipc::Response），避免 JSON 序列化 Vec<u8>。
/// async + spawn_blocking：列表页多卡片并发拉缩略图时，fs::read 在阻塞线程池执行，
/// 避免占用主线程/IPC 异步运行时导致列表滚动卡顿。
#[command]
pub async fn read_background_thumbnail(
    app: AppHandle,
    file_name: String,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = backgrounds_dir(&app)?;
        let thumb_path = dir.join(thumbnail_file_name(&file_name));

        if !thumb_path.exists() {
            return Err(format!("缩略图不存在：{}", thumbnail_file_name(&file_name)));
        }

        let bytes = fs::read(&thumb_path).map_err(|e| format!("读取缩略图失败：{e}"))?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| format!("读取缩略图后台执行失败：{e}"))?
}

/// 批量补齐所有缺失的缩略图，返回实际生成的缩略图数量。
/// 异步 + spawn_blocking：生成过程在线程池执行，不阻塞 UI 线程。
#[command]
pub async fn ensure_background_thumbnails(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<usize, String> {
    let dir = backgrounds_dir(&app)?;
    let templates = db.list_backgrounds()?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut generated = 0usize;

        for t in &templates {
            let thumb_path = dir.join(thumbnail_file_name(&t.file_name));
            if thumb_path.exists() {
                continue;
            }
            let orig_path = dir.join(&t.file_name);
            let orig_bytes = match fs::read(&orig_path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            if let Some(thumb_bytes) = generate_thumbnail_bytes(&orig_bytes) {
                let _ = fs::write(&thumb_path, &thumb_bytes);
                generated += 1;
            }
        }

        Ok(generated)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub fn delete_background_file(
    app: AppHandle,
    file_name: String,
) -> Result<(), String> {
    let dir = backgrounds_dir(&app)?;
    let file_path = dir.join(&file_name);

    if !file_path.exists() {
        return Err(format!("背景文件不存在：{file_name}"));
    }

    fs::remove_file(&file_path).map_err(|e| format!("删除背景文件失败：{e}"))
}

#[command]
pub fn list_background_files(
    app: AppHandle,
) -> Result<Vec<String>, String> {
    let dir = backgrounds_dir(&app)?;

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut files: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("读取背景目录失败：{e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.is_file() {
                path.file_name()?.to_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();

    files.sort();
    Ok(files)
}

// -- DB CRUD 命令 --

#[command]
pub fn list_background_templates(
    db: State<'_, Database>,
) -> Result<Vec<crate::db::BackgroundRecord>, String> {
    db.list_backgrounds()
}

#[command]
pub fn add_background_template(
    _app: AppHandle,
    db: State<'_, Database>,
    file_name: String,
    width: i64,
    height: i64,
    file_size: i64,
) -> Result<String, String> {
    let id = generate_background_id();
    db.insert_background(&id, &file_name, width, height, file_size)?;
    Ok(id)
}

#[command]
pub fn delete_background_template(
    app: AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let file_name = db.delete_background(&id)?;
    let _ = delete_background_file_inner(&app, &file_name);
    Ok(())
}

#[command]
pub fn batch_delete_background_templates(
    app: AppHandle,
    db: State<'_, Database>,
    ids: Vec<String>,
) -> Result<(), String> {
    let file_names = db.batch_delete_backgrounds(&ids)?;
    for name in &file_names {
        let _ = delete_background_file_inner(&app, name);
    }
    Ok(())
}

#[command]
pub fn get_background_template(
    db: State<'_, Database>,
    id: String,
) -> Result<crate::db::BackgroundRecord, String> {
    db.get_background(&id)
}

#[command]
pub fn random_background_template(
    db: State<'_, Database>,
) -> Result<crate::db::BackgroundRecord, String> {
    db.random_background()
}

#[command]
pub fn get_background_file_path(
    app: AppHandle,
    file_name: String,
) -> Result<String, String> {
    let dir = backgrounds_dir(&app)?;
    Ok(dir.join(&file_name).to_string_lossy().to_string())
}

#[command]
pub fn save_calibration(
    db: State<'_, Database>,
    id: String,
    corners: [f64; 8],
) -> Result<(), String> {
    db.save_calibration(&id, &corners)
}

fn delete_background_file_inner(app: &AppHandle, file_name: &str) -> Result<(), String> {
    let dir = backgrounds_dir(app)?;
    let file_path = dir.join(file_name);
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| format!("删除背景文件失败：{e}"))?;
    }
    let thumb_path = dir.join(thumbnail_file_name(file_name));
    if thumb_path.exists() {
        let _ = fs::remove_file(&thumb_path);
    }
    Ok(())
}
