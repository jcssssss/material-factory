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
mod python_bridge;

use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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

// warp 双线性插值并行度：限制为物理核数（消除超线程争抢与过度发热）。
fn physical_worker_count() -> usize {
    let n = num_cpus::get_physical();
    if n >= 1 {
        n
    } else {
        1
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 限制 rayon 全局线程池为物理核数：消除超线程争抢与过度发热。
    // warp 双线性插值是唯一 rayon 用户，物理核打满几乎无损；
    // build_global 只能在任何 rayon 使用前调用一次（run 是唯一入口，warp 仅命令运行时触发）。
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(physical_worker_count())
        .build_global();

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
            convert_word_files_to_pdf,
            scan_folder_tree,
            background::save_background_file,
            background::save_background_file_from_path,
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
            watermark::scan_document,
            watermark::scan_documents,
            watermark::execute_clean,
            watermark::execute_batch_clean,
            watermark::generate_clean_report,
            python_bridge::python_detect,
            python_bridge::python_clean,
            python_bridge::python_validate,
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
// 递归收集目录树下的 PDF/Word 文件（支持嵌套子目录）。
// 与 scan_directory_recursive 的目录遍历不同，这里只收集输入文件本身。
fn collect_input_files_recursive(path: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(path).map_err(|e| format!("读取文件夹失败：{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败：{e}"))?;
        let p = entry.path();
        if p.is_dir() {
            collect_input_files_recursive(&p, out)?;
        } else if let Some(ext) = p.extension() {
            if ext.eq_ignore_ascii_case("pdf")
                || ext.eq_ignore_ascii_case("docx")
                || ext.eq_ignore_ascii_case("doc")
            {
                out.push(p);
            }
        }
    }
    Ok(())
}

// 按文件名升序返回完整路径。
// 用于 folder 模式输入展开，与 spec.md "Scenario: 文件夹中无 PDF" 对齐。
// 递归扫描嵌套子目录，支持 2 层及以上目录中的资料。
#[command]
async fn scan_input_files(folder: String) -> Result<Vec<String>, String> {
    // 递归扫描大目录可能较慢，放阻塞线程池执行。
    tauri::async_runtime::spawn_blocking(move || {
        let folder_path = Path::new(&folder);
        if !folder_path.exists() {
            return Err(format!("文件夹不存在：{}", folder));
        }
        if !folder_path.is_dir() {
            return Err(format!("路径不是文件夹：{}", folder));
        }

        let mut input_files: Vec<PathBuf> = Vec::new();
        collect_input_files_recursive(folder_path, &mut input_files)?;

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
    })
    .await
    .map_err(|e| format!("扫描输入文件后台执行失败：{e}"))?
}

// 读取 PDF 文件二进制数据。
// 字节数组通过 Tauri IPC 传输给前端，由 pdf.js 在 worker 中解析。
#[command]
async fn read_pdf_bytes(path: String) -> Result<Response, String> {
    // 大文件 fs::read 较重，放阻塞线程池执行，避免占用主线程/IPC 异步运行时
    // （同步命令默认在主线程执行，数 MB~数十 MB PDF 会造成卡顿）。
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| format!("读取 PDF 后台执行失败：{e}"))?
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
async fn write_image_binary(request: Request<'_>) -> Result<(), String> {
    let body: Vec<u8> = match request.body() {
        InvokeBody::Raw(v) => v.clone(),
        InvokeBody::Json(_) => {
            return Err(
                "write_image_binary 需要 octet-stream 二进制 body，请用 invoke 顶层传 Uint8Array"
                    .to_string(),
            );
        }
    };
    // fs::write 放阻塞线程池执行，避免占用主线程/IPC 异步运行时。
    tauri::async_runtime::spawn_blocking(move || write_image_binary_sync(&body))
        .await
        .map_err(|e| format!("写入图片后台执行失败：{e}"))?
}

fn write_image_binary_sync(body: &[u8]) -> Result<(), String> {
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
// 验证 soffice 可执行文件真实可用（运行 --version 成功）。
// PATH 回退可能命中包装脚本，其指向的 LibreOffice 已不存在；
// 仅检查文件存在不足，需实际运行确认，避免转换时报 "No such file or directory"。
fn soffice_usable(path: &Path) -> bool {
    let (tx, rx) = mpsc::channel();
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    thread::spawn(move || {
        let _ = tx.send(cmd.output());
    });
    matches!(rx.recv_timeout(Duration::from_secs(5)), Ok(Ok(o)) if o.status.success())
}

fn find_libreoffice(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 1) 优先应用捆绑的资源目录（随安装包分发的 LibreOffice，仅 macos/windows 有捆绑资源）
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if let Ok(res) = app.path().resource_dir() {
        // Tauri 打包 resources 可能带 _up_ 前缀、保留 vendor 顶层，逐一尝试
        let mut bundled_paths: Vec<PathBuf> = Vec::new();
        #[cfg(target_os = "macos")]
        for base in [
            res.join("_up_/vendor/libreoffice"),
            res.join("vendor/libreoffice"),
            res.join("_up_/libreoffice"),
            res.join("libreoffice"),
        ] {
            bundled_paths.push(base.join("LibreOffice.app/Contents/MacOS/soffice"));
        }
        #[cfg(target_os = "windows")]
        for base in [
            res.join("_up_/vendor/libreoffice"),
            res.join("vendor/libreoffice"),
            res.join("_up_/libreoffice"),
            res.join("libreoffice"),
        ] {
            bundled_paths.push(base.join("program/soffice.exe"));
        }
        for p in bundled_paths {
            if p.is_file() {
                return Some(p);
            }
        }
    }

    // 2) 回退到系统常见安装路径（按平台区分）
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
    let candidates: Vec<PathBuf> = {
        let mut v = vec![
            PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
            PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
        ];
        // 用户级（per-user MSI）安装，常见于 Windows 10+
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            v.push(PathBuf::from(local).join(r"Programs\LibreOffice\program\soffice.exe"));
        }
        v
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let candidates: Vec<PathBuf> = vec![];

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 回退到 PATH 查找：Unix 用 which，Windows 用 where。
    // 遍历所有候选行，仅当真实可运行才返回，否则视为未安装。
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("which").arg("soffice").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let p = PathBuf::from(trimmed);
                    if p.is_file() && soffice_usable(&p) {
                        return Some(p);
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
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let p = PathBuf::from(trimmed);
                    if p.is_file() && soffice_usable(&p) {
                        return Some(p);
                    }
                }
            }
        }
    }

    None
}

// 检测 LibreOffice 是否可用。供前端在启用 Word 输入前预检。
// 优先应用捆绑版本，其次系统安装。检测失败也返回 available=false（不返回错误）。
#[command]
fn check_libreoffice(app: tauri::AppHandle) -> LibreOfficeStatus {
    match find_libreoffice(&app) {
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
async fn convert_word_to_pdf(
    app: tauri::AppHandle,
    word_path: String,
    task_id: String,
) -> Result<String, String> {
    // 转换含 soffice 子进程等待，放阻塞线程池执行，避免冻结 UI 线程
    tauri::async_runtime::spawn_blocking(move || {
        convert_word_to_pdf_sync(&app, word_path, task_id)
    })
    .await
    .map_err(|e| format!("Word 转换后台执行失败：{e}"))?
}

fn convert_word_to_pdf_sync(
    app: &tauri::AppHandle,
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

    // 获取 LibreOffice 路径（优先应用捆绑版本）
    let soffice = find_libreoffice(app).ok_or_else(|| {
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

    // 独立 LibreOffice profile，避免多任务并发初始化冲突、污染系统配置
    let lo_profile = cache_dir.join("lo_profile");
    // 在子线程中执行 LibreOffice，主线程等待 120 秒，避免阻塞 UI 线程。
    // 超时后主线程返回错误；子线程继续运行至命令结束，send 失败被静默忽略。
    let (tx, rx) = mpsc::channel();
    let soffice_clone = soffice.clone();
    let cache_dir_clone = cache_dir.clone();
    let profile_clone = lo_profile.clone();
    let word_path_clone = word_path.clone();
    thread::spawn(move || {
        let result = Command::new(&soffice_clone)
            // 同上：跳过 OpenCL 自检与 Java 检测（冷 profile 启动满核浪费）。
            .env("SAL_DISABLE_OPENCL", "1")
            .env("SAL_DISABLE_JAVA", "1")
            .arg("--headless")
            .arg("--norestore")
            .arg(format!(
                "-env:UserInstallation=file://{}",
                urlencode_path(&profile_clone)
            ))
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

// ─── Word 批量转换（避免逐文件启动 soffice 频繁打开/关闭）───

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WordFileInput {
    word_path: String,
    task_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WordFileResult {
    word_path: String,
    pdf_path: Option<String>,
    error: Option<String>,
}

fn is_word_file(path: &str) -> bool {
    Path::new(path)
        .extension()
        .map(|e| e.eq_ignore_ascii_case("docx") || e.eq_ignore_ascii_case("doc"))
        .unwrap_or(false)
}

// 批量将多个 Word 文件转换为 PDF。同一 task_id 的所有文件合并为一次
// LibreOffice 无头调用（同 --outdir），避免任务队列中逐文件启动 soffice
// 导致窗口/进程频繁打开关闭。单个文件失败不影响其余文件。
#[command]
async fn convert_word_files_to_pdf(
    app: tauri::AppHandle,
    files: Vec<WordFileInput>,
) -> Result<Vec<WordFileResult>, String> {
    // 转换含 soffice 子进程等待（最长 120s+），放阻塞线程池执行，避免冻结 UI 线程
    let results = tauri::async_runtime::spawn_blocking(move || {
        convert_word_files_to_pdf_sync(&app, files)
    })
    .await
    .map_err(|e| format!("Word 批量转换后台执行失败：{e}"))?;
    Ok(results)
}

fn convert_word_files_to_pdf_sync(
    app: &tauri::AppHandle,
    files: Vec<WordFileInput>,
) -> Vec<WordFileResult> {
    let mut results: Vec<WordFileResult> = Vec::with_capacity(files.len());
    let soffice = find_libreoffice(app);

    // 按 task_id 分组（记录输入索引以保持返回顺序）
    let mut groups: HashMap<String, Vec<(usize, &WordFileInput)>> = HashMap::new();
    for (idx, f) in files.iter().enumerate() {
        if !is_word_file(&f.word_path) {
            results.push(WordFileResult {
                word_path: f.word_path.clone(),
                pdf_path: None,
                error: Some(format!("仅支持 .docx / .doc 文件：{}", f.word_path)),
            });
            continue;
        }
        groups.entry(f.task_id.clone()).or_default().push((idx, f));
        results.push(WordFileResult {
            word_path: f.word_path.clone(),
            pdf_path: None,
            error: None,
        });
    }

    let Some(soffice) = soffice else {
        for r in &mut results {
            if r.error.is_none() {
                r.error = Some("未检测到 LibreOffice，请先安装后再使用 Word 输入".to_string());
            }
        }
        return results;
    };

    let app_data = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            for r in &mut results {
                if r.error.is_none() {
                    r.error = Some(format!("获取应用数据目录失败：{e}"));
                }
            }
            return results;
        }
    };

    // 共享 profile：全局唯一（word_cache/shared_lo_profile），跨任务/批次复用，
    // 第二次起 warm start ~1-3s。任务队列串行执行，无并发锁冲突；soffice 正常
    // 退出残留的 .lock 由陈旧锁检测（pid 已死）处理。转换开始前清理历史残留的
    // 独立 profile（lo_profile_* / lo_retry_*），避免 word_cache 无限膨胀。
    let word_cache_dir = app_data.join("word_cache");
    let shared_profile = word_cache_dir.join("shared_lo_profile");
    cleanup_stale_profiles(&word_cache_dir, &shared_profile);

    for (task_id, group) in groups {
        let cache_dir = word_cache_dir.join(&task_id);
        if let Err(e) = fs::create_dir_all(&cache_dir) {
            for (idx, _) in &group {
                results[*idx].error = Some(format!("创建缓存目录失败：{e}"));
            }
            continue;
        }
        // 每批复用共享 profile：soffice 崩溃/超时会在下方失败分支删除共享 profile
        //（锁残留/组件注册损坏），下批自动冷启动重建；未生成文件走独立 lo_retry_*
        // profile 逐个重试，崩溃隔离能力保留。
        let lo_profile = shared_profile.clone();

        // 记录转换前已有 PDF，用于转换后识别新增输出（soffice 输出名可能
        // 因特殊字符/长文件名与预期 stem 不一致）
        let existing: HashSet<String> = fs::read_dir(&cache_dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|e| e.path().extension().map(|x| x == "pdf").unwrap_or(false))
                    .filter_map(|e| e.file_name().to_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // 子进程执行 soffice 转换该组所有文件；主线程轮询退出并做超时保护，
        // 超时后主动 kill 进程，避免残留 soffice 卡住后续批次
        let timeout = Duration::from_secs(60 + 20 * group.len() as u64);
        let word_paths: Vec<String> = group.iter().map(|(_, f)| f.word_path.clone()).collect();
        let mut cmd = Command::new(&soffice);
        // 跳过 LibreOffice 无用的 OpenCL/GPU 自检与 Java VM 检测：冷 profile 首次
        // 启动的 OpenCL 基准自检实测 ~3.4s 满核，而渲染已确认用 CPU raster（UseOpenCL=false）。
        cmd.env("SAL_DISABLE_OPENCL", "1")
            .env("SAL_DISABLE_JAVA", "1")
            .arg("--headless")
            .arg("--norestore")
            .arg(format!(
                "-env:UserInstallation=file://{}",
                urlencode_path(&lo_profile)
            ))
            .arg("--convert-to")
            .arg("pdf")
            .arg("--outdir")
            .arg(&cache_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        for w in &word_paths {
            cmd.arg(w);
        }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                // 启动失败可能源于共享 profile 损坏/残留锁，删除后下批重建。
                let _ = fs::remove_dir_all(&shared_profile);
                for (idx, _) in &group {
                    results[*idx].error = Some(format!("启动 soffice 失败：{e}"));
                }
                continue;
            }
        };

        // stderr 由独立线程读取，避免与退出轮询互相阻塞
        let stderr_reader = child.stderr.take().map(|mut stderr| {
            thread::spawn(move || {
                let mut buf = String::new();
                let _ = stderr.read_to_string(&mut buf);
                buf
            })
        });

        let start = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(st)) => break Some(st),
                Ok(None) => {
                    if start.elapsed() > timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        break None;
                    }
                    thread::sleep(Duration::from_millis(200));
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        };
        let timed_out = status.is_none();
        let status_ok = status.map(|s| s.success()).unwrap_or(false);
        let stderr = stderr_reader
            .map(|h| h.join().unwrap_or_default())
            .unwrap_or_default();
        let stderr = stderr.trim().to_string();

        let new_pdfs: Vec<String> = fs::read_dir(&cache_dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|e| e.path().extension().map(|x| x == "pdf").unwrap_or(false))
                    .filter_map(|e| e.file_name().to_str().map(String::from))
                    .filter(|n| !existing.contains(n))
                    .collect()
            })
            .unwrap_or_default();

        let mut new_pdfs = new_pdfs;
        // 第一阶段：精准确认已生成的 PDF（所有场景下都判为成功），
        // 未生成的文件收集到 unmatched，超时场景下再逐个重试，避免被卡住文件连累
        let mut unmatched: Vec<(usize, &WordFileInput)> = Vec::new();
        for (idx, f) in group {
            let stem = Path::new(&f.word_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let expected = format!("{stem}.pdf");
            if let Some(pos) = new_pdfs.iter().position(|n| n == &expected) {
                new_pdfs.remove(pos);
                results[idx].pdf_path = Some(
                    cache_dir.join(&expected).to_string_lossy().to_string(),
                );
            } else {
                unmatched.push((idx, f));
            }
        }

        if unmatched.is_empty() {
            continue;
        }

        if !timed_out && status_ok {
            // 正常完成：兜底认领本次新增 PDF，或报未生成
            for (idx, _) in &unmatched {
                if let Some(name) = new_pdfs.first().cloned() {
                    // 兜底：soffice 输出名与 stem 不一致时，取本次新增的 PDF
                    new_pdfs.remove(0);
                    results[*idx].pdf_path = Some(
                        cache_dir.join(&name).to_string_lossy().to_string(),
                    );
                } else {
                    let detail = if !stderr.is_empty() {
                        format!("Word 转换未生成 PDF 文件：{stderr}")
                    } else {
                        "Word 转换未生成 PDF 文件".to_string()
                    };
                    results[*idx].error = Some(detail);
                }
            }
        } else if timed_out {
            // 超时批：逐个单文件重试（短超时），救回被坏文件连累的好文件
            let single_timeout = Duration::from_secs(60);
            for (idx, f) in &unmatched {
                let word = &f.word_path;
                if run_soffice_single(
                    &soffice,
                    word,
                    &cache_dir,
                    single_timeout,
                ) {
                    let stem = Path::new(word)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let expected = format!("{stem}.pdf");
                    if cache_dir.join(&expected).is_file() {
                        results[*idx].pdf_path = Some(
                            cache_dir.join(&expected).to_string_lossy().to_string(),
                        );
                    } else {
                        results[*idx].error = Some("LibreOffice 转换超时".to_string());
                    }
                } else {
                    results[*idx].error = Some("LibreOffice 转换超时".to_string());
                }
            }
            // 超时后共享 profile 可能残留锁/损坏组件，删除重建避免下批启动失败。
            let _ = fs::remove_dir_all(&shared_profile);
        } else {
            // 进程崩溃/非零退出（如某文件触发 UNO 异常拖垮整批 soffice）：
            // 已生成的 PDF 已在上方认领，对未生成的逐个独立重试，隔离真正坏的
            // 文件——否则整批好文件都会被误判失败
            let single_timeout = Duration::from_secs(90);
            for (idx, f) in &unmatched {
                let word = &f.word_path;
                if run_soffice_single(
                    &soffice,
                    word,
                    &cache_dir,
                    single_timeout,
                ) {
                    let stem = Path::new(word)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let expected = format!("{stem}.pdf");
                    if cache_dir.join(&expected).is_file() {
                        results[*idx].pdf_path = Some(
                            cache_dir.join(&expected).to_string_lossy().to_string(),
                        );
                    } else {
                        results[*idx].error = Some("Word 转换失败，重试后仍未生成 PDF".to_string());
                    }
                } else {
                    let detail = if !stderr.is_empty() {
                        format!("Word 转换失败（soffice 异常退出）：{stderr}")
                    } else {
                        "Word 转换失败（soffice 异常退出）".to_string()
                    };
                    results[*idx].error = Some(detail);
                }
            }
            // 崩溃后共享 profile 可能残留锁/损坏组件，删除重建避免下批启动失败。
            let _ = fs::remove_dir_all(&shared_profile);
        }
    }

    results
}

// 删除 word_cache 下所有历史残留的独立 profile 目录（lo_profile* / lo_retry*，
// 含单文件路径遗留的无后缀 lo_profile），保留共享 profile（shared）与转换产物
// PDF（文件）。任务队列串行执行，清理时无在途 soffice，安全。
fn cleanup_stale_profiles(word_cache: &Path, shared: &Path) {
    let Ok(entries) = fs::read_dir(word_cache) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() || p == shared {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("lo_profile") || name.starts_with("lo_retry") {
            let _ = fs::remove_dir_all(&p);
        } else {
            // 任务子目录（word_cache/{task_id}）：再清一层
            cleanup_stale_profiles(&p, shared);
        }
    }
}

// LibreOffice 的 -env:UserInstallation 需要 URL 编码的路径（file:// 后不能含裸空格等
// 特殊字符）。路径常含空格（如 ~/Library/Application Support），未编码会让 soffice
// 启动时抛 UNO RuntimeException 崩溃。按 UTF-8 字节编码，仅保留安全字符与路径分隔符。
fn urlencode_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'/' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// 用单个 Word 文件启动一次 soffice，超时内正常退出返回 true。
// 是否生成 PDF 由调用方检查缓存目录（输出名可能与 stem 不一致）。
// 使用独立 profile（主批崩溃后其 profile 可能残留锁/损坏组件，复用会启动失败）。
fn run_soffice_single(
    soffice: &Path,
    word_path: &str,
    cache_dir: &Path,
    timeout: Duration,
) -> bool {
    let uniq = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let retry_profile = cache_dir.join(format!("lo_retry_{uniq}"));
    let mut cmd = Command::new(soffice);
    // 同上：跳过 OpenCL 自检与 Java 检测，避免冷 profile 满核启动浪费。
    cmd.env("SAL_DISABLE_OPENCL", "1")
        .env("SAL_DISABLE_JAVA", "1")
        .arg("--headless")
        .arg("--norestore")
        .arg(format!(
            "-env:UserInstallation=file://{}",
            urlencode_path(&retry_profile)
        ))
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(cache_dir)
        .arg(word_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return false,
    };
    // 读取并丢弃 stderr，避免管道写满阻塞子进程
    let _drain = child.stderr.take().map(|mut s| {
        thread::spawn(move || {
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            buf
        })
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(st)) => return st.success(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                thread::sleep(Duration::from_millis(200));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
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

// 日志文件大小上限。超过后保留最近一半（按行边界裁剪），
// 防止长时间运行 app.log 无限膨胀：占用磁盘、启动 read_log_file 读整文件变慢。
// 检查仅一次 stat（O(1)），超限才做一次读+写（低频），不影响正常运行性能。
const MAX_LOG_FILE_BYTES: u64 = 4 * 1024 * 1024;

// 若日志文件超过上限，保留最近一半内容（从完整行边界开始裁剪）。
fn trim_log_file(log_path: &Path) -> std::io::Result<()> {
    let meta = std::fs::metadata(log_path)?;
    if meta.len() <= MAX_LOG_FILE_BYTES {
        return Ok(());
    }
    let all = std::fs::read(log_path)?;
    let keep_from = all.len().saturating_sub((MAX_LOG_FILE_BYTES / 2) as usize);
    // 从保留起点后的第一个换行开始，避免从某行中间切开（JSONL 一行一条）。
    let start = all[keep_from..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(keep_from, |off| keep_from + off + 1);
    if start >= all.len() {
        return Ok(());
    }
    std::fs::write(log_path, &all[start..])
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
    // 写入前先裁剪超限的历史日志，保证最新日志始终保留。
    trim_log_file(&log_path).map_err(|e| format!("整理日志文件失败：{e}"))?;
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
async fn scan_folder_tree(folder: String) -> Result<FolderTreeNode, String> {
    // 递归扫描大目录可能数百 ms，放阻塞线程池执行，避免占用主线程/IPC 异步运行时。
    tauri::async_runtime::spawn_blocking(move || {
        let folder_path = Path::new(&folder);
        if !folder_path.exists() {
            return Err(format!("文件夹不存在：{}", folder));
        }
        if !folder_path.is_dir() {
            return Err(format!("路径不是文件夹：{}", folder));
        }
        scan_directory_recursive(folder_path)
    })
    .await
    .map_err(|e| format!("扫描文件夹后台执行失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(tag: &str) -> PathBuf {
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "xhs_pic_scan_{tag}_{}_{}",
            std::process::id(),
            id
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn collect_recursive_finds_nested_input_files() {
        let root = temp_dir("nested");
        // 顶层 PDF
        fs::write(root.join("top.pdf"), b"x").unwrap();
        // 2 层子目录
        let l1 = root.join("level1");
        fs::create_dir_all(&l1).unwrap();
        fs::write(l1.join("a.docx"), b"x").unwrap();
        // 3 层子目录
        let l2 = l1.join("level2");
        fs::create_dir_all(&l2).unwrap();
        fs::write(l2.join("b.doc"), b"x").unwrap();
        // 非输入扩展名，应被忽略
        fs::write(l2.join("note.txt"), b"x").unwrap();
        // 空目录不应报错
        fs::create_dir_all(root.join("empty")).unwrap();

        let mut files = Vec::new();
        collect_input_files_recursive(&root, &mut files).unwrap();

        let mut names: Vec<String> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["a.docx", "b.doc", "top.pdf"]);
    }

    #[test]
    fn cleanup_stale_profiles_keeps_shared_and_pdfs() {
        let root = temp_dir("cleanup");
        // 共享 profile 目录，应保留
        let shared = root.join("shared_lo_profile");
        fs::create_dir_all(&shared).unwrap();
        // 任务子目录：历史独立 profile + 转换产物 PDF
        let t1 = root.join("task_a");
        fs::create_dir_all(t1.join("lo_profile_task_a_111")).unwrap();
        fs::create_dir_all(t1.join("lo_retry_222")).unwrap();
        fs::write(t1.join("report.pdf"), b"x").unwrap();
        // 另一任务的历史 profile
        let t2 = root.join("task_b");
        fs::create_dir_all(t2.join("lo_profile_task_b_333")).unwrap();

        cleanup_stale_profiles(&root, &shared);

        assert!(shared.exists(), "共享 profile 应保留");
        assert!(t1.join("report.pdf").exists(), "转换产物 PDF 应保留");
        assert!(!t1.join("lo_profile_task_a_111").exists(), "历史批量 profile 应删除");
        assert!(!t1.join("lo_retry_222").exists(), "历史重试 profile 应删除");
        assert!(!t2.join("lo_profile_task_b_333").exists(), "其他任务历史 profile 应删除");
    }

    #[test]
    fn physical_worker_count_is_at_least_one() {
        // warp 双线性插值并行度：物理核数 >= 1，保证 rayon 池合法。
        assert!(physical_worker_count() >= 1);
    }

    #[test]
    fn trim_log_file_caps_size_and_keeps_line_boundary() {
        let root = temp_dir("log_trim");
        let path = root.join("app.log");

        // 构造超过上限的文件：每行 100 字节 + 换行，行数使总大小 > 4MB。
        let line = [b'x'; 100];
        let mut content = Vec::new();
        let lines = (MAX_LOG_FILE_BYTES as usize / 100) + 20;
        for _ in 0..lines {
            content.extend_from_slice(&line);
            content.push(b'\n');
        }
        fs::write(&path, &content).unwrap();
        assert!(fs::metadata(&path).unwrap().len() > MAX_LOG_FILE_BYTES);

        trim_log_file(&path).unwrap();

        let trimmed = fs::read(&path).unwrap();
        assert!(
            trimmed.len() as u64 <= MAX_LOG_FILE_BYTES,
            "裁剪后仍超限：{}",
            trimmed.len()
        );
        // 从完整行边界开始：首字节是行内容，末字节是换行。
        assert_eq!(trimmed[0], b'x');
        assert_eq!(*trimmed.last().unwrap(), b'\n');
    }
}
