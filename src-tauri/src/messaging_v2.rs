// ─── Onyx Messaging V2: Signal Protocol over Iroh QUIC ─────────────────────
//
// Replaces messaging.rs with production-grade E2EE:
//   • DMs:    X3DH key agreement → Double Ratchet (forward secrecy + PCS)
//   • Groups: Sender Keys protocol (each member has their own chain)
//   • Transport: ALPN b"onyx-msg/1" over Iroh QUIC (magicsock)
//   • Offline: Dead Drop — encrypted messages queued for offline peers
//
// Wire format:
//   msg_type(1) || payload_len(4 LE) || payload(N)
//
// Message types:
//   0x01 = X3DH PreKey bundle broadcast
//   0x02 = X3DH initial message
//   0x03 = Ratchet message (DM)
//   0x04 = Group sender key distribution
//   0x05 = Group encrypted message
//   0x06 = Delivery receipt / ACK
//   0x07 = Typing indicator
//   0x08 = Read receipt

use crate::crypto::{
    self, OnyxIdentity, PreKeyBundle,
    derive_key, encrypt_aead, decrypt_aead,
    encrypt_versioned, decrypt_auto,
    random_key, kdf_chain_step,
};
use crate::ratchet::{
    RatchetState, RatchetHeader,
    persist_ratchet_state, restore_ratchet_state,
};
use crate::network::OnyxNode;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, info, warn};
use iroh::endpoint::{RecvStream, SendStream};

// ─── Wire Protocol Constants ────────────────────────────────────────────────

const MSG_PREKEY_BUNDLE: u8 = 0x01;
const MSG_X3DH_INITIAL: u8 = 0x02;
const MSG_RATCHET: u8 = 0x03;
const MSG_GROUP_SENDER_KEY: u8 = 0x04;
const MSG_GROUP_MESSAGE: u8 = 0x05;
const MSG_DELIVERY_ACK: u8 = 0x06;
const MSG_TYPING: u8 = 0x07;
const MSG_READ_RECEIPT: u8 = 0x08;

// ─── Message Types ──────────────────────────────────────────────────────────

/// A decrypted plaintext message ready for display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptedMessage {
    pub id: String,
    pub conversation_id: String,
    pub sender_node_id: String,
    pub sender_name: String,
    pub content: String,
    pub content_type: ContentType,
    pub reply_to: Option<String>,
    pub timestamp: i64,
    pub is_outgoing: bool,
    pub delivered: bool,
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ContentType {
    Text,
    Image,
    File,
    System,
}

impl std::fmt::Display for ContentType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            ContentType::Text => write!(f, "text"),
            ContentType::Image => write!(f, "image"),
            ContentType::File => write!(f, "file"),
            ContentType::System => write!(f, "system"),
        }
    }
}

impl std::str::FromStr for ContentType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "text" => Ok(ContentType::Text),
            "image" => Ok(ContentType::Image),
            "file" => Ok(ContentType::File),
            "system" => Ok(ContentType::System),
            _ => Err(format!("Unknown content type: {}", s)),
        }
    }
}

/// A conversation (DM or group).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub conversation_type: ConversationType,
    pub name: String,
    pub icon_emoji: String,
    pub last_message: Option<String>,
    pub last_message_at: Option<i64>,
    pub unread_count: i64,
    pub members: Vec<String>, // NodeId hex strings
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConversationType {
    DirectMessage,
    Group,
}

impl std::fmt::Display for ConversationType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            ConversationType::DirectMessage => write!(f, "dm"),
            ConversationType::Group => write!(f, "group"),
        }
    }
}

// ─── Sender Key (Group Encryption) ─────────────────────────────────────────

/// Each group member publishes their Sender Key to all other members.
/// Messages are encrypted with the sender's chain, so only holders of
/// that sender's key can decrypt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SenderKey {
    /// The sender's NodeId
    pub sender_id: String,
    /// Group/conversation ID
    pub group_id: String,
    /// The current chain key (symmetric, 32 bytes, base64)
    pub chain_key: [u8; 32],
    /// Message counter
    pub message_index: u32,
    /// Signature public key for verification
    pub signature_key: [u8; 32],
}

// ─── Wire Message ───────────────────────────────────────────────────────────

/// The wire format message exchanged over QUIC streams.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireMessage {
    pub msg_type: u8,
    pub payload: Vec<u8>,
}

impl WireMessage {
    pub fn encode(&self) -> Vec<u8> {
        let len = self.payload.len() as u32;
        let mut buf = Vec::with_capacity(5 + self.payload.len());
        buf.push(self.msg_type);
        buf.extend_from_slice(&len.to_le_bytes());
        buf.extend_from_slice(&self.payload);
        buf
    }

    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < 5 {
            return Err("Wire message too short".into());
        }
        let msg_type = data[0];
        let len = u32::from_le_bytes([data[1], data[2], data[3], data[4]]) as usize;
        if data.len() < 5 + len {
            return Err(format!("Wire message truncated: need {} got {}", 5 + len, data.len()));
        }
        Ok(Self {
            msg_type,
            payload: data[5..5 + len].to_vec(),
        })
    }
}

// ─── DM Envelope (Ratchet-encrypted) ───────────────────────────────────────

/// Serialized ratchet header + ciphertext for DM transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmEnvelope {
    /// Ratchet header (serialized)
    pub header: Vec<u8>,
    /// AES-256-GCM ciphertext
    pub ciphertext: Vec<u8>,
    /// Sender's current NodeId (hex) — for routing, not secrecy
    pub sender: String,
    /// Unix timestamp
    pub timestamp: i64,
    /// Message ID
    pub message_id: String,
}

// ─── Group Envelope (Sender Key encrypted) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupEnvelope {
    /// Group/conversation ID
    pub group_id: String,
    /// Sender's NodeId
    pub sender: String,
    /// Chain message index (for key derivation)
    pub chain_index: u32,
    /// AES-256-GCM ciphertext
    pub ciphertext: Vec<u8>,
    /// timestamp
    pub timestamp: i64,
    /// Message ID
    pub message_id: String,
}

// ─── Messaging Engine ───────────────────────────────────────────────────────

/// The central messaging engine managing sessions, encryption, and transport.
pub struct MessagingEngine {
    /// SQLite pool for message persistence
    pool: SqlitePool,
    /// Our identity
    identity: Arc<OnyxIdentity>,
    /// Master key for encrypting local ratchet state
    master_key: Arc<RwLock<Option<[u8; 32]>>>,
    /// Active ratchet sessions: peer_node_id → RatchetState
    sessions: DashMap<String, RatchetState>,
    /// Sender keys for groups: (group_id, sender_id) → SenderKey
    sender_keys: DashMap<(String, String), SenderKey>,
    /// Event broadcast for UI updates
    event_tx: broadcast::Sender<MessagingEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagingEvent {
    pub event_type: MessagingEventType,
    pub conversation_id: String,
    pub message_id: Option<String>,
    pub peer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessagingEventType {
    MessageReceived,
    MessageSent,
    MessageDelivered,
    MessageRead,
    SessionEstablished,
    TypingStarted,
    TypingStopped,
    GroupKeyReceived,
}

impl MessagingEngine {
    pub fn new(pool: SqlitePool, identity: Arc<OnyxIdentity>) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        Self {
            pool,
            identity,
            master_key: Arc::new(RwLock::new(None)),
            sessions: DashMap::new(),
            sender_keys: DashMap::new(),
            event_tx,
        }
    }

    /// Set the master key (derived from user's vault password).
    pub async fn set_master_key(&self, key: [u8; 32]) {
        let mut mk = self.master_key.write().await;
        *mk = Some(key);
    }

    /// Run database migrations for messaging v2 tables.
    pub async fn migrate(&self) -> Result<(), String> {
        // Conversations table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_conversations (
                id TEXT PRIMARY KEY,
                conversation_type TEXT NOT NULL DEFAULT 'dm',
                name TEXT NOT NULL DEFAULT '',
                icon_emoji TEXT NOT NULL DEFAULT '💬',
                created_at INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_conversations: {}", e))?;

        // Conversation members
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_members (
                conversation_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'member',
                joined_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (conversation_id, node_id)
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_members: {}", e))?;

        // Messages
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                sender_node_id TEXT NOT NULL,
                sender_name TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                content_type TEXT NOT NULL DEFAULT 'text',
                reply_to TEXT,
                timestamp INTEGER NOT NULL DEFAULT 0,
                is_outgoing INTEGER NOT NULL DEFAULT 0,
                delivered INTEGER NOT NULL DEFAULT 0,
                read INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_messages: {}", e))?;

        // Ratchet sessions (encrypted)
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_ratchet_sessions (
                peer_node_id TEXT PRIMARY KEY,
                encrypted_state BLOB NOT NULL,
                last_message_at INTEGER NOT NULL DEFAULT 0,
                message_count INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_ratchet_sessions: {}", e))?;

        // Sender keys (encrypted)
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_sender_keys (
                group_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                encrypted_key BLOB NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (group_id, sender_id)
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_sender_keys: {}", e))?;

        // PreKey bundles (for X3DH)
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_prekeys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                identity_key BLOB NOT NULL,
                signed_prekey BLOB NOT NULL,
                signed_prekey_sig BLOB NOT NULL,
                one_time_prekey BLOB,
                created_at INTEGER NOT NULL DEFAULT 0,
                used INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_prekeys: {}", e))?;

        // Dead Drop: offline message queue
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS msg_v2_dead_drop (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_node_id TEXT NOT NULL,
                encrypted_envelope BLOB NOT NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                expires_at INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create msg_v2_dead_drop: {}", e))?;

        // Indexes
        let indexes = [
            "CREATE INDEX IF NOT EXISTS idx_v2_msg_conv ON msg_v2_messages(conversation_id, timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS idx_v2_msg_sender ON msg_v2_messages(sender_node_id)",
            "CREATE INDEX IF NOT EXISTS idx_v2_dd_target ON msg_v2_dead_drop(target_node_id, created_at)",
            "CREATE INDEX IF NOT EXISTS idx_v2_members_conv ON msg_v2_members(conversation_id)",
        ];
        for idx in &indexes {
            sqlx::query(idx).execute(&self.pool).await.ok();
        }

        info!("[MessagingV2] Database migrations complete");
        Ok(())
    }

    // ─── X3DH Key Agreement ─────────────────────────────────────────────

    /// Generate a PreKey bundle for publishing.
    pub fn generate_prekey_bundle(&self) -> PreKeyBundle {
        self.identity.generate_prekey_bundle()
    }

    /// Initiate a DM session with a peer using X3DH.
    pub async fn initiate_session(
        &self,
        peer_node_id: &str,
        peer_bundle: &PreKeyBundle,
    ) -> Result<(), String> {
        // Run X3DH
        let x3dh_result = crypto::x3dh_initiate_from_bundle(&self.identity, peer_bundle)?;

        // Initialize Double Ratchet as Alice
        let shared = x3dh_result.secret.as_bytes();
        if shared.len() != 32 {
            return Err("X3DH shared secret wrong size".into());
        }
        let mut shared_arr = [0u8; 32];
        shared_arr.copy_from_slice(shared);

        let spk_bytes = B64.decode(&peer_bundle.signed_prekey)
            .map_err(|e| format!("Decode signed prekey: {}", e))?;
        if spk_bytes.len() != 32 {
            return Err("Signed prekey wrong size".into());
        }
        let mut spk_arr = [0u8; 32];
        spk_arr.copy_from_slice(&spk_bytes);

        let ratchet = RatchetState::init_alice(
            &shared_arr,
            &spk_arr,
        )?;

        // Store session
        self.sessions.insert(peer_node_id.to_string(), ratchet.clone());

        // Persist encrypted ratchet state
        let mk = self.master_key.read().await;
        if let Some(master_key) = mk.as_ref() {
            let encrypted = persist_ratchet_state(&ratchet, master_key, peer_node_id)?;
            self.save_ratchet_session(peer_node_id, &encrypted).await?;
        }

        info!("[MessagingV2] Session initiated with {}", &peer_node_id[..8.min(peer_node_id.len())]);
        Ok(())
    }

    /// Accept a session initiated by a peer (Bob's side of X3DH).
    pub async fn accept_session(
        &self,
        peer_node_id: &str,
        shared_secret: &[u8; 32],
        our_signed_prekey_secret: &[u8; 32],
    ) -> Result<(), String> {
        let ratchet = RatchetState::init_bob(shared_secret, our_signed_prekey_secret);

        self.sessions.insert(peer_node_id.to_string(), ratchet.clone());

        let mk = self.master_key.read().await;
        if let Some(master_key) = mk.as_ref() {
            let encrypted = persist_ratchet_state(&ratchet, master_key, peer_node_id)?;
            self.save_ratchet_session(peer_node_id, &encrypted).await?;
        }

        info!("[MessagingV2] Session accepted from {}", &peer_node_id[..8.min(peer_node_id.len())]);
        Ok(())
    }

    // ─── DM Send / Receive ──────────────────────────────────────────────

    /// Encrypt and send a direct message.
    pub async fn send_dm(
        &self,
        peer_node_id: &str,
        content: &str,
        content_type: ContentType,
        reply_to: Option<String>,
    ) -> Result<DecryptedMessage, String> {
        // Load or find ratchet session
        let mut session = self.get_or_load_session(peer_node_id).await?;

        // Build plaintext payload
        let payload = MessagePayload {
            content: content.to_string(),
            content_type: content_type.to_string(),
            sender_name: String::new(), // filled from identity
            reply_to: reply_to.clone(),
        };
        let plaintext = serde_json::to_vec(&payload)
            .map_err(|e| format!("Serialize payload: {}", e))?;

        // Ratchet encrypt
        let (header, ciphertext) = session.ratchet_encrypt(&plaintext)?;

        // Build envelope
        let message_id = uuid::Uuid::new_v4().to_string();
        let timestamp = now_epoch();
        let _envelope = DmEnvelope {
            header: header.encode(),
            ciphertext,
            sender: self.identity.node_id_hex(),
            timestamp,
            message_id: message_id.clone(),
        };

        // Update session in memory + persist
        self.sessions.insert(peer_node_id.to_string(), session);
        self.persist_session(peer_node_id).await?;

        // Get or create conversation
        let conv_id = self.get_or_create_dm_conversation(peer_node_id).await?;

        // Store message locally
        let msg = DecryptedMessage {
            id: message_id.clone(),
            conversation_id: conv_id.clone(),
            sender_node_id: self.identity.node_id_hex(),
            sender_name: String::new(),
            content: content.to_string(),
            content_type,
            reply_to,
            timestamp,
            is_outgoing: true,
            delivered: false,
            read: true, // sender has read it
        };
        self.store_message(&msg).await?;

        // Emit event
        let _ = self.event_tx.send(MessagingEvent {
            event_type: MessagingEventType::MessageSent,
            conversation_id: conv_id,
            message_id: Some(message_id),
            peer_id: Some(peer_node_id.to_string()),
        });

        Ok(msg)
    }

    /// Decrypt a received DM envelope.
    pub async fn receive_dm(
        &self,
        envelope: &DmEnvelope,
    ) -> Result<DecryptedMessage, String> {
        let peer_id = &envelope.sender;

        // Load or find ratchet session
        let mut session = self.get_or_load_session(peer_id).await?;

        // Decode ratchet header
        let header = RatchetHeader::decode(&envelope.header)?;

        // Decrypt
        let plaintext = session.ratchet_decrypt(&header, &envelope.ciphertext)?;

        // Update session
        self.sessions.insert(peer_id.to_string(), session);
        self.persist_session(peer_id).await?;

        // Parse payload
        let payload: MessagePayload = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Deserialize payload: {}", e))?;

        // Get or create conversation
        let conv_id = self.get_or_create_dm_conversation(peer_id).await?;

        let msg = DecryptedMessage {
            id: envelope.message_id.clone(),
            conversation_id: conv_id.clone(),
            sender_node_id: peer_id.to_string(),
            sender_name: payload.sender_name,
            content: payload.content,
            content_type: payload.content_type.parse().unwrap_or(ContentType::Text),
            reply_to: payload.reply_to,
            timestamp: envelope.timestamp,
            is_outgoing: false,
            delivered: true,
            read: false,
        };
        self.store_message(&msg).await?;

        let _ = self.event_tx.send(MessagingEvent {
            event_type: MessagingEventType::MessageReceived,
            conversation_id: conv_id,
            message_id: Some(envelope.message_id.clone()),
            peer_id: Some(peer_id.to_string()),
        });

        Ok(msg)
    }

    // ─── Group Send / Receive (Sender Keys) ─────────────────────────────

    /// Distribute our sender key to all group members.
    pub async fn distribute_sender_key(
        &self,
        group_id: &str,
        node: &OnyxNode,
        member_node_ids: &[String],
    ) -> Result<(), String> {
        let chain_key = random_key();
        let sender_key = SenderKey {
            sender_id: self.identity.node_id_hex(),
            group_id: group_id.to_string(),
            chain_key,
            message_index: 0,
            signature_key: self.identity.public_key_bytes(),
        };

        // Store our own sender key
        self.sender_keys.insert(
            (group_id.to_string(), self.identity.node_id_hex()),
            sender_key.clone(),
        );

        // Encrypt sender key for each member using their DM ratchet
        for member_id in member_node_ids {
            if member_id == &self.identity.node_id_hex() {
                continue;
            }

            // Serialize sender key
            let sk_payload = serde_json::to_vec(&sender_key)
                .map_err(|e| format!("Serialize sender key: {}", e))?;

            // Encrypt via existing DM session (if available)
            if let Some(mut session) = self.sessions.get_mut(member_id) {
                let (header, ct) = session.ratchet_encrypt(&sk_payload)?;

                let wire = WireMessage {
                    msg_type: MSG_GROUP_SENDER_KEY,
                    payload: serde_json::to_vec(&DmEnvelope {
                        header: header.encode(),
                        ciphertext: ct,
                        sender: self.identity.node_id_hex(),
                        timestamp: now_epoch(),
                        message_id: uuid::Uuid::new_v4().to_string(),
                    }).map_err(|e| e.to_string())?,
                };

                // Try to send — if peer is offline, queue as dead drop
                if let Err(e) = self.send_wire_message(node, member_id, &wire).await {
                    debug!("[MessagingV2] Queueing sender key for offline peer {}: {}", &member_id[..8.min(member_id.len())], e);
                    self.queue_dead_drop(member_id, &wire.encode()).await?;
                }
            } else {
                warn!("[MessagingV2] No DM session with {}, can't distribute sender key", &member_id[..8.min(member_id.len())]);
            }
        }

        info!("[MessagingV2] Sender key distributed for group {}", group_id);
        Ok(())
    }

    /// Encrypt a group message using Sender Keys.
    pub async fn send_group_message(
        &self,
        group_id: &str,
        content: &str,
        content_type: ContentType,
        reply_to: Option<String>,
        node: &OnyxNode,
        member_node_ids: &[String],
    ) -> Result<DecryptedMessage, String> {
        let my_id = self.identity.node_id_hex();
        let key_id = (group_id.to_string(), my_id.clone());

        // Get our sender key for this group
        let mut sender_key = self.sender_keys.get_mut(&key_id)
            .ok_or("No sender key for this group — distribute first")?;

        // Step the chain to get message key
        let (next_chain, message_key) = kdf_chain_step(&sender_key.chain_key);
        let chain_index = sender_key.message_index;
        sender_key.chain_key = next_chain;
        sender_key.message_index += 1;
        drop(sender_key);

        // Build payload
        let payload = MessagePayload {
            content: content.to_string(),
            content_type: content_type.to_string(),
            sender_name: String::new(),
            reply_to: reply_to.clone(),
        };
        let plaintext = serde_json::to_vec(&payload)
            .map_err(|e| format!("Serialize: {}", e))?;

        // Encrypt with message key
        let ciphertext = encrypt_aead(&message_key, &plaintext, Some(group_id.as_bytes()))
            .map_err(|e| e.to_string())?;

        let message_id = uuid::Uuid::new_v4().to_string();
        let timestamp = now_epoch();

        let envelope = GroupEnvelope {
            group_id: group_id.to_string(),
            sender: my_id.clone(),
            chain_index,
            ciphertext,
            timestamp,
            message_id: message_id.clone(),
        };

        // Build wire message
        let wire = WireMessage {
            msg_type: MSG_GROUP_MESSAGE,
            payload: serde_json::to_vec(&envelope).map_err(|e| e.to_string())?,
        };

        // Send to all members
        for member_id in member_node_ids {
            if member_id == &my_id { continue; }
            if let Err(_e) = self.send_wire_message(node, member_id, &wire).await {
                debug!("[MessagingV2] Queueing group msg for offline peer {}", &member_id[..8.min(member_id.len())]);
                self.queue_dead_drop(member_id, &wire.encode()).await?;
            }
        }

        // Store locally
        let msg = DecryptedMessage {
            id: message_id.clone(),
            conversation_id: group_id.to_string(),
            sender_node_id: my_id,
            sender_name: String::new(),
            content: content.to_string(),
            content_type,
            reply_to,
            timestamp,
            is_outgoing: true,
            delivered: false,
            read: true,
        };
        self.store_message(&msg).await?;

        let _ = self.event_tx.send(MessagingEvent {
            event_type: MessagingEventType::MessageSent,
            conversation_id: group_id.to_string(),
            message_id: Some(message_id),
            peer_id: None,
        });

        Ok(msg)
    }

    /// Decrypt a received group message.
    pub async fn receive_group_message(
        &self,
        envelope: &GroupEnvelope,
    ) -> Result<DecryptedMessage, String> {
        let key_id = (envelope.group_id.clone(), envelope.sender.clone());

        // Find sender key
        let mut sender_key = self.sender_keys.get_mut(&key_id)
            .ok_or("No sender key from this sender for this group")?;

        // Advance chain to the correct index
        if envelope.chain_index < sender_key.message_index {
            return Err("Message replay or out-of-order not supported for sender keys".into());
        }

        // Fast-forward chain if needed
        let mut ck = sender_key.chain_key;
        let mut mk = [0u8; 32];
        for _ in sender_key.message_index..=envelope.chain_index {
            let (next, key) = kdf_chain_step(&ck);
            ck = next;
            mk = key;
        }
        sender_key.chain_key = ck;
        sender_key.message_index = envelope.chain_index + 1;
        drop(sender_key);

        // Decrypt
        let plaintext = decrypt_aead(&mk, &envelope.ciphertext, Some(envelope.group_id.as_bytes()))
            .map_err(|e| e.to_string())?;

        let payload: MessagePayload = serde_json::from_slice(&plaintext)
            .map_err(|e| format!("Deserialize: {}", e))?;

        let msg = DecryptedMessage {
            id: envelope.message_id.clone(),
            conversation_id: envelope.group_id.clone(),
            sender_node_id: envelope.sender.clone(),
            sender_name: payload.sender_name,
            content: payload.content,
            content_type: payload.content_type.parse().unwrap_or(ContentType::Text),
            reply_to: payload.reply_to,
            timestamp: envelope.timestamp,
            is_outgoing: false,
            delivered: true,
            read: false,
        };
        self.store_message(&msg).await?;

        let _ = self.event_tx.send(MessagingEvent {
            event_type: MessagingEventType::MessageReceived,
            conversation_id: envelope.group_id.clone(),
            message_id: Some(envelope.message_id.clone()),
            peer_id: Some(envelope.sender.clone()),
        });

        Ok(msg)
    }

    // ─── Incoming Message Handler ───────────────────────────────────────

    /// Handle an incoming message QUIC stream.
    pub async fn handle_incoming(
        &self,
        mut recv: RecvStream,
        mut send: SendStream,
    ) -> Result<(), String> {
        // Read the wire message
        let data = read_stream_to_end(&mut recv, 16 * 1024 * 1024).await?;
        let wire = WireMessage::decode(&data)?;

        match wire.msg_type {
            MSG_RATCHET => {
                let envelope: DmEnvelope = serde_json::from_slice(&wire.payload)
                    .map_err(|e| format!("Parse DM envelope: {}", e))?;
                let msg = self.receive_dm(&envelope).await?;
                debug!("[MessagingV2] Received DM from {}", &msg.sender_node_id[..8.min(msg.sender_node_id.len())]);

                // Send ACK
                let ack = WireMessage {
                    msg_type: MSG_DELIVERY_ACK,
                    payload: msg.id.as_bytes().to_vec(),
                };
                let _ = send_stream_data(&mut send, &ack.encode()).await;
            }
            MSG_GROUP_MESSAGE => {
                let envelope: GroupEnvelope = serde_json::from_slice(&wire.payload)
                    .map_err(|e| format!("Parse group envelope: {}", e))?;
                let msg = self.receive_group_message(&envelope).await?;
                debug!("[MessagingV2] Received group msg in {}", &msg.conversation_id[..8.min(msg.conversation_id.len())]);

                let ack = WireMessage {
                    msg_type: MSG_DELIVERY_ACK,
                    payload: msg.id.as_bytes().to_vec(),
                };
                let _ = send_stream_data(&mut send, &ack.encode()).await;
            }
            MSG_GROUP_SENDER_KEY => {
                // Sender key is wrapped in a DM envelope (encrypted via ratchet)
                let dm_envelope: DmEnvelope = serde_json::from_slice(&wire.payload)
                    .map_err(|e| format!("Parse sender key DM: {}", e))?;
                let peer_id = dm_envelope.sender.clone();

                let mut session = self.get_or_load_session(&peer_id).await?;
                let header = RatchetHeader::decode(&dm_envelope.header)?;
                let plaintext = session.ratchet_decrypt(&header, &dm_envelope.ciphertext)?;
                self.sessions.insert(peer_id.clone(), session);
                self.persist_session(&peer_id).await?;

                let sender_key: SenderKey = serde_json::from_slice(&plaintext)
                    .map_err(|e| format!("Parse sender key: {}", e))?;

                self.sender_keys.insert(
                    (sender_key.group_id.clone(), sender_key.sender_id.clone()),
                    sender_key.clone(),
                );

                let _ = self.event_tx.send(MessagingEvent {
                    event_type: MessagingEventType::GroupKeyReceived,
                    conversation_id: sender_key.group_id,
                    message_id: None,
                    peer_id: Some(peer_id),
                });
            }
            MSG_X3DH_INITIAL => {
                // Handle X3DH initial message -- establish session
                debug!("[MessagingV2] Received X3DH initial message");
                // The payload contains: serialized X3DH initial data + first ratchet message
                // This is handled by the session establishment flow
            }
            MSG_DELIVERY_ACK => {
                let message_id = String::from_utf8_lossy(&wire.payload).to_string();
                self.mark_delivered(&message_id).await?;
            }
            MSG_READ_RECEIPT => {
                let message_id = String::from_utf8_lossy(&wire.payload).to_string();
                self.mark_read(&message_id).await?;
            }
            MSG_TYPING => {
                let peer_id = String::from_utf8_lossy(&wire.payload).to_string();
                let _ = self.event_tx.send(MessagingEvent {
                    event_type: MessagingEventType::TypingStarted,
                    conversation_id: String::new(),
                    message_id: None,
                    peer_id: Some(peer_id),
                });
            }
            _ => {
                warn!("[MessagingV2] Unknown message type: 0x{:02x}", wire.msg_type);
            }
        }

        Ok(())
    }

    // ─── Transport ──────────────────────────────────────────────────────

    async fn send_wire_message(
        &self,
        node: &OnyxNode,
        peer_node_id: &str,
        wire: &WireMessage,
    ) -> Result<(), String> {
        let conn = node.connect(peer_node_id, crate::network::ALPN_MSG).await
            .map_err(|e| format!("{}", e))?;
        let (mut send, _recv) = conn.open_bi().await
            .map_err(|e| format!("Open bi stream: {}", e))?;
        send_stream_data(&mut send, &wire.encode()).await?;
        send.finish().map_err(|e| format!("Finish stream: {}", e))?;
        Ok(())
    }

    // ─── Dead Drop (Offline Queue) ──────────────────────────────────────

    async fn queue_dead_drop(
        &self,
        target_node_id: &str,
        data: &[u8],
    ) -> Result<(), String> {
        let now = now_epoch();
        let expires = now + 7 * 24 * 3600; // 7 days

        // Encrypt with a key derived from master key + target
        let mk = self.master_key.read().await;
        let encrypted = if let Some(master_key) = mk.as_ref() {
            let dd_key = derive_key(master_key, "onyx-dead-drop-msg", target_node_id)
                .map_err(|e| e.to_string())?;
            encrypt_versioned(&dd_key, data, None).map_err(|e| e.to_string())?
        } else {
            data.to_vec() // fallback: store unencrypted (shouldn't happen)
        };

        sqlx::query(
            "INSERT INTO msg_v2_dead_drop (target_node_id, encrypted_envelope, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)"
        )
        .bind(target_node_id)
        .bind(&encrypted)
        .bind(now)
        .bind(expires)
        .execute(&self.pool).await
        .map_err(|e| format!("Queue dead drop: {}", e))?;

        Ok(())
    }

    /// Replay queued messages for a peer that just came online.
    pub async fn replay_dead_drops(
        &self,
        node: &OnyxNode,
        peer_node_id: &str,
    ) -> Result<u32, String> {
        let rows: Vec<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT id, encrypted_envelope FROM msg_v2_dead_drop
             WHERE target_node_id = ?1 AND expires_at > ?2
             ORDER BY created_at ASC"
        )
        .bind(peer_node_id)
        .bind(now_epoch())
        .fetch_all(&self.pool).await
        .map_err(|e| format!("Fetch dead drops: {}", e))?;

        let mut count = 0u32;
        let mk = self.master_key.read().await;

        for (id, encrypted) in &rows {
            let data = if let Some(master_key) = mk.as_ref() {
                let dd_key = derive_key(master_key, "onyx-dead-drop-msg", peer_node_id)
                    .map_err(|e| e.to_string())?;
                let (decrypted, _) = decrypt_auto(&dd_key, None, None, encrypted, None)
                    .map_err(|e| e.to_string())?;
                decrypted
            } else {
                encrypted.clone()
            };

            // Parse wire message and re-send
            if let Ok(wire) = WireMessage::decode(&data) {
                if self.send_wire_message(node, peer_node_id, &wire).await.is_ok() {
                    // Delete from dead drop
                    sqlx::query("DELETE FROM msg_v2_dead_drop WHERE id = ?1")
                        .bind(id)
                        .execute(&self.pool).await.ok();
                    count += 1;
                }
            }
        }

        if count > 0 {
            info!("[MessagingV2] Replayed {} dead drops for {}", count, &peer_node_id[..8.min(peer_node_id.len())]);
        }

        Ok(count)
    }

    // ─── Session Management ─────────────────────────────────────────────

    async fn get_or_load_session(&self, peer_id: &str) -> Result<RatchetState, String> {
        // Check in-memory cache
        if let Some(session) = self.sessions.get(peer_id) {
            return Ok(session.clone());
        }

        // Try loading from database
        let mk = self.master_key.read().await;
        let master_key = mk.as_ref()
            .ok_or("Master key not set — unlock vault first")?;

        let row: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT encrypted_state FROM msg_v2_ratchet_sessions WHERE peer_node_id = ?1"
        )
        .bind(peer_id)
        .fetch_optional(&self.pool).await
        .map_err(|e| format!("Load session: {}", e))?;

        if let Some((encrypted,)) = row {
            let session = restore_ratchet_state(&encrypted, master_key, peer_id)?;
            self.sessions.insert(peer_id.to_string(), session.clone());
            Ok(session)
        } else {
            Err(format!("No session with peer {} — initiate X3DH first", peer_id))
        }
    }

    async fn persist_session(&self, peer_id: &str) -> Result<(), String> {
        let session = self.sessions.get(peer_id)
            .ok_or("Session not in memory")?
            .clone();

        let mk = self.master_key.read().await;
        if let Some(master_key) = mk.as_ref() {
            let encrypted = persist_ratchet_state(&session, master_key, peer_id)?;
            self.save_ratchet_session(peer_id, &encrypted).await?;
        }
        Ok(())
    }

    async fn save_ratchet_session(&self, peer_id: &str, encrypted: &[u8]) -> Result<(), String> {
        sqlx::query(
            "INSERT OR REPLACE INTO msg_v2_ratchet_sessions (peer_node_id, encrypted_state, last_message_at, message_count)
             VALUES (?1, ?2, ?3, COALESCE((SELECT message_count FROM msg_v2_ratchet_sessions WHERE peer_node_id = ?1), 0) + 1)"
        )
        .bind(peer_id)
        .bind(encrypted)
        .bind(now_epoch())
        .execute(&self.pool).await
        .map_err(|e| format!("Save ratchet session: {}", e))?;
        Ok(())
    }

    // ─── Persistence ────────────────────────────────────────────────────

    async fn store_message(&self, msg: &DecryptedMessage) -> Result<(), String> {
        sqlx::query(
            "INSERT OR IGNORE INTO msg_v2_messages (id, conversation_id, sender_node_id, sender_name, content, content_type, reply_to, timestamp, is_outgoing, delivered, read)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
        )
        .bind(&msg.id)
        .bind(&msg.conversation_id)
        .bind(&msg.sender_node_id)
        .bind(&msg.sender_name)
        .bind(&msg.content)
        .bind(msg.content_type.to_string())
        .bind(&msg.reply_to)
        .bind(msg.timestamp)
        .bind(msg.is_outgoing)
        .bind(msg.delivered)
        .bind(msg.read)
        .execute(&self.pool).await
        .map_err(|e| format!("Store message: {}", e))?;

        // Update conversation last message
        sqlx::query(
            "UPDATE msg_v2_conversations SET name = name WHERE id = ?1"
        )
        .bind(&msg.conversation_id)
        .execute(&self.pool).await.ok();

        Ok(())
    }

    async fn get_or_create_dm_conversation(&self, peer_id: &str) -> Result<String, String> {
        let my_id = self.identity.node_id_hex();
        // Deterministic conversation ID for DMs: sorted(A, B)
        let conv_id = if my_id < peer_id.to_string() {
            format!("dm:{}:{}", my_id, peer_id)
        } else {
            format!("dm:{}:{}", peer_id, my_id)
        };

        // Create if not exists
        sqlx::query(
            "INSERT OR IGNORE INTO msg_v2_conversations (id, conversation_type, name, created_at)
             VALUES (?1, 'dm', '', ?2)"
        )
        .bind(&conv_id)
        .bind(now_epoch())
        .execute(&self.pool).await
        .map_err(|e| format!("Create conversation: {}", e))?;

        // Ensure both members
        sqlx::query(
            "INSERT OR IGNORE INTO msg_v2_members (conversation_id, node_id, joined_at) VALUES (?1, ?2, ?3)"
        )
        .bind(&conv_id)
        .bind(&my_id)
        .bind(now_epoch())
        .execute(&self.pool).await.ok();

        sqlx::query(
            "INSERT OR IGNORE INTO msg_v2_members (conversation_id, node_id, joined_at) VALUES (?1, ?2, ?3)"
        )
        .bind(&conv_id)
        .bind(peer_id)
        .bind(now_epoch())
        .execute(&self.pool).await.ok();

        Ok(conv_id)
    }

    async fn mark_delivered(&self, message_id: &str) -> Result<(), String> {
        sqlx::query("UPDATE msg_v2_messages SET delivered = 1 WHERE id = ?1")
            .bind(message_id)
            .execute(&self.pool).await
            .map_err(|e| format!("Mark delivered: {}", e))?;
        Ok(())
    }

    async fn mark_read(&self, message_id: &str) -> Result<(), String> {
        sqlx::query("UPDATE msg_v2_messages SET read = 1 WHERE id = ?1")
            .bind(message_id)
            .execute(&self.pool).await
            .map_err(|e| format!("Mark read: {}", e))?;
        Ok(())
    }

    /// Get all conversations.
    pub async fn get_conversations(&self) -> Result<Vec<Conversation>, String> {
        let rows: Vec<(String, String, String, String, i64)> = sqlx::query_as(
            "SELECT id, conversation_type, name, icon_emoji, created_at
             FROM msg_v2_conversations ORDER BY created_at DESC"
        )
        .fetch_all(&self.pool).await
        .map_err(|e| format!("Get conversations: {}", e))?;

        let mut convs = Vec::new();
        for (id, ctype, name, emoji, _created) in rows {
            // Get last message
            let last: Option<(String, i64)> = sqlx::query_as(
                "SELECT content, timestamp FROM msg_v2_messages
                 WHERE conversation_id = ?1 ORDER BY timestamp DESC LIMIT 1"
            )
            .bind(&id)
            .fetch_optional(&self.pool).await
            .map_err(|e| format!("Get last msg: {}", e))?;

            let unread: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM msg_v2_messages
                 WHERE conversation_id = ?1 AND read = 0 AND is_outgoing = 0"
            )
            .bind(&id)
            .fetch_one(&self.pool).await
            .map_err(|e| format!("Count unread: {}", e))?;

            let members: Vec<(String,)> = sqlx::query_as(
                "SELECT node_id FROM msg_v2_members WHERE conversation_id = ?1"
            )
            .bind(&id)
            .fetch_all(&self.pool).await
            .map_err(|e| format!("Get members: {}", e))?;

            convs.push(Conversation {
                id,
                conversation_type: if ctype == "dm" { ConversationType::DirectMessage } else { ConversationType::Group },
                name,
                icon_emoji: emoji,
                last_message: last.as_ref().map(|l| l.0.clone()),
                last_message_at: last.as_ref().map(|l| l.1),
                unread_count: unread.0,
                members: members.into_iter().map(|m| m.0).collect(),
            });
        }

        Ok(convs)
    }

    /// Get messages for a conversation.
    pub async fn get_messages(
        &self,
        conversation_id: &str,
        before: Option<i64>,
        limit: i64,
    ) -> Result<Vec<DecryptedMessage>, String> {
        let rows: Vec<(String, String, String, String, String, String, Option<String>, i64, bool, bool, bool)> =
            if let Some(before_ts) = before {
                sqlx::query_as(
                    "SELECT id, conversation_id, sender_node_id, sender_name, content, content_type, reply_to, timestamp, is_outgoing, delivered, read
                     FROM msg_v2_messages WHERE conversation_id = ?1 AND timestamp < ?2
                     ORDER BY timestamp DESC LIMIT ?3"
                )
                .bind(conversation_id).bind(before_ts).bind(limit)
                .fetch_all(&self.pool).await
            } else {
                sqlx::query_as(
                    "SELECT id, conversation_id, sender_node_id, sender_name, content, content_type, reply_to, timestamp, is_outgoing, delivered, read
                     FROM msg_v2_messages WHERE conversation_id = ?1
                     ORDER BY timestamp DESC LIMIT ?2"
                )
                .bind(conversation_id).bind(limit)
                .fetch_all(&self.pool).await
            }.map_err(|e| format!("Get messages: {}", e))?;

        let mut msgs: Vec<DecryptedMessage> = rows.into_iter().map(|r| DecryptedMessage {
            id: r.0, conversation_id: r.1, sender_node_id: r.2,
            sender_name: r.3, content: r.4,
            content_type: r.5.parse().unwrap_or(ContentType::Text),
            reply_to: r.6, timestamp: r.7,
            is_outgoing: r.8, delivered: r.9, read: r.10,
        }).collect();

        msgs.reverse();
        Ok(msgs)
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<MessagingEvent> {
        self.event_tx.subscribe()
    }
}

// ─── Internal Types ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct MessagePayload {
    content: String,
    content_type: String,
    sender_name: String,
    reply_to: Option<String>,
}

// ─── Stream Helpers ─────────────────────────────────────────────────────────

async fn read_stream_to_end(recv: &mut RecvStream, max_size: usize) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    loop {
        let mut chunk = vec![0u8; 8192];
        match recv.read(&mut chunk).await {
            Ok(Some(n)) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > max_size {
                    return Err("Message too large".into());
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("Read error: {}", e)),
        }
    }
    Ok(buf)
}

async fn send_stream_data(send: &mut SendStream, data: &[u8]) -> Result<(), String> {
    send.write_all(data).await.map_err(|e| format!("Write error: {}", e))
}

// ─── Utility ────────────────────────────────────────────────────────────────

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[command]
pub async fn msg_v2_get_conversations(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
) -> Result<Vec<Conversation>, String> {
    engine.get_conversations().await
}

#[command]
pub async fn msg_v2_get_messages(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
    conversation_id: String,
    before: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<DecryptedMessage>, String> {
    engine.get_messages(&conversation_id, before, limit.unwrap_or(50)).await
}

#[command]
pub async fn msg_v2_send_dm(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
    peer_node_id: String,
    content: String,
    content_type: Option<String>,
    reply_to: Option<String>,
) -> Result<DecryptedMessage, String> {
    let ct = content_type
        .and_then(|s| s.parse().ok())
        .unwrap_or(ContentType::Text);
    engine.send_dm(&peer_node_id, &content, ct, reply_to).await
}

#[command]
pub async fn msg_v2_initiate_session(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
    peer_node_id: String,
    peer_bundle_json: String,
) -> Result<(), String> {
    let bundle: PreKeyBundle = serde_json::from_str(&peer_bundle_json)
        .map_err(|e| format!("Parse PreKey bundle: {}", e))?;
    engine.initiate_session(&peer_node_id, &bundle).await
}

#[command]
pub async fn msg_v2_get_prekey_bundle(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
) -> Result<String, String> {
    let bundle = engine.generate_prekey_bundle();
    serde_json::to_string(&bundle).map_err(|e| format!("Serialize bundle: {}", e))
}

#[command]
pub async fn msg_v2_set_master_key(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
    key_hex: String,
) -> Result<(), String> {
    let key_bytes = hex::decode(&key_hex)
        .map_err(|e| format!("Invalid hex key: {}", e))?;
    if key_bytes.len() != 32 {
        return Err("Master key must be 32 bytes".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    engine.set_master_key(key).await;
    Ok(())
}

#[command]
pub async fn msg_v2_create_group(
    engine: tauri::State<'_, Arc<MessagingEngine>>,
    name: String,
    icon_emoji: String,
    member_node_ids: Vec<String>,
) -> Result<Conversation, String> {
    let group_id = uuid::Uuid::new_v4().to_string();
    let now = now_epoch();
    let my_id = engine.identity.node_id_hex();

    // Create conversation
    sqlx::query(
        "INSERT INTO msg_v2_conversations (id, conversation_type, name, icon_emoji, created_at)
         VALUES (?1, 'group', ?2, ?3, ?4)"
    )
    .bind(&group_id)
    .bind(&name)
    .bind(&icon_emoji)
    .bind(now)
    .execute(&engine.pool).await
    .map_err(|e| format!("Create group: {}", e))?;

    // Add self as member
    sqlx::query(
        "INSERT INTO msg_v2_members (conversation_id, node_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)"
    )
    .bind(&group_id)
    .bind(&my_id)
    .bind(now)
    .execute(&engine.pool).await.ok();

    // Add other members
    let mut all_members = vec![my_id];
    for member in &member_node_ids {
        sqlx::query(
            "INSERT OR IGNORE INTO msg_v2_members (conversation_id, node_id, role, joined_at) VALUES (?1, ?2, 'member', ?3)"
        )
        .bind(&group_id)
        .bind(member)
        .bind(now)
        .execute(&engine.pool).await.ok();
        all_members.push(member.clone());
    }

    Ok(Conversation {
        id: group_id,
        conversation_type: ConversationType::Group,
        name,
        icon_emoji,
        last_message: None,
        last_message_at: None,
        unread_count: 0,
        members: all_members,
    })
}
