// src-tauri/src/email_cache.rs
// ─── Local Email Cache: SQLite-backed IMAP Mirror ─────────────────────────────
//
// Zero-latency email UI: all emails are served from a local SQLite cache.
// A background worker continuously syncs IMAP → SQLite.
// Token refresh is handled transparently via an interceptor pattern.
//
// Architecture:
//   1. EmailCacheDb — SQLite schema + CRUD for cached emails
//   2. OAuthInterceptor — auto-refresh expired tokens via keyring
//   3. BackgroundSyncer — tokio task that polls IMAP and upserts into cache
//   4. Tauri commands — query cache for instant UI, trigger syncs

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::command;
use tauri::Emitter;
use tokio::sync::{Mutex, RwLock};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CachedEmail {
    pub id: i64,
    pub account_id: String,
    pub uid: i64,
    pub message_id: String,
    pub folder: String,
    pub from_address: String,
    pub from_name: String,
    pub to_address: String,
    pub subject: String,
    pub preview: String,
    pub date_str: String,
    pub date_epoch: i64,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    pub category: String,
    pub html_body: Option<String>,
    pub text_body: Option<String>,
    pub raw_headers: Option<String>,
    pub synced_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CachedEmailHeader {
    pub id: i64,
    pub account_id: String,
    pub uid: i64,
    pub message_id: String,
    pub folder: String,
    pub from_address: String,
    pub from_name: String,
    pub to_address: String,
    pub subject: String,
    pub preview: String,
    pub date_str: String,
    pub date_epoch: i64,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub in_reply_to: Option<String>,
    pub references_header: Option<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedEmailBody {
    pub uid: i64,
    pub html_body: Option<String>,
    pub text_body: Option<String>,
    pub attachments: Vec<CachedAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CachedAttachment {
    pub id: i64,
    pub email_id: i64,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSyncState {
    pub account_id: String,
    pub folder: String,
    pub last_uid: i64,
    pub total_count: i64,
    pub syncing: bool,
    pub last_sync_epoch: i64,
    pub error: Option<String>,
}

/// Token state held in memory — refreshed transparently
#[derive(Debug, Clone)]
pub struct TokenState {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64, // unix timestamp
    pub provider: String,
    pub client_id: String,
}

// ─── Email Cache Database ─────────────────────────────────────────────────────

pub struct EmailCacheDb;

impl EmailCacheDb {
    /// Run migrations for the email cache tables
    pub async fn migrate(pool: &SqlitePool) -> Result<(), String> {
        // Main emails table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS cached_emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                uid INTEGER NOT NULL,
                message_id TEXT NOT NULL DEFAULT '',
                folder TEXT NOT NULL DEFAULT 'INBOX',
                from_address TEXT NOT NULL DEFAULT '',
                from_name TEXT NOT NULL DEFAULT '',
                to_address TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                preview TEXT NOT NULL DEFAULT '',
                date_str TEXT NOT NULL DEFAULT '',
                date_epoch INTEGER NOT NULL DEFAULT 0,
                is_read INTEGER NOT NULL DEFAULT 0,
                is_starred INTEGER NOT NULL DEFAULT 0,
                has_attachments INTEGER NOT NULL DEFAULT 0,
                in_reply_to TEXT,
                references_header TEXT,
                category TEXT NOT NULL DEFAULT 'personal',
                html_body TEXT,
                text_body TEXT,
                raw_headers TEXT,
                synced_at INTEGER NOT NULL DEFAULT 0,
                UNIQUE(account_id, uid, folder)
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create cached_emails table: {}", e))?;

        // Attachments table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS cached_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_id INTEGER NOT NULL,
                filename TEXT NOT NULL DEFAULT '',
                mime_type TEXT NOT NULL DEFAULT '',
                size INTEGER NOT NULL DEFAULT 0,
                data_b64 TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (email_id) REFERENCES cached_emails(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create cached_attachments table: {}", e))?;

        // Sync state table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS email_sync_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL DEFAULT 'INBOX',
                last_uid INTEGER NOT NULL DEFAULT 0,
                total_count INTEGER NOT NULL DEFAULT 0,
                last_sync_epoch INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                UNIQUE(account_id, folder)
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create email_sync_state table: {}", e))?;

        // Indexes for fast queries
        let indexes = [
            "CREATE INDEX IF NOT EXISTS idx_cached_emails_account_folder ON cached_emails(account_id, folder)",
            "CREATE INDEX IF NOT EXISTS idx_cached_emails_date ON cached_emails(date_epoch DESC)",
            "CREATE INDEX IF NOT EXISTS idx_cached_emails_category ON cached_emails(category)",
            "CREATE INDEX IF NOT EXISTS idx_cached_emails_message_id ON cached_emails(message_id)",
            "CREATE INDEX IF NOT EXISTS idx_cached_emails_is_read ON cached_emails(is_read)",
            "CREATE INDEX IF NOT EXISTS idx_cached_attachments_email ON cached_attachments(email_id)",
        ];

        for idx in &indexes {
            sqlx::query(idx)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to create index: {}", e))?;
        }

        // FTS5 virtual table for full-text search
        sqlx::query(
            "CREATE VIRTUAL TABLE IF NOT EXISTS email_fts USING fts5(
                subject, from_address, from_name, preview, text_body,
                content='cached_emails',
                content_rowid='id'
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create FTS table: {}", e))?;

        // Triggers to keep FTS in sync
        sqlx::query(
            "CREATE TRIGGER IF NOT EXISTS email_fts_insert AFTER INSERT ON cached_emails BEGIN
                INSERT INTO email_fts(rowid, subject, from_address, from_name, preview, text_body)
                VALUES (new.id, new.subject, new.from_address, new.from_name, new.preview, new.text_body);
            END",
        )
        .execute(pool)
        .await
        .ok(); // May already exist

        sqlx::query(
            "CREATE TRIGGER IF NOT EXISTS email_fts_delete AFTER DELETE ON cached_emails BEGIN
                INSERT INTO email_fts(email_fts, rowid, subject, from_address, from_name, preview, text_body)
                VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.preview, old.text_body);
            END",
        )
        .execute(pool)
        .await
        .ok();

        sqlx::query(
            "CREATE TRIGGER IF NOT EXISTS email_fts_update AFTER UPDATE ON cached_emails BEGIN
                INSERT INTO email_fts(email_fts, rowid, subject, from_address, from_name, preview, text_body)
                VALUES ('delete', old.id, old.subject, old.from_address, old.from_name, old.preview, old.text_body);
                INSERT INTO email_fts(rowid, subject, from_address, from_name, preview, text_body)
                VALUES (new.id, new.subject, new.from_address, new.from_name, new.preview, new.text_body);
            END",
        )
        .execute(pool)
        .await
        .ok();

        println!("[EmailCache] Migrations complete");
        Ok(())
    }

    /// Upsert a cached email — if it exists by (account_id, uid, folder), update it
    #[allow(dead_code)]
    pub async fn upsert_email(pool: &SqlitePool, email: &CachedEmail) -> Result<i64, String> {
        let result = sqlx::query(
            "INSERT INTO cached_emails (
                account_id, uid, message_id, folder, from_address, from_name, to_address,
                subject, preview, date_str, date_epoch, is_read, is_starred, has_attachments,
                in_reply_to, references_header, category, html_body, text_body, raw_headers, synced_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
            ON CONFLICT(account_id, uid, folder) DO UPDATE SET
                is_read = excluded.is_read,
                is_starred = excluded.is_starred,
                html_body = COALESCE(excluded.html_body, cached_emails.html_body),
                text_body = COALESCE(excluded.text_body, cached_emails.text_body),
                synced_at = excluded.synced_at"
        )
        .bind(&email.account_id)
        .bind(email.uid)
        .bind(&email.message_id)
        .bind(&email.folder)
        .bind(&email.from_address)
        .bind(&email.from_name)
        .bind(&email.to_address)
        .bind(&email.subject)
        .bind(&email.preview)
        .bind(&email.date_str)
        .bind(email.date_epoch)
        .bind(email.is_read)
        .bind(email.is_starred)
        .bind(email.has_attachments)
        .bind(&email.in_reply_to)
        .bind(&email.references_header)
        .bind(&email.category)
        .bind(&email.html_body)
        .bind(&email.text_body)
        .bind(&email.raw_headers)
        .bind(email.synced_at)
        .execute(pool)
        .await
        .map_err(|e| format!("Upsert email failed: {}", e))?;

        Ok(result.last_insert_rowid())
    }

    /// Batch upsert emails (much faster than individual inserts)
    pub async fn upsert_emails_batch(pool: &SqlitePool, emails: &[CachedEmail]) -> Result<usize, String> {
        if emails.is_empty() {
            return Ok(0);
        }

        let mut count = 0usize;

        // Use a transaction for atomicity and speed
        let mut tx = pool.begin().await.map_err(|e| format!("Transaction begin failed: {}", e))?;

        for email in emails {
            sqlx::query(
                "INSERT INTO cached_emails (
                    account_id, uid, message_id, folder, from_address, from_name, to_address,
                    subject, preview, date_str, date_epoch, is_read, is_starred, has_attachments,
                    in_reply_to, references_header, category, html_body, text_body, raw_headers, synced_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
                ON CONFLICT(account_id, uid, folder) DO UPDATE SET
                    is_read = excluded.is_read,
                    is_starred = excluded.is_starred,
                    html_body = COALESCE(excluded.html_body, cached_emails.html_body),
                    text_body = COALESCE(excluded.text_body, cached_emails.text_body),
                    synced_at = excluded.synced_at"
            )
            .bind(&email.account_id)
            .bind(email.uid)
            .bind(&email.message_id)
            .bind(&email.folder)
            .bind(&email.from_address)
            .bind(&email.from_name)
            .bind(&email.to_address)
            .bind(&email.subject)
            .bind(&email.preview)
            .bind(&email.date_str)
            .bind(email.date_epoch)
            .bind(email.is_read)
            .bind(email.is_starred)
            .bind(email.has_attachments)
            .bind(&email.in_reply_to)
            .bind(&email.references_header)
            .bind(&email.category)
            .bind(&email.html_body)
            .bind(&email.text_body)
            .bind(&email.raw_headers)
            .bind(email.synced_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("Batch upsert failed: {}", e))?;

            count += 1;
        }

        tx.commit().await.map_err(|e| format!("Transaction commit failed: {}", e))?;
        Ok(count)
    }

    /// Get emails from cache (paginated, sorted by date desc)
    pub async fn get_emails(
        pool: &SqlitePool,
        account_id: Option<&str>,
        folder: &str,
        category: Option<&str>,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<CachedEmailHeader>, String> {
        let mut query = String::from(
            "SELECT id, account_id, uid, message_id, folder, from_address, from_name, to_address,
             subject, preview, date_str, date_epoch, is_read, is_starred, has_attachments,
             in_reply_to, references_header, category
             FROM cached_emails WHERE folder = ?1"
        );
        let mut bind_idx = 2;
        let mut binds: Vec<String> = vec![folder.to_string()];

        if let Some(aid) = account_id {
            query.push_str(&format!(" AND account_id = ?{}", bind_idx));
            binds.push(aid.to_string());
            bind_idx += 1;
        }

        if let Some(cat) = category {
            if cat != "all" {
                query.push_str(&format!(" AND category = ?{}", bind_idx));
                binds.push(cat.to_string());
                bind_idx += 1;
            }
        }

        query.push_str(&format!(" ORDER BY date_epoch DESC LIMIT ?{} OFFSET ?{}", bind_idx, bind_idx + 1));
        binds.push(limit.to_string());
        binds.push(offset.to_string());

        // Build the query dynamically
        let mut q = sqlx::query_as::<_, CachedEmailHeader>(&query);

        for b in &binds {
            q = q.bind(b);
        }

        let headers = q.fetch_all(pool).await.map_err(|e| format!("Query emails failed: {}", e))?;

        Ok(headers)
    }

    /// Get email body from cache
    pub async fn get_email_body(pool: &SqlitePool, account_id: &str, uid: i64, folder: &str) -> Result<Option<CachedEmailBody>, String> {
        let row: Option<(i64, i64, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT id, uid, html_body, text_body FROM cached_emails WHERE account_id = ?1 AND uid = ?2 AND folder = ?3"
        )
        .bind(account_id)
        .bind(uid)
        .bind(folder)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Query body failed: {}", e))?;

        match row {
            Some((email_id, uid, html, text)) => {
                // Fetch attachments
                let attachments: Vec<CachedAttachment> = sqlx::query_as(
                    "SELECT id, email_id, filename, mime_type, size, data_b64 FROM cached_attachments WHERE email_id = ?1"
                )
                .bind(email_id)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Query attachments failed: {}", e))?;

                Ok(Some(CachedEmailBody { uid, html_body: html, text_body: text, attachments }))
            }
            None => Ok(None),
        }
    }

    /// Store email body + attachments (called after fetching full body from IMAP)
    pub async fn store_email_body(
        pool: &SqlitePool,
        account_id: &str,
        uid: i64,
        folder: &str,
        html: Option<&str>,
        text: Option<&str>,
        attachments: &[CachedAttachment],
    ) -> Result<(), String> {
        // Update the email body
        sqlx::query(
            "UPDATE cached_emails SET html_body = ?1, text_body = ?2, synced_at = ?3
             WHERE account_id = ?4 AND uid = ?5 AND folder = ?6"
        )
        .bind(html)
        .bind(text)
        .bind(now_epoch())
        .bind(account_id)
        .bind(uid)
        .bind(folder)
        .execute(pool)
        .await
        .map_err(|e| format!("Update body failed: {}", e))?;

        // Get email_id for attachment storage
        if !attachments.is_empty() {
            let row: Option<(i64,)> = sqlx::query_as(
                "SELECT id FROM cached_emails WHERE account_id = ?1 AND uid = ?2 AND folder = ?3"
            )
            .bind(account_id)
            .bind(uid)
            .bind(folder)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Query email_id failed: {}", e))?;

            if let Some((email_id,)) = row {
                for att in attachments {
                    sqlx::query(
                        "INSERT OR IGNORE INTO cached_attachments (email_id, filename, mime_type, size, data_b64)
                         VALUES (?1, ?2, ?3, ?4, ?5)"
                    )
                    .bind(email_id)
                    .bind(&att.filename)
                    .bind(&att.mime_type)
                    .bind(att.size)
                    .bind(&att.data_b64)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Insert attachment failed: {}", e))?;
                }
            }
        }

        Ok(())
    }

    /// Full-text search across cached emails
    pub async fn search_emails(pool: &SqlitePool, query: &str, account_id: Option<&str>, limit: i64) -> Result<Vec<CachedEmailHeader>, String> {
        let fts_query = format!("{}*", query); // prefix matching

        let sql = if let Some(_aid) = account_id {
            format!(
                "SELECT e.id, e.account_id, e.uid, e.message_id, e.folder, e.from_address, e.from_name,
                 e.to_address, e.subject, e.preview, e.date_str, e.date_epoch, e.is_read, e.is_starred,
                 e.has_attachments, e.in_reply_to, e.references_header, e.category
                 FROM cached_emails e
                 INNER JOIN email_fts f ON e.id = f.rowid
                 WHERE email_fts MATCH ?1 AND e.account_id = ?2
                 ORDER BY rank LIMIT ?3"
            )
        } else {
            format!(
                "SELECT e.id, e.account_id, e.uid, e.message_id, e.folder, e.from_address, e.from_name,
                 e.to_address, e.subject, e.preview, e.date_str, e.date_epoch, e.is_read, e.is_starred,
                 e.has_attachments, e.in_reply_to, e.references_header, e.category
                 FROM cached_emails e
                 INNER JOIN email_fts f ON e.id = f.rowid
                 WHERE email_fts MATCH ?1
                 ORDER BY rank LIMIT ?2"
            )
        };

        let headers = if let Some(aid) = account_id {
            sqlx::query_as::<_, CachedEmailHeader>(&sql)
            .bind(&fts_query)
            .bind(aid)
            .bind(limit)
            .fetch_all(pool)
            .await
        } else {
            sqlx::query_as::<_, CachedEmailHeader>(&sql)
            .bind(&fts_query)
            .bind(limit)
            .fetch_all(pool)
            .await
        };

        let headers = headers.map_err(|e| format!("FTS search failed: {}", e))?;

        Ok(headers)
    }

    /// Mark email read/unread in cache
    pub async fn mark_read(pool: &SqlitePool, account_id: &str, uid: i64, folder: &str, read: bool) -> Result<(), String> {
        sqlx::query("UPDATE cached_emails SET is_read = ?1 WHERE account_id = ?2 AND uid = ?3 AND folder = ?4")
            .bind(read)
            .bind(account_id)
            .bind(uid)
            .bind(folder)
            .execute(pool)
            .await
            .map_err(|e| format!("Mark read failed: {}", e))?;
        Ok(())
    }

    /// Delete email from cache
    #[allow(dead_code)]
    pub async fn delete_email(pool: &SqlitePool, account_id: &str, uid: i64, folder: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM cached_emails WHERE account_id = ?1 AND uid = ?2 AND folder = ?3")
            .bind(account_id)
            .bind(uid)
            .bind(folder)
            .execute(pool)
            .await
            .map_err(|e| format!("Delete cached email failed: {}", e))?;
        Ok(())
    }

    /// Get total unread count
    pub async fn unread_count(pool: &SqlitePool, account_id: Option<&str>, folder: &str) -> Result<i64, String> {
        let (count,): (i64,) = if let Some(aid) = account_id {
            sqlx::query_as("SELECT COUNT(*) FROM cached_emails WHERE is_read = 0 AND account_id = ?1 AND folder = ?2")
                .bind(aid)
                .bind(folder)
                .fetch_one(pool)
                .await
        } else {
            sqlx::query_as("SELECT COUNT(*) FROM cached_emails WHERE is_read = 0 AND folder = ?1")
                .bind(folder)
                .fetch_one(pool)
                .await
        }.map_err(|e| format!("Unread count failed: {}", e))?;

        Ok(count)
    }

    /// Get sync state for an account/folder
    pub async fn get_sync_state(pool: &SqlitePool, account_id: &str, folder: &str) -> Result<Option<AccountSyncState>, String> {
        let row: Option<(String, String, i64, i64, i64, Option<String>)> = sqlx::query_as(
            "SELECT account_id, folder, last_uid, total_count, last_sync_epoch, error FROM email_sync_state WHERE account_id = ?1 AND folder = ?2"
        )
        .bind(account_id)
        .bind(folder)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Get sync state failed: {}", e))?;

        Ok(row.map(|r| AccountSyncState {
            account_id: r.0,
            folder: r.1,
            last_uid: r.2,
            total_count: r.3,
            syncing: false,
            last_sync_epoch: r.4,
            error: r.5,
        }))
    }

    /// Update sync state
    pub async fn set_sync_state(pool: &SqlitePool, state: &AccountSyncState) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO email_sync_state (account_id, folder, last_uid, total_count, last_sync_epoch, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(account_id, folder) DO UPDATE SET
                last_uid = excluded.last_uid,
                total_count = excluded.total_count,
                last_sync_epoch = excluded.last_sync_epoch,
                error = excluded.error"
        )
        .bind(&state.account_id)
        .bind(&state.folder)
        .bind(state.last_uid)
        .bind(state.total_count)
        .bind(state.last_sync_epoch)
        .bind(&state.error)
        .execute(pool)
        .await
        .map_err(|e| format!("Set sync state failed: {}", e))?;

        Ok(())
    }

    /// Purge all cached data for an account
    pub async fn purge_account(pool: &SqlitePool, account_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM cached_emails WHERE account_id = ?1")
            .bind(account_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Purge emails failed: {}", e))?;

        sqlx::query("DELETE FROM email_sync_state WHERE account_id = ?1")
            .bind(account_id)
            .execute(pool)
            .await
            .map_err(|e| format!("Purge sync state failed: {}", e))?;

        Ok(())
    }
}

// ─── OAuth Token Interceptor ──────────────────────────────────────────────────
//
// Transparently refreshes expired OAuth tokens before IMAP/SMTP operations.
// Tokens are stored in-memory with expiry tracking. On 401/auth failure,
// the interceptor fetches a new access_token using the stored refresh_token.

pub struct OAuthInterceptor {
    tokens: Arc<RwLock<HashMap<String, TokenState>>>,
}

impl OAuthInterceptor {
    pub fn new() -> Self {
        Self {
            tokens: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a token state for an account
    pub async fn set_token(&self, account_id: &str, state: TokenState) {
        let mut tokens = self.tokens.write().await;
        tokens.insert(account_id.to_string(), state);
    }

    /// Remove token state for an account
    pub async fn remove_token(&self, account_id: &str) {
        let mut tokens = self.tokens.write().await;
        tokens.remove(account_id);
    }

    /// Get a valid access token — refreshes if expired
    pub async fn get_valid_token(&self, account_id: &str) -> Result<String, String> {
        // First, check if token exists and is still valid
        {
            let tokens = self.tokens.read().await;
            if let Some(state) = tokens.get(account_id) {
                let now = now_epoch() as u64;
                // Consider token valid if it has >60s remaining
                if state.expires_at > now + 60 {
                    return Ok(state.access_token.clone());
                }
            }
        }

        // Token expired or missing — attempt refresh
        self.refresh_token(account_id).await
    }

    /// Force-refresh a token
    pub async fn refresh_token(&self, account_id: &str) -> Result<String, String> {
        let (refresh_token, provider, client_id) = {
            let tokens = self.tokens.read().await;
            let state = tokens.get(account_id)
                .ok_or_else(|| format!("No token state for account {}", account_id))?;
            let rt = state.refresh_token.clone()
                .ok_or_else(|| "No refresh token available — re-authenticate required".to_string())?;
            (rt, state.provider.clone(), state.client_id.clone())
        };

        println!("[OAuth] Refreshing token for account {}", account_id);

        let token_url = match provider.as_str() {
            "google" | "gmail" | "Gmail" => "https://oauth2.googleapis.com/token",
            "microsoft" | "outlook" | "Microsoft" => {
                "https://login.microsoftonline.com/common/oauth2/v2.0/token"
            }
            _ => return Err(format!("Unsupported OAuth provider: {}", provider)),
        };

        let params = [
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("client_id", &client_id),
        ];

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("HTTP client error: {}", e))?;

        let response = client
            .post(token_url)
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Token refresh request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Token refresh failed ({}): {}", status, body));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            expires_in: Option<u64>,
            refresh_token: Option<String>,
        }

        let token_resp: TokenResponse = response.json().await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        let expires_at = now_epoch() as u64 + token_resp.expires_in.unwrap_or(3600);

        // Update stored token
        {
            let mut tokens = self.tokens.write().await;
            if let Some(state) = tokens.get_mut(account_id) {
                state.access_token = token_resp.access_token.clone();
                state.expires_at = expires_at;
                // Some providers rotate refresh tokens
                if let Some(new_rt) = token_resp.refresh_token {
                    state.refresh_token = Some(new_rt);
                }
            }
        }

        println!("[OAuth] Token refreshed successfully for account {} (expires in {}s)", account_id, token_resp.expires_in.unwrap_or(3600));
        Ok(token_resp.access_token)
    }

    /// Execute an IMAP operation with automatic token refresh on auth failure.
    /// The closure receives a valid access_token and should return the IMAP result.
    /// On auth failure, we refresh and retry once.
    pub async fn with_retry<F, Fut, T>(&self, account_id: &str, operation: F) -> Result<T, String>
    where
        F: Fn(String) -> Fut + Send + Sync,
        Fut: std::future::Future<Output = Result<T, String>> + Send,
    {
        // First attempt with current token
        let token = self.get_valid_token(account_id).await?;

        match operation(token).await {
            Ok(result) => Ok(result),
            Err(e) => {
                let err_lower = e.to_lowercase();
                let is_auth_failure = err_lower.contains("authentication")
                    || err_lower.contains("auth failed")
                    || err_lower.contains("xoauth2")
                    || err_lower.contains("invalid credentials")
                    || err_lower.contains("login failed")
                    || err_lower.contains("no response");

                if is_auth_failure {
                    println!("[OAuth] Auth failure detected, refreshing token and retrying...");
                    // Force refresh and retry once
                    let new_token = self.refresh_token(account_id).await?;
                    operation(new_token).await
                } else {
                    Err(e)
                }
            }
        }
    }
}

// ─── Background Email Syncer ──────────────────────────────────────────────────
//
// Runs as a tokio background task. Periodically syncs IMAP → SQLite cache.
// Emits Tauri events so the frontend knows when new mail arrives.

pub struct BackgroundSyncer {
    pub pool: SqlitePool,
    pub interceptor: Arc<OAuthInterceptor>,
    pub active_syncs: Arc<Mutex<HashMap<String, bool>>>,
    shutdown: Arc<tokio::sync::Notify>,
}

impl BackgroundSyncer {
    pub fn new(pool: SqlitePool, interceptor: Arc<OAuthInterceptor>) -> Self {
        Self {
            pool,
            interceptor,
            active_syncs: Arc::new(Mutex::new(HashMap::new())),
            shutdown: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Start background sync for a specific account
    pub fn start_account_sync(
        &self,
        account_id: String,
        imap_host: String,
        imap_port: u16,
        email: String,
        auth_method: String,
        password: Option<String>,
        folders: Vec<String>,
        app_handle: tauri::AppHandle,
    ) {
        let pool = self.pool.clone();
        let interceptor = self.interceptor.clone();
        let active_syncs = self.active_syncs.clone();
        let shutdown = self.shutdown.clone();

        tokio::spawn(async move {
            // Mark as syncing
            {
                let mut syncs = active_syncs.lock().await;
                syncs.insert(account_id.clone(), true);
            }

            println!("[EmailSync] Starting background sync for {}", account_id);

            loop {
                // Check shutdown
                if tokio::time::timeout(Duration::from_millis(100), shutdown.notified()).await.is_ok() {
                    break;
                }

                // Check if still active
                {
                    let syncs = active_syncs.lock().await;
                    if !syncs.get(&account_id).copied().unwrap_or(false) {
                        break;
                    }
                }

                // Sync each folder
                for folder in &folders {
                    let sync_result = sync_folder_incremental(
                        &pool,
                        &interceptor,
                        &account_id,
                        &imap_host,
                        imap_port,
                        &email,
                        &auth_method,
                        password.as_deref(),
                        folder,
                    )
                    .await;

                    match sync_result {
                        Ok(new_count) => {
                            if new_count > 0 {
                                // Emit event to frontend
                                let _ = app_handle.emit("email-sync-update", serde_json::json!({
                                    "accountId": account_id,
                                    "folder": folder,
                                    "newCount": new_count,
                                }));
                            }
                        }
                        Err(e) => {
                            eprintln!("[EmailSync] Sync error for {}/{}: {}", account_id, folder, e);
                            // Update sync state with error
                            let _ = EmailCacheDb::set_sync_state(&pool, &AccountSyncState {
                                account_id: account_id.clone(),
                                folder: folder.clone(),
                                last_uid: 0,
                                total_count: 0,
                                syncing: false,
                                last_sync_epoch: now_epoch(),
                                error: Some(e),
                            }).await;
                        }
                    }
                }

                // Emit sync complete event
                let _ = app_handle.emit("email-sync-complete", serde_json::json!({
                    "accountId": account_id,
                    "timestamp": now_epoch(),
                }));

                // Sleep between sync cycles (60 seconds)
                tokio::time::sleep(Duration::from_secs(60)).await;
            }

            // Mark as not syncing
            {
                let mut syncs = active_syncs.lock().await;
                syncs.remove(&account_id);
            }

            println!("[EmailSync] Background sync stopped for {}", account_id);
        });
    }

    /// Stop sync for a specific account
    pub async fn stop_account_sync(&self, account_id: &str) {
        let mut syncs = self.active_syncs.lock().await;
        syncs.insert(account_id.to_string(), false);
    }

    /// Stop all syncs
    #[allow(dead_code)]
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}

/// Incremental IMAP sync: fetch only new UIDs since last sync
async fn sync_folder_incremental(
    pool: &SqlitePool,
    interceptor: &OAuthInterceptor,
    account_id: &str,
    imap_host: &str,
    imap_port: u16,
    email: &str,
    auth_method: &str,
    password: Option<&str>,
    folder: &str,
) -> Result<usize, String> {
    // Get last known UID for this folder
    let sync_state = EmailCacheDb::get_sync_state(pool, account_id, folder).await?;
    let last_uid = sync_state.as_ref().map(|s| s.last_uid).unwrap_or(0);

    let _account_id_owned = account_id.to_string();
    let imap_host_owned = imap_host.to_string();
    let email_owned = email.to_string();
    let auth_method_owned = auth_method.to_string();
    let password_owned = password.map(|s| s.to_string());
    let folder_owned = folder.to_string();

    // Determine the access token based on auth method
    let access_token = if auth_method == "oauth2" {
        Some(interceptor.get_valid_token(account_id).await?)
    } else {
        None
    };

    // Run IMAP fetch in blocking thread (imap crate is sync)
    let fetched_headers = tokio::task::spawn_blocking(move || {
        fetch_new_headers_sync(
            &imap_host_owned,
            imap_port,
            &email_owned,
            &auth_method_owned,
            access_token.as_deref(),
            password_owned.as_deref(),
            &folder_owned,
            last_uid as u32,
        )
    })
    .await
    .map_err(|e| format!("Spawn blocking failed: {}", e))??;

    if fetched_headers.is_empty() {
        return Ok(0);
    }

    let new_count = fetched_headers.len();
    let max_uid = fetched_headers.iter().map(|e| e.uid).max().unwrap_or(last_uid);

    // Batch upsert into cache
    EmailCacheDb::upsert_emails_batch(pool, &fetched_headers).await?;

    // Update sync state
    EmailCacheDb::set_sync_state(pool, &AccountSyncState {
        account_id: account_id.to_string(),
        folder: folder.to_string(),
        last_uid: max_uid,
        total_count: sync_state.as_ref().map(|s| s.total_count).unwrap_or(0) + new_count as i64,
        syncing: false,
        last_sync_epoch: now_epoch(),
        error: None,
    }).await?;

    println!("[EmailSync] Synced {} new emails for {}/{}", new_count, account_id, folder);
    Ok(new_count)
}

/// Fetch only headers newer than `since_uid` from IMAP (blocking, runs in spawn_blocking)
fn fetch_new_headers_sync(
    host: &str,
    port: u16,
    email: &str,
    auth_method: &str,
    access_token: Option<&str>,
    password: Option<&str>,
    folder: &str,
    since_uid: u32,
) -> Result<Vec<CachedEmail>, String> {
    use crate::email_client::XOAuth2Authenticator;

    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token for OAuth2")?;
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", email, token);
            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_string.clone() })
                .map_err(|(e, _)| format!("XOAUTH2 auth failed: {}", e))?
        }
        _ => {
            let pass = password.ok_or("No password")?;
            client.login(email, pass).map_err(|(e, _)| format!("Login failed: {}", e))?
        }
    };

    let mailbox = session.select(folder).map_err(|e| format!("Folder select: {}", e))?;
    let total = mailbox.exists;

    if total == 0 {
        session.logout().ok();
        return Ok(vec![]);
    }

    // Fetch UIDs greater than since_uid using UID SEARCH
    let uid_search = if since_uid > 0 {
        format!("UID {}:*", since_uid + 1)
    } else {
        // First sync — fetch last 200 emails
        let start = total.saturating_sub(200).max(1);
        format!("{}:*", start)
    };

    let fetch_result = session
        .fetch(
            &uid_search,
            "(UID FLAGS ENVELOPE BODYSTRUCTURE BODY.PEEK[TEXT]<0.200>)",
        )
        .map_err(|e| format!("IMAP fetch failed: {}", e))?;

    let mut emails = Vec::new();
    let now = now_epoch();

    for msg in fetch_result.iter() {
        let uid = msg.uid.unwrap_or(0) as i64;
        if uid <= since_uid as i64 && since_uid > 0 {
            continue; // Skip already-synced
        }

        let flags = msg.flags();
        let is_read = flags.iter().any(|f| matches!(f, imap::types::Flag::Seen));
        let is_starred = flags.iter().any(|f| matches!(f, imap::types::Flag::Flagged));

        let mut from_address = String::new();
        let mut from_name = String::new();
        let mut to_address = String::new();
        let mut subject = String::new();
        let mut date_str = String::new();
        let mut message_id = String::new();
        let mut in_reply_to = None;

        if let Some(envelope) = msg.envelope() {
            subject = envelope.subject.as_ref()
                .map(|s| decode_mime_bytes(s))
                .unwrap_or_default();

            if let Some(from) = envelope.from.as_ref().and_then(|a| a.first()) {
                from_name = from.name.as_ref().map(|n| decode_mime_bytes(n)).unwrap_or_default();
                let mbox = from.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string()).unwrap_or_default();
                let host = from.host.as_ref().map(|h| String::from_utf8_lossy(h).to_string()).unwrap_or_default();
                from_address = format!("{}@{}", mbox, host);
            }

            if let Some(to) = envelope.to.as_ref().and_then(|a| a.first()) {
                let mbox = to.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string()).unwrap_or_default();
                let host = to.host.as_ref().map(|h| String::from_utf8_lossy(h).to_string()).unwrap_or_default();
                to_address = format!("{}@{}", mbox, host);
            }

            date_str = envelope.date.as_ref()
                .map(|d| String::from_utf8_lossy(d).to_string())
                .unwrap_or_default();

            message_id = envelope.message_id.as_ref()
                .map(|m| String::from_utf8_lossy(m).to_string())
                .unwrap_or_default();

            in_reply_to = envelope.in_reply_to.as_ref()
                .map(|r| String::from_utf8_lossy(r).to_string());
        }

        // Check for attachments
        let has_attachments = msg.bodystructure()
            .map(|bs| check_has_attachments(bs))
            .unwrap_or(false);

        // Grab preview from the partial text body peek
        let preview = msg.text()
            .map(|t| {
                let text = String::from_utf8_lossy(t);
                text.chars().take(200).collect::<String>()
                    .replace('\r', "")
                    .replace('\n', " ")
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();

        // Parse date to epoch for sorting
        let date_epoch = parse_date_to_epoch(&date_str);

        // Categorize
        let category = categorize_email(&subject, &from_address, &preview);

        emails.push(CachedEmail {
            id: 0, // auto-increment
            account_id: String::new(), // filled by caller
            uid,
            message_id,
            folder: folder.to_string(),
            from_address,
            from_name,
            to_address,
            subject,
            preview,
            date_str,
            date_epoch,
            is_read,
            is_starred,
            has_attachments,
            in_reply_to,
            references_header: None,
            category,
            html_body: None,
            text_body: None,
            raw_headers: None,
            synced_at: now,
        });
    }

    session.logout().ok();
    Ok(emails)
}

// ─── Helper functions ─────────────────────────────────────────────────────────

fn decode_mime_bytes(data: &[u8]) -> String {
    let raw = String::from_utf8_lossy(data).to_string();
    if raw.contains("=?") {
        // RFC 2047 decoding
        let mut result = raw.clone();
        while let Some(start) = result.find("=?") {
            if let Some(end) = result[start + 2..].find("?=") {
                let encoded = &result[start..start + 2 + end + 2];
                let parts: Vec<&str> = encoded[2..encoded.len() - 2].splitn(3, '?').collect();
                if parts.len() == 3 {
                    let encoding = parts[1].to_uppercase();
                    let data = parts[2];
                    let decoded = match encoding.as_str() {
                        "B" => general_purpose::STANDARD.decode(data).ok()
                            .and_then(|b| String::from_utf8(b).ok())
                            .unwrap_or_else(|| data.to_string()),
                        "Q" => data.replace('_', " ").replace("=20", " ").to_string(),
                        _ => data.to_string(),
                    };
                    result = result.replace(encoded, &decoded);
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        result
    } else {
        raw
    }
}

fn check_has_attachments(bs: &imap_proto::types::BodyStructure) -> bool {
    match bs {
        imap_proto::types::BodyStructure::Multipart { bodies, .. } => {
            bodies.iter().any(|b| check_has_attachments(b))
        }
        imap_proto::types::BodyStructure::Basic { common, .. }
        | imap_proto::types::BodyStructure::Text { common, .. }
        | imap_proto::types::BodyStructure::Message { common, .. } => {
            if let Some(ref disp) = common.disposition {
                if disp.ty.eq_ignore_ascii_case("attachment") {
                    return true;
                }
            }
            let mime = common.ty.ty.to_lowercase();
            matches!(mime.as_str(), "application" | "image" | "audio" | "video")
        }
    }
}

fn parse_date_to_epoch(date_str: &str) -> i64 {
    // Try common RFC 2822 date formats
    // Example: "Mon, 01 Jan 2024 12:00:00 +0000"
    // Simplified parser — extract key components
    let trimmed = date_str.trim();
    if trimmed.is_empty() {
        return 0;
    }

    // Extract day, month, year from common patterns
    let months = [
        ("jan", 1), ("feb", 2), ("mar", 3), ("apr", 4), ("may", 5), ("jun", 6),
        ("jul", 7), ("aug", 8), ("sep", 9), ("oct", 10), ("nov", 11), ("dec", 12),
    ];

    let lower = trimmed.to_lowercase();
    let parts: Vec<&str> = lower.split_whitespace().collect();

    // Find month
    let mut month = 0u32;
    let mut month_idx = 0usize;
    for (i, part) in parts.iter().enumerate() {
        for (name, num) in &months {
            if part.starts_with(name) {
                month = *num;
                month_idx = i;
                break;
            }
        }
        if month > 0 { break; }
    }

    if month == 0 {
        return now_epoch(); // fallback to current time
    }

    // Day is usually before month in RFC 2822
    let day: u32 = if month_idx > 0 {
        parts.get(month_idx - 1).and_then(|s| s.trim_end_matches(',').parse().ok()).unwrap_or(1)
    } else {
        parts.get(month_idx + 1).and_then(|s| s.parse().ok()).unwrap_or(1)
    };

    // Year is after month
    let year: i32 = parts.get(month_idx + 1).and_then(|s| s.parse().ok())
        .or_else(|| parts.get(month_idx + 2).and_then(|s| s.parse().ok()))
        .unwrap_or(2024);

    // Time is in HH:MM:SS format
    let mut hour = 0u32;
    let mut min = 0u32;
    let mut sec = 0u32;
    for part in &parts {
        if part.contains(':') {
            let time_parts: Vec<&str> = part.split(':').collect();
            if time_parts.len() >= 2 {
                hour = time_parts[0].parse().unwrap_or(0);
                min = time_parts[1].parse().unwrap_or(0);
                sec = time_parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            }
            break;
        }
    }

    // Convert to epoch (simplified, UTC assumed)
    let days_since_epoch = days_from_civil(year, month, day);
    let epoch = days_since_epoch as i64 * 86400 + hour as i64 * 3600 + min as i64 * 60 + sec as i64;
    epoch
}

/// Civil date to days since Unix epoch (algorithm from Howard Hinnant)
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = y as i64;
    let m = m as i64;
    let d = d as i64;
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn categorize_email(subject: &str, from: &str, preview: &str) -> String {
    let text = format!("{} {} {}", subject, from, preview).to_lowercase();

    let transactional = ["otp", "verification", "verify", "code", "confirm", "receipt",
        "invoice", "order", "shipping", "delivery", "tracking", "payment",
        "password reset", "security alert", "sign in", "login", "banking"];
    let newsletter = ["unsubscribe", "newsletter", "digest", "weekly", "monthly",
        "promotion", "deal", "offer", "sale", "discount", "promo",
        "list-unsubscribe", "marketing", "campaign"];
    let spam = ["viagra", "casino", "lottery", "winner", "click here now",
        "act now", "limited time", "free money"];

    let spam_score: i32 = spam.iter().map(|k| if text.contains(k) { 3 } else { 0 }).sum();
    if spam_score >= 6 { return "spam".to_string(); }

    let tx_score: i32 = transactional.iter().map(|k| if text.contains(k) { 1 } else { 0 }).sum();
    if tx_score >= 2 { return "transactional".to_string(); }

    let nl_score: i32 = newsletter.iter().map(|k| if text.contains(k) { 1 } else { 0 }).sum();
    if nl_score >= 2 { return "newsletters".to_string(); }

    "personal".to_string()
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Query cached emails (instant, from local SQLite)
#[command]
pub async fn get_cached_emails(
    pool: tauri::State<'_, SqlitePool>,
    account_id: Option<String>,
    folder: String,
    category: Option<String>,
    offset: i64,
    limit: i64,
) -> Result<Vec<CachedEmailHeader>, String> {
    EmailCacheDb::get_emails(
        &pool,
        account_id.as_deref(),
        &folder,
        category.as_deref(),
        offset,
        limit,
    )
    .await
}

/// Get cached email body (instant if already synced)
#[command]
pub async fn get_cached_email_body(
    pool: tauri::State<'_, SqlitePool>,
    account_id: String,
    uid: i64,
    folder: String,
) -> Result<Option<CachedEmailBody>, String> {
    EmailCacheDb::get_email_body(&pool, &account_id, uid, &folder).await
}

/// Full-text search across cached emails
#[command]
pub async fn search_cached_emails(
    pool: tauri::State<'_, SqlitePool>,
    query: String,
    account_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<CachedEmailHeader>, String> {
    EmailCacheDb::search_emails(&pool, &query, account_id.as_deref(), limit.unwrap_or(50)).await
}

/// Get unread count
#[command]
pub async fn get_unread_count(
    pool: tauri::State<'_, SqlitePool>,
    account_id: Option<String>,
    folder: String,
) -> Result<i64, String> {
    EmailCacheDb::unread_count(&pool, account_id.as_deref(), &folder).await
}

/// Register an OAuth token for background sync with auto-refresh
#[command]
pub async fn register_email_token(
    interceptor: tauri::State<'_, Arc<OAuthInterceptor>>,
    account_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    provider: String,
    client_id: String,
) -> Result<(), String> {
    let expires_at = now_epoch() as u64 + expires_in.unwrap_or(3600);
    interceptor.set_token(&account_id, TokenState {
        access_token,
        refresh_token,
        expires_at,
        provider,
        client_id,
    }).await;
    Ok(())
}

/// Start background sync for an account
#[command]
pub async fn start_email_sync(
    syncer: tauri::State<'_, Arc<BackgroundSyncer>>,
    app_handle: tauri::AppHandle,
    account_id: String,
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    password: Option<String>,
    folders: Option<Vec<String>>,
) -> Result<(), String> {
    let folders = folders.unwrap_or_else(|| vec!["INBOX".to_string()]);
    syncer.start_account_sync(
        account_id, imap_host, imap_port, email, auth_method, password, folders, app_handle,
    );
    Ok(())
}

/// Stop background sync for an account
#[command]
pub async fn stop_email_sync(
    syncer: tauri::State<'_, Arc<BackgroundSyncer>>,
    account_id: String,
) -> Result<(), String> {
    syncer.stop_account_sync(&account_id).await;
    Ok(())
}

/// Force an immediate sync (user pull-to-refresh)
#[command]
pub async fn force_email_sync(
    pool: tauri::State<'_, SqlitePool>,
    interceptor: tauri::State<'_, Arc<OAuthInterceptor>>,
    account_id: String,
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    password: Option<String>,
    folder: String,
) -> Result<usize, String> {
    sync_folder_incremental(
        &pool,
        &interceptor,
        &account_id,
        &imap_host,
        imap_port,
        &email,
        &auth_method,
        password.as_deref(),
        &folder,
    )
    .await
}

/// Fetch and cache a specific email body (on-demand, when user clicks)
#[command]
pub async fn fetch_and_cache_email_body(
    pool: tauri::State<'_, SqlitePool>,
    interceptor: tauri::State<'_, Arc<OAuthInterceptor>>,
    account_id: String,
    imap_host: String,
    imap_port: u16,
    email_addr: String,
    auth_method: String,
    password: Option<String>,
    folder: String,
    uid: i64,
) -> Result<CachedEmailBody, String> {
    // First check cache
    if let Some(cached) = EmailCacheDb::get_email_body(&pool, &account_id, uid, &folder).await? {
        if cached.html_body.is_some() || cached.text_body.is_some() {
            return Ok(cached);
        }
    }

    // Not in cache — fetch from IMAP with token auto-refresh
    let imap_host_c = imap_host.clone();
    let email_c = email_addr.clone();
    let _auth_c = auth_method.clone();
    let _password_c = password.clone();
    let folder_c = folder.clone();

    let body = if auth_method == "oauth2" {
        interceptor.with_retry(&account_id, |token| {
            let host = imap_host_c.clone();
            let em = email_c.clone();
            let fld = folder_c.clone();
            async move {
                crate::email_client::fetch_email_body(
                    host, imap_port, em, "oauth2".to_string(),
                    Some(token), None, fld, uid as u32,
                ).await
            }
        }).await?
    } else {
        crate::email_client::fetch_email_body(
            imap_host, imap_port, email_addr, auth_method,
            None, password, folder.clone(), uid as u32,
        ).await?
    };

    // Cache the body + attachments
    let cached_attachments: Vec<CachedAttachment> = body.attachments.iter().map(|a| CachedAttachment {
        id: 0,
        email_id: 0,
        filename: a.filename.clone(),
        mime_type: a.mime_type.clone(),
        size: a.size as i64,
        data_b64: a.data.clone(),
    }).collect();

    EmailCacheDb::store_email_body(
        &pool,
        &account_id,
        uid,
        &folder,
        body.html.as_deref(),
        body.text.as_deref(),
        &cached_attachments,
    ).await?;

    Ok(CachedEmailBody {
        uid,
        html_body: body.html,
        text_body: body.text,
        attachments: cached_attachments,
    })
}

/// Mark email as read in cache + IMAP (background)
#[command]
pub async fn mark_cached_email_read(
    pool: tauri::State<'_, SqlitePool>,
    interceptor: tauri::State<'_, Arc<OAuthInterceptor>>,
    account_id: String,
    uid: i64,
    folder: String,
    read: bool,
    imap_host: String,
    imap_port: u16,
    email_addr: String,
    auth_method: String,
    password: Option<String>,
) -> Result<(), String> {
    // Update cache immediately (instant UI feedback)
    EmailCacheDb::mark_read(&pool, &account_id, uid, &folder, read).await?;

    // Update on IMAP in background (fire-and-forget with retry)
    let interceptor = interceptor.inner().clone();
    tokio::spawn(async move {
        let flag = "\\Seen".to_string();
        let result = if auth_method == "oauth2" {
            interceptor.with_retry(&account_id, |token| {
                let host = imap_host.clone();
                let em = email_addr.clone();
                let fld = folder.clone();
                let flg = flag.clone();
                async move {
                    crate::email_client::mark_email_flag(
                        host, imap_port, em, "oauth2".to_string(),
                        Some(token), None, fld, uid as u32, flg, read,
                    ).await
                }
            }).await
        } else {
            crate::email_client::mark_email_flag(
                imap_host, imap_port, email_addr, auth_method,
                None, password, folder, uid as u32, flag, read,
            ).await
        };

        if let Err(e) = result {
            eprintln!("[EmailCache] Failed to sync read flag to IMAP: {}", e);
        }
    });

    Ok(())
}

/// Purge cache for an account (on account removal)
#[command]
pub async fn purge_email_cache(
    pool: tauri::State<'_, SqlitePool>,
    interceptor: tauri::State<'_, Arc<OAuthInterceptor>>,
    syncer: tauri::State<'_, Arc<BackgroundSyncer>>,
    account_id: String,
) -> Result<(), String> {
    syncer.stop_account_sync(&account_id).await;
    interceptor.remove_token(&account_id).await;
    EmailCacheDb::purge_account(&pool, &account_id).await
}
