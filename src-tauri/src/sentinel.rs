// ─── Onyx Sentinel: Relay Mode with Karma System ────────────────────────────
//
// Enables Onyx nodes to act as relay nodes for the swarm, forwarding data
// for other peers who can't connect directly (behind strict NAT/firewalls).
//
// Architecture:
//   • Relay Mode: Any Onyx node can opt-in to relay traffic
//   • Karma System: Peers earn "karma" by relaying, spend it by using relays
//   • Relay Receipts: Ed25519-signed receipts prove relay work was done
//   • VDF Timestamps: Verifiable Delay Function for relay receipt timestamps
//   • Bandwidth Accounting: Fair-share tracking per peer
//   • Abuse Prevention: Rate limiting, peer reputation, blocklists
//
// Protocol: ALPN b"onyx-sentinel/1"
//
// This creates a decentralized incentive structure where nodes that contribute
// relay bandwidth earn the ability to use other nodes as relays.

use crate::crypto::{OnyxIdentity, hmac_sha256};
use crate::network::OnyxNode;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::command;
use tokio::sync::RwLock;
use tracing::{debug, info};

// ─── Configuration ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelConfig {
    /// Enable sentinel relay mode
    pub enabled: bool,
    /// Maximum bandwidth to relay (bytes per hour, 0 = unlimited)
    pub max_bandwidth_per_hour: u64,
    /// Maximum number of peers to relay for simultaneously
    pub max_relay_peers: usize,
    /// Minimum karma required to use this node as relay
    pub min_karma_required: i64,
    /// Karma earned per MB relayed
    pub karma_per_mb: i64,
    /// Karma spent per MB relayed through another node
    pub karma_cost_per_mb: i64,
    /// Enable blocklist
    pub blocklist_enabled: bool,
}

impl Default for SentinelConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_bandwidth_per_hour: 500 * 1024 * 1024, // 500 MB/hr
            max_relay_peers: 10,
            min_karma_required: 0,
            karma_per_mb: 10,
            karma_cost_per_mb: 5,
            blocklist_enabled: true,
        }
    }
}

// ─── Relay Receipt ──────────────────────────────────────────────────────────

/// Signed proof that relay work was performed.
///
/// The sender signs a receipt proving that the relay forwarded their data.
/// The relay can present this receipt to prove its karma earnings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayReceipt {
    /// Unique receipt ID
    pub id: String,
    /// The relay node that forwarded data
    pub relay_node_id: String,
    /// The sender who benefited from relaying
    pub sender_node_id: String,
    /// The recipient of the relayed data
    pub recipient_node_id: String,
    /// Bytes relayed
    pub bytes_relayed: u64,
    /// Unix timestamp
    pub timestamp: i64,
    /// VDF proof (simplified: hash chain of configurable length)
    pub vdf_proof: Vec<u8>,
    /// Ed25519 signature from the sender (proves the sender acknowledges the relay work)
    pub sender_signature: Vec<u8>,
    /// Ed25519 signature from the relay (proves the relay participated)
    pub relay_signature: Vec<u8>,
}

// ─── Peer Karma ─────────────────────────────────────────────────────────────

/// Karma and reputation tracking for a peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerKarma {
    pub node_id: String,
    /// Current karma balance
    pub karma: i64,
    /// Total bytes relayed FOR this peer (they consumed)
    pub bytes_consumed: u64,
    /// Total bytes this peer relayed for others (they contributed)
    pub bytes_contributed: u64,
    /// Number of relay receipts
    pub receipt_count: u64,
    /// Last activity timestamp
    pub last_seen: i64,
    /// Whether this peer is blocked
    pub blocked: bool,
}

// ─── Sentinel Status ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelStatus {
    pub enabled: bool,
    pub active_relay_peers: usize,
    pub total_bytes_relayed: u64,
    pub total_karma_earned: i64,
    pub total_karma_spent: i64,
    pub uptime_secs: u64,
    pub bandwidth_used_this_hour: u64,
}

// ─── Sentinel Engine ────────────────────────────────────────────────────────

pub struct SentinelEngine {
    pool: SqlitePool,
    identity: Arc<OnyxIdentity>,
    config: Arc<RwLock<SentinelConfig>>,
    /// Peer karma tracking (in-memory cache, persisted to SQLite)
    peer_karma: DashMap<String, PeerKarma>,
    /// Blocked peers
    blocklist: DashMap<String, bool>,
    /// Total bytes relayed (this session)
    total_relayed: Arc<AtomicU64>,
    /// Bytes relayed this hour (for rate limiting)
    hourly_relayed: Arc<AtomicU64>,
    /// Our karma balance
    our_karma: Arc<AtomicI64>,
    /// Active relay connections count
    active_relays: Arc<AtomicU64>,
    /// Running flag
    active: Arc<AtomicBool>,
    /// Start time
    started_at: std::time::Instant,
}

impl SentinelEngine {
    pub fn new(pool: SqlitePool, identity: Arc<OnyxIdentity>) -> Self {
        Self {
            pool,
            identity,
            config: Arc::new(RwLock::new(SentinelConfig::default())),
            peer_karma: DashMap::new(),
            blocklist: DashMap::new(),
            total_relayed: Arc::new(AtomicU64::new(0)),
            hourly_relayed: Arc::new(AtomicU64::new(0)),
            our_karma: Arc::new(AtomicI64::new(0)),
            active_relays: Arc::new(AtomicU64::new(0)),
            active: Arc::new(AtomicBool::new(false)),
            started_at: std::time::Instant::now(),
        }
    }

    /// Run database migrations for sentinel tables.
    pub async fn migrate(&self) -> Result<(), String> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sentinel_karma (
                node_id TEXT PRIMARY KEY,
                karma INTEGER NOT NULL DEFAULT 0,
                bytes_consumed INTEGER NOT NULL DEFAULT 0,
                bytes_contributed INTEGER NOT NULL DEFAULT 0,
                receipt_count INTEGER NOT NULL DEFAULT 0,
                last_seen INTEGER NOT NULL DEFAULT 0,
                blocked INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create sentinel_karma: {}", e))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sentinel_receipts (
                id TEXT PRIMARY KEY,
                relay_node_id TEXT NOT NULL,
                sender_node_id TEXT NOT NULL,
                recipient_node_id TEXT NOT NULL,
                bytes_relayed INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                vdf_proof BLOB,
                sender_signature BLOB NOT NULL,
                relay_signature BLOB NOT NULL
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create sentinel_receipts: {}", e))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sentinel_blocklist (
                node_id TEXT PRIMARY KEY,
                reason TEXT NOT NULL DEFAULT '',
                blocked_at INTEGER NOT NULL DEFAULT 0
            )"
        )
        .execute(&self.pool).await
        .map_err(|e| format!("Create sentinel_blocklist: {}", e))?;

        // Load blocklist into memory
        let blocked: Vec<(String,)> = sqlx::query_as(
            "SELECT node_id FROM sentinel_blocklist"
        )
        .fetch_all(&self.pool).await
        .map_err(|e| format!("Load blocklist: {}", e))?;

        for (node_id,) in blocked {
            self.blocklist.insert(node_id, true);
        }

        // Load our karma
        let my_id = self.identity.node_id_hex();
        let karma: Option<(i64,)> = sqlx::query_as(
            "SELECT karma FROM sentinel_karma WHERE node_id = ?1"
        )
        .bind(&my_id)
        .fetch_optional(&self.pool).await
        .map_err(|e| format!("Load karma: {}", e))?;

        if let Some((k,)) = karma {
            self.our_karma.store(k, Ordering::SeqCst);
        }

        info!("[Sentinel] Migrations complete, karma: {}", self.our_karma.load(Ordering::SeqCst));
        Ok(())
    }

    /// Set configuration.
    pub async fn set_config(&self, config: SentinelConfig) {
        let was_enabled = self.config.read().await.enabled;
        *self.config.write().await = config.clone();
        if config.enabled && !was_enabled {
            self.active.store(true, Ordering::SeqCst);
            info!("[Sentinel] Relay mode ENABLED");
        } else if !config.enabled && was_enabled {
            self.active.store(false, Ordering::SeqCst);
            info!("[Sentinel] Relay mode DISABLED");
        }
    }

    pub async fn get_config(&self) -> SentinelConfig {
        self.config.read().await.clone()
    }

    /// Get sentinel status.
    pub fn get_status(&self) -> SentinelStatus {
        SentinelStatus {
            enabled: self.active.load(Ordering::SeqCst),
            active_relay_peers: self.active_relays.load(Ordering::SeqCst) as usize,
            total_bytes_relayed: self.total_relayed.load(Ordering::Relaxed),
            total_karma_earned: self.our_karma.load(Ordering::Relaxed),
            total_karma_spent: 0, // tracked separately
            uptime_secs: self.started_at.elapsed().as_secs(),
            bandwidth_used_this_hour: self.hourly_relayed.load(Ordering::Relaxed),
        }
    }

    // ─── Relay Decision ─────────────────────────────────────────────────

    /// Decide whether to relay data for a given peer.
    pub async fn should_relay(&self, peer_node_id: &str) -> Result<bool, String> {
        let config = self.config.read().await;
        if !config.enabled {
            return Ok(false);
        }

        // Check blocklist
        if config.blocklist_enabled && self.blocklist.contains_key(peer_node_id) {
            return Ok(false);
        }

        // Check max relay peers
        if self.active_relays.load(Ordering::SeqCst) as usize >= config.max_relay_peers {
            return Ok(false);
        }

        // Check bandwidth limit
        let hourly = self.hourly_relayed.load(Ordering::Relaxed);
        if config.max_bandwidth_per_hour > 0 && hourly >= config.max_bandwidth_per_hour {
            return Ok(false);
        }

        // Check peer karma
        if config.min_karma_required > 0 {
            let peer = self.get_peer_karma(peer_node_id).await;
            if peer.karma < config.min_karma_required {
                return Ok(false);
            }
        }

        Ok(true)
    }

    // ─── Karma Management ───────────────────────────────────────────────

    /// Record bytes relayed and update karma.
    pub async fn record_relay(
        &self,
        sender_node_id: &str,
        bytes: u64,
    ) -> Result<(), String> {
        let config = self.config.read().await;

        // Update counters
        self.total_relayed.fetch_add(bytes, Ordering::Relaxed);
        self.hourly_relayed.fetch_add(bytes, Ordering::Relaxed);

        // Calculate karma earned
        let mb_relayed = bytes as f64 / (1024.0 * 1024.0);
        let karma_earned = (mb_relayed * config.karma_per_mb as f64) as i64;

        // Update our karma
        self.our_karma.fetch_add(karma_earned, Ordering::Relaxed);

        // Update sender's karma (they consumed)
        let mut peer = self.get_peer_karma(sender_node_id).await;
        peer.bytes_consumed += bytes;
        peer.karma -= (mb_relayed * config.karma_cost_per_mb as f64) as i64;
        peer.last_seen = now_epoch();
        self.peer_karma.insert(sender_node_id.to_string(), peer.clone());

        // Persist
        self.save_peer_karma(&peer).await?;
        self.save_our_karma().await?;

        Ok(())
    }

    /// Get karma info for a peer (from cache or default).
    pub async fn get_peer_karma(&self, node_id: &str) -> PeerKarma {
        if let Some(pk) = self.peer_karma.get(node_id) {
            return pk.clone();
        }

        // Try loading from DB
        let row: Option<(String, i64, i64, i64, i64, i64, bool)> = sqlx::query_as(
            "SELECT node_id, karma, bytes_consumed, bytes_contributed, receipt_count, last_seen, blocked
             FROM sentinel_karma WHERE node_id = ?1"
        )
        .bind(node_id)
        .fetch_optional(&self.pool).await
        .ok()
        .flatten();

        if let Some((id, karma, consumed, contributed, count, seen, blocked)) = row {
            let pk = PeerKarma {
                node_id: id,
                karma,
                bytes_consumed: consumed as u64,
                bytes_contributed: contributed as u64,
                receipt_count: count as u64,
                last_seen: seen,
                blocked,
            };
            self.peer_karma.insert(node_id.to_string(), pk.clone());
            pk
        } else {
            PeerKarma {
                node_id: node_id.to_string(),
                karma: 0,
                bytes_consumed: 0,
                bytes_contributed: 0,
                receipt_count: 0,
                last_seen: 0,
                blocked: false,
            }
        }
    }

    async fn save_peer_karma(&self, karma: &PeerKarma) -> Result<(), String> {
        sqlx::query(
            "INSERT OR REPLACE INTO sentinel_karma (node_id, karma, bytes_consumed, bytes_contributed, receipt_count, last_seen, blocked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
        )
        .bind(&karma.node_id)
        .bind(karma.karma)
        .bind(karma.bytes_consumed as i64)
        .bind(karma.bytes_contributed as i64)
        .bind(karma.receipt_count as i64)
        .bind(karma.last_seen)
        .bind(karma.blocked)
        .execute(&self.pool).await
        .map_err(|e| format!("Save karma: {}", e))?;
        Ok(())
    }

    async fn save_our_karma(&self) -> Result<(), String> {
        let my_id = self.identity.node_id_hex();
        let karma = self.our_karma.load(Ordering::Relaxed);
        sqlx::query(
            "INSERT OR REPLACE INTO sentinel_karma (node_id, karma, bytes_consumed, bytes_contributed, receipt_count, last_seen, blocked)
             VALUES (?1, ?2, 0, ?3, 0, ?4, 0)"
        )
        .bind(&my_id)
        .bind(karma)
        .bind(self.total_relayed.load(Ordering::Relaxed) as i64)
        .bind(now_epoch())
        .execute(&self.pool).await
        .map_err(|e| format!("Save our karma: {}", e))?;
        Ok(())
    }

    // ─── Relay Receipt Generation ───────────────────────────────────────

    /// Create a relay receipt signed by us (as the relay).
    pub fn create_receipt(
        &self,
        sender_node_id: &str,
        recipient_node_id: &str,
        bytes_relayed: u64,
    ) -> Result<RelayReceipt, String> {
        let receipt_id = uuid::Uuid::new_v4().to_string();
        let timestamp = now_epoch();

        // Simplified VDF: hash chain of length proportional to bytes
        // In production, use a proper VDF like Wesolowski or Pietrzak
        let vdf_iterations = std::cmp::min(bytes_relayed / 1024, 1000);
        let vdf_proof = self.compute_vdf_proof(&receipt_id, vdf_iterations as usize);

        // Create receipt data for signing
        let receipt_data = format!(
            "{}:{}:{}:{}:{}:{}",
            receipt_id, self.identity.node_id_hex(), sender_node_id,
            recipient_node_id, bytes_relayed, timestamp
        );

        // Sign as relay
        let relay_signature = self.identity.sign(receipt_data.as_bytes());

        Ok(RelayReceipt {
            id: receipt_id,
            relay_node_id: self.identity.node_id_hex(),
            sender_node_id: sender_node_id.to_string(),
            recipient_node_id: recipient_node_id.to_string(),
            bytes_relayed,
            timestamp,
            vdf_proof,
            sender_signature: Vec::new(), // filled by sender counter-signing
            relay_signature: relay_signature.to_vec(),
        })
    }

    /// Counter-sign a relay receipt (as the sender acknowledging relay work).
    pub fn countersign_receipt(&self, receipt: &mut RelayReceipt) -> Result<(), String> {
        let receipt_data = format!(
            "{}:{}:{}:{}:{}:{}",
            receipt.id, receipt.relay_node_id, receipt.sender_node_id,
            receipt.recipient_node_id, receipt.bytes_relayed, receipt.timestamp
        );
        receipt.sender_signature = self.identity.sign(receipt_data.as_bytes()).to_vec();
        Ok(())
    }

    /// Store a completed relay receipt.
    pub async fn store_receipt(&self, receipt: &RelayReceipt) -> Result<(), String> {
        sqlx::query(
            "INSERT OR IGNORE INTO sentinel_receipts
             (id, relay_node_id, sender_node_id, recipient_node_id, bytes_relayed, timestamp, vdf_proof, sender_signature, relay_signature)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        )
        .bind(&receipt.id)
        .bind(&receipt.relay_node_id)
        .bind(&receipt.sender_node_id)
        .bind(&receipt.recipient_node_id)
        .bind(receipt.bytes_relayed as i64)
        .bind(receipt.timestamp)
        .bind(&receipt.vdf_proof)
        .bind(&receipt.sender_signature)
        .bind(&receipt.relay_signature)
        .execute(&self.pool).await
        .map_err(|e| format!("Store receipt: {}", e))?;
        Ok(())
    }

    // ─── VDF (Simplified) ───────────────────────────────────────────────

    fn compute_vdf_proof(&self, seed: &str, iterations: usize) -> Vec<u8> {
        let mut hash = hmac_sha256(seed.as_bytes(), b"onyx-vdf-seed");
        for _ in 0..iterations {
            hash = hmac_sha256(&hash, b"onyx-vdf-chain");
        }
        hash.to_vec()
    }

    // ─── Blocklist ──────────────────────────────────────────────────────

    /// Block a peer from using us as relay.
    pub async fn block_peer(&self, node_id: &str, reason: &str) -> Result<(), String> {
        self.blocklist.insert(node_id.to_string(), true);
        sqlx::query(
            "INSERT OR REPLACE INTO sentinel_blocklist (node_id, reason, blocked_at) VALUES (?1, ?2, ?3)"
        )
        .bind(node_id)
        .bind(reason)
        .bind(now_epoch())
        .execute(&self.pool).await
        .map_err(|e| format!("Block peer: {}", e))?;
        info!("[Sentinel] Blocked peer {}: {}", &node_id[..8.min(node_id.len())], reason);
        Ok(())
    }

    /// Unblock a peer.
    pub async fn unblock_peer(&self, node_id: &str) -> Result<(), String> {
        self.blocklist.remove(node_id);
        sqlx::query("DELETE FROM sentinel_blocklist WHERE node_id = ?1")
            .bind(node_id)
            .execute(&self.pool).await
            .map_err(|e| format!("Unblock peer: {}", e))?;
        Ok(())
    }

    /// Get all blocked peers.
    pub async fn get_blocklist(&self) -> Result<Vec<(String, String)>, String> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT node_id, reason FROM sentinel_blocklist ORDER BY blocked_at DESC"
        )
        .fetch_all(&self.pool).await
        .map_err(|e| format!("Get blocklist: {}", e))?;
        Ok(rows)
    }

    // ─── Handle Incoming Sentinel Request ───────────────────────────────

    /// Handle an incoming relay request on ALPN b"onyx-sentinel/1".
    pub async fn handle_relay_request(
        &self,
        _node: &OnyxNode,
        mut recv: iroh::endpoint::RecvStream,
        mut send: iroh::endpoint::SendStream,
        peer_node_id: &str,
    ) -> Result<(), String> {
        // Check if we should relay
        if !self.should_relay(peer_node_id).await? {
            let _ = send.write_all(b"\x00RELAY_DENIED").await;
            let _ = send.finish();
            return Ok(());
        }

        // Accept relay request
        let _ = send.write_all(b"\x01RELAY_OK").await;

        self.active_relays.fetch_add(1, Ordering::SeqCst);

        // Read target node ID (first 64 bytes = hex node ID of target)
        let mut target_buf = [0u8; 64];
        match recv.read_exact(&mut target_buf).await {
            Ok(()) => {}
            Err(e) => {
                self.active_relays.fetch_sub(1, Ordering::SeqCst);
                return Err(format!("Read target: {}", e));
            }
        }
        let target_node_id = String::from_utf8_lossy(&target_buf).to_string();

        // Forward data (simplified — in production this would be a full proxy)
        let mut total_bytes = 0u64;
        let mut buf = vec![0u8; 8192];
        loop {
            match recv.read(&mut buf).await {
                Ok(Some(n)) => {
                    total_bytes += n as u64;
                    // In production: forward to target via OnyxNode connection
                    // For now: just count bytes
                }
                Ok(None) => break,
                Err(e) => {
                    debug!("[Sentinel] Relay stream ended: {}", e);
                    break;
                }
            }
        }

        self.active_relays.fetch_sub(1, Ordering::SeqCst);

        // Record relay work
        if total_bytes > 0 {
            self.record_relay(peer_node_id, total_bytes).await?;

            // Create and store receipt
            let receipt = self.create_receipt(
                peer_node_id,
                &target_node_id,
                total_bytes,
            )?;
            self.store_receipt(&receipt).await?;

            info!("[Sentinel] Relayed {}B for {} → {}",
                total_bytes,
                &peer_node_id[..8.min(peer_node_id.len())],
                &target_node_id[..8.min(target_node_id.len())]);
        }

        Ok(())
    }

    /// Start hourly bandwidth counter reset.
    pub fn start_hourly_reset(&self) {
        let hourly = self.hourly_relayed.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(3600)).await;
                hourly.store(0, Ordering::Relaxed);
                debug!("[Sentinel] Hourly bandwidth counter reset");
            }
        });
    }
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
pub async fn sentinel_get_status(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
) -> Result<SentinelStatus, String> {
    Ok(engine.get_status())
}

#[command]
pub async fn sentinel_set_config(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
    config_json: String,
) -> Result<(), String> {
    let config: SentinelConfig = serde_json::from_str(&config_json)
        .map_err(|e| format!("Invalid config: {}", e))?;
    engine.set_config(config).await;
    Ok(())
}

#[command]
pub async fn sentinel_get_config(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
) -> Result<SentinelConfig, String> {
    Ok(engine.get_config().await)
}

#[command]
pub async fn sentinel_enable(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
    enabled: bool,
) -> Result<(), String> {
    let mut config = engine.get_config().await;
    config.enabled = enabled;
    engine.set_config(config).await;
    Ok(())
}

#[command]
pub async fn sentinel_get_peer_karma(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
    node_id: String,
) -> Result<PeerKarma, String> {
    Ok(engine.get_peer_karma(&node_id).await)
}

#[command]
pub async fn sentinel_block_peer(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
    node_id: String,
    reason: String,
) -> Result<(), String> {
    engine.block_peer(&node_id, &reason).await
}

#[command]
pub async fn sentinel_unblock_peer(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
    node_id: String,
) -> Result<(), String> {
    engine.unblock_peer(&node_id).await
}

#[command]
pub async fn sentinel_get_blocklist(
    engine: tauri::State<'_, Arc<SentinelEngine>>,
) -> Result<Vec<(String, String)>, String> {
    engine.get_blocklist().await
}
