// ─── Onyx Sync: E2EE CRDT Sync over Iroh QUIC ──────────────────────────────
//
// This module implements Loro CRDT sync directly over Iroh's QUIC transport,
// with end-to-end encryption.
//
// Onyx Sync:
//   • Peer-to-peer via Iroh QUIC — no central server needed
//   • Every delta is encrypted with AES-256-GCM before transmission
//   • Works over LAN (mDNS), internet (DHT), or relay (fallback)
//   • Offline deltas cached in DocStore, replayed on reconnect
//   • Fallback: Blind Cache (Hetzner) → Home Station → direct P2P
//   • Real-time collaborative editing: subscribe_local_update → broadcast
//
// Sync Protocol (onyx-sync/1):
//
//   Step 1: Initiator sends their VersionVector
//   Step 2: Responder computes diff, sends missing updates
//   Step 3: Responder sends their VersionVector
//   Step 4: Initiator computes diff, sends their missing updates
//   Step 5: Bidirectional live update stream (subscribe → push)
//
// Uses Loro VersionVector for sync negotiation.
// Wire format is CRDT-agnostic — only encrypted byte blobs move over QUIC.

use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tracing::{info, warn, debug};
use tokio::sync::broadcast;
use base64::Engine as _;

use crate::crypto;
use crate::doc_store::DocStore;
use crate::network::{OnyxNode, ALPN_SYNC};

// ─── Sync Protocol Messages ────────────────────────────────────────────────

/// Wire format for sync protocol messages.
///
/// Each message is serialized as:
///   msg_type(1 byte) || payload_length(4 bytes LE) || payload(N bytes)
///
/// All payloads are encrypted with per-document AES-256-GCM keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMessageType {
    /// Request: "Here's my version vector, send me what I'm missing"
    StateVector = 0,
    /// Response: "Here are the updates you're missing"
    StateDiff = 1,
    /// Incremental: "I just made an edit, here's the delta"
    Update = 2,
    /// Awareness: cursor position, selection, presence info (unreliable)
    Awareness = 3,
    /// Acknowledgement: "I received your update"
    Ack = 4,
    /// Error: something went wrong
    Error = 5,
}

impl SyncMessageType {
    fn from_byte(b: u8) -> Option<Self> {
        match b {
            0 => Some(Self::StateVector),
            1 => Some(Self::StateDiff),
            2 => Some(Self::Update),
            3 => Some(Self::Awareness),
            4 => Some(Self::Ack),
            5 => Some(Self::Error),
            _ => None,
        }
    }

    fn to_byte(&self) -> u8 {
        match self {
            Self::StateVector => 0,
            Self::StateDiff => 1,
            Self::Update => 2,
            Self::Awareness => 3,
            Self::Ack => 4,
            Self::Error => 5,
        }
    }
}

/// A complete sync message with encrypted payload.
#[derive(Debug, Clone)]
pub struct SyncMessage {
    pub msg_type: SyncMessageType,
    pub doc_id: String,
    pub payload: Vec<u8>, // encrypted CRDT data
}

impl SyncMessage {
    /// Serialize to wire format:
    ///   msg_type(1) || doc_id_len(2 LE) || doc_id(N) || payload_len(4 LE) || payload(M)
    pub fn encode(&self) -> Vec<u8> {
        let doc_id_bytes = self.doc_id.as_bytes();
        let mut buf = Vec::with_capacity(1 + 2 + doc_id_bytes.len() + 4 + self.payload.len());

        buf.push(self.msg_type.to_byte());
        buf.extend_from_slice(&(doc_id_bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(doc_id_bytes);
        buf.extend_from_slice(&(self.payload.len() as u32).to_le_bytes());
        buf.extend_from_slice(&self.payload);

        buf
    }

    /// Deserialize from wire format.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < 7 { // 1 + 2 + 0 + 4 minimum
            return Err("Sync message too short".to_string());
        }

        let msg_type = SyncMessageType::from_byte(data[0])
            .ok_or_else(|| format!("Unknown sync message type: {}", data[0]))?;

        let doc_id_len = u16::from_le_bytes([data[1], data[2]]) as usize;
        if data.len() < 3 + doc_id_len + 4 {
            return Err("Sync message truncated at doc_id".to_string());
        }

        let doc_id = String::from_utf8(data[3..3 + doc_id_len].to_vec())
            .map_err(|e| format!("Invalid doc_id UTF-8: {}", e))?;

        let payload_offset = 3 + doc_id_len;
        let payload_len = u32::from_le_bytes([
            data[payload_offset],
            data[payload_offset + 1],
            data[payload_offset + 2],
            data[payload_offset + 3],
        ]) as usize;

        let payload_start = payload_offset + 4;
        if data.len() < payload_start + payload_len {
            return Err("Sync message truncated at payload".to_string());
        }

        let payload = data[payload_start..payload_start + payload_len].to_vec();

        Ok(Self { msg_type, doc_id, payload })
    }
}

// ─── Sync Engine ────────────────────────────────────────────────────────────

/// The Onyx Sync Engine — orchestrates Loro CRDT sync over Iroh QUIC connections.
///
/// Sync priority: (1) Direct P2P → (2) Home Station → (3) Blind Cache
///
/// Usage:
///   1. Call `sync_with_peer()` to initiate a sync with a specific peer
///   2. The accept loop in network.rs routes incoming sync connections here
///   3. For real-time collab, LoroDoc.subscribe_local_update() drives broadcasts
pub struct SyncEngine {
    /// Reference to the Iroh networking node
    node: Arc<OnyxNode>,
    /// Reference to the local CRDT document store
    doc_store: Arc<DocStore>,
    /// Master encryption key for document encryption
    master_key: Arc<tokio::sync::RwLock<Option<[u8; 32]>>>,
    /// Event broadcaster for sync status updates → frontend
    event_tx: broadcast::Sender<SyncEvent>,
}

/// Events emitted by the sync engine, forwarded to the frontend as Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub event_type: SyncEventType,
    pub doc_id: String,
    pub peer_id: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncEventType {
    SyncStarted,
    SyncCompleted,
    SyncFailed,
    UpdateReceived,
    UpdateSent,
    PeerOnline,
    PeerOffline,
}

impl SyncEngine {
    /// Create a new SyncEngine.
    pub fn new(node: Arc<OnyxNode>, doc_store: Arc<DocStore>) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            node,
            doc_store,
            master_key: Arc::new(tokio::sync::RwLock::new(None)),
            event_tx,
        }
    }

    /// Set the master key (called after user authenticates).
    pub async fn set_master_key(&self, key: [u8; 32]) {
        *self.master_key.write().await = Some(key);
        self.doc_store.set_master_key(key);
    }

    /// Subscribe to sync events.
    pub fn subscribe_events(&self) -> broadcast::Receiver<SyncEvent> {
        self.event_tx.subscribe()
    }

    /// Get the document encryption key for a specific document.
    async fn doc_key(&self, doc_id: &str) -> Result<[u8; 32], String> {
        let master = self.master_key.read().await;
        let master = master.ok_or("Master key not set — user not authenticated")?;
        crypto::derive_key(&master, "onyx-sync-v1", doc_id)
            .map_err(|e| e.to_string())
    }

    // ─── Sync Operations ────────────────────────────────────────────────────

    /// Sync a document with a specific peer.
    ///
    /// This is the main sync function. It:
    ///   1. Opens a QUIC connection to the peer via Iroh (racing all paths)
    ///   2. Sends our version vector
    ///   3. Receives the peer's diff (updates we're missing)
    ///   4. Applies the diff to our local document
    ///   5. Sends our diff (updates the peer is missing)
    ///   6. Both sides are now in sync
    ///
    /// All CRDT data is encrypted with per-document AES-256-GCM keys.
    pub async fn sync_with_peer(
        &self,
        doc_id: &str,
        peer_node_id: &str,
    ) -> Result<SyncResult, String> {
        info!("[Sync] Starting sync of doc '{}' with peer {}", doc_id, peer_node_id);

        let doc_key = self.doc_key(doc_id).await?;

        // Emit sync started event
        let _ = self.event_tx.send(SyncEvent {
            event_type: SyncEventType::SyncStarted,
            doc_id: doc_id.to_string(),
            peer_id: peer_node_id.to_string(),
            detail: "Connecting...".to_string(),
        });

        // Step 1: Connect to peer via Iroh (races: direct, LAN, relay)
        let connection = self.node.connect(peer_node_id, ALPN_SYNC).await
            .map_err(|e| format!("Connection failed: {}", e))?;

        // Step 2: Open bidirectional QUIC stream
        let (mut send, mut recv) = connection.open_bi().await
            .map_err(|e| format!("Failed to open stream: {}", e))?;

        // Step 3: Send our version vector (encrypted)
        let state_vector = self.doc_store.get_state_vector(doc_id).await?;
        let encrypted_sv = crypto::encrypt_aead(&doc_key, &state_vector, Some(b"sv"))
            .map_err(|e| e.to_string())?;

        let sv_msg = SyncMessage {
            msg_type: SyncMessageType::StateVector,
            doc_id: doc_id.to_string(),
            payload: encrypted_sv,
        };

        let encoded = sv_msg.encode();
        send.write_all(&(encoded.len() as u32).to_le_bytes()).await
            .map_err(|e| format!("Write length failed: {}", e))?;
        send.write_all(&encoded).await
            .map_err(|e| format!("Write SV failed: {}", e))?;

        debug!("[Sync] Sent version vector ({} bytes) to peer", state_vector.len());

        // Step 4: Receive peer's diff (updates we're missing)
        let response_data = read_framed_message(&mut recv).await?;
        let response_msg = SyncMessage::decode(&response_data)?;

        if let SyncMessageType::StateDiff = response_msg.msg_type {
            // Decrypt the diff
            let diff = crypto::decrypt_aead(&doc_key, &response_msg.payload, Some(b"diff"))
                .map_err(|e| format!("Failed to decrypt diff: {}", e))?;

            if !diff.is_empty() {
                self.doc_store.apply_update(doc_id, &diff).await?;
                info!("[Sync] Applied {} byte diff from peer", diff.len());
            }
        }

        // Step 5: Receive peer's version vector, compute and send our diff
        let peer_sv_data = read_framed_message(&mut recv).await?;
        let peer_sv_msg = SyncMessage::decode(&peer_sv_data)?;

        if let SyncMessageType::StateVector = peer_sv_msg.msg_type {
            let peer_sv = crypto::decrypt_aead(&doc_key, &peer_sv_msg.payload, Some(b"sv"))
                .map_err(|e| format!("Failed to decrypt peer SV: {}", e))?;

            let our_diff = self.doc_store.compute_diff(doc_id, &peer_sv).await?;
            let encrypted_diff = crypto::encrypt_aead(&doc_key, &our_diff, Some(b"diff"))
                .map_err(|e| e.to_string())?;

            let diff_msg = SyncMessage {
                msg_type: SyncMessageType::StateDiff,
                doc_id: doc_id.to_string(),
                payload: encrypted_diff,
            };

            let encoded = diff_msg.encode();
            send.write_all(&(encoded.len() as u32).to_le_bytes()).await
                .map_err(|e| format!("Write diff length failed: {}", e))?;
            send.write_all(&encoded).await
                .map_err(|e| format!("Write diff failed: {}", e))?;

            debug!("[Sync] Sent {} byte diff to peer", our_diff.len());
        }

        // Step 6: Record peer's sync state
        let final_sv = self.doc_store.get_state_vector(doc_id).await?;
        self.doc_store.update_peer_state(doc_id, peer_node_id, &final_sv).await?;

        // Finish the stream
        send.finish()
            .map_err(|e| format!("Failed to finish stream: {}", e))?;

        let result = SyncResult {
            doc_id: doc_id.to_string(),
            peer_id: peer_node_id.to_string(),
            bytes_sent: 0, // TODO: track actual bytes
            bytes_received: 0,
            success: true,
        };

        // Emit sync completed event
        let _ = self.event_tx.send(SyncEvent {
            event_type: SyncEventType::SyncCompleted,
            doc_id: doc_id.to_string(),
            peer_id: peer_node_id.to_string(),
            detail: "Sync complete".to_string(),
        });

        info!("[Sync] Sync of doc '{}' with peer {} complete", doc_id, peer_node_id);
        Ok(result)
    }

    /// Handle an incoming sync request from a peer (called by network.rs accept loop).
    pub async fn handle_incoming_sync(
        &self,
        connection: iroh::endpoint::Connection,
    ) -> Result<(), String> {
        let peer_id = connection.remote_node_id()
            .map(|id| id.to_string())
            .unwrap_or_else(|_| "unknown".to_string());

        info!("[Sync] Handling incoming sync from peer {}", peer_id);

        // Accept bidirectional stream
        let (mut send, mut recv) = connection.accept_bi().await
            .map_err(|e| format!("Failed to accept stream: {}", e))?;

        // Step 1: Receive peer's version vector
        let sv_data = read_framed_message(&mut recv).await?;
        let sv_msg = SyncMessage::decode(&sv_data)?;

        let doc_id = sv_msg.doc_id.clone();
        let doc_key = self.doc_key(&doc_id).await?;

        if let SyncMessageType::StateVector = sv_msg.msg_type {
            // Decrypt peer's version vector
            let peer_sv = crypto::decrypt_aead(&doc_key, &sv_msg.payload, Some(b"sv"))
                .map_err(|e| format!("Failed to decrypt peer SV: {}", e))?;

            // Step 2: Compute diff (updates the peer is missing) and send
            let diff = self.doc_store.compute_diff(&doc_id, &peer_sv).await?;
            let encrypted_diff = crypto::encrypt_aead(&doc_key, &diff, Some(b"diff"))
                .map_err(|e| e.to_string())?;

            let diff_msg = SyncMessage {
                msg_type: SyncMessageType::StateDiff,
                doc_id: doc_id.clone(),
                payload: encrypted_diff,
            };

            let encoded = diff_msg.encode();
            send.write_all(&(encoded.len() as u32).to_le_bytes()).await
                .map_err(|e| format!("Write diff length failed: {}", e))?;
            send.write_all(&encoded).await
                .map_err(|e| format!("Write diff failed: {}", e))?;

            // Step 3: Send our version vector
            let our_sv = self.doc_store.get_state_vector(&doc_id).await?;
            let encrypted_sv = crypto::encrypt_aead(&doc_key, &our_sv, Some(b"sv"))
                .map_err(|e| e.to_string())?;

            let sv_response = SyncMessage {
                msg_type: SyncMessageType::StateVector,
                doc_id: doc_id.clone(),
                payload: encrypted_sv,
            };

            let encoded = sv_response.encode();
            send.write_all(&(encoded.len() as u32).to_le_bytes()).await
                .map_err(|e| format!("Write SV length failed: {}", e))?;
            send.write_all(&encoded).await
                .map_err(|e| format!("Write SV failed: {}", e))?;

            // Step 4: Receive peer's diff and apply
            let diff_data = read_framed_message(&mut recv).await?;
            let diff_msg = SyncMessage::decode(&diff_data)?;

            if let SyncMessageType::StateDiff = diff_msg.msg_type {
                let peer_diff = crypto::decrypt_aead(&doc_key, &diff_msg.payload, Some(b"diff"))
                    .map_err(|e| format!("Failed to decrypt peer diff: {}", e))?;

                if !peer_diff.is_empty() {
                    self.doc_store.apply_update(&doc_id, &peer_diff).await?;
                }
            }

            // Record sync state
            let final_sv = self.doc_store.get_state_vector(&doc_id).await?;
            self.doc_store.update_peer_state(&doc_id, &peer_id, &final_sv).await?;
        }

        send.finish()
            .map_err(|e| format!("Failed to finish stream: {}", e))?;

        info!("[Sync] Incoming sync of doc '{}' from peer {} complete", doc_id, peer_id);
        Ok(())
    }

    /// Send a real-time incremental update to all connected peers for a document.
    /// Called when the frontend applies a local edit.
    pub async fn broadcast_update(
        &self,
        doc_id: &str,
        update: &[u8],
        connected_peers: &[String],
    ) -> Result<(), String> {
        let doc_key = self.doc_key(doc_id).await?;
        let encrypted = crypto::encrypt_aead(&doc_key, update, Some(b"update"))
            .map_err(|e| e.to_string())?;

        let msg = SyncMessage {
            msg_type: SyncMessageType::Update,
            doc_id: doc_id.to_string(),
            payload: encrypted,
        };

        let encoded = msg.encode();

        for peer_id in connected_peers {
            match self.node.connect(peer_id, ALPN_SYNC).await {
                Ok(connection) => {
                    match connection.open_uni().await {
                        Ok(mut send) => {
                            let _ = send.write_all(&(encoded.len() as u32).to_le_bytes()).await;
                            let _ = send.write_all(&encoded).await;
                            let _ = send.finish();
                            debug!("[Sync] Broadcast {} byte update to peer {}", update.len(), peer_id);
                        }
                        Err(e) => {
                            warn!("[Sync] Failed to open stream to {}: {}", peer_id, e);
                        }
                    }
                }
                Err(_e) => {
                    // Peer offline — queue delta for later delivery
                    debug!("[Sync] Peer {} offline, queueing delta", peer_id);
                    if let Some(master) = *self.master_key.read().await {
                        let _ = self.doc_store.queue_delta(doc_id, peer_id, update, &master).await;
                    }
                }
            }
        }

        Ok(())
    }

    /// Replay all pending deltas to a newly-online peer.
    pub async fn replay_pending_deltas(&self, peer_id: &str) -> Result<usize, String> {
        let master = self.master_key.read().await
            .ok_or("Master key not set")?;

        let deltas = self.doc_store.drain_pending_deltas(peer_id, &master).await?;
        let count = deltas.len();

        if count == 0 {
            return Ok(0);
        }

        info!("[Sync] Replaying {} pending deltas to peer {}", count, peer_id);

        for (doc_id, delta) in &deltas {
            let doc_key = self.doc_key(doc_id).await?;
            let encrypted = crypto::encrypt_aead(&doc_key, delta, Some(b"update"))
                .map_err(|e| e.to_string())?;

            let msg = SyncMessage {
                msg_type: SyncMessageType::Update,
                doc_id: doc_id.to_string(),
                payload: encrypted,
            };

            match self.node.connect(peer_id, ALPN_SYNC).await {
                Ok(connection) => {
                    if let Ok(mut send) = connection.open_uni().await {
                        let encoded = msg.encode();
                        let _ = send.write_all(&(encoded.len() as u32).to_le_bytes()).await;
                        let _ = send.write_all(&encoded).await;
                        let _ = send.finish();
                    }
                }
                Err(e) => {
                    warn!("[Sync] Failed to replay delta to {}: {}", peer_id, e);
                    break;
                }
            }
        }

        Ok(count)
    }
}

// ─── Wire Helpers ───────────────────────────────────────────────────────────

/// Read a length-prefixed message from a QUIC receive stream.
async fn read_framed_message(
    recv: &mut iroh::endpoint::RecvStream,
) -> Result<Vec<u8>, String> {
    let mut len_buf = [0u8; 4];
    recv.read_exact(&mut len_buf).await
        .map_err(|e| format!("Failed to read message length: {}", e))?;

    let len = u32::from_le_bytes(len_buf) as usize;
    if len > 64 * 1024 * 1024 { // 64MB max message size
        return Err(format!("Message too large: {} bytes", len));
    }

    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf).await
        .map_err(|e| format!("Failed to read message body: {}", e))?;

    Ok(buf)
}

// ─── Sync Result ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub doc_id: String,
    pub peer_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub success: bool,
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Sync a specific document with a peer.
#[tauri::command]
pub async fn sync_doc_with_peer(
    engine: tauri::State<'_, Arc<SyncEngine>>,
    doc_id: String,
    peer_node_id: String,
) -> Result<SyncResult, String> {
    engine.sync_with_peer(&doc_id, &peer_node_id).await
}

/// Broadcast an update to all peers editing a document.
#[tauri::command]
pub async fn sync_broadcast_update(
    engine: tauri::State<'_, Arc<SyncEngine>>,
    doc_id: String,
    update_b64: String,
    peer_ids: Vec<String>,
) -> Result<(), String> {
    let update = base64::engine::general_purpose::STANDARD
        .decode(&update_b64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    engine.broadcast_update(&doc_id, &update, &peer_ids).await
}

/// Set the master encryption key for the sync engine.
#[tauri::command]
pub async fn sync_set_master_key(
    engine: tauri::State<'_, Arc<SyncEngine>>,
    master_key_b64: String,
) -> Result<(), String> {
    let key_bytes = base64::engine::general_purpose::STANDARD
        .decode(&master_key_b64)
        .map_err(|e| format!("Invalid base64 key: {}", e))?;

    if key_bytes.len() != 32 {
        return Err("Master key must be 32 bytes".to_string());
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    engine.set_master_key(key).await;

    Ok(())
}

/// Replay pending deltas to a peer that just came online.
#[tauri::command]
pub async fn sync_replay_pending(
    engine: tauri::State<'_, Arc<SyncEngine>>,
    peer_id: String,
) -> Result<usize, String> {
    engine.replay_pending_deltas(&peer_id).await
}
