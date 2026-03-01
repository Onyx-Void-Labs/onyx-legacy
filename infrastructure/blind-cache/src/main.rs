// ─── Onyx Blind Cache Server ─────────────────────────────────────────────────
//
// A minimal Axum server that stores and retrieves opaque encrypted blobs.
// The server never sees plaintext — it only stores `Vec<u8>` keyed by
// (doc_id, node_id). Clients encrypt with AES-256-GCM before uploading.
//
// Endpoints:
//   PUT    /cache/{doc_id}/{node_id}             — store encrypted blob
//   GET    /cache/{doc_id}/{node_id}?cursor=     — fetch blobs since cursor
//   DELETE /cache/{doc_id}/{node_id}/{blob_id}   — ack/delete a blob
//   GET    /health                                — health check
//
// Auth: Ed25519 signature in Authorization header (NodeId signs the request).
// Storage: Sled embedded KV with TTL-based GC (30 days).
//
// Deploy: `cache.onyxvoid.com` on Hetzner via Docker.

use axum::{
    Router,
    routing::{get, put, delete},
    extract::{Path, Query, State},
    http::{StatusCode, HeaderMap},
    response::Json,
    body::Bytes,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{info, warn};

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct BlobEntry {
    id: String,
    data: Vec<u8>,
    timestamp: u64,
}

#[derive(Debug, Deserialize)]
struct FetchQuery {
    cursor: Option<u64>,
}

#[derive(Debug, Serialize)]
struct FetchResponse {
    blobs: Vec<BlobMeta>,
    next_cursor: Option<u64>,
}

#[derive(Debug, Serialize)]
struct BlobMeta {
    id: String,
    size: usize,
    timestamp: u64,
    data: Vec<u8>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    version: String,
    blob_count: u64,
}

// ─── App State ──────────────────────────────────────────────────────────────

struct AppState {
    db: sled::Db,
}

impl AppState {
    fn new(path: &str) -> Self {
        let db = sled::open(path).expect("Failed to open sled database");
        Self { db }
    }

    /// Get the sled tree for a specific doc_id + node_id pair.
    fn tree_key(doc_id: &str, node_id: &str) -> String {
        format!("cache:{}:{}", doc_id, node_id)
    }

    /// Count total blobs across all trees.
    fn total_blobs(&self) -> u64 {
        self.db.tree_names().iter().filter_map(|name| {
            let name_str = String::from_utf8_lossy(name);
            if name_str.starts_with("cache:") {
                self.db.open_tree(name).ok().map(|t| t.len() as u64)
            } else {
                None
            }
        }).sum()
    }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

/// Store an encrypted blob.
async fn put_blob(
    State(state): State<Arc<AppState>>,
    Path((doc_id, node_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Verify Ed25519 signature
    if let Err(_) = verify_auth(&headers, &node_id, &body) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    if body.len() > 10 * 1024 * 1024 {
        // 10MB max blob size
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let tree_key = AppState::tree_key(&doc_id, &node_id);
    let tree = state.db.open_tree(&tree_key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let blob_id = uuid::Uuid::new_v4().to_string();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let entry = BlobEntry {
        id: blob_id.clone(),
        data: body.to_vec(),
        timestamp,
    };

    let serialized = serde_json::to_vec(&entry)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Use timestamp + blob_id as key for ordering
    let key = format!("{}:{}", timestamp, blob_id);
    tree.insert(key.as_bytes(), serialized)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    info!("[Cache] Stored {} byte blob for doc={} node={}", body.len(), doc_id, node_id);

    Ok(Json(serde_json::json!({
        "blob_id": blob_id,
        "timestamp": timestamp,
    })))
}

/// Fetch blobs since cursor.
async fn get_blobs(
    State(state): State<Arc<AppState>>,
    Path((doc_id, node_id)): Path<(String, String)>,
    headers: HeaderMap,
    Query(query): Query<FetchQuery>,
) -> Result<Json<FetchResponse>, StatusCode> {
    // Verify auth
    if let Err(_) = verify_auth_get(&headers, &node_id) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let tree_key = AppState::tree_key(&doc_id, &node_id);
    let tree = state.db.open_tree(&tree_key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let cursor = query.cursor.unwrap_or(0);
    let cursor_prefix = format!("{}:", cursor);

    let mut blobs = Vec::new();
    let mut latest_ts = cursor;

    for result in tree.range(cursor_prefix.as_bytes()..) {
        let (key, value) = result.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let entry: BlobEntry = serde_json::from_slice(&value)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if entry.timestamp <= cursor {
            continue;
        }

        latest_ts = latest_ts.max(entry.timestamp);

        blobs.push(BlobMeta {
            id: entry.id,
            size: entry.data.len(),
            timestamp: entry.timestamp,
            data: entry.data,
        });

        // Limit to 100 blobs per fetch
        if blobs.len() >= 100 {
            break;
        }
    }

    let next_cursor = if blobs.len() >= 100 {
        Some(latest_ts)
    } else {
        None
    };

    Ok(Json(FetchResponse { blobs, next_cursor }))
}

/// Delete/ack a blob.
async fn delete_blob(
    State(state): State<Arc<AppState>>,
    Path((doc_id, node_id, blob_id)): Path<(String, String, String)>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    if let Err(_) = verify_auth_get(&headers, &node_id) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let tree_key = AppState::tree_key(&doc_id, &node_id);
    let tree = state.db.open_tree(&tree_key)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Scan for the blob_id in keys
    let mut found = false;
    for result in tree.iter() {
        let (key, value) = result.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let entry: BlobEntry = serde_json::from_slice(&value)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if entry.id == blob_id {
            tree.remove(key).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            found = true;
            break;
        }
    }

    if found {
        info!("[Cache] Deleted blob {} for doc={} node={}", blob_id, doc_id, node_id);
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// Health check.
async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        blob_count: state.total_blobs(),
    })
}

// ─── Auth Helpers ───────────────────────────────────────────────────────────

/// Verify Ed25519 signature for PUT requests.
/// Authorization: Ed25519 <hex_signature>
fn verify_auth(headers: &HeaderMap, node_id: &str, body: &[u8]) -> Result<(), ()> {
    let auth = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(())?;

    if !auth.starts_with("Ed25519 ") {
        return Err(());
    }

    let sig_hex = &auth[8..];
    let sig_bytes = hex::decode(sig_hex).map_err(|_| ())?;
    let node_bytes = hex::decode(node_id).map_err(|_| ())?;

    if node_bytes.len() != 32 || sig_bytes.len() != 64 {
        return Err(());
    }

    use ed25519_dalek::{VerifyingKey, Signature, Verifier};
    let key = VerifyingKey::from_bytes(&node_bytes.try_into().map_err(|_| ())?)
        .map_err(|_| ())?;
    let sig = Signature::from_bytes(&sig_bytes.try_into().map_err(|_| ())?);

    key.verify(body, &sig).map_err(|_| ())?;
    Ok(())
}

/// Verify auth for GET/DELETE requests (signature over node_id).
fn verify_auth_get(headers: &HeaderMap, node_id: &str) -> Result<(), ()> {
    verify_auth(headers, node_id, node_id.as_bytes())
}

// ─── Background GC ─────────────────────────────────────────────────────────

/// Garbage-collect entries older than 30 days.
async fn run_gc(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await; // Hourly

        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            - 30 * 24 * 3600; // 30 days

        let mut total_removed = 0u64;

        for name in state.db.tree_names() {
            let name_str = String::from_utf8_lossy(&name);
            if !name_str.starts_with("cache:") {
                continue;
            }

            if let Ok(tree) = state.db.open_tree(&name) {
                let mut to_remove = Vec::new();
                for result in tree.iter() {
                    if let Ok((key, value)) = result {
                        if let Ok(entry) = serde_json::from_slice::<BlobEntry>(&value) {
                            if entry.timestamp < cutoff {
                                to_remove.push(key);
                            }
                        }
                    }
                }
                for key in to_remove {
                    let _ = tree.remove(key);
                    total_removed += 1;
                }
            }
        }

        if total_removed > 0 {
            info!("[Cache GC] Removed {} expired blobs", total_removed);
        }
    }
}

// ─── Main ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "onyx_blind_cache=info,tower_http=info".into()),
        )
        .init();

    let data_dir = std::env::var("CACHE_DATA_DIR").unwrap_or_else(|_| "./cache_data".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3456".to_string());
    let bind_addr = format!("0.0.0.0:{}", port);

    let state = Arc::new(AppState::new(&data_dir));

    // Spawn background GC
    let gc_state = state.clone();
    tokio::spawn(run_gc(gc_state));

    let app = Router::new()
        .route("/cache/{doc_id}/{node_id}", put(put_blob).get(get_blobs))
        .route("/cache/{doc_id}/{node_id}/{blob_id}", delete(delete_blob))
        .route("/health", get(health))
        .layer(CorsLayer::permissive())
        .with_state(state);

    info!("[Blind Cache] Starting on {}", bind_addr);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
