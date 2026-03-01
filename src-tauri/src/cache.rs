// ─── Onyx Blind Cache Client ─────────────────────────────────────────────────
//
// Client module for the Blind Cache server (cache.onyxvoid.com).
// Pushes encrypted CRDT updates when peers are offline, pulls on wake.
//
// The blind cache never sees plaintext — all blobs are AES-256-GCM encrypted
// before upload, using per-document derived keys.
//
// Integration with SyncEngine:
//   broadcast_update() priority: (1) Direct P2P → (2) Home Station → (3) Blind Cache
//   On app wake: pull_all() → import into DocStore

use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tracing::{info, warn, debug};
use base64::Engine as _;

use crate::crypto::{self, OnyxIdentity};
use crate::doc_store::DocStore;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStatus {
    pub connected: bool,
    pub cache_url: String,
    pub pending_push: u64,
    pub last_pull: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PushResponse {
    blob_id: String,
    timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FetchResponse {
    blobs: Vec<BlobMeta>,
    next_cursor: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BlobMeta {
    id: String,
    size: usize,
    timestamp: u64,
    data: Vec<u8>,
}

// ─── Blind Cache Client ────────────────────────────────────────────────────

pub struct BlindCacheClient {
    /// Base URL of the blind cache server
    cache_url: String,
    /// Cryptographic identity for signing requests
    identity: Arc<OnyxIdentity>,
    /// HTTP client
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    http: reqwest::Client,
    /// Last pull cursor per doc_id
    cursors: dashmap::DashMap<String, u64>,
}

impl BlindCacheClient {
    /// Create a new BlindCacheClient.
    pub fn new(cache_url: String, identity: Arc<OnyxIdentity>) -> Self {
        Self {
            cache_url,
            identity,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            http: reqwest::Client::new(),
            cursors: dashmap::DashMap::new(),
        }
    }

    /// Get our node_id as hex string.
    fn node_id_hex(&self) -> String {
        hex::encode(self.identity.signing_key.verifying_key().as_bytes())
    }

    /// Sign a payload with our Ed25519 key.
    fn sign(&self, data: &[u8]) -> String {
        use ed25519_dalek::Signer;
        let sig = self.identity.signing_key.sign(data);
        hex::encode(sig.to_bytes())
    }

    /// Push an encrypted update to the blind cache.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub async fn push_update(
        &self,
        doc_id: &str,
        update_bytes: &[u8],
        master_key: &[u8; 32],
    ) -> Result<String, String> {
        // Encrypt the update
        let doc_key = crypto::derive_key(master_key, "onyx-cache-v1", doc_id)
            .map_err(|e| e.to_string())?;
        let encrypted = crypto::encrypt_aead(&doc_key, update_bytes, Some(b"cache"))
            .map_err(|e| e.to_string())?;

        let node_id = self.node_id_hex();
        let url = format!("{}/cache/{}/{}", self.cache_url, doc_id, node_id);
        let sig = self.sign(&encrypted);

        let resp = self.http.put(&url)
            .header("Authorization", format!("Ed25519 {}", sig))
            .body(encrypted)
            .send()
            .await
            .map_err(|e| format!("Cache push failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Cache push returned {}", resp.status()));
        }

        let result: PushResponse = resp.json().await
            .map_err(|e| format!("Cache push parse error: {}", e))?;

        debug!("[Cache] Pushed {} byte update for doc={}", update_bytes.len(), doc_id);
        Ok(result.blob_id)
    }

    /// Pull all pending updates from the blind cache for a document.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub async fn pull_updates(
        &self,
        doc_id: &str,
        master_key: &[u8; 32],
    ) -> Result<Vec<(String, Vec<u8>)>, String> {
        let node_id = self.node_id_hex();
        let cursor = self.cursors.get(doc_id).map(|c| *c).unwrap_or(0);
        let url = format!("{}/cache/{}/{}?cursor={}", self.cache_url, doc_id, node_id, cursor);
        let sig = self.sign(node_id.as_bytes());

        let resp = self.http.get(&url)
            .header("Authorization", format!("Ed25519 {}", sig))
            .send()
            .await
            .map_err(|e| format!("Cache pull failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Cache pull returned {}", resp.status()));
        }

        let result: FetchResponse = resp.json().await
            .map_err(|e| format!("Cache pull parse error: {}", e))?;

        let doc_key = crypto::derive_key(master_key, "onyx-cache-v1", doc_id)
            .map_err(|e| e.to_string())?;

        let mut updates = Vec::new();
        let mut max_ts = cursor;

        for blob in &result.blobs {
            match crypto::decrypt_aead(&doc_key, &blob.data, Some(b"cache")) {
                Ok(plaintext) => {
                    updates.push((blob.id.clone(), plaintext));
                    max_ts = max_ts.max(blob.timestamp);
                }
                Err(e) => {
                    warn!("[Cache] Failed to decrypt blob {}: {}", blob.id, e);
                }
            }
        }

        // Update cursor
        if max_ts > cursor {
            self.cursors.insert(doc_id.to_string(), max_ts);
        }

        debug!("[Cache] Pulled {} updates for doc={}", updates.len(), doc_id);
        Ok(updates)
    }

    /// Acknowledge/delete a blob after successful import.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub async fn ack_update(
        &self,
        doc_id: &str,
        blob_id: &str,
    ) -> Result<(), String> {
        let node_id = self.node_id_hex();
        let url = format!("{}/cache/{}/{}/{}", self.cache_url, doc_id, node_id, blob_id);
        let sig = self.sign(node_id.as_bytes());

        let resp = self.http.delete(&url)
            .header("Authorization", format!("Ed25519 {}", sig))
            .send()
            .await
            .map_err(|e| format!("Cache ack failed: {}", e))?;

        if !resp.status().is_success() && resp.status().as_u16() != 404 {
            return Err(format!("Cache ack returned {}", resp.status()));
        }

        debug!("[Cache] Acked blob {} for doc={}", blob_id, doc_id);
        Ok(())
    }

    /// Pull updates from cache and import into DocStore for all subscribed docs.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub async fn pull_and_import(
        &self,
        doc_store: &DocStore,
        doc_ids: &[String],
        master_key: &[u8; 32],
    ) -> Result<u64, String> {
        let mut total = 0u64;

        for doc_id in doc_ids {
            match self.pull_updates(doc_id, master_key).await {
                Ok(updates) => {
                    for (blob_id, update_data) in &updates {
                        if let Err(e) = doc_store.apply_update(doc_id, update_data).await {
                            warn!("[Cache] Failed to apply update {}: {}", blob_id, e);
                            continue;
                        }
                        // Ack successful import
                        let _ = self.ack_update(doc_id, blob_id).await;
                        total += 1;
                    }
                }
                Err(e) => {
                    warn!("[Cache] Pull failed for doc {}: {}", doc_id, e);
                }
            }
        }

        if total > 0 {
            info!("[Cache] Imported {} updates from blind cache", total);
        }
        Ok(total)
    }

    /// Get cache status.
    pub fn status(&self) -> CacheStatus {
        CacheStatus {
            connected: true, // TODO: actual health check
            cache_url: self.cache_url.clone(),
            pending_push: 0,
            last_pull: None,
        }
    }

    // Mobile stubs — blind cache requires reqwest which isn't available on mobile
    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub async fn push_update(&self, _doc_id: &str, _update: &[u8], _key: &[u8; 32]) -> Result<String, String> {
        Err("Blind cache not available on mobile".to_string())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub async fn pull_updates(&self, _doc_id: &str, _key: &[u8; 32]) -> Result<Vec<(String, Vec<u8>)>, String> {
        Err("Blind cache not available on mobile".to_string())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub async fn ack_update(&self, _doc_id: &str, _blob_id: &str) -> Result<(), String> {
        Err("Blind cache not available on mobile".to_string())
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    pub async fn pull_and_import(&self, _store: &DocStore, _ids: &[String], _key: &[u8; 32]) -> Result<u64, String> {
        Err("Blind cache not available on mobile".to_string())
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Push an update to the blind cache.
#[tauri::command]
pub async fn cache_push(
    cache: tauri::State<'_, Arc<BlindCacheClient>>,
    doc_id: String,
    update_b64: String,
    master_key_b64: String,
) -> Result<String, String> {
    let update = base64::engine::general_purpose::STANDARD
        .decode(&update_b64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(&master_key_b64)
        .map_err(|e| format!("Invalid base64 key: {}", e))?;
    if key_bytes.len() != 32 {
        return Err("Master key must be 32 bytes".to_string());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);

    cache.push_update(&doc_id, &update, &key).await
}

/// Pull updates from the blind cache.
#[tauri::command]
pub async fn cache_pull(
    cache: tauri::State<'_, Arc<BlindCacheClient>>,
    doc_store: tauri::State<'_, Arc<DocStore>>,
    doc_ids: Vec<String>,
    master_key_b64: String,
) -> Result<u64, String> {
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(&master_key_b64)
        .map_err(|e| format!("Invalid base64 key: {}", e))?;
    if key_bytes.len() != 32 {
        return Err("Master key must be 32 bytes".to_string());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);

    cache.pull_and_import(&doc_store, &doc_ids, &key).await
}

/// Get blind cache status.
#[tauri::command]
pub async fn cache_status(
    cache: tauri::State<'_, Arc<BlindCacheClient>>,
) -> Result<CacheStatus, String> {
    Ok(cache.status())
}
