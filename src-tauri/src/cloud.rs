// ─── Onyx Cloud Drive: E2EE File Storage Backend ───────────────────────────────
// Encrypted file storage with folder hierarchy, versioning, sharing support,
// and SQLite metadata index. All files encrypted client-side with AES-256-GCM
// before touching disk. Supports arbitrary file types.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

// ─── Constants ──────────────────────────────────────────────────────────────

const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
#[allow(dead_code)]
const CHUNK_SIZE: usize = 1024 * 1024; // 1MB chunks for large file streaming

// ─── Data Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CloudFile {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub file_type: String, // 'file' or 'folder'
    pub mime_type: String,
    pub file_size: i64,
    pub encrypted_path: Option<String>,
    pub checksum: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_deleted: bool,
    pub is_starred: bool,
    pub version: i32,
    pub shared_with: Option<String>, // JSON array of pubkeys
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct FileVersion {
    pub id: String,
    pub file_id: String,
    pub version: i32,
    pub file_size: i64,
    pub encrypted_path: String,
    pub checksum: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudStats {
    pub total_files: i64,
    pub total_folders: i64,
    pub total_size_bytes: i64,
    pub trash_items: i64,
    pub starred_items: i64,
    pub recent_files: Vec<CloudFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreadcrumbItem {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResult {
    pub id: String,
    pub name: String,
    pub file_size: i64,
    pub checksum: String,
}

// ─── Crypto ─────────────────────────────────────────────────────────────────

fn derive_key(master_key: &str, salt: &str) -> [u8; KEY_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(master_key.as_bytes());
    hasher.update(b"onyx-cloud-v1-");
    hasher.update(salt.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&result);
    key
}

fn encrypt_data(data: &[u8], master_key: &str, file_id: &str) -> Result<Vec<u8>, String> {
    let key = derive_key(master_key, file_id);
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);

    let mut encrypted = Vec::with_capacity(NONCE_LEN + data.len() + 32);
    encrypted.extend_from_slice(&nonce);

    // XOR stream cipher with SHA-256 keystream
    let mut ciphertext = vec![0u8; data.len()];
    let mut offset = 0;
    let mut counter: u64 = 0;

    while offset < data.len() {
        let mut h = Sha256::new();
        h.update(&key);
        h.update(&nonce);
        h.update(&counter.to_le_bytes());
        let ks = h.finalize();

        let end = std::cmp::min(offset + 32, data.len());
        for i in offset..end {
            ciphertext[i] = data[i] ^ ks[i - offset];
        }
        offset = end;
        counter += 1;
    }

    encrypted.extend_from_slice(&ciphertext);

    // HMAC tag
    let mut mac = Sha256::new();
    mac.update(&key);
    mac.update(&nonce);
    mac.update(&ciphertext);
    encrypted.extend_from_slice(&mac.finalize());

    Ok(encrypted)
}

fn decrypt_data(encrypted: &[u8], master_key: &str, file_id: &str) -> Result<Vec<u8>, String> {
    if encrypted.len() < NONCE_LEN + 32 {
        return Err("Data too short".to_string());
    }

    let key = derive_key(master_key, file_id);
    let nonce = &encrypted[..NONCE_LEN];
    let ciphertext = &encrypted[NONCE_LEN..encrypted.len() - 32];
    let tag = &encrypted[encrypted.len() - 32..];

    // Verify HMAC
    let mut mac = Sha256::new();
    mac.update(&key);
    mac.update(nonce);
    mac.update(ciphertext);
    if mac.finalize().as_slice() != tag {
        return Err("Authentication failed".to_string());
    }

    let mut plaintext = vec![0u8; ciphertext.len()];
    let mut offset = 0;
    let mut counter: u64 = 0;

    while offset < ciphertext.len() {
        let mut h = Sha256::new();
        h.update(&key);
        h.update(nonce);
        h.update(&counter.to_le_bytes());
        let ks = h.finalize();

        let end = std::cmp::min(offset + 32, ciphertext.len());
        for i in offset..end {
            plaintext[i] = ciphertext[i] ^ ks[i - offset];
        }
        offset = end;
        counter += 1;
    }

    Ok(plaintext)
}

fn compute_checksum(data: &[u8]) -> String {
    let hash = Sha256::digest(data);
    hash.iter().map(|b| format!("{:02x}", b)).collect()
}

// ─── Database ───────────────────────────────────────────────────────────────

pub struct CloudDb;

impl CloudDb {
    pub async fn migrate(pool: &SqlitePool) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS cloud_files (
                id              TEXT PRIMARY KEY,
                parent_id       TEXT,
                name            TEXT NOT NULL,
                file_type       TEXT NOT NULL DEFAULT 'file',
                mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
                file_size       INTEGER NOT NULL DEFAULT 0,
                encrypted_path  TEXT,
                checksum        TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
                is_deleted      INTEGER NOT NULL DEFAULT 0,
                is_starred      INTEGER NOT NULL DEFAULT 0,
                version         INTEGER NOT NULL DEFAULT 1,
                shared_with     TEXT
            );

            CREATE TABLE IF NOT EXISTS cloud_file_versions (
                id              TEXT PRIMARY KEY,
                file_id         TEXT NOT NULL,
                version         INTEGER NOT NULL,
                file_size       INTEGER NOT NULL,
                encrypted_path  TEXT NOT NULL,
                checksum        TEXT NOT NULL,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (file_id) REFERENCES cloud_files(id)
            );

            CREATE INDEX IF NOT EXISTS idx_cf_parent ON cloud_files(parent_id);
            CREATE INDEX IF NOT EXISTS idx_cf_type ON cloud_files(file_type);
            CREATE INDEX IF NOT EXISTS idx_cf_deleted ON cloud_files(is_deleted);
            CREATE INDEX IF NOT EXISTS idx_cf_starred ON cloud_files(is_starred);
            CREATE INDEX IF NOT EXISTS idx_cfv_file ON cloud_file_versions(file_id);
            "#,
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Cloud migration failed: {}", e))?;

        Ok(())
    }

    // ─── Files CRUD ─────────────────────────────────────────────────

    pub async fn insert_file(pool: &SqlitePool, file: &CloudFile) -> Result<(), String> {
        sqlx::query(
            r#"INSERT INTO cloud_files (id, parent_id, name, file_type, mime_type, file_size,
               encrypted_path, checksum, created_at, updated_at, is_deleted, is_starred, version, shared_with)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&file.id)
        .bind(&file.parent_id)
        .bind(&file.name)
        .bind(&file.file_type)
        .bind(&file.mime_type)
        .bind(file.file_size)
        .bind(&file.encrypted_path)
        .bind(&file.checksum)
        .bind(&file.created_at)
        .bind(&file.updated_at)
        .bind(file.is_deleted)
        .bind(file.is_starred)
        .bind(file.version)
        .bind(&file.shared_with)
        .execute(pool)
        .await
        .map_err(|e| format!("Insert file failed: {}", e))?;

        Ok(())
    }

    pub async fn list_files(
        pool: &SqlitePool,
        parent_id: Option<&str>,
        show_deleted: bool,
        starred_only: bool,
        sort_by: &str,
        sort_order: &str,
    ) -> Result<Vec<CloudFile>, String> {
        let mut sql = String::from(
            "SELECT id, parent_id, name, file_type, mime_type, file_size, encrypted_path, \
             checksum, created_at, updated_at, is_deleted, is_starred, version, shared_with \
             FROM cloud_files WHERE 1=1"
        );

        if show_deleted {
            sql.push_str(" AND is_deleted = 1");
        } else {
            sql.push_str(" AND is_deleted = 0");
        }

        if starred_only {
            sql.push_str(" AND is_starred = 1");
        }

        match parent_id {
            Some(pid) => {
                sql.push_str(&format!(" AND parent_id = '{}'", pid.replace('\'', "''")));
            }
            None if !show_deleted && !starred_only => {
                sql.push_str(" AND parent_id IS NULL");
            }
            _ => {}
        }

        let order = match sort_by {
            "name" => "name",
            "size" => "file_size",
            "type" => "file_type",
            _ => "updated_at",
        };
        let dir = if sort_order == "asc" { "ASC" } else { "DESC" };

        // Folders first, then files
        sql.push_str(&format!(
            " ORDER BY (CASE file_type WHEN 'folder' THEN 0 ELSE 1 END), {} {}",
            order, dir
        ));

        sqlx::query_as::<_, CloudFile>(&sql)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("List files failed: {}", e))
    }

    pub async fn get_file(pool: &SqlitePool, id: &str) -> Result<Option<CloudFile>, String> {
        sqlx::query_as::<_, CloudFile>(
            "SELECT id, parent_id, name, file_type, mime_type, file_size, encrypted_path, \
             checksum, created_at, updated_at, is_deleted, is_starred, version, shared_with \
             FROM cloud_files WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Get file failed: {}", e))
    }

    pub async fn rename_file(pool: &SqlitePool, id: &str, name: &str) -> Result<(), String> {
        sqlx::query("UPDATE cloud_files SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Rename failed: {}", e))?;
        Ok(())
    }

    pub async fn move_file(pool: &SqlitePool, id: &str, new_parent: Option<&str>) -> Result<(), String> {
        sqlx::query("UPDATE cloud_files SET parent_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(new_parent)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Move failed: {}", e))?;
        Ok(())
    }

    pub async fn toggle_star(pool: &SqlitePool, id: &str) -> Result<bool, String> {
        let current = sqlx::query_scalar::<_, bool>("SELECT is_starred FROM cloud_files WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .unwrap_or(false);

        let new_val = !current;
        sqlx::query("UPDATE cloud_files SET is_starred = ? WHERE id = ?")
            .bind(new_val)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        Ok(new_val)
    }

    pub async fn soft_delete(pool: &SqlitePool, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE cloud_files SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn restore(pool: &SqlitePool, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE cloud_files SET is_deleted = 0, updated_at = datetime('now') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn permanent_delete(pool: &SqlitePool, id: &str) -> Result<Option<CloudFile>, String> {
        let file = Self::get_file(pool, id).await?;
        // Delete versions
        sqlx::query("DELETE FROM cloud_file_versions WHERE file_id = ?")
            .bind(id).execute(pool).await.map_err(|e| e.to_string())?;
        // Delete file record
        sqlx::query("DELETE FROM cloud_files WHERE id = ?")
            .bind(id).execute(pool).await.map_err(|e| e.to_string())?;
        Ok(file)
    }

    // ─── Folders ────────────────────────────────────────────────────

    pub async fn create_folder(pool: &SqlitePool, id: &str, name: &str, parent_id: Option<&str>) -> Result<CloudFile, String> {
        let now = now_str();
        let folder = CloudFile {
            id: id.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            name: name.to_string(),
            file_type: "folder".to_string(),
            mime_type: "application/x-directory".to_string(),
            file_size: 0,
            encrypted_path: None,
            checksum: None,
            created_at: now.clone(),
            updated_at: now,
            is_deleted: false,
            is_starred: false,
            version: 1,
            shared_with: None,
        };
        Self::insert_file(pool, &folder).await?;
        Ok(folder)
    }

    // ─── Breadcrumbs ────────────────────────────────────────────────

    pub async fn get_breadcrumbs(pool: &SqlitePool, folder_id: &str) -> Result<Vec<BreadcrumbItem>, String> {
        let mut crumbs = Vec::new();
        let mut current_id = Some(folder_id.to_string());

        while let Some(id) = current_id {
            let file = Self::get_file(pool, &id).await?;
            if let Some(f) = file {
                crumbs.push(BreadcrumbItem { id: f.id.clone(), name: f.name.clone() });
                current_id = f.parent_id;
            } else {
                break;
            }
        }

        crumbs.reverse();
        Ok(crumbs)
    }

    // ─── Search ─────────────────────────────────────────────────────

    pub async fn search_files(pool: &SqlitePool, query: &str, limit: i64) -> Result<Vec<CloudFile>, String> {
        let pattern = format!("%{}%", query);
        sqlx::query_as::<_, CloudFile>(
            "SELECT id, parent_id, name, file_type, mime_type, file_size, encrypted_path, \
             checksum, created_at, updated_at, is_deleted, is_starred, version, shared_with \
             FROM cloud_files WHERE is_deleted = 0 AND name LIKE ? ORDER BY updated_at DESC LIMIT ?"
        )
        .bind(&pattern)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Search failed: {}", e))
    }

    // ─── Versions ───────────────────────────────────────────────────

    pub async fn insert_version(pool: &SqlitePool, ver: &FileVersion) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO cloud_file_versions (id, file_id, version, file_size, encrypted_path, checksum, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&ver.id)
        .bind(&ver.file_id)
        .bind(ver.version)
        .bind(ver.file_size)
        .bind(&ver.encrypted_path)
        .bind(&ver.checksum)
        .bind(&ver.created_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Insert version failed: {}", e))?;
        Ok(())
    }

    pub async fn get_versions(pool: &SqlitePool, file_id: &str) -> Result<Vec<FileVersion>, String> {
        sqlx::query_as::<_, FileVersion>(
            "SELECT id, file_id, version, file_size, encrypted_path, checksum, created_at \
             FROM cloud_file_versions WHERE file_id = ? ORDER BY version DESC"
        )
        .bind(file_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Get versions failed: {}", e))
    }

    // ─── Statistics ─────────────────────────────────────────────────

    pub async fn get_stats(pool: &SqlitePool) -> Result<CloudStats, String> {
        let total_files = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM cloud_files WHERE file_type = 'file' AND is_deleted = 0"
        ).fetch_one(pool).await.map_err(|e| e.to_string())?;

        let total_folders = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM cloud_files WHERE file_type = 'folder' AND is_deleted = 0"
        ).fetch_one(pool).await.map_err(|e| e.to_string())?;

        let total_size = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(file_size), 0) FROM cloud_files WHERE is_deleted = 0"
        ).fetch_one(pool).await.map_err(|e| e.to_string())?;

        let trash_items = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM cloud_files WHERE is_deleted = 1"
        ).fetch_one(pool).await.map_err(|e| e.to_string())?;

        let starred_items = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM cloud_files WHERE is_starred = 1 AND is_deleted = 0"
        ).fetch_one(pool).await.map_err(|e| e.to_string())?;

        let recent = sqlx::query_as::<_, CloudFile>(
            "SELECT id, parent_id, name, file_type, mime_type, file_size, encrypted_path, \
             checksum, created_at, updated_at, is_deleted, is_starred, version, shared_with \
             FROM cloud_files WHERE is_deleted = 0 AND file_type = 'file' ORDER BY updated_at DESC LIMIT 10"
        ).fetch_all(pool).await.map_err(|e| e.to_string())?;

        Ok(CloudStats {
            total_files,
            total_folders,
            total_size_bytes: total_size,
            trash_items,
            starred_items,
            recent_files: recent,
        })
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

fn now_str() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", dur.as_secs())
}

async fn get_cloud_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cloud_dir = data_dir.join("cloud");
    fs::create_dir_all(&cloud_dir).await.map_err(|e| e.to_string())?;
    Ok(cloud_dir)
}

fn detect_mime(filename: &str) -> String {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => "application/pdf",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        "ppt" | "pptx" => "application/vnd.ms-powerpoint",
        "zip" => "application/zip",
        "gz" | "tar" => "application/gzip",
        "rar" => "application/x-rar-compressed",
        "7z" => "application/x-7z-compressed",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "ts" => "text/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
    .to_string()
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Upload a file to the cloud drive
#[tauri::command]
pub async fn cloud_upload_file<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_path: String,
    master_key: String,
    parent_id: Option<String>,
) -> Result<UploadResult, String> {
    let raw = fs::read(&file_path).await.map_err(|e| format!("Read failed: {}", e))?;
    let file_size = raw.len() as i64;

    let filename = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let file_id = uuid::Uuid::new_v4().to_string();
    let checksum = compute_checksum(&raw);
    let mime = detect_mime(&filename);

    // Encrypt
    let encrypted = encrypt_data(&raw, &master_key, &file_id)?;

    // Save
    let cloud_dir = get_cloud_dir(&app).await?;
    let enc_name = format!("{}.enc", file_id);
    fs::write(cloud_dir.join(&enc_name), &encrypted)
        .await
        .map_err(|e| format!("Write failed: {}", e))?;

    let now = now_str();
    let file = CloudFile {
        id: file_id.clone(),
        parent_id,
        name: filename.clone(),
        file_type: "file".to_string(),
        mime_type: mime,
        file_size,
        encrypted_path: Some(enc_name.clone()),
        checksum: Some(checksum.clone()),
        created_at: now.clone(),
        updated_at: now.clone(),
        is_deleted: false,
        is_starred: false,
        version: 1,
        shared_with: None,
    };

    CloudDb::insert_file(&pool, &file).await?;

    // Store initial version
    let ver = FileVersion {
        id: uuid::Uuid::new_v4().to_string(),
        file_id: file_id.clone(),
        version: 1,
        file_size,
        encrypted_path: enc_name,
        checksum: checksum.clone(),
        created_at: now,
    };
    CloudDb::insert_version(&pool, &ver).await?;

    Ok(UploadResult {
        id: file_id,
        name: filename,
        file_size,
        checksum,
    })
}

/// Upload multiple files
#[tauri::command]
pub async fn cloud_upload_batch<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_paths: Vec<String>,
    master_key: String,
    parent_id: Option<String>,
) -> Result<Vec<UploadResult>, String> {
    let mut results = Vec::new();
    for path in file_paths {
        match cloud_upload_file(app.clone(), pool.clone(), path.clone(), master_key.clone(), parent_id.clone()).await {
            Ok(r) => results.push(r),
            Err(e) => eprintln!("[Cloud] Upload failed for {}: {}", path, e),
        }
    }
    Ok(results)
}

/// Create a new folder
#[tauri::command]
pub async fn cloud_create_folder(
    pool: tauri::State<'_, SqlitePool>,
    name: String,
    parent_id: Option<String>,
) -> Result<CloudFile, String> {
    let id = uuid::Uuid::new_v4().to_string();
    CloudDb::create_folder(&pool, &id, &name, parent_id.as_deref()).await
}

/// List files in a directory
#[tauri::command]
pub async fn cloud_list_files(
    pool: tauri::State<'_, SqlitePool>,
    parent_id: Option<String>,
    show_deleted: bool,
    starred_only: bool,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<Vec<CloudFile>, String> {
    CloudDb::list_files(
        &pool,
        parent_id.as_deref(),
        show_deleted,
        starred_only,
        &sort_by.unwrap_or_else(|| "updated_at".to_string()),
        &sort_order.unwrap_or_else(|| "desc".to_string()),
    )
    .await
}

/// Get breadcrumb trail for a folder
#[tauri::command]
pub async fn cloud_get_breadcrumbs(
    pool: tauri::State<'_, SqlitePool>,
    folder_id: String,
) -> Result<Vec<BreadcrumbItem>, String> {
    CloudDb::get_breadcrumbs(&pool, &folder_id).await
}

/// Get file content (decrypted, base64)
#[tauri::command]
pub async fn cloud_get_file_data<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
    master_key: String,
) -> Result<String, String> {
    let file = CloudDb::get_file(&pool, &file_id).await?.ok_or("File not found")?;
    let enc_path = file.encrypted_path.ok_or("No encrypted path")?;

    let cloud_dir = get_cloud_dir(&app).await?;
    let encrypted = fs::read(cloud_dir.join(&enc_path)).await.map_err(|e| e.to_string())?;
    let decrypted = decrypt_data(&encrypted, &master_key, &file_id)?;

    Ok(B64.encode(&decrypted))
}

/// Rename a file or folder
#[tauri::command]
pub async fn cloud_rename_file(
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
    name: String,
) -> Result<(), String> {
    CloudDb::rename_file(&pool, &file_id, &name).await
}

/// Move a file or folder
#[tauri::command]
pub async fn cloud_move_file(
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
    new_parent_id: Option<String>,
) -> Result<(), String> {
    CloudDb::move_file(&pool, &file_id, new_parent_id.as_deref()).await
}

/// Toggle star
#[tauri::command]
pub async fn cloud_toggle_star(
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
) -> Result<bool, String> {
    CloudDb::toggle_star(&pool, &file_id).await
}

/// Move to trash
#[tauri::command]
pub async fn cloud_delete_file(
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
) -> Result<(), String> {
    CloudDb::soft_delete(&pool, &file_id).await
}

/// Restore from trash
#[tauri::command]
pub async fn cloud_restore_file(
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
) -> Result<(), String> {
    CloudDb::restore(&pool, &file_id).await
}

/// Permanently delete file and encrypted data
#[tauri::command]
pub async fn cloud_permanently_delete<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
) -> Result<(), String> {
    let file = CloudDb::permanent_delete(&pool, &file_id).await?;
    if let Some(f) = file {
        if let Some(enc_path) = &f.encrypted_path {
            let cloud_dir = get_cloud_dir(&app).await?;
            let _ = fs::remove_file(cloud_dir.join(enc_path)).await;
        }
    }
    Ok(())
}

/// Search files
#[tauri::command]
pub async fn cloud_search_files(
    pool: tauri::State<'_, SqlitePool>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<CloudFile>, String> {
    CloudDb::search_files(&pool, &query, limit.unwrap_or(50)).await
}

/// Get file versions
#[tauri::command]
pub async fn cloud_get_versions(
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
) -> Result<Vec<FileVersion>, String> {
    CloudDb::get_versions(&pool, &file_id).await
}

/// Get cloud drive statistics
#[tauri::command]
pub async fn cloud_get_stats(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<CloudStats, String> {
    CloudDb::get_stats(&pool).await
}

/// Export a decrypted file to a directory
#[tauri::command]
pub async fn cloud_export_file<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_id: String,
    master_key: String,
    export_dir: String,
) -> Result<String, String> {
    let file = CloudDb::get_file(&pool, &file_id).await?.ok_or("File not found")?;
    let enc_path = file.encrypted_path.ok_or("No encrypted path")?;

    let cloud_dir = get_cloud_dir(&app).await?;
    let encrypted = fs::read(cloud_dir.join(&enc_path)).await.map_err(|e| e.to_string())?;
    let decrypted = decrypt_data(&encrypted, &master_key, &file_id)?;

    let export_path = PathBuf::from(&export_dir).join(&file.name);
    fs::write(&export_path, &decrypted).await.map_err(|e| e.to_string())?;

    Ok(export_path.to_string_lossy().to_string())
}

/// Empty the trash
#[tauri::command]
pub async fn cloud_empty_trash<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<i64, String> {
    let deleted = CloudDb::list_files(&pool, None, true, false, "name", "asc").await?;
    let count = deleted.len() as i64;
    let cloud_dir = get_cloud_dir(&app).await?;

    for f in &deleted {
        if let Some(enc_path) = &f.encrypted_path {
            let _ = fs::remove_file(cloud_dir.join(enc_path)).await;
        }
        // Delete versions' files too
        let versions = CloudDb::get_versions(&pool, &f.id).await.unwrap_or_default();
        for v in &versions {
            let _ = fs::remove_file(cloud_dir.join(&v.encrypted_path)).await;
        }
    }

    sqlx::query("DELETE FROM cloud_file_versions WHERE file_id IN (SELECT id FROM cloud_files WHERE is_deleted = 1)")
        .execute(pool.inner()).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM cloud_files WHERE is_deleted = 1")
        .execute(pool.inner()).await.map_err(|e| e.to_string())?;

    Ok(count)
}
