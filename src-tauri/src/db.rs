use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

#[derive(serde::Serialize, Clone)]
pub struct BackgroundRecord {
    pub id: String,
    pub file_name: String,
    pub width: i64,
    pub height: i64,
    pub file_size: i64,
    pub calibrated: bool,
    pub created_at: String,
    pub a4_x1: Option<f64>,
    pub a4_y1: Option<f64>,
    pub a4_x2: Option<f64>,
    pub a4_y2: Option<f64>,
    pub a4_x3: Option<f64>,
    pub a4_y3: Option<f64>,
    pub a4_x4: Option<f64>,
    pub a4_y4: Option<f64>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建数据库目录失败：{e}"))?;
        }
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("打开数据库失败：{e}"))?;
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;

        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS backgrounds (
                id              TEXT PRIMARY KEY,
                file_name       TEXT NOT NULL,
                width           INTEGER NOT NULL,
                height          INTEGER NOT NULL,
                file_size       INTEGER NOT NULL,
                calibrated      INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_backgrounds_created_at
                ON backgrounds(created_at DESC);
            ",
        )
        .map_err(|e| format!("数据库基表迁移失败：{e}"))?;

        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(backgrounds)")
            .map_err(|e| format!("查询表结构失败：{e}"))?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("读取表结构失败：{e}"))?
            .filter_map(|r| r.ok())
            .collect();

        let corner_cols = [
            "a4_x1", "a4_y1", "a4_x2", "a4_y2",
            "a4_x3", "a4_y3", "a4_x4", "a4_y4",
        ];
        for col in &corner_cols {
            if !cols.contains(&col.to_string()) {
                conn.execute_batch(&format!(
                    "ALTER TABLE backgrounds ADD COLUMN {col} REAL;"
                ))
                .map_err(|e| format!("添加列 {col} 失败：{e}"))?;
            }
        }

        Ok(())
    }

    fn row_to_background(row: &rusqlite::Row) -> rusqlite::Result<BackgroundRecord> {
        Ok(BackgroundRecord {
            id: row.get(0)?,
            file_name: row.get(1)?,
            width: row.get(2)?,
            height: row.get(3)?,
            file_size: row.get(4)?,
            calibrated: row.get::<_, i64>(5)? != 0,
            created_at: row.get(6)?,
            a4_x1: row.get(7)?,
            a4_y1: row.get(8)?,
            a4_x2: row.get(9)?,
            a4_y2: row.get(10)?,
            a4_x3: row.get(11)?,
            a4_y3: row.get(12)?,
            a4_x4: row.get(13)?,
            a4_y4: row.get(14)?,
        })
    }

    const BACKGROUND_SELECT: &'static str =
        "SELECT id, file_name, width, height, file_size, calibrated, created_at, \
         a4_x1, a4_y1, a4_x2, a4_y2, a4_x3, a4_y3, a4_x4, a4_y4 \
         FROM backgrounds";

    pub fn list_backgrounds(&self) -> Result<Vec<BackgroundRecord>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;
        let mut stmt = conn
            .prepare(&format!(
                "{} ORDER BY created_at DESC",
                Self::BACKGROUND_SELECT
            ))
            .map_err(|e| format!("查询背景模板失败：{e}"))?;
        let rows = stmt
            .query_map([], Self::row_to_background)
            .map_err(|e| format!("遍历背景模板失败：{e}"))?;
        let mut records = Vec::new();
        for row in rows {
            records.push(row.map_err(|e| format!("读取背景模板行失败：{e}"))?);
        }
        Ok(records)
    }

    pub fn insert_background(
        &self,
        id: &str,
        file_name: &str,
        width: i64,
        height: i64,
        file_size: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;
        conn.execute(
            "INSERT INTO backgrounds (id, file_name, width, height, file_size, calibrated, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, 0, datetime('now'))",
            params![id, file_name, width, height, file_size],
        )
        .map_err(|e| format!("插入背景模板失败：{e}"))?;
        Ok(())
    }

    pub fn delete_background(&self, id: &str) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;
        let file_name: String = conn
            .query_row(
                "SELECT file_name FROM backgrounds WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| format!("查询背景模板文件名失败：{e}"))?;
        conn.execute("DELETE FROM backgrounds WHERE id = ?1", params![id])
            .map_err(|e| format!("删除背景模板失败：{e}"))?;
        Ok(file_name)
    }

    pub fn batch_delete_backgrounds(&self, ids: &[String]) -> Result<Vec<String>, String> {
        let mut file_names = Vec::new();
        for id in ids {
            file_names.push(self.delete_background(id)?);
        }
        Ok(file_names)
    }

    pub fn get_background(&self, id: &str) -> Result<BackgroundRecord, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;
        conn.query_row(
            &format!("{} WHERE id = ?1", Self::BACKGROUND_SELECT),
            params![id],
            Self::row_to_background,
        )
        .map_err(|e| format!("查询背景模板失败：{e}"))
    }

    pub fn save_calibration(
        &self,
        id: &str,
        corners: &[f64; 8],
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;
        conn.execute(
            "UPDATE backgrounds SET \
             a4_x1 = ?1, a4_y1 = ?2, a4_x2 = ?3, a4_y2 = ?4, \
             a4_x3 = ?5, a4_y3 = ?6, a4_x4 = ?7, a4_y4 = ?8, \
             calibrated = 1 \
             WHERE id = ?9",
            params![
                corners[0], corners[1], corners[2], corners[3],
                corners[4], corners[5], corners[6], corners[7],
                id
            ],
        )
        .map_err(|e| format!("保存标定数据失败：{e}"))?;
        Ok(())
    }

    pub fn random_background(&self) -> Result<BackgroundRecord, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取数据库锁失败：{e}"))?;
        conn.query_row(
            &format!("{} ORDER BY RANDOM() LIMIT 1", Self::BACKGROUND_SELECT),
            [],
            Self::row_to_background,
        )
        .map_err(|e| format!("随机获取背景模板失败：{e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_db() -> (Database, PathBuf) {
        let count = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("xhs_pic_test_{}_{}", std::process::id(), count));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        let db = Database::new(path.clone()).unwrap();
        (db, dir)
    }

    #[test]
    fn test_new_creates_tables() {
        let (db, _dir) = temp_db();
        let conn = db.conn.lock().unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.contains(&"backgrounds".to_string()), "should have backgrounds table");
        // 仅 background 表活跃使用；tasks/page_results/logs/breakpoints
        // 已从迁移中移除（对应 JSONL 文件日志、localStorage 断点方案）。
        assert_eq!(tables.len(), 1, "only backgrounds table should be created");
    }

    #[test]
    fn test_insert_and_list_background() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "test.jpg", 1920, 1080, 102400).unwrap();
        let list = db.list_backgrounds().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "bg_001");
        assert_eq!(list[0].file_name, "test.jpg");
        assert_eq!(list[0].width, 1920);
        assert_eq!(list[0].height, 1080);
        assert_eq!(list[0].file_size, 102400);
        assert!(!list[0].calibrated);
    }

    #[test]
    fn test_insert_multiple_backgrounds_ordered_by_created_at_desc() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "a.jpg", 100, 100, 100).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        db.insert_background("bg_002", "b.jpg", 200, 200, 200).unwrap();

        let list = db.list_backgrounds().unwrap();
        assert_eq!(list.len(), 2);
        // list order: created_at DESC, so bg_002 first
        assert_eq!(list[0].id, "bg_002");
        assert_eq!(list[1].id, "bg_001");
    }

    #[test]
    fn test_get_background() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "test.jpg", 1920, 1080, 50000).unwrap();
        let record = db.get_background("bg_001").unwrap();
        assert_eq!(record.id, "bg_001");
        assert_eq!(record.file_name, "test.jpg");
    }

    #[test]
    fn test_get_background_not_found() {
        let (db, _dir) = temp_db();
        let result = db.get_background("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_background() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "test.jpg", 100, 100, 100).unwrap();
        let file_name = db.delete_background("bg_001").unwrap();
        assert_eq!(file_name, "test.jpg");
        assert!(db.list_backgrounds().unwrap().is_empty());
    }

    #[test]
    fn test_batch_delete_backgrounds() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "a.jpg", 100, 100, 100).unwrap();
        db.insert_background("bg_002", "b.jpg", 200, 200, 200).unwrap();
        let names = db.batch_delete_backgrounds(&["bg_001".to_string(), "bg_002".to_string()]).unwrap();
        assert_eq!(names.len(), 2);
        assert!(db.list_backgrounds().unwrap().is_empty());
    }

    #[test]
    fn test_save_calibration() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "test.jpg", 1000, 800, 1024).unwrap();
        let corners: [f64; 8] = [0.1, 0.2, 0.8, 0.2, 0.8, 0.9, 0.1, 0.9];
        db.save_calibration("bg_001", &corners).unwrap();

        let record = db.get_background("bg_001").unwrap();
        assert!(record.calibrated);
        assert_eq!(record.a4_x1, Some(0.1));
        assert_eq!(record.a4_y1, Some(0.2));
        assert_eq!(record.a4_x3, Some(0.8));
        assert_eq!(record.a4_y3, Some(0.9));
    }

    #[test]
    fn test_random_background() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "a.jpg", 100, 100, 100).unwrap();
        db.insert_background("bg_002", "b.jpg", 200, 200, 200).unwrap();
        let record = db.random_background().unwrap();
        // Should return one of the two inserted
        assert!(record.id == "bg_001" || record.id == "bg_002");
    }

    #[test]
    fn test_random_background_empty() {
        let (db, _dir) = temp_db();
        let result = db.random_background();
        assert!(result.is_err());
    }

    #[test]
    fn test_duplicate_id_returns_error() {
        let (db, _dir) = temp_db();
        db.insert_background("bg_001", "a.jpg", 100, 100, 100).unwrap();
        let result = db.insert_background("bg_001", "b.jpg", 200, 200, 200);
        assert!(result.is_err());
    }

    #[test]
    fn test_migration_adds_corner_columns() {
        // Create table without corner columns, then run migrations to add them
        let count = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("xhs_pic_migrate_test_{}_{}", std::process::id(), count));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("migrate_test.db");

        // Create DB with old schema (no corner columns)
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS backgrounds (
                    id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    file_size INTEGER NOT NULL,
                    calibrated INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );"
            ).unwrap();
            conn.execute(
                "INSERT INTO backgrounds (id, file_name, width, height, file_size, calibrated, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, datetime('now'))",
                params!["bg_old", "old.jpg", 100, 100, 100],
            ).unwrap();
        }

        // Re-open with migrations
        let db = Database::new(path.clone()).unwrap();

        // Corner columns should exist now
        let record = db.get_background("bg_old").unwrap();
        assert_eq!(record.file_name, "old.jpg");
        assert!(record.a4_x1.is_none());

        // Can save calibration on the migrated record
        let corners: [f64; 8] = [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0];
        db.save_calibration("bg_old", &corners).unwrap();
        let updated = db.get_background("bg_old").unwrap();
        assert!(updated.calibrated);
        assert_eq!(updated.a4_x1, Some(0.0));

        // Cleanup
        let _ = std::fs::remove_dir_all(&dir);
    }
}
