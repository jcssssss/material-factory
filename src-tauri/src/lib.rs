// 桌面应用库入口。
// Task 5 暴露文件系统能力：
//   - scan_input_files: 扫描文件夹中的 PDF 与 Word 输入文件（folder 模式输入展开）
//   - read_pdf_bytes: 读取 PDF 二进制数据供 pdf.js 解析
//   - ensure_output_dir: 创建任务/PDF 输出目录
//   - write_image_file: 将 JPG 字节写入磁盘
// Task 6 暴露日志落盘能力：
//   - append_log_line: 追加一行 JSONL 日志到应用数据目录
//   - read_log_file: 读取全部日志供界面展示
//   - clear_log_file: 清空日志文件
// v1.1.0 新增 Word 输入支持：
//   - check_libreoffice: 检测 LibreOffice 是否可用
//   - convert_word_to_pdf: 通过 LibreOffice 无头模式将 Word 转换为 PDF
// v1.2.0 新增资料列表展示图生成器：
//   - scan_folder_tree: 递归扫描商品资料文件夹，返回目录树结构（过滤系统文件）
//
// 全部命令使用 std::fs 实现，错误通过 Result<T, String> 返回给前端，
// 由 taskRunner 在页级 / PDF 级 / 任务级三层失败隔离中处理。

mod background;
mod db;
mod warp;
mod watermark;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::{command, Manager};
use tauri::ipc::{InvokeBody, Request, Response};

use db::Database;

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败：{e}"))?;
    Ok(app_data.join("data").join("xhs_pic.db"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = db_path(&app.handle())?;
            let database = Database::new(path)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_input_files,
            read_pdf_bytes,
            ensure_output_dir,
            write_image_file,
            write_image_binary,
            append_log_line,
            read_log_file,
            clear_log_file,
            check_libreoffice,
            convert_word_to_pdf,
            scan_folder_tree,
            background::save_background_file,
            background::read_background_file,
            background::read_background_thumbnail,
            background::ensure_background_thumbnails,
            background::delete_background_file,
            background::list_background_files,
            background::list_background_templates,
            background::add_background_template,
            background::delete_background_template,
            background::batch_delete_background_templates,
            background::get_background_template,
            background::get_background_file_path,
            background::random_background_template,
            background::save_calibration,
            warp::warp_to_a4,
            watermark::detect_watermark_info,
            watermark::remove_watermarks,
            watermark::batch_remove_watermarks,
            copy_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// 将源文件复制到目标路径。目标路径父目录必须已存在。
// 用于去水印模块无水印文件原样输出。
#[command]
fn copy_file(src: String, dst: String) -> Result<(), String> {
    let src_path = std::path::Path::new(&src);
    if !src_path.exists() {
        return Err(format!("源文件不存在：{}", src));
    }
    fs::copy(&src, &dst).map_err(|e| format!("复制文件失败：{e}"))?;
    Ok(())
}

// 扫描文件夹（仅顶层）中的 PDF 与 Word 输入文件（.pdf/.docx/.doc），
// 按文件名升序返回完整路径。
// 用于 folder 模式输入展开，与 spec.md "Scenario: 文件夹中无 PDF" 对齐。
#[command]
fn scan_input_files(folder: String) -> Result<Vec<String>, String> {
    let folder_path = Path::new(&folder);
    if !folder_path.exists() {
        return Err(format!("文件夹不存在：{}", folder));
    }
    if !folder_path.is_dir() {
        return Err(format!("路径不是文件夹：{}", folder));
    }

    let mut input_files: Vec<PathBuf> = Vec::new();
    let entries =
        fs::read_dir(folder_path).map_err(|e| format!("读取文件夹失败：{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败：{e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(ext) = path.extension() {
            if ext.eq_ignore_ascii_case("pdf")
                || ext.eq_ignore_ascii_case("docx")
                || ext.eq_ignore_ascii_case("doc")
            {
                input_files.push(path);
            }
        }
    }

    input_files.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        let b_name = b
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        a_name.cmp(&b_name)
    });

    Ok(input_files
        .into_iter()
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect())
}

// 读取 PDF 文件二进制数据。
// 字节数组通过 Tauri IPC 传输给前端，由 pdf.js 在 worker 中解析。
#[command]
fn read_pdf_bytes(path: String) -> Result<Response, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在：{}", path));
    }
    if !p.is_file() {
        return Err(format!("路径不是文件：{}", path));
    }
    let bytes = fs::read(p).map_err(|e| format!("读取 PDF 失败：{e}"))?;
    // 返回 Response 走二进制通道，避免 JSON 序列化 Vec<u8> 为数字数组
    // （5MB PDF → 20MB JSON 字符串 + 40MB number[] 内存，改为零拷贝二进制传输）
    Ok(Response::new(bytes))
}

// 递归创建输出目录（任务目录 / PDF 子目录）。
// macOS 下 ~/Downloads、~/Desktop、~/Documents 受 TCC 保护，
// 未授权应用写入会得到 "Operation not permitted (os error 1)"，
// 这里给出更友好的提示。
#[command]
fn ensure_output_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        if !p.is_dir() {
            return Err(format!("路径已存在但不是目录：{}", path));
        }
        return Ok(());
    }
    fs::create_dir_all(p).map_err(|e| {
        let raw = format!("{e}");
        if raw.contains("Operation not permitted") || raw.contains("os error 1") {
            // macOS TCC 保护 ~/Downloads / ~/Desktop / ~/Documents
            format!(
                "创建目录失败：{raw}\n\n这通常是 macOS 权限保护导致（~/Downloads、~/Desktop、~/Documents 受 TCC 保护）。\n解决方法：\n1. 换用非受保护目录（如 ~/xhs_output）\n2. 或在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中添加本应用"
            )
        } else if raw.contains("Access is denied") || raw.contains("os error 5") {
            // Windows 权限不足（如系统目录、其他用户目录）
            format!(
                "创建目录失败：{raw}\n\n这通常是 Windows 权限不足导致。\n解决方法：\n1. 换用当前用户可写的目录（如 ~/xhs_output 或 ~/Documents/xhs_output）\n2. 或以管理员身份运行本应用"
            )
        } else {
            format!("创建目录失败：{raw}")
        }
    })
}

// 将 JPG 字节写入指定路径。父目录必须已存在（由 ensure_output_dir 创建）。
#[command]
fn write_image_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            return Err(format!(
                "输出目录不存在，请先 ensure_output_dir：{}",
                parent.display()
            ));
        }
    }
    fs::write(p, &bytes).map_err(|e| {
        let raw = format!("{e}");
        if raw.contains("Operation not permitted") || raw.contains("os error 1") {
            // macOS TCC 保护
            format!(
                "写入图片失败：{raw}\n\n这通常是 macOS 权限保护导致。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中添加本应用，或换用非受保护目录。"
            )
        } else if raw.contains("Access is denied") || raw.contains("os error 5") {
            // Windows 权限不足
            format!(
                "写入图片失败：{raw}\n\n这通常是 Windows 权限不足导致。请换用当前用户可写的目录，或以管理员身份运行本应用。"
            )
        } else {
            format!("写入图片失败：{raw}")
        }
    })
}

// 将 JPG 字节写入指定路径（二进制 body 版本）。
//
// 为什么单独一个命令：Tauri v2 的 invoke 在 args 为普通对象 { path, bytes } 时，
// 会把嵌套的 Uint8Array 在主线程同步 JSON.stringify 成数字数组（Array.from），
// 一张数 MB JPG → ~15-25MB 字符串，主线程阻塞数百毫秒 ~ 1 秒，仿真打印滚动卡顿。
//
// 解法：前端只传一个顶层 Uint8Array（Tauri 走 octet-stream 零序列化二进制 body），
// body 格式：[4 字节 LE u32 path_len][UTF-8 path_bytes][JPEG 像素数据]。
// Rust 端用 Request 参数拿 InvokeBody::Raw，解开三段直接 fs::write。
#[command]
fn write_image_binary(request: Request) -> Result<(), String> {
    let body: Vec<u8> = match request.body() {
        InvokeBody::Raw(v) => v.clone(),
        InvokeBody::Json(_) => {
            return Err(
                "write_image_binary 需要 octet-stream 二进制 body，请用 invoke 顶层传 Uint8Array"
                    .to_string(),
            );
        }
    };

    if body.len() < 4 {
        return Err("二进制 body 太短，缺少路径长度头".to_string());
    }
    let path_len = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if body.len() < 4 + path_len {
        return Err("二进制 body 太短，路径段不完整".to_string());
    }
    let path = String::from_utf8_lossy(&body[4..4 + path_len]).to_string();
    let bytes = &body[4 + path_len..];

    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.exists() {
            return Err(format!(
                "输出目录不存在，请先 ensure_output_dir：{}",
                parent.display()
            ));
        }
    }

    fs::write(p, bytes).map_err(|e| {
        let raw = format!("{e}");
        if raw.contains("Operation not permitted") || raw.contains("os error 1") {
            format!("写入图片失败：{raw}\n\n这通常是 macOS 权限保护导致。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中添加本应用，或换用非受保护目录。")
        } else if raw.contains("Access is denied") || raw.contains("os error 5") {
            format!("写入图片失败：{raw}\n\n这通常是 Windows 权限不足导致。请换用当前用户可写的目录，或以管理员身份运行本应用。")
        } else {
            format!("写入图片失败：{raw}")
        }
    })
}

// ─── Word 输入支持（v1.1.0）───
// Word 文件先通过 LibreOffice 无头模式转 PDF，再复用现有 PDF 处理链路。
// 缓存目录：{app_data_dir}/word_cache/{task_id}/
// 与 spec.md "Scenario: LibreOffice 未安装" 对齐。

// LibreOffice 检测结果，供前端展示是否支持 Word 输入。
#[derive(serde::Serialize)]
struct LibreOfficeStatus {
    available: bool,
    path: Option<String>,
}

// 检测 LibreOffice 可执行文件路径。
// 优先检查常见安装路径；若均不存在，回退到 PATH 查找（which/where）。
// 复用 check_libreoffice 命令与 convert_word_to_pdf 命令的检测逻辑。
fn find_libreoffice() -> Option<PathBuf> {
    // 常见安装路径（按平台区分）
    #[cfg(target_os = "macos")]
    let candidates: Vec<PathBuf> = vec![PathBuf::from(
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    )];
    #[cfg(target_os = "linux")]
    let candidates: Vec<PathBuf> = vec![
        PathBuf::from("/usr/bin/soffice"),
        PathBuf::from("/usr/bin/libreoffice"),
        PathBuf::from("/usr/local/bin/soffice"),
    ];
    #[cfg(target_os = "windows")]
    let candidates: Vec<PathBuf> = vec![
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
    ];
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let candidates: Vec<PathBuf> = vec![];

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 回退到 PATH 查找：Unix 用 which，Windows 用 where
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("which").arg("soffice").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let trimmed = first_line.trim();
                    if !trimmed.is_empty() {
                        return Some(PathBuf::from(trimmed));
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("where").arg("soffice").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let trimmed = first_line.trim();
                    if !trimmed.is_empty() {
                        return Some(PathBuf::from(trimmed));
                    }
                }
            }
        }
    }

    None
}

// 检测 LibreOffice 是否可用。供前端在启用 Word 输入前预检。
// 命令不接受参数，检测失败也返回 available=false（不返回错误）。
#[command]
fn check_libreoffice() -> LibreOfficeStatus {
    match find_libreoffice() {
        Some(p) => LibreOfficeStatus {
            available: true,
            path: Some(p.to_string_lossy().to_string()),
        },
        None => LibreOfficeStatus {
            available: false,
            path: None,
        },
    }
}

// 将 Word 文件（.docx/.doc）转换为 PDF。
// 内部调用 LibreOffice 无头模式，输出 PDF 缓存到应用数据目录。
// 转换成功后返回 PDF 路径，前端复用现有 PDF 处理链路。
// 超时（120 秒）或转换失败时返回友好错误，由任务级失败隔离处理。
#[command]
fn convert_word_to_pdf(
    app: tauri::AppHandle,
    word_path: String,
    task_id: String,
) -> Result<String, String> {
    let word_p = Path::new(&word_path);
    if !word_p.exists() {
        return Err(format!("文件不存在：{}", word_path));
    }
    if !word_p.is_file() {
        return Err(format!("路径不是文件：{}", word_path));
    }
    // 校验扩展名（不区分大小写）
    let ext_ok = word_p
        .extension()
        .map(|e| e.eq_ignore_ascii_case("docx") || e.eq_ignore_ascii_case("doc"))
        .unwrap_or(false);
    if !ext_ok {
        return Err(format!("仅支持 .docx / .doc 文件：{}", word_path));
    }

    // 获取 LibreOffice 路径
    let soffice = find_libreoffice().ok_or_else(|| {
        "未检测到 LibreOffice，请先安装后再使用 Word 输入".to_string()
    })?;

    // 缓存目录：{app_data_dir}/word_cache/{task_id}/
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败：{e}"))?;
    let cache_dir = app_data.join("word_cache").join(&task_id);
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("创建缓存目录失败：{e}"))?;

    // 在子线程中执行 LibreOffice，主线程等待 120 秒，避免阻塞 UI 线程。
    // 超时后主线程返回错误；子线程继续运行至命令结束，send 失败被静默忽略。
    let (tx, rx) = mpsc::channel();
    let soffice_clone = soffice.clone();
    let cache_dir_clone = cache_dir.clone();
    let word_path_clone = word_path.clone();
    thread::spawn(move || {
        let result = Command::new(&soffice_clone)
            .arg("--headless")
            .arg("--norestore")
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(&cache_dir_clone)
            .arg(&word_path_clone)
            .output();
        let _ = tx.send(result);
    });

    let output = rx
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "LibreOffice 转换超时（120 秒未完成）".to_string())?
        .map_err(|e| format!("调用 LibreOffice 失败：{e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Word 转换失败：{stderr}"));
    }

    // 计算输出 PDF 路径：{cache_dir}/{原文件名 stem}.pdf
    let stem = word_p
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("无法解析文件名：{}", word_path))?;
    let pdf_path = cache_dir.join(format!("{}.pdf", stem));
    if !pdf_path.exists() {
        // LibreOffice 可能转换失败但不报错，需检查输出文件是否真的生成
        return Err("Word 转换未生成 PDF 文件".to_string());
    }

    Ok(pdf_path.to_string_lossy().to_string())
}

// ─── 日志落盘命令（Task 6）───
// 日志文件位置：{app_data_dir}/logs/app.log
// 格式：JSONL（每行一条 LogEntry 的 JSON 序列化结果）
// 与 spec.md "Scenario: 应用重启后查看历史" 对齐：日志写入应用数据目录，
// 重启后通过 read_log_file 读回，在前端日志页展示。

// 解析日志文件路径。如应用数据目录不可用，返回错误。
fn log_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败：{e}"))?;
    Ok(app_data.join("logs").join("app.log"))
}

// 追加一行日志到日志文件。前端传入完整 JSON 字符串（不含换行）。
// 文件不存在时自动创建；目录不存在时先创建。
#[command]
fn append_log_line(
    app: tauri::AppHandle,
    line: String,
) -> Result<(), String> {
    let log_path = log_file_path(&app)?;
    if let Some(parent) = log_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建日志目录失败：{e}"))?;
        }
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("打开日志文件失败：{e}"))?;
    let mut content = line;
    if !content.ends_with('\n') {
        content.push('\n');
    }
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入日志失败：{e}"))
}

// 读取全部日志文件内容。文件不存在时返回空字符串。
// 前端按 JSONL 解析为 LogEntry[]，限制最多加载最近 N 条避免内存爆炸。
#[command]
fn read_log_file(app: tauri::AppHandle) -> Result<String, String> {
    let log_path = log_file_path(&app)?;
    if !log_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&log_path)
        .map_err(|e| format!("读取日志文件失败：{e}"))
}

// 清空日志文件。与前端 store.clearLogs 配合，提供「清空」能力。
#[command]
fn clear_log_file(app: tauri::AppHandle) -> Result<(), String> {
    let log_path = log_file_path(&app)?;
    if !log_path.exists() {
        return Ok(());
    }
    fs::write(&log_path, "").map_err(|e| format!("清空日志文件失败：{e}"))
}

// ─── 资料列表展示图生成器（v1.2.0）───
// 递归扫描商品资料文件夹，返回完整目录树结构供前端渲染资料列表图片。
// 自动过滤系统文件（.DS_Store / Thumbs.db / desktop.ini / __MACOSX），
// 对无法读取元数据的文件跳过（不中断扫描），由前端记录 warn 日志。
// 与 spec.md "Requirement: 商品资料文件夹递归扫描" 对齐。

// 文件类型分类，与前端 FileType 枚举对齐。
#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum FileType {
    Pdf,
    Word,
    Excel,
    Ppt,
    Folder,
    Other,
}

// 目录树节点。文件夹节点含 children，文件节点 children 为空数组。
// empty 仅对文件夹有效：当文件夹过滤后无有效子项时为 true。
#[derive(serde::Serialize)]
struct FolderTreeNode {
    name: String,
    path: String,
    is_dir: bool,
    extension: Option<String>,
    file_type: FileType,
    empty: bool,
    children: Vec<FolderTreeNode>,
}

// 判断文件名是否为应忽略的系统文件。
// 包含 macOS / Windows / 跨平台常见垃圾文件。
fn is_system_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.as_str(),
        ".ds_store" | "thumbs.db" | "desktop.ini"
    ) || lower.starts_with("._") // macOS 资源 fork 残留
        || lower == "__macosx" // macOS 压缩包元数据目录
}

// 根据文件扩展名推断 FileType。
fn classify_file_type(extension: Option<&str>) -> FileType {
    match extension {
        Some(ext) => {
            let lower = ext.to_lowercase();
            match lower.as_str() {
                "pdf" => FileType::Pdf,
                "docx" | "doc" => FileType::Word,
                "xlsx" | "xls" => FileType::Excel,
                "pptx" | "ppt" => FileType::Ppt,
                _ => FileType::Other,
            }
        }
        None => FileType::Other,
    }
}

// 递归扫描目录，构建 FolderTreeNode 树。
// 单个目录项读取失败时跳过该项（不中断同级其他项）。
fn scan_directory_recursive(path: &Path) -> Result<FolderTreeNode, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let entries = fs::read_dir(path).map_err(|e| format!("读取文件夹失败：{e}"))?;

    let mut children: Vec<FolderTreeNode> = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                // 跳过无法读取的目录项（权限或 IO 错误），不中断扫描。
                // 前端 Runner 会通过 warn 日志记录跳过统计。
                continue;
            }
        };
        let child_path = entry.path();
        let child_name = child_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // 过滤系统文件
        if is_system_file(&child_name) {
            continue;
        }

        // 用 symlink_metadata 避免 follow 符号链接导致的循环；
        // 元数据读取失败时跳过该项。
        let metadata = match fs::symlink_metadata(&child_path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            // 递归扫描子目录；子目录扫描失败时跳过整个子目录。
            match scan_directory_recursive(&child_path) {
                Ok(node) => children.push(node),
                Err(_) => continue,
            }
        } else if metadata.is_file() {
            let extension = child_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase());
            let file_type = classify_file_type(extension.as_deref());
            children.push(FolderTreeNode {
                name: child_name,
                path: child_path.to_string_lossy().to_string(),
                is_dir: false,
                extension,
                file_type,
                empty: false,
                children: Vec::new(),
            });
        }
        // 其他类型（符号链接等）跳过，保持目录树只含文件夹与普通文件。
    }

    let is_empty = children.is_empty();
    Ok(FolderTreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: true,
        extension: None,
        file_type: FileType::Folder,
        empty: is_empty,
        children,
    })
}

// 递归扫描商品资料文件夹，返回目录树。
// 商品根目录作为扫描入口，其节点本身不展示在图片中（前端规则）。
// 与 spec.md "Scenario: 扫描正常的多级目录" / "Scenario: 自动忽略系统文件" /
// "Scenario: 扫描空文件夹" 对齐。
#[command]
fn scan_folder_tree(folder: String) -> Result<FolderTreeNode, String> {
    let folder_path = Path::new(&folder);
    if !folder_path.exists() {
        return Err(format!("文件夹不存在：{}", folder));
    }
    if !folder_path.is_dir() {
        return Err(format!("路径不是文件夹：{}", folder));
    }
    scan_directory_recursive(folder_path)
}
