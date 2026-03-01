// ─── Onyx Home Station — Headless Sync Node ──────────────────────────────────
//
// A headless Rust binary that runs the same Iroh node + DocStore + SyncEngine
// as the Tauri app, but without a UI. Designed for NAS / always-on server use.
//
// Usage:
//   onyx-station                        # Start with default config
//   onyx-station --config /path/to.toml # Custom config file
//   onyx-station pair <auth-string>     # Pair with a device
//
// Environment variables:
//   ONYX_DATA_DIR    — Where to store data (default: ./onyx_station_data)
//   ONYX_CACHE_URL   — Blind cache URL (default: https://cache.onyxvoid.com)
//   ONYX_PORT        — Iroh node port (default: auto)

use clap::{Parser, Subcommand};
use tracing::info;

#[derive(Parser)]
#[command(name = "onyx-station", about = "Onyx Home Station — always-on sync node")]
struct Cli {
    /// Path to config file
    #[arg(short, long, default_value = "station.toml")]
    config: String,

    /// Data directory
    #[arg(short, long, env = "ONYX_DATA_DIR", default_value = "./onyx_station_data")]
    data_dir: String,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Home Station (default)
    Run,
    /// Pair with a device using an auth string
    Pair {
        /// The 6-character auth string from the pairing device
        auth_string: String,
    },
    /// Show station status
    Status,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "onyx_home_station=info,iroh=warn".into()),
        )
        .init();

    let cli = Cli::parse();

    // Ensure data directory exists
    std::fs::create_dir_all(&cli.data_dir)?;

    match cli.command.unwrap_or(Commands::Run) {
        Commands::Run => {
            info!("[HomeStation] Starting Onyx Home Station...");
            info!("[HomeStation] Data dir: {}", cli.data_dir);
            info!("[HomeStation] Config: {}", cli.config);

            // TODO: Initialize the full stack:
            // 1. Load/create cryptographic identity
            // 2. Start Iroh node
            // 3. Initialize SQLite + DocStore
            // 4. Initialize SyncEngine
            // 5. Initialize BlindCacheClient
            // 6. Start accept loop
            // 7. Run forever

            info!("[HomeStation] Ready — waiting for connections...");
            info!("[HomeStation] Press Ctrl+C to stop");

            // Keep running
            tokio::signal::ctrl_c().await?;
            info!("[HomeStation] Shutting down...");
        }
        Commands::Pair { auth_string } => {
            info!("[HomeStation] Pairing with auth string: {}", auth_string);
            // TODO: Implement CLI pairing flow
            info!("[HomeStation] Pairing not yet implemented in CLI mode");
        }
        Commands::Status => {
            info!("[HomeStation] Status:");
            info!("  Config: {}", cli.config);
            info!("  Data dir: {}", cli.data_dir);
            // TODO: Read config and show station status
        }
    }

    Ok(())
}
