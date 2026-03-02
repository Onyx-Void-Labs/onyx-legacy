// ─── Onyx Home Station: Always-On Personal Sync Node ─────────────────────────
//
// A Home Station is an always-on Onyx node (desktop in tray mode, or a Docker
// container on a NAS) that acts as a sync anchor for all your devices.
//
// Features:
//   • Always-available sync target — no need for peers to be online simultaneously
//   • Multi-station support — desktop + NAS, load-balanced by latency
//   • Pairing via short auth string (6 chars, QR code compatible)
//   • Priority routing: Home Station > relay > blind cache
//
// Config is persisted as TOML in the app data directory (same as relay_config.rs).

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tracing::info;
use parking_lot::RwLock;

use crate::crypto::OnyxIdentity;

// ─── Types ──────────────────────────────────────────────────────────────────

/// Configuration for Home Station mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeStationConfig {
    /// Whether this device is running as a Home Station.
    pub enabled: bool,
    /// Paired Home Stations (other devices we sync through).
    pub paired_stations: Vec<StationInfo>,
}

/// Information about a paired Home Station.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationInfo {
    /// The station's Iroh NodeId (hex-encoded).
    pub node_id: String,
    /// Human-readable label (e.g., "Desktop", "NAS", "Server").
    pub label: String,
    /// Sync priority (lower = higher priority). Default: 10.
    pub priority: u8,
    /// When this station was paired (Unix timestamp).
    pub paired_at: u64,
}

/// Status of the Home Station.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HomeStationStatus {
    /// Whether Home Station mode is enabled on this device.
    pub enabled: bool,
    /// Our node ID (for pairing display).
    pub node_id: String,
    /// Number of paired stations.
    pub paired_count: usize,
    /// Pairing auth string (if pairing is in progress).
    pub pairing_code: Option<String>,
    /// Connected stations with their online status.
    pub stations: Vec<StationStatus>,
}

/// Online status of a specific station.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StationStatus {
    pub node_id: String,
    pub label: String,
    pub priority: u8,
    pub online: bool,
    pub last_seen: Option<u64>,
}

// ─── Home Station Engine ────────────────────────────────────────────────────

pub struct HomeStationEngine {
    /// Configuration (persisted to TOML).
    config: Arc<RwLock<HomeStationConfig>>,
    /// Our cryptographic identity.
    identity: Arc<OnyxIdentity>,
    /// Config file path.
    config_path: Option<std::path::PathBuf>,
    /// Active pairing code (temporary, cleared after pairing completes).
    active_pairing: Arc<RwLock<Option<String>>>,
}

impl HomeStationConfig {
    /// Load config from a TOML file, or return defaults.
    pub fn load(app_dir: Option<&impl AsRef<Path>>) -> Self {
        if let Some(dir) = app_dir {
            let path = dir.as_ref().join("home_station.toml");
            if let Ok(contents) = std::fs::read_to_string(&path) {
                if let Ok(config) = toml::from_str(&contents) {
                    return config;
                }
            }
        }
        Self::default()
    }

    /// Save config to TOML file.
    pub fn save(&self, app_dir: Option<&impl AsRef<Path>>) -> Result<(), String> {
        if let Some(dir) = app_dir {
            let path = dir.as_ref().join("home_station.toml");
            let contents = toml::to_string_pretty(self)
                .map_err(|e| format!("Failed to serialize config: {}", e))?;
            std::fs::write(&path, contents)
                .map_err(|e| format!("Failed to write config: {}", e))?;
        }
        Ok(())
    }
}

impl Default for HomeStationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            paired_stations: Vec::new(),
        }
    }
}

impl HomeStationEngine {
    /// Create a new HomeStationEngine.
    pub fn new(identity: Arc<OnyxIdentity>, app_dir: Option<&impl AsRef<Path>>) -> Self {
        let config_path = app_dir.map(|d| d.as_ref().join("home_station.toml"));
        let config = HomeStationConfig::load(app_dir);

        Self {
            config: Arc::new(RwLock::new(config)),
            identity,
            config_path,
            active_pairing: Arc::new(RwLock::new(None)),
        }
    }

    /// Enable Home Station mode on this device.
    pub fn enable(&self) -> Result<(), String> {
        let mut config = self.config.write();
        config.enabled = true;
        self.save_config(&config)?;
        info!("[HomeStation] Enabled");
        Ok(())
    }

    /// Disable Home Station mode.
    pub fn disable(&self) -> Result<(), String> {
        let mut config = self.config.write();
        config.enabled = false;
        self.save_config(&config)?;
        info!("[HomeStation] Disabled");
        Ok(())
    }

    /// Generate a pairing code for a peer to confirm.
    /// The code is 6 alphanumeric characters derived from HKDF of both NodeIds.
    pub fn start_pairing(&self, peer_node_id: &str) -> Result<String, String> {
        let our_id = self.node_id_hex();

        // Deterministic pairing code: HKDF(our_id || peer_id)
        // Both sides compute the same code, so they can confirm visually.
        let mut combined = Vec::new();
        // Sort IDs so both sides get the same input regardless of who initiates
        if our_id < peer_node_id.to_string() {
            combined.extend_from_slice(our_id.as_bytes());
            combined.extend_from_slice(peer_node_id.as_bytes());
        } else {
            combined.extend_from_slice(peer_node_id.as_bytes());
            combined.extend_from_slice(our_id.as_bytes());
        }

        // Use HKDF to derive a short code
        use hkdf::Hkdf;
        use sha2::Sha256;
        let hk = Hkdf::<Sha256>::new(Some(b"onyx-home-station-pair"), &combined);
        let mut okm = [0u8; 4];
        hk.expand(b"pairing-code", &mut okm)
            .map_err(|_| "HKDF expansion failed".to_string())?;

        // Convert to 6-char alphanumeric
        let code = format!(
            "{}",
            u32::from_be_bytes(okm) % 1_000_000
        );
        let code = format!("{:06}", code.parse::<u32>().unwrap_or(0));

        *self.active_pairing.write() = Some(code.clone());
        info!("[HomeStation] Pairing code generated for peer {}", peer_node_id);
        Ok(code)
    }

    /// Confirm pairing with a peer by verifying the auth string matches.
    pub fn confirm_pairing(
        &self,
        peer_node_id: &str,
        label: &str,
        auth_string: &str,
    ) -> Result<(), String> {
        let expected = self.start_pairing(peer_node_id)?;
        if auth_string != expected {
            return Err("Pairing code does not match".to_string());
        }

        let mut config = self.config.write();

        // Check if already paired
        if config.paired_stations.iter().any(|s| s.node_id == peer_node_id) {
            return Err("Already paired with this station".to_string());
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        config.paired_stations.push(StationInfo {
            node_id: peer_node_id.to_string(),
            label: label.to_string(),
            priority: 10,
            paired_at: now,
        });

        self.save_config(&config)?;
        *self.active_pairing.write() = None;

        info!("[HomeStation] Paired with {} ({})", label, peer_node_id);
        Ok(())
    }

    /// Unpair a station.
    pub fn unpair(&self, peer_node_id: &str) -> Result<(), String> {
        let mut config = self.config.write();
        let before = config.paired_stations.len();
        config.paired_stations.retain(|s| s.node_id != peer_node_id);
        if config.paired_stations.len() == before {
            return Err("Station not found".to_string());
        }
        self.save_config(&config)?;
        info!("[HomeStation] Unpaired {}", peer_node_id);
        Ok(())
    }

    /// List paired stations.
    pub fn list_stations(&self) -> Vec<StationInfo> {
        self.config.read().paired_stations.clone()
    }

    /// Get ordered sync targets: home stations sorted by priority, then other peers.
    pub fn get_sync_targets(&self, other_peers: &[String]) -> Vec<String> {
        let config = self.config.read();
        let mut targets: Vec<(u8, String)> = config
            .paired_stations
            .iter()
            .map(|s| (s.priority, s.node_id.clone()))
            .collect();
        targets.sort_by_key(|(p, _)| *p);

        let mut result: Vec<String> = targets.into_iter().map(|(_, id)| id).collect();

        // Add other peers after home stations
        for peer in other_peers {
            if !result.contains(peer) {
                result.push(peer.clone());
            }
        }

        result
    }

    /// Get current status.
    pub fn status(&self) -> HomeStationStatus {
        let config = self.config.read();
        HomeStationStatus {
            enabled: config.enabled,
            node_id: self.node_id_hex(),
            paired_count: config.paired_stations.len(),
            pairing_code: self.active_pairing.read().clone(),
            stations: config
                .paired_stations
                .iter()
                .map(|s| StationStatus {
                    node_id: s.node_id.clone(),
                    label: s.label.clone(),
                    priority: s.priority,
                    online: false, // TODO: check via Iroh
                    last_seen: None,
                })
                .collect(),
        }
    }

    /// Get our node_id as hex.
    fn node_id_hex(&self) -> String {
        self.identity.public_hex()
    }

    /// Save config to disk.
    fn save_config(&self, config: &HomeStationConfig) -> Result<(), String> {
        if let Some(path) = &self.config_path {
            let contents = toml::to_string_pretty(config)
                .map_err(|e| format!("Failed to serialize config: {}", e))?;
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(path, contents)
                .map_err(|e| format!("Failed to write config: {}", e))?;
        }
        Ok(())
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn home_station_enable(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
) -> Result<(), String> {
    engine.enable()
}

#[tauri::command]
pub async fn home_station_disable(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
) -> Result<(), String> {
    engine.disable()
}

#[tauri::command]
pub async fn home_station_pair(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
    peer_node_id: String,
    label: String,
    auth_string: String,
) -> Result<(), String> {
    engine.confirm_pairing(&peer_node_id, &label, &auth_string)
}

#[tauri::command]
pub async fn home_station_unpair(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
    peer_node_id: String,
) -> Result<(), String> {
    engine.unpair(&peer_node_id)
}

#[tauri::command]
pub async fn home_station_list(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
) -> Result<Vec<StationInfo>, String> {
    Ok(engine.list_stations())
}

#[tauri::command]
pub async fn home_station_status(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
) -> Result<HomeStationStatus, String> {
    Ok(engine.status())
}

#[tauri::command]
pub async fn home_station_start_pairing(
    engine: tauri::State<'_, Arc<HomeStationEngine>>,
    peer_node_id: String,
) -> Result<String, String> {
    engine.start_pairing(&peer_node_id)
}
