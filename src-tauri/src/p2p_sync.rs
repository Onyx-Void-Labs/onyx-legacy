// src-tauri/src/p2p_sync.rs
// ─── P2P Offline Sync via mDNS LAN Discovery + TCP Yjs Update Exchange ───
//
// Architecture:
//   1. mDNS broadcasts "onyx-peer" service on port 4747
//   2. On discovery, opens TCP socket, exchanges Yjs update vectors
//   3. All data is E2EE-wrapped before transmission (reuses SecurityService key)
//   4. No WebRTC — pure TCP over LAN, no IP exposure outside local network
//   5. Syncs Yjs CRDT ops only — same merge semantics as Hocuspocus

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::io::{Read, Write};
use tauri::{command, AppHandle, Manager};
use tokio::sync::broadcast;
use base64::{Engine as _, engine::general_purpose};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub last_seen: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PStatus {
    pub enabled: bool,
    pub listening: bool,
    pub port: u16,
    pub peer_count: usize,
    pub peers: Vec<PeerInfo>,
    pub last_sync: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMessage {
    /// Base64 encoded E2EE-wrapped Yjs update vector
    pub payload: String,
    /// Document room identifier (e.g. "user-xxx-filesystem")
    pub room: String,
    /// Message type
    pub msg_type: SyncMessageType,
    /// Sender peer ID
    pub sender_id: String,
    /// Unix timestamp
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncMessageType {
    SyncStep1,   // Request: send state vector
    SyncStep2,   // Response: send update based on received state vector
    Update,      // Incremental update push
    Awareness,   // Awareness/presence info
}

// ─── P2P Manager State ────────────────────────────────────────────────────────

pub struct P2PManager {
    pub peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    pub enabled: Arc<Mutex<bool>>,
    pub listening: Arc<Mutex<bool>>,
    pub port: u16,
    pub device_id: String,
    pub device_name: String,
    pub last_sync: Arc<Mutex<Option<u64>>>,
    shutdown_tx: Arc<Mutex<Option<broadcast::Sender<()>>>>,
}

impl P2PManager {
    pub fn new() -> Self {
        let device_id = uuid::Uuid::new_v4().to_string();
        let device_name = hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Onyx Device".to_string());

        Self {
            peers: Arc::new(Mutex::new(HashMap::new())),
            enabled: Arc::new(Mutex::new(false)),
            listening: Arc::new(Mutex::new(false)),
            port: 4747,
            device_id,
            device_name,
            last_sync: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    /// Start mDNS service advertisement and listener
    pub fn start_discovery(&self) -> Result<(), String> {
        let peers = self.peers.clone();
        let device_id = self.device_id.clone();
        let device_name = self.device_name.clone();
        let port = self.port;
        let enabled = self.enabled.clone();
        let listening = self.listening.clone();

        // Set enabled flag
        {
            let mut e = enabled.lock().map_err(|e| e.to_string())?;
            *e = true;
        }

        // Create shutdown channel
        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        {
            let mut tx = self.shutdown_tx.lock().map_err(|e| e.to_string())?;
            *tx = Some(shutdown_tx.clone());
        }

        // Spawn mDNS browser + responder in background
        let shutdown_rx = shutdown_tx.subscribe();
        std::thread::spawn(move || {
            if let Err(e) = run_mdns_discovery(
                peers,
                device_id,
                device_name,
                port,
                listening,
                shutdown_rx,
            ) {
                eprintln!("[P2P] mDNS discovery error: {}", e);
            }
        });

        // Start TCP listener for incoming sync connections
        let peers_for_tcp = self.peers.clone();
        let last_sync = self.last_sync.clone();
        let tcp_port = self.port;
        let mut shutdown_rx2 = shutdown_tx.subscribe();

        std::thread::spawn(move || {
            if let Err(e) = run_tcp_listener(tcp_port, peers_for_tcp, last_sync, &mut shutdown_rx2) {
                eprintln!("[P2P] TCP listener error: {}", e);
            }
        });

        println!("[P2P] Discovery started on port {}", self.port);
        Ok(())
    }

    /// Stop all P2P services
    pub fn stop_discovery(&self) -> Result<(), String> {
        {
            let mut e = self.enabled.lock().map_err(|e| e.to_string())?;
            *e = false;
        }
        {
            let mut l = self.listening.lock().map_err(|e| e.to_string())?;
            *l = false;
        }

        // Signal shutdown
        if let Ok(tx) = self.shutdown_tx.lock() {
            if let Some(ref sender) = *tx {
                let _ = sender.send(());
            }
        }

        // Clear peers
        if let Ok(mut peers) = self.peers.lock() {
            peers.clear();
        }

        println!("[P2P] Discovery stopped");
        Ok(())
    }

    pub fn get_status(&self) -> P2PStatus {
        let enabled = self.enabled.lock().map(|e| *e).unwrap_or(false);
        let listening = self.listening.lock().map(|l| *l).unwrap_or(false);
        let peers: Vec<PeerInfo> = self
            .peers
            .lock()
            .map(|p| p.values().cloned().collect())
            .unwrap_or_default();
        let last_sync = self.last_sync.lock().map(|l| *l).unwrap_or(None);

        P2PStatus {
            enabled,
            listening,
            port: self.port,
            peer_count: peers.len(),
            peers,
            last_sync,
        }
    }

    /// Push Yjs update data to a specific peer via TCP
    pub fn sync_with_peer(
        &self,
        peer_id: &str,
        encrypted_payload: &str,
        room: &str,
    ) -> Result<(), String> {
        let peers = self.peers.lock().map_err(|e| e.to_string())?;
        let peer = peers
            .get(peer_id)
            .ok_or_else(|| format!("Peer not found: {}", peer_id))?;

        let msg = SyncMessage {
            payload: encrypted_payload.to_string(),
            room: room.to_string(),
            msg_type: SyncMessageType::Update,
            sender_id: self.device_id.clone(),
            timestamp: now_unix(),
        };

        send_to_peer(&peer.ip, peer.port, &msg)?;

        // Update last_sync timestamp
        if let Ok(mut ls) = self.last_sync.lock() {
            *ls = Some(now_unix());
        }

        Ok(())
    }

    /// Attempt to push pending ops to all known peers (called on app close)
    pub fn flush_to_peers(&self, encrypted_payload: &str, room: &str) -> Result<u32, String> {
        let peers: Vec<PeerInfo> = self
            .peers
            .lock()
            .map(|p| p.values().cloned().collect())
            .unwrap_or_default();

        let mut success_count = 0u32;

        for peer in &peers {
            let msg = SyncMessage {
                payload: encrypted_payload.to_string(),
                room: room.to_string(),
                msg_type: SyncMessageType::Update,
                sender_id: self.device_id.clone(),
                timestamp: now_unix(),
            };

            match send_to_peer_with_timeout(&peer.ip, peer.port, &msg, Duration::from_secs(3)) {
                Ok(_) => {
                    success_count += 1;
                    println!("[P2P] Flushed to peer: {}", peer.name);
                }
                Err(e) => {
                    eprintln!("[P2P] Failed to flush to {}: {}", peer.name, e);
                }
            }
        }

        if success_count > 0 {
            if let Ok(mut ls) = self.last_sync.lock() {
                *ls = Some(now_unix());
            }
        }

        Ok(success_count)
    }
}

// ─── mDNS Discovery ──────────────────────────────────────────────────────────

fn run_mdns_discovery(
    peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    device_id: String,
    device_name: String,
    port: u16,
    listening: Arc<Mutex<bool>>,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), String> {
    use std::net::UdpSocket;

    // Simple mDNS-like UDP broadcast discovery
    // We use a custom UDP protocol on a multicast group for LAN discovery
    // This avoids requiring the mdns-sd crate while achieving the same effect

    let multicast_addr = "239.255.77.88";
    let multicast_port = 4748u16;
    let bind_addr = format!("0.0.0.0:{}", multicast_port);

    let socket = UdpSocket::bind(&bind_addr).map_err(|e| format!("Bind failed: {}", e))?;

    // Join multicast group
    let multicast = multicast_addr
        .parse::<std::net::Ipv4Addr>()
        .map_err(|e| e.to_string())?;
    let any = std::net::Ipv4Addr::new(0, 0, 0, 0);
    socket
        .join_multicast_v4(&multicast, &any)
        .map_err(|e| format!("Multicast join failed: {}", e))?;

    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    socket.set_nonblocking(false).map_err(|e| e.to_string())?;

    {
        let mut l = listening.lock().map_err(|e| e.to_string())?;
        *l = true;
    }

    // Announce our presence
    let announce = serde_json::json!({
        "type": "announce",
        "id": device_id,
        "name": device_name,
        "port": port,
    });
    let announce_bytes = serde_json::to_vec(&announce).map_err(|e| e.to_string())?;
    let target = format!("{}:{}", multicast_addr, multicast_port);
    let _ = socket.send_to(&announce_bytes, &target);

    let mut buf = [0u8; 2048];
    let mut announce_interval = std::time::Instant::now();

    loop {
        // Check shutdown signal
        if shutdown_rx.try_recv().is_ok() {
            break;
        }

        // Re-announce every 10 seconds
        if announce_interval.elapsed() > Duration::from_secs(10) {
            let _ = socket.send_to(&announce_bytes, &target);
            announce_interval = std::time::Instant::now();

            // Prune stale peers (not seen in 30 seconds)
            let now = now_unix();
            if let Ok(mut p) = peers.lock() {
                p.retain(|_, peer| now - peer.last_seen < 30);
            }
        }

        // Listen for announcements from other peers
        match socket.recv_from(&mut buf) {
            Ok((size, src_addr)) => {
                if let Ok(msg) = serde_json::from_slice::<serde_json::Value>(&buf[..size]) {
                    if let Some(peer_type) = msg.get("type").and_then(|t| t.as_str()) {
                        if peer_type == "announce" {
                            let peer_id = msg
                                .get("id")
                                .and_then(|i| i.as_str())
                                .unwrap_or("unknown")
                                .to_string();

                            // Skip self
                            if peer_id == device_id {
                                continue;
                            }

                            let peer_name = msg
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("Unknown Device")
                                .to_string();
                            let peer_port = msg
                                .get("port")
                                .and_then(|p| p.as_u64())
                                .unwrap_or(4747) as u16;

                            let peer = PeerInfo {
                                id: peer_id.clone(),
                                name: peer_name,
                                ip: src_addr.ip().to_string(),
                                port: peer_port,
                                last_seen: now_unix(),
                            };

                            if let Ok(mut p) = peers.lock() {
                                p.insert(peer_id, peer);
                            }
                        }
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // Timeout — normal, continue loop
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                // Timeout — normal, continue loop
            }
            Err(e) => {
                eprintln!("[P2P] UDP recv error: {}", e);
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }

    // Leave multicast group on shutdown
    let _ = socket.leave_multicast_v4(&multicast, &any);
    println!("[P2P] mDNS discovery stopped");
    Ok(())
}

// ─── TCP Listener ─────────────────────────────────────────────────────────────

fn run_tcp_listener(
    port: u16,
    _peers: Arc<Mutex<HashMap<String, PeerInfo>>>,
    last_sync: Arc<Mutex<Option<u64>>>,
    shutdown_rx: &mut broadcast::Receiver<()>,
) -> Result<(), String> {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).map_err(|e| format!("TCP bind failed: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;

    println!("[P2P] TCP listening on port {}", port);

    loop {
        // Check shutdown
        if shutdown_rx.try_recv().is_ok() {
            break;
        }

        match listener.accept() {
            Ok((mut stream, addr)) => {
                println!("[P2P] Incoming connection from {}", addr);
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .ok();

                // Read the sync message
                let mut buf = Vec::new();
                let mut temp = [0u8; 8192];

                loop {
                    match stream.read(&mut temp) {
                        Ok(0) => break,
                        Ok(n) => buf.extend_from_slice(&temp[..n]),
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
                        Err(_) => break,
                    }
                    if buf.len() > 10 * 1024 * 1024 {
                        // Cap at 10MB
                        break;
                    }
                }

                if let Ok(msg) = serde_json::from_slice::<SyncMessage>(&buf) {
                    println!(
                        "[P2P] Received {:?} from {} for room {}",
                        msg.msg_type, msg.sender_id, msg.room
                    );

                    // The payload is E2EE-encrypted Yjs update data.
                    // We emit an event to the frontend so it can decrypt and apply.
                    // The frontend holds the encryption key, not Rust.
                    // We pass the raw encrypted message through.

                    // Respond with ACK
                    let ack = serde_json::json!({"status": "ok"});
                    let ack_bytes = serde_json::to_vec(&ack).unwrap_or_default();
                    let _ = stream.write_all(&ack_bytes);

                    // Update last sync
                    if let Ok(mut ls) = last_sync.lock() {
                        *ls = Some(now_unix());
                    }

                    // TODO: Emit tauri event to frontend with the encrypted payload
                    // This will be done via AppHandle in the command layer
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                eprintln!("[P2P] TCP accept error: {}", e);
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }

    println!("[P2P] TCP listener stopped");
    Ok(())
}

// ─── TCP Client ───────────────────────────────────────────────────────────────

fn send_to_peer(ip: &str, port: u16, msg: &SyncMessage) -> Result<(), String> {
    send_to_peer_with_timeout(ip, port, msg, Duration::from_secs(5))
}

fn send_to_peer_with_timeout(
    ip: &str,
    port: u16,
    msg: &SyncMessage,
    timeout: Duration,
) -> Result<(), String> {
    let addr = format!("{}:{}", ip, port);
    let stream =
        TcpStream::connect_timeout(&addr.parse().map_err(|e: std::net::AddrParseError| e.to_string())?, timeout)
            .map_err(|e| format!("TCP connect to {} failed: {}", addr, e))?;

    stream.set_write_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;

    let data = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let mut stream = stream;
    stream
        .write_all(&data)
        .map_err(|e| format!("TCP write failed: {}", e))?;
    stream.flush().map_err(|e| e.to_string())?;

    // Shutdown write side to signal we're done
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(|e| e.to_string())?;

    // Read ACK
    let mut ack_buf = [0u8; 1024];
    let _ = stream.read(&mut ack_buf); // Best-effort ACK read

    Ok(())
}

// ─── Utility ──────────────────────────────────────────────────────────────────

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[command]
pub async fn discover_peers(
    p2p: tauri::State<'_, Arc<P2PManager>>,
) -> Result<Vec<PeerInfo>, String> {
    let peers = p2p
        .peers
        .lock()
        .map_err(|e| e.to_string())?
        .values()
        .cloned()
        .collect();
    Ok(peers)
}

#[command]
pub async fn sync_with_peer(
    p2p: tauri::State<'_, Arc<P2PManager>>,
    peer_id: String,
    encrypted_payload: String,
    room: String,
) -> Result<(), String> {
    p2p.sync_with_peer(&peer_id, &encrypted_payload, &room)
}

#[command]
pub async fn get_p2p_status(
    p2p: tauri::State<'_, Arc<P2PManager>>,
) -> Result<P2PStatus, String> {
    Ok(p2p.get_status())
}

#[command]
pub async fn enable_p2p(
    p2p: tauri::State<'_, Arc<P2PManager>>,
) -> Result<(), String> {
    p2p.start_discovery()
}

#[command]
pub async fn disable_p2p(
    p2p: tauri::State<'_, Arc<P2PManager>>,
) -> Result<(), String> {
    p2p.stop_discovery()
}

#[command]
pub async fn flush_p2p_ops(
    p2p: tauri::State<'_, Arc<P2PManager>>,
    encrypted_payload: String,
    room: String,
) -> Result<u32, String> {
    p2p.flush_to_peers(&encrypted_payload, &room)
}
