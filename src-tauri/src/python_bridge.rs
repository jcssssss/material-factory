// Tauri → Python 引擎桥接模块。
//
// 通过 subprocess 调用 `tools/document_cleaning_engine/cli.py` 并将 JSON
// 输出反序列化为前端对齐的 Rust 结构体。
//
// 路径解析顺序：
//   1. 环境变量 DOC_CLEANER_CLI
//   2. 相对于当前工作目录: ../tools/document_cleaning_engine/cli.py

use std::path::PathBuf;
use std::process::Command;

use crate::watermark::{CleanReportResult, FileDetectionResult};

/// 定位 cli.py 路径。
fn find_cli() -> PathBuf {
    if let Ok(path) = std::env::var("DOC_CLEANER_CLI") {
        let p = PathBuf::from(path);
        if p.exists() {
            return p;
        }
    }
    // 相对于 cwd（在桌面 App dev 模式下 cwd 通常是项目根或 frontend/）
    let candidates = [
        "tools/document_cleaning_engine/cli.py",
        "../tools/document_cleaning_engine/cli.py",
    ];
    for rel in &candidates {
        let p = PathBuf::from(rel);
        if p.exists() {
            return p;
        }
    }
    // 最后尝试：在可执行文件同级
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("cli.py");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("../tools/document_cleaning_engine/cli.py")
}

/// 运行 Python CLI 并返回 stdout。
fn run_python(args: &[&str]) -> Result<String, String> {
    let cli = find_cli();
    let output = Command::new("python3")
        .arg(cli.to_str().unwrap_or("cli.py"))
        .args(args)
        .output()
        .map_err(|e| format!("调用 Python CLI 失败：{e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python CLI 返回错误：{stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err("Python CLI 输出为空".to_string());
    }
    Ok(stdout)
}

/// 使用 Python 引擎检测单个 PDF 文件。
#[tauri::command]
pub fn python_detect(pdf_path: String) -> Result<FileDetectionResult, String> {
    let json_str = run_python(&["detect", &pdf_path])?;
    serde_json::from_str(&json_str).map_err(|e| format!("解析检测结果失败：{e}"))
}

/// 使用 Python 引擎执行清理。
#[tauri::command]
pub fn python_clean(
    pdf_path: String,
    output_path: String,
) -> Result<CleanReportResult, String> {
    let json_str = run_python(&["clean", &pdf_path, &output_path])?;
    serde_json::from_str(&json_str).map_err(|e| format!("解析清理结果失败：{e}"))
}

/// 使用 Python 引擎验证清理结果。
#[tauri::command]
pub fn python_validate(
    original_path: String,
    cleaned_path: String,
) -> Result<serde_json::Value, String> {
    let json_str = run_python(&["validate", &original_path, &cleaned_path])?;
    serde_json::from_str(&json_str).map_err(|e| format!("解析验证结果失败：{e}"))
}
