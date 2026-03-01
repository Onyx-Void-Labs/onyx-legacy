// ─── Onyx Doc Store: Local CRDT Persistence Layer ───────────────────────────
//
// This module manages the local storage of Loro CRDT documents in SQLite.
// It is the Rust-native persistence layer — no frontend IndexedDB needed.
//
// Each document is stored as a Loro snapshot, with a queue of pending deltas
// for offline peers. When a peer comes online, the deltas are replayed to
// bring them up to date.
//
// Architecture:
//   DocStore (SQLite)
//     ├── crdt_docs          — full Loro snapshots, keyed by doc_id
//     ├── pending_deltas     — encrypted CRDT deltas waiting for offline peers
//     └── sync_peers         — last-known sync state per peer per document
//
// All CRDT operations happen through Loro.
// LoroDoc is Send + Sync — no RwLock needed around documents.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use tracing::{info, warn, debug};
use loro::{LoroDoc, ExportMode, VersionVector};
use dashmap::DashMap;
use base64::Engine as _;

use crate::crypto;

// --- Types ------------------------------------------------------------------

/// Metadata about a stored CRDT document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocMeta {
    pub doc_id: String,
    pub state_size: i64,
    pub update_count: i64,
    pub last_synced: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

/// A pending delta waiting to be sent to an offline peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingDelta {
    pub id: i64,
    pub doc_id: String,
    /// Encrypted CRDT update bytes (base64-encoded)
    pub encrypted_delta: String,
    /// Target peer's NodeId (hex)
    pub peer_id: String,
    /// Unix timestamp when the delta was queued
    pub created_at: i64,
}

/// Sync state tracking per peer per document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPeerState {
    pub doc_id: String,
    pub peer_id: String,
    /// The peer's last-known version vector (base64-encoded)
    pub last_version_vector: String,
    /// Unix timestamp of last successful sync
    pub last_synced: i64,
}

// --- Doc Store --------------------------------------------------------------

/// The local CRDT document store.
///
/// Manages Loro `LoroDoc` instances in memory with SQLite persistence.
/// Thread-safe: LoroDoc is Send + Sync � no RwLock needed.
/// Uses DashMap for concurrent access from multiple sync streams.
pub struct DocStore {
    /// SQLite connection pool (shared with the rest of the app)
    pool: SqlitePool,
    /// In-memory Loro documents, lazily loaded from SQLite.
    /// LoroDoc is Send + Sync, so Arc alone is sufficient.
    docs: DashMap<String, Arc<LoroDoc>>,
    /// Master encryption key for encrypting deltas at rest
    /// Derived from the user's vault key
    master_key: Arc<parking_lot::RwLock<Option<[u8; 32]>>>,
}

impl DocStore {
    /// Create a new DocStore backed by the shared SQLite pool.
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool,
            docs: DashMap::new(),
            master_key: Arc::new(parking_lot::RwLock::new(None)),
        }
    }

    /// Set the master encryption key (called after user unlocks their vault).
    pub fn set_master_key(&self, key: [u8; 32]) {
        *self.master_key.write() = Some(key);
    }

    /// Run database migrations for CRDT tables.
    pub async fn migrate(pool: &SqlitePool) -> Result<(), String> {
        // Table: crdt_docs � stores full Loro document snapshots
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS crdt_docs (
                doc_id      TEXT PRIMARY KEY,
                state       BLOB NOT NULL,
                state_size  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create crdt_docs table: {}", e))?;

        // Table: pending_deltas � queued deltas for offline peers
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS pending_deltas (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id          TEXT NOT NULL,
                encrypted_delta BLOB NOT NULL,
                peer_id         TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                FOREIGN KEY (doc_id) REFERENCES crdt_docs(doc_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_pending_deltas_peer
                ON pending_deltas(peer_id, doc_id);
            CREATE INDEX IF NOT EXISTS idx_pending_deltas_created
                ON pending_deltas(created_at);
            "#,
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create pending_deltas table: {}", e))?;

        // Table: sync_peers � per-peer per-doc sync state
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sync_peers (
                doc_id              TEXT NOT NULL,
                peer_id             TEXT NOT NULL,
                last_state_vector   BLOB,
                last_synced         INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (doc_id, peer_id)
            );
            "#,
        )
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to create sync_peers table: {}", e))?;

        info!("[DocStore] Migrations complete");
        Ok(())
    }

    // --- Document Operations ------------------------------------------------

    /// Get or create a Loro document by ID.
    /// If the document exists in SQLite, its state is loaded from snapshot.
    /// If not, a new empty document is created.
    pub async fn get_or_create(&self, doc_id: &str) -> Result<Arc<LoroDoc>, String> {
        // Check in-memory cache first
        if let Some(doc) = self.docs.get(doc_id) {
            return Ok(doc.clone());
        }

        // Try loading from SQLite
        let doc = if let Some(state) = self.load_state(doc_id).await? {
            let doc = LoroDoc::new();
            doc.import(&state)
                .map_err(|e| format!("Failed to import stored state: {}", e))?;
            info!("[DocStore] Loaded doc '{}' from SQLite ({} bytes)", doc_id, state.len());
            doc
        } else {
            info!("[DocStore] Created new doc '{}'", doc_id);
            LoroDoc::new()
        };

        let arc_doc = Arc::new(doc);
        self.docs.insert(doc_id.to_string(), arc_doc.clone());
        Ok(arc_doc)
    }

    /// Apply a Loro update (CRDT delta) to a document.
    /// This is the core operation � called when we receive a sync update from a peer.
    /// No transaction or lock scoping needed � LoroDoc is Send + Sync.
    pub async fn apply_update(&self, doc_id: &str, update_data: &[u8]) -> Result<(), String> {
        let doc = self.get_or_create(doc_id).await?;

        // LoroDoc.import() handles updates atomically � no transaction needed
        doc.import(update_data)
            .map_err(|e| format!("Failed to import update: {}", e))?;

        // Persist to SQLite
        self.save_state(doc_id).await?;

        debug!("[DocStore] Applied {} byte update to doc '{}'", update_data.len(), doc_id);
        Ok(())
    }

    /// Get the version vector of a document (for sync negotiation).
    /// The version vector tells a peer what updates we already have.
    pub async fn get_state_vector(&self, doc_id: &str) -> Result<Vec<u8>, String> {
        let doc = self.get_or_create(doc_id).await?;
        let vv = doc.oplog_vv();
        Ok(vv.encode())
    }

    /// Compute the diff between our state and a peer's version vector.
    /// Returns the CRDT updates the peer is missing.
    pub async fn compute_diff(
        &self,
        doc_id: &str,
        peer_version_vector: &[u8],
    ) -> Result<Vec<u8>, String> {
        let doc = self.get_or_create(doc_id).await?;

        let peer_vv = VersionVector::decode(peer_version_vector)
            .map_err(|e| format!("Failed to decode peer version vector: {}", e))?;

        let diff = doc.export(ExportMode::updates(&peer_vv))
            .map_err(|e| format!("Failed to export diff: {}", e))?;
        Ok(diff)
    }

    /// Get the full encoded state of a document (for initial sync / snapshot).
    pub async fn get_full_state(&self, doc_id: &str) -> Result<Vec<u8>, String> {
        let doc = self.get_or_create(doc_id).await?;
        let snapshot = doc.export(ExportMode::Snapshot)
            .map_err(|e| format!("Failed to export snapshot: {}", e))?;
        Ok(snapshot)
    }

    // --- Pending Deltas (Dead Drop) -----------------------------------------

    /// Queue an encrypted delta for an offline peer.
    /// When the peer comes online, these are replayed.
    pub async fn queue_delta(
        &self,
        doc_id: &str,
        peer_id: &str,
        delta: &[u8],
        master_key: &[u8; 32],
    ) -> Result<(), String> {
        // Encrypt the delta before storing
        let doc_key = crypto::derive_key(master_key, "onyx-sync-v1", doc_id)
            .map_err(|e| e.to_string())?;
        let encrypted = crypto::encrypt_aead(&doc_key, delta, Some(peer_id.as_bytes()))
            .map_err(|e| e.to_string())?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        sqlx::query(
            "INSERT INTO pending_deltas (doc_id, encrypted_delta, peer_id, created_at) VALUES (?, ?, ?, ?)"
        )
        .bind(doc_id)
        .bind(&encrypted)
        .bind(peer_id)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to queue delta: {}", e))?;

        debug!("[DocStore] Queued {} byte delta for peer {} (doc: {})", delta.len(), peer_id, doc_id);
        Ok(())
    }

    /// Retrieve and decrypt all pending deltas for a peer.
    /// Called when a peer comes online.
    pub async fn drain_pending_deltas(
        &self,
        peer_id: &str,
        master_key: &[u8; 32],
    ) -> Result<Vec<(String, Vec<u8>)>, String> {
        let rows: Vec<(i64, String, Vec<u8>)> = sqlx::query_as(
            "SELECT id, doc_id, encrypted_delta FROM pending_deltas WHERE peer_id = ? ORDER BY created_at ASC"
        )
        .bind(peer_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to fetch pending deltas: {}", e))?;

        let mut deltas = Vec::new();
        let mut ids_to_delete = Vec::new();

        for (id, doc_id, encrypted) in rows {
            // Decrypt each delta
            let doc_key = crypto::derive_key(master_key, "onyx-sync-v1", &doc_id)
                .map_err(|e| e.to_string())?;
            match crypto::decrypt_aead(&doc_key, &encrypted, Some(peer_id.as_bytes())) {
                Ok(plaintext) => {
                    deltas.push((doc_id, plaintext));
                    ids_to_delete.push(id);
                }
                Err(e) => {
                    warn!("[DocStore] Failed to decrypt delta {}: {}", id, e);
                }
            }
        }

        // Delete drained deltas
        if !ids_to_delete.is_empty() {
            let placeholders: Vec<String> = ids_to_delete.iter().map(|_| "?".to_string()).collect();
            let query = format!(
                "DELETE FROM pending_deltas WHERE id IN ({})",
                placeholders.join(",")
            );
            let mut q = sqlx::query(&query);
            for id in &ids_to_delete {
                q = q.bind(id);
            }
            let _ = q.execute(&self.pool).await;

            info!("[DocStore] Drained {} pending deltas for peer {}", ids_to_delete.len(), peer_id);
        }

        Ok(deltas)
    }

    /// Purge expired pending deltas (older than 7 days).
    pub async fn purge_expired_deltas(&self) -> Result<u64, String> {
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
            - 7 * 24 * 3600; // 7 days

        let result = sqlx::query("DELETE FROM pending_deltas WHERE created_at < ?")
            .bind(cutoff)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to purge expired deltas: {}", e))?;

        let count = result.rows_affected();
        if count > 0 {
            info!("[DocStore] Purged {} expired pending deltas", count);
        }
        Ok(count)
    }

    // --- Sync Peer State ----------------------------------------------------

    /// Record a peer's last-known version vector for a document.
    pub async fn update_peer_state(
        &self,
        doc_id: &str,
        peer_id: &str,
        version_vector: &[u8],
    ) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        sqlx::query(
            r#"
            INSERT INTO sync_peers (doc_id, peer_id, last_state_vector, last_synced)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (doc_id, peer_id)
            DO UPDATE SET last_state_vector = excluded.last_state_vector,
                          last_synced = excluded.last_synced
            "#,
        )
        .bind(doc_id)
        .bind(peer_id)
        .bind(version_vector)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to update peer state: {}", e))?;

        Ok(())
    }

    /// Get a peer's last-known version vector for a document.
    pub async fn get_peer_state(
        &self,
        doc_id: &str,
        peer_id: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let row: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT last_state_vector FROM sync_peers WHERE doc_id = ? AND peer_id = ?"
        )
        .bind(doc_id)
        .bind(peer_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to get peer state: {}", e))?;

        Ok(row.map(|(sv,)| sv))
    }

    // --- Persistence --------------------------------------------------------

    /// Save a document's current state to SQLite as a Loro snapshot.
    /// No guard scoping needed � LoroDoc is Send + Sync.
    async fn save_state(&self, doc_id: &str) -> Result<(), String> {
        let (state, size) = {
            let doc = self.docs.get(doc_id)
                .ok_or_else(|| format!("Doc '{}' not in memory", doc_id))?;
            let snapshot = doc.export(ExportMode::Snapshot)
                .map_err(|e| format!("Failed to export snapshot: {}", e))?;
            let size = snapshot.len() as i64;
            (snapshot, size)
        };

        sqlx::query(
            r#"
            INSERT INTO crdt_docs (doc_id, state, state_size) VALUES (?, ?, ?)
            ON CONFLICT (doc_id)
            DO UPDATE SET state = excluded.state,
                          state_size = excluded.state_size,
                          updated_at = datetime('now')
            "#,
        )
        .bind(doc_id)
        .bind(&state)
        .bind(size)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("Failed to save doc state: {}", e))?;

        debug!("[DocStore] Saved doc '{}' ({} bytes)", doc_id, size);
        Ok(())
    }

    /// Load a document's state from SQLite.
    async fn load_state(&self, doc_id: &str) -> Result<Option<Vec<u8>>, String> {
        let row: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT state FROM crdt_docs WHERE doc_id = ?"
        )
        .bind(doc_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("Failed to load doc state: {}", e))?;

        Ok(row.map(|(state,)| state))
    }

    /// List all stored documents.
    pub async fn list_docs(&self) -> Result<Vec<DocMeta>, String> {
        let rows: Vec<(String, i64, String, String)> = sqlx::query_as(
            "SELECT doc_id, state_size, created_at, updated_at FROM crdt_docs ORDER BY updated_at DESC"
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("Failed to list docs: {}", e))?;

        let mut docs = Vec::new();
        for (doc_id, state_size, created_at, updated_at) in rows {
            let (update_count,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM pending_deltas WHERE doc_id = ?"
            )
            .bind(&doc_id)
            .fetch_one(&self.pool)
            .await
            .unwrap_or((0,));

            docs.push(DocMeta {
                doc_id,
                state_size,
                update_count,
                last_synced: None,
                created_at,
                updated_at,
            });
        }

        Ok(docs)
    }

    /// Delete a document and all its pending deltas.
    pub async fn delete_doc(&self, doc_id: &str) -> Result<(), String> {
        self.docs.remove(doc_id);

        sqlx::query("DELETE FROM crdt_docs WHERE doc_id = ?")
            .bind(doc_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete doc: {}", e))?;

        sqlx::query("DELETE FROM pending_deltas WHERE doc_id = ?")
            .bind(doc_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete pending deltas: {}", e))?;

        sqlx::query("DELETE FROM sync_peers WHERE doc_id = ?")
            .bind(doc_id)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("Failed to delete sync peers: {}", e))?;

        info!("[DocStore] Deleted doc '{}'", doc_id);
        Ok(())
    }

    /// Flush all in-memory documents to SQLite (e.g., on app close).
    pub async fn flush_all(&self) -> Result<(), String> {
        let doc_ids: Vec<String> = self.docs.iter().map(|entry| entry.key().clone()).collect();
        for doc_id in &doc_ids {
            if let Err(e) = self.save_state(doc_id).await {
                warn!("[DocStore] Failed to flush doc '{}': {}", doc_id, e);
            }
        }
        info!("[DocStore] Flushed {} docs to SQLite", doc_ids.len());
        Ok(())
    }

}

// --- Tauri Commands ---------------------------------------------------------

/// Get the version vector for a document (for sync triggers from frontend).
#[tauri::command]
pub async fn doc_get_state_vector(
    store: tauri::State<'_, Arc<DocStore>>,
    doc_id: String,
) -> Result<String, String> {
    let vv = store.get_state_vector(&doc_id).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&vv))
}

/// Apply an update to a document (received from frontend or sync).
#[tauri::command]
pub async fn doc_apply_update(
    store: tauri::State<'_, Arc<DocStore>>,
    doc_id: String,
    update_b64: String,
) -> Result<(), String> {
    let update = base64::engine::general_purpose::STANDARD
        .decode(&update_b64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    store.apply_update(&doc_id, &update).await
}

/// Get the full state of a document (for initial load).
#[tauri::command]
pub async fn doc_get_full_state(
    store: tauri::State<'_, Arc<DocStore>>,
    doc_id: String,
) -> Result<String, String> {
    let state = store.get_full_state(&doc_id).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&state))
}

/// List all stored documents.
#[tauri::command]
pub async fn doc_list(
    store: tauri::State<'_, Arc<DocStore>>,
) -> Result<Vec<DocMeta>, String> {
    store.list_docs().await
}

/// Flush all documents to disk (called on app close).
#[tauri::command]
pub async fn doc_flush_all(
    store: tauri::State<'_, Arc<DocStore>>,
) -> Result<(), String> {
    store.flush_all().await
}
