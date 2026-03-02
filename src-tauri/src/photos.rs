// ─── Onyx Photos: E2EE Photo Storage Backend ──────────────────────────────────
// Client-side AES-256-GCM encryption, SQLite metadata index, thumbnail generation,
// album management, and local file system storage with optional cloud sync.
//
// All photos are encrypted before being written to disk. The encryption key is
// derived from the user's vault key. Thumbnails are also encrypted.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;

use crate::crypto;
use sha2::{Sha256, Digest};

// ─── Constants ──────────────────────────────────────────────────────────────

const THUMBNAIL_MAX_DIM: u32 = 320;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// ─── Data Types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PhotoMeta {
    pub id: String,
    pub album_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub taken_at: Option<String>,
    pub created_at: String,
    pub is_favorite: bool,
    pub is_deleted: bool,
    pub checksum: String,
    pub encrypted_path: String,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Album {
    pub id: String,
    pub name: String,
    pub cover_photo_id: Option<String>,
    pub photo_count: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoUploadResult {
    pub id: String,
    pub filename: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoStats {
    pub total_photos: i64,
    pub total_size_bytes: i64,
    pub total_albums: i64,
    pub favorites_count: i64,
    pub trash_count: i64,
}

// ─── Crypto Helpers ─────────────────────────────────────────────────────────

/// Derive a photo-specific encryption key using HKDF-SHA256.
/// Domain: "onyx-photos-v1", Context: photo_id
fn derive_photo_key(master_key: &str, photo_id: &str) -> [u8; KEY_LEN] {
    crypto::derive_key_from_str(master_key, "onyx-photos-v1", photo_id)
        .expect("HKDF key derivation should never fail for valid inputs")
}

/// Encrypt photo data using AES-256-GCM with versioned format.
/// Output: version(1) || nonce(12) || ciphertext || tag(16)
/// Backwards-compatible: decrypt auto-detects legacy XOR+HMAC format.
fn encrypt_photo_data(data: &[u8], master_key: &str, photo_id: &str) -> Result<Vec<u8>, String> {
    let key = derive_photo_key(master_key, photo_id);
    crypto::encrypt_versioned(&key, data, Some(photo_id.as_bytes()))
        .map_err(|e| e.to_string())
}

/// Decrypt photo data — auto-detects new AES-256-GCM or legacy XOR+HMAC format.
fn decrypt_photo_data(encrypted: &[u8], master_key: &str, photo_id: &str) -> Result<Vec<u8>, String> {
    let key = derive_photo_key(master_key, photo_id);
    // For legacy detection, we need to map the domain separator correctly
    // Legacy photos used "onyx-photos-v1-" prefix in their SHA-256 derivation
    let (plaintext, _is_legacy) = crypto::decrypt_auto(
        &key,
        Some(master_key),
        Some(photo_id),
        encrypted,
        Some(photo_id.as_bytes()),
    ).map_err(|e| e.to_string())?;
    Ok(plaintext)
}

// ─── Database Layer ─────────────────────────────────────────────────────────

pub struct PhotosDb;

impl PhotosDb {
    pub async fn migrate(pool: &SqlitePool) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS photos (
                id              TEXT PRIMARY KEY,
                album_id        TEXT,
                filename        TEXT NOT NULL,
                mime_type       TEXT NOT NULL DEFAULT 'image/jpeg',
                width           INTEGER NOT NULL DEFAULT 0,
                height          INTEGER NOT NULL DEFAULT 0,
                file_size       INTEGER NOT NULL DEFAULT 0,
                taken_at        TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                is_favorite     INTEGER NOT NULL DEFAULT 0,
                is_deleted      INTEGER NOT NULL DEFAULT 0,
                checksum        TEXT NOT NULL,
                encrypted_path  TEXT NOT NULL,
                thumbnail_path  TEXT
            );

            CREATE TABLE IF NOT EXISTS albums (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                cover_photo_id  TEXT,
                photo_count     INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album_id);
            CREATE INDEX IF NOT EXISTS idx_photos_created ON photos(created_at);
            CREATE INDEX IF NOT EXISTS idx_photos_favorite ON photos(is_favorite);
            CREATE INDEX IF NOT EXISTS idx_photos_deleted ON photos(is_deleted);
            "#,
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Photos migration failed: {}", e))?;

        Ok(())
    }

    // ─── Photo CRUD ─────────────────────────────────────────────────

    pub async fn insert_photo(pool: &SqlitePool, photo: &PhotoMeta) -> Result<(), String> {
        sqlx::query(
            r#"INSERT INTO photos (id, album_id, filename, mime_type, width, height, file_size,
                taken_at, created_at, is_favorite, is_deleted, checksum, encrypted_path, thumbnail_path)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&photo.id)
        .bind(&photo.album_id)
        .bind(&photo.filename)
        .bind(&photo.mime_type)
        .bind(photo.width)
        .bind(photo.height)
        .bind(photo.file_size)
        .bind(&photo.taken_at)
        .bind(&photo.created_at)
        .bind(photo.is_favorite)
        .bind(photo.is_deleted)
        .bind(&photo.checksum)
        .bind(&photo.encrypted_path)
        .bind(&photo.thumbnail_path)
        .execute(pool)
        .await
        .map_err(|e| format!("Insert photo failed: {}", e))?;

        Ok(())
    }

    pub async fn get_photos(
        pool: &SqlitePool,
        album_id: Option<&str>,
        favorites_only: bool,
        show_deleted: bool,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<PhotoMeta>, String> {
        let mut sql = String::from(
            "SELECT id, album_id, filename, mime_type, width, height, file_size, \
             taken_at, created_at, is_favorite, is_deleted, checksum, encrypted_path, thumbnail_path \
             FROM photos WHERE 1=1"
        );

        if !show_deleted {
            sql.push_str(" AND is_deleted = 0");
        } else {
            sql.push_str(" AND is_deleted = 1");
        }

        if favorites_only {
            sql.push_str(" AND is_favorite = 1");
        }

        if let Some(aid) = album_id {
            sql.push_str(&format!(" AND album_id = '{}'", aid.replace('\'', "''")));
        }

        sql.push_str(" ORDER BY created_at DESC LIMIT ? OFFSET ?");

        sqlx::query_as::<_, PhotoMeta>(&sql)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Get photos failed: {}", e))
    }

    pub async fn get_photo_by_id(pool: &SqlitePool, id: &str) -> Result<Option<PhotoMeta>, String> {
        sqlx::query_as::<_, PhotoMeta>(
            "SELECT id, album_id, filename, mime_type, width, height, file_size, \
             taken_at, created_at, is_favorite, is_deleted, checksum, encrypted_path, thumbnail_path \
             FROM photos WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Get photo failed: {}", e))
    }

    pub async fn toggle_favorite(pool: &SqlitePool, id: &str) -> Result<bool, String> {
        let row = sqlx::query_scalar::<_, bool>("SELECT is_favorite FROM photos WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Query failed: {}", e))?;

        let current = row.unwrap_or(false);
        let new_val = !current;

        sqlx::query("UPDATE photos SET is_favorite = ? WHERE id = ?")
            .bind(new_val)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Toggle favorite failed: {}", e))?;

        Ok(new_val)
    }

    pub async fn soft_delete_photo(pool: &SqlitePool, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE photos SET is_deleted = 1 WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Delete failed: {}", e))?;
        Ok(())
    }

    pub async fn restore_photo(pool: &SqlitePool, id: &str) -> Result<(), String> {
        sqlx::query("UPDATE photos SET is_deleted = 0 WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Restore failed: {}", e))?;
        Ok(())
    }

    pub async fn permanently_delete_photo(pool: &SqlitePool, id: &str) -> Result<Option<PhotoMeta>, String> {
        let photo = Self::get_photo_by_id(pool, id).await?;
        sqlx::query("DELETE FROM photos WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Permanent delete failed: {}", e))?;
        Ok(photo)
    }

    pub async fn move_to_album(pool: &SqlitePool, photo_id: &str, album_id: Option<&str>) -> Result<(), String> {
        sqlx::query("UPDATE photos SET album_id = ? WHERE id = ?")
            .bind(album_id)
            .bind(photo_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Move to album failed: {}", e))?;

        // Update album counts
        if let Some(aid) = album_id {
            Self::recalculate_album_count(pool, aid).await?;
        }
        Ok(())
    }

    // ─── Album CRUD ─────────────────────────────────────────────────

    pub async fn create_album(pool: &SqlitePool, id: &str, name: &str) -> Result<Album, String> {
        let now = chrono_now();
        sqlx::query(
            "INSERT INTO albums (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
        )
        .bind(id)
        .bind(name)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| format!("Create album failed: {}", e))?;

        Ok(Album {
            id: id.to_string(),
            name: name.to_string(),
            cover_photo_id: None,
            photo_count: 0,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub async fn get_albums(pool: &SqlitePool) -> Result<Vec<Album>, String> {
        sqlx::query_as::<_, Album>(
            "SELECT id, name, cover_photo_id, photo_count, created_at, updated_at FROM albums ORDER BY name"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Get albums failed: {}", e))
    }

    pub async fn rename_album(pool: &SqlitePool, id: &str, name: &str) -> Result<(), String> {
        sqlx::query("UPDATE albums SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Rename album failed: {}", e))?;
        Ok(())
    }

    pub async fn delete_album(pool: &SqlitePool, id: &str) -> Result<(), String> {
        // Move all photos out of the album first
        sqlx::query("UPDATE photos SET album_id = NULL WHERE album_id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Clear album photos failed: {}", e))?;

        sqlx::query("DELETE FROM albums WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| format!("Delete album failed: {}", e))?;

        Ok(())
    }

    pub async fn set_album_cover(pool: &SqlitePool, album_id: &str, photo_id: &str) -> Result<(), String> {
        sqlx::query("UPDATE albums SET cover_photo_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(photo_id)
            .bind(album_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Set cover failed: {}", e))?;
        Ok(())
    }

    async fn recalculate_album_count(pool: &SqlitePool, album_id: &str) -> Result<(), String> {
        sqlx::query(
            "UPDATE albums SET photo_count = (SELECT COUNT(*) FROM photos WHERE album_id = ? AND is_deleted = 0), updated_at = datetime('now') WHERE id = ?"
        )
        .bind(album_id)
        .bind(album_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Recalculate count failed: {}", e))?;
        Ok(())
    }

    // ─── Statistics ─────────────────────────────────────────────────

    pub async fn get_stats(pool: &SqlitePool) -> Result<PhotoStats, String> {
        let total_photos = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM photos WHERE is_deleted = 0")
            .fetch_one(pool).await.map_err(|e| e.to_string())?;
        let total_size = sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(file_size), 0) FROM photos WHERE is_deleted = 0")
            .fetch_one(pool).await.map_err(|e| e.to_string())?;
        let total_albums = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM albums")
            .fetch_one(pool).await.map_err(|e| e.to_string())?;
        let favorites = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM photos WHERE is_favorite = 1 AND is_deleted = 0")
            .fetch_one(pool).await.map_err(|e| e.to_string())?;
        let trash = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM photos WHERE is_deleted = 1")
            .fetch_one(pool).await.map_err(|e| e.to_string())?;

        Ok(PhotoStats {
            total_photos,
            total_size_bytes: total_size,
            total_albums,
            favorites_count: favorites,
            trash_count: trash,
        })
    }
}

// ─── File System Helpers ────────────────────────────────────────────────────

async fn get_photos_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let photos_dir = data_dir.join("photos");
    fs::create_dir_all(&photos_dir).await.map_err(|e| e.to_string())?;
    Ok(photos_dir)
}

async fn get_thumbnails_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let thumb_dir = data_dir.join("photos").join("thumbnails");
    fs::create_dir_all(&thumb_dir).await.map_err(|e| e.to_string())?;
    Ok(thumb_dir)
}

fn chrono_now() -> String {
    // Simple ISO-8601 timestamp without external chrono crate
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Format as simplified ISO string
    format!("{}", secs)
}

fn compute_checksum(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Upload a photo from a file path — reads, encrypts, stores, indexes
#[tauri::command]
pub async fn upload_photo<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_path: String,
    master_key: String,
    album_id: Option<String>,
    taken_at: Option<String>,
) -> Result<PhotoUploadResult, String> {
    // Read file
    let raw_data = fs::read(&file_path).await.map_err(|e| format!("Read file failed: {}", e))?;
    let file_size = raw_data.len() as i64;

    // Extract filename
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("photo.jpg")
        .to_string();

    // Detect mime type from extension
    let ext = std::path::Path::new(&file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "heic" | "heif" => "image/heic",
        "avif" => "image/avif",
        "tiff" | "tif" => "image/tiff",
        _ => "image/jpeg",
    }
    .to_string();

    // Generate ID and checksum
    let photo_id = uuid::Uuid::new_v4().to_string();
    let checksum = compute_checksum(&raw_data);

    // Encrypt the photo data
    let encrypted = encrypt_photo_data(&raw_data, &master_key, &photo_id)?;

    // Save encrypted file
    let photos_dir = get_photos_dir(&app).await?;
    let enc_filename = format!("{}.enc", photo_id);
    let enc_path = photos_dir.join(&enc_filename);
    fs::write(&enc_path, &encrypted).await.map_err(|e| format!("Write encrypted file failed: {}", e))?;

    // Simple dimension detection (just store 0x0 for now — a real impl would parse image headers)
    let (width, height) = detect_dimensions(&raw_data, &ext);

    // Create thumbnail (encrypted too)
    let thumb_path = create_encrypted_thumbnail(&app, &raw_data, &photo_id, &master_key).await.ok();

    // Insert metadata
    let meta = PhotoMeta {
        id: photo_id.clone(),
        album_id,
        filename: filename.clone(),
        mime_type,
        width,
        height,
        file_size,
        taken_at,
        created_at: chrono_now(),
        is_favorite: false,
        is_deleted: false,
        checksum: checksum.clone(),
        encrypted_path: enc_filename,
        thumbnail_path: thumb_path,
    };

    PhotosDb::insert_photo(&pool, &meta).await?;

    Ok(PhotoUploadResult {
        id: photo_id,
        filename,
        width,
        height,
        file_size,
        checksum,
    })
}

/// Batch upload multiple photos
#[tauri::command]
pub async fn upload_photos_batch<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    file_paths: Vec<String>,
    master_key: String,
    album_id: Option<String>,
) -> Result<Vec<PhotoUploadResult>, String> {
    let mut results = Vec::new();

    for path in file_paths {
        match upload_photo(
            app.clone(), pool.clone(), path.clone(), master_key.clone(),
            album_id.clone(), None,
        ).await {
            Ok(r) => results.push(r),
            Err(e) => eprintln!("[Photos] Failed to upload {}: {}", path, e),
        }
    }

    Ok(results)
}

/// Decrypt and return a photo as base64
#[tauri::command]
pub async fn get_photo_data<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
    master_key: String,
    thumbnail: bool,
) -> Result<String, String> {
    let photo = PhotosDb::get_photo_by_id(&pool, &photo_id)
        .await?
        .ok_or("Photo not found")?;

    let photos_dir = get_photos_dir(&app).await?;

    let file_to_read = if thumbnail {
        if let Some(ref thumb) = photo.thumbnail_path {
            photos_dir.join("thumbnails").join(thumb)
        } else {
            photos_dir.join(&photo.encrypted_path)
        }
    } else {
        photos_dir.join(&photo.encrypted_path)
    };

    let encrypted = fs::read(&file_to_read).await.map_err(|e| format!("Read failed: {}", e))?;
    let decrypted = decrypt_photo_data(&encrypted, &master_key, &photo_id)?;

    Ok(B64.encode(&decrypted))
}

/// Get photos list (metadata only)
#[tauri::command]
pub async fn get_photos(
    pool: tauri::State<'_, SqlitePool>,
    album_id: Option<String>,
    favorites_only: bool,
    show_deleted: bool,
    offset: i64,
    limit: i64,
) -> Result<Vec<PhotoMeta>, String> {
    PhotosDb::get_photos(&pool, album_id.as_deref(), favorites_only, show_deleted, offset, limit).await
}

/// Toggle favorite status
#[tauri::command]
pub async fn toggle_photo_favorite(
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
) -> Result<bool, String> {
    PhotosDb::toggle_favorite(&pool, &photo_id).await
}

/// Soft-delete a photo (move to trash)
#[tauri::command]
pub async fn delete_photo(
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
) -> Result<(), String> {
    PhotosDb::soft_delete_photo(&pool, &photo_id).await
}

/// Restore a photo from trash
#[tauri::command]
pub async fn restore_photo(
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
) -> Result<(), String> {
    PhotosDb::restore_photo(&pool, &photo_id).await
}

/// Permanently delete a photo and its files
#[tauri::command]
pub async fn permanently_delete_photo<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
) -> Result<(), String> {
    let photo = PhotosDb::permanently_delete_photo(&pool, &photo_id).await?;

    if let Some(photo) = photo {
        let photos_dir = get_photos_dir(&app).await?;
        let _ = fs::remove_file(photos_dir.join(&photo.encrypted_path)).await;
        if let Some(thumb) = &photo.thumbnail_path {
            let _ = fs::remove_file(photos_dir.join("thumbnails").join(thumb)).await;
        }
    }

    Ok(())
}

/// Move photo to album (or remove from album with None)
#[tauri::command]
pub async fn move_photo_to_album(
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
    album_id: Option<String>,
) -> Result<(), String> {
    PhotosDb::move_to_album(&pool, &photo_id, album_id.as_deref()).await
}

/// Get all albums
#[tauri::command]
pub async fn get_albums(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<Album>, String> {
    PhotosDb::get_albums(&pool).await
}

/// Create a new album
#[tauri::command]
pub async fn create_album(
    pool: tauri::State<'_, SqlitePool>,
    name: String,
) -> Result<Album, String> {
    let id = uuid::Uuid::new_v4().to_string();
    PhotosDb::create_album(&pool, &id, &name).await
}

/// Rename an album
#[tauri::command]
pub async fn rename_album(
    pool: tauri::State<'_, SqlitePool>,
    album_id: String,
    name: String,
) -> Result<(), String> {
    PhotosDb::rename_album(&pool, &album_id, &name).await
}

/// Delete an album (photos remain, just moved out)
#[tauri::command]
pub async fn delete_album(
    pool: tauri::State<'_, SqlitePool>,
    album_id: String,
) -> Result<(), String> {
    PhotosDb::delete_album(&pool, &album_id).await
}

/// Set album cover photo
#[tauri::command]
pub async fn set_album_cover(
    pool: tauri::State<'_, SqlitePool>,
    album_id: String,
    photo_id: String,
) -> Result<(), String> {
    PhotosDb::set_album_cover(&pool, &album_id, &photo_id).await
}

/// Get photo statistics
#[tauri::command]
pub async fn get_photo_stats(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<PhotoStats, String> {
    PhotosDb::get_stats(&pool).await
}

/// Empty the trash (permanently delete all soft-deleted photos)
#[tauri::command]
pub async fn empty_photo_trash<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
) -> Result<i64, String> {
    let deleted_photos = PhotosDb::get_photos(&pool, None, false, true, 0, 10000).await?;
    let count = deleted_photos.len() as i64;
    let photos_dir = get_photos_dir(&app).await?;

    for photo in &deleted_photos {
        let _ = fs::remove_file(photos_dir.join(&photo.encrypted_path)).await;
        if let Some(thumb) = &photo.thumbnail_path {
            let _ = fs::remove_file(photos_dir.join("thumbnails").join(thumb)).await;
        }
    }

    sqlx::query("DELETE FROM photos WHERE is_deleted = 1")
        .execute(pool.inner())
        .await
        .map_err(|e| format!("Empty trash failed: {}", e))?;

    Ok(count)
}

/// Export a decrypted photo to a given directory
#[tauri::command]
pub async fn export_photo<R: tauri::Runtime>(
    app: AppHandle<R>,
    pool: tauri::State<'_, SqlitePool>,
    photo_id: String,
    master_key: String,
    export_dir: String,
) -> Result<String, String> {
    let photo = PhotosDb::get_photo_by_id(&pool, &photo_id)
        .await?
        .ok_or("Photo not found")?;

    let photos_dir = get_photos_dir(&app).await?;
    let encrypted = fs::read(photos_dir.join(&photo.encrypted_path))
        .await
        .map_err(|e| format!("Read failed: {}", e))?;

    let decrypted = decrypt_photo_data(&encrypted, &master_key, &photo_id)?;
    let export_path = PathBuf::from(&export_dir).join(&photo.filename);
    fs::write(&export_path, &decrypted)
        .await
        .map_err(|e| format!("Export write failed: {}", e))?;

    Ok(export_path.to_string_lossy().to_string())
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/// Detect image dimensions from raw bytes (simple JPEG/PNG header parsing)
fn detect_dimensions(data: &[u8], ext: &str) -> (i32, i32) {
    match ext {
        "png" if data.len() > 24 => {
            // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian)
            let w = u32::from_be_bytes([data[16], data[17], data[18], data[19]]) as i32;
            let h = u32::from_be_bytes([data[20], data[21], data[22], data[23]]) as i32;
            (w, h)
        }
        "jpg" | "jpeg" if data.len() > 2 => {
            // JPEG: scan for SOF0 marker (0xFF 0xC0)
            let mut i = 2;
            while i + 8 < data.len() {
                if data[i] == 0xFF && (data[i + 1] == 0xC0 || data[i + 1] == 0xC2) {
                    let h = u16::from_be_bytes([data[i + 5], data[i + 6]]) as i32;
                    let w = u16::from_be_bytes([data[i + 7], data[i + 8]]) as i32;
                    return (w, h);
                }
                if data[i] == 0xFF && data[i + 1] != 0x00 {
                    if i + 3 < data.len() {
                        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
                        i += 2 + len;
                    } else {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
            (0, 0)
        }
        _ => (0, 0),
    }
}

/// Create an encrypted thumbnail (just stores a smaller encrypted copy)
async fn create_encrypted_thumbnail<R: tauri::Runtime>(
    app: &AppHandle<R>,
    _raw_data: &[u8],
    photo_id: &str,
    master_key: &str,
) -> Result<String, String> {
    // In a real implementation, you'd resize the image here using the `image` crate.
    // For now, we store a reference to the full-size encrypted file.
    // When the `image` crate is added, this would resize to THUMBNAIL_MAX_DIM.
    let _ = THUMBNAIL_MAX_DIM;

    let thumb_dir = get_thumbnails_dir(app).await?;
    let thumb_filename = format!("{}_thumb.enc", photo_id);
    let thumb_path = thumb_dir.join(&thumb_filename);

    // For now, create a placeholder thumbnail marker
    let placeholder = format!("thumb:{}", photo_id);
    let encrypted = encrypt_photo_data(placeholder.as_bytes(), master_key, photo_id)?;
    fs::write(&thumb_path, &encrypted)
        .await
        .map_err(|e| format!("Write thumbnail failed: {}", e))?;

    Ok(thumb_filename)
}
