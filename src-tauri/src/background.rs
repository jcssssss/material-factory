use crate::db::Database;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager, State};

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

#[command]
pub fn save_background_file(
    app: AppHandle,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let dir = backgrounds_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建背景目录失败：{e}"))?;

    let file_id = generate_background_id();
    let ext = ext.trim_start_matches('.');
    let file_name = format!("{file_id}.{ext}");
    let file_path = dir.join(&file_name);

    fs::write(&file_path, &bytes).map_err(|e| format!("写入背景文件失败：{e}"))?;

    Ok(file_name)
}

#[command]
pub fn read_background_file(
    app: AppHandle,
    file_name: String,
) -> Result<Vec<u8>, String> {
    let dir = backgrounds_dir(&app)?;
    let file_path = dir.join(&file_name);

    if !file_path.exists() {
        return Err(format!("背景文件不存在：{file_name}"));
    }

    fs::read(&file_path).map_err(|e| format!("读取背景文件失败：{e}"))
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
    Ok(())
}
