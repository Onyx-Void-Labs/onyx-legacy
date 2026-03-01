// ─── Onyx Relay Config: Configurable Relay URL Management ────────────────────
//
// Manages the relay server URL used for fallback connectivity when direct P2P
// or LAN connections fail. The relay wraps traffic in standard TLS so it looks
// like HTTPS to firewalls.
//
// Configuration is stored in `~/.onyx/relay.toml` (or app data dir on each platform).
// Can be overridden via:
//   1. Environment variable: ONYX_RELAY_URL
//   2. Tauri command: iroh_set_relay_url
//   3. Config file: relay.toml
//
// Default: https://relay.onyxvoid.com (fallback to Iroh's default relays)

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{info, warn};

/// Default relay URL — points to your VPS.
/// Change this when migrating from RackNerd to Hetzner.
const DEFAULT_RELAY_URL: &str = "https://relay1.iroh.network";

/// Config filename within the app data directory
const CONFIG_FILENAME: &str = "relay.toml";

// ─── Relay Config ───────────────────────────────────────────────────────────

/// Relay configuration — persisted to disk as TOML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayConfig {
    /// The relay server URL (e.g., "https://relay.onyxvoid.com")
    pub relay_url: String,

    /// Whether to use the relay at all.
    /// If false, only direct P2P and LAN connections are attempted.
    #[serde(default = "default_true")]
    pub relay_enabled: bool,

    /// Whether to publish our address to the Pkarr DHT.
    /// Disabling this makes the node "invisible" on the global network.
    #[serde(default = "default_true")]
    pub dht_enabled: bool,

    /// Whether to use mDNS for LAN discovery.
    #[serde(default = "default_true")]
    pub mdns_enabled: bool,

    /// Maximum number of concurrent peer connections.
    #[serde(default = "default_max_peers")]
    pub max_peers: u32,

    /// Additional relay URLs for geographic coverage.
    /// Iroh probes all relays and latches onto the fastest one.
    /// Example: ["https://sgp-relay.onyxvoid.com", "https://lon-relay.onyxvoid.com"]
    #[serde(default)]
    pub additional_relays: Vec<String>,
}

fn default_true() -> bool { true }
fn default_max_peers() -> u32 { 64 }

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            relay_url: DEFAULT_RELAY_URL.to_string(),
            relay_enabled: true,
            dht_enabled: true,
            mdns_enabled: true,
            max_peers: 64,
            additional_relays: Vec::new(),
        }
    }
}

impl RelayConfig {
    /// Load configuration with priority:
    ///   1. Environment variable ONYX_RELAY_URL (overrides file)
    ///   2. Config file (~/.onyx/relay.toml or app data dir)
    ///   3. Defaults
    pub fn load(app_data_dir: Option<&PathBuf>) -> Self {
        // Start with defaults
        let mut config = Self::default();

        // Try loading from file
        if let Some(dir) = app_data_dir {
            let config_path = dir.join(CONFIG_FILENAME);
            if config_path.exists() {
                match std::fs::read_to_string(&config_path) {
                    Ok(content) => {
                        match toml::from_str::<RelayConfig>(&content) {
                            Ok(file_config) => {
                                info!("[RelayConfig] Loaded from {}", config_path.display());
                                config = file_config;
                            }
                            Err(e) => {
                                warn!("[RelayConfig] Parse error in {}: {}", config_path.display(), e);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("[RelayConfig] Read error {}: {}", config_path.display(), e);
                    }
                }
            }
        }

        // Environment variable overrides file
        if let Ok(env_url) = std::env::var("ONYX_RELAY_URL") {
            if !env_url.is_empty() {
                info!("[RelayConfig] Using env override: {}", env_url);
                config.relay_url = env_url;
            }
        }

        config
    }

    /// Save configuration to the app data directory.
    pub fn save(&self) -> Result<(), String> {
        let config_dir = get_config_dir()?;
        let config_path = config_dir.join(CONFIG_FILENAME);

        let content = toml::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;

        std::fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        info!("[RelayConfig] Saved to {}", config_path.display());
        Ok(())
    }

    /// Save to a specific app data directory (used during Tauri setup).
    pub fn save_to(&self, app_data_dir: &PathBuf) -> Result<(), String> {
        let config_path = app_data_dir.join(CONFIG_FILENAME);

        let content = toml::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;

        std::fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;

        info!("[RelayConfig] Saved to {}", config_path.display());
        Ok(())
    }
}

/// Get the platform-specific config directory.
fn get_config_dir() -> Result<PathBuf, String> {
    directories::ProjectDirs::from("com", "onyxvoid", "onyx")
        .map(|dirs| dirs.config_dir().to_path_buf())
        .ok_or_else(|| "Could not determine config directory".to_string())
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Get the current relay configuration.
#[tauri::command]
pub fn get_relay_config(
    _node: tauri::State<'_, std::sync::Arc<crate::network::OnyxNode>>,
) -> Result<RelayConfig, String> {
    // Return a default config; the actual config is managed by OnyxNode
    Ok(RelayConfig::default())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RelayConfig::default();
        assert_eq!(config.relay_url, DEFAULT_RELAY_URL);
        assert!(config.relay_enabled);
        assert!(config.dht_enabled);
        assert!(config.mdns_enabled);
        assert_eq!(config.max_peers, 64);
    }

    #[test]
    fn test_config_serialize_roundtrip() {
        let config = RelayConfig {
            relay_url: "https://custom.relay.example.com".to_string(),
            relay_enabled: true,
            dht_enabled: false,
            mdns_enabled: true,
            max_peers: 32,
        };
        let serialized = toml::to_string_pretty(&config).unwrap();
        let deserialized: RelayConfig = toml::from_str(&serialized).unwrap();
        assert_eq!(config.relay_url, deserialized.relay_url);
        assert_eq!(config.dht_enabled, deserialized.dht_enabled);
        assert_eq!(config.max_peers, deserialized.max_peers);
    }
}
