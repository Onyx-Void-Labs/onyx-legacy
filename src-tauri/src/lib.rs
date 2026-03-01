mod commands;
mod database;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod email;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod email_client;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod email_cache;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod onyx_outlook;
mod messaging;
mod photos;
mod cloud;

// ─── Onyx Transport v3.0 modules ─────────────────────────────────────────────
mod crypto;
mod network;
mod relay_config;
mod doc_store;
mod sync;
mod cache;
mod home_station;
mod ratchet;
mod messaging_v2;
mod media;
mod shield;
mod sentinel;

use database::Database;
use tauri::Manager;
use std::sync::Arc;

// We "use" everything from the commands module so the generate_handler can see them
use commands::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use email::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use email_client::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use email_cache::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use onyx_outlook::*;
use messaging::*;
use photos::*;
use cloud::*;

// Stub commands for Android — Outlook WebView is desktop-only
#[cfg(any(target_os = "android", target_os = "ios"))]
mod outlook_stubs {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ImportedEmail {
        pub sender: String,
        pub subject: String,
        pub body: String,
    }

    #[tauri::command]
    pub fn open_outlook_onyx(_realm: Option<String>) -> Result<(), String> {
        Err("Outlook WebView is not available on Android".to_string())
    }

    #[tauri::command]
    pub fn close_outlook_onyx() -> Result<(), String> {
        Err("Outlook WebView is not available on Android".to_string())
    }

    #[tauri::command]
    pub fn onyx_import_email(_email: ImportedEmail) -> Result<(), String> {
        Err("Outlook WebView is not available on Android".to_string())
    }

    #[tauri::command]
    pub fn outlook_console(_level: String, _message: String) -> Result<(), String> {
        Ok(()) // silently ignore console forwarding on Android
    }

    // Email relay stubs (reqwest not available on mobile)
    #[tauri::command]
    pub async fn send_magic_link_email(_email: String, _link: String) -> Result<String, String> {
        Err("Email relay is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn send_otp_email(_email: String, _code: String) -> Result<String, String> {
        Err("Email relay is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn check_relay_health() -> Result<String, String> {
        Err("Email relay is not available on mobile".to_string())
    }

    // Email client stubs (imap/lettre/reqwest not available on mobile)
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct ProviderConfig {
        pub provider: String,
        pub imap_host: String,
        pub imap_port: u16,
        pub smtp_host: String,
        pub smtp_port: u16,
        pub auth_type: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct OAuthTokens {
        pub access_token: String,
        pub refresh_token: Option<String>,
        pub expires_in: Option<u64>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct EmailHeader {
        pub uid: u32,
        pub subject: String,
        pub from: String,
        pub date: String,
        pub flags: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct EmailBody {
        pub uid: u32,
        pub subject: String,
        pub from: String,
        pub date: String,
        pub text: Option<String>,
        pub html: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct EmailFolder {
        pub name: String,
        pub delimiter: String,
    }

    /// Placeholder EmailManager for mobile — no-op
    pub struct EmailManager;
    impl EmailManager {
        pub fn new() -> Self { EmailManager }
    }

    #[tauri::command]
    pub async fn detect_email_provider(_email: String) -> Result<ProviderConfig, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn exchange_oauth_code(
        _provider: String, _code: String, _redirect_uri: String,
    ) -> Result<OAuthTokens, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn refresh_oauth_token(
        _provider: String, _refresh_token: String,
    ) -> Result<OAuthTokens, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn fetch_email_headers(
        _host: String, _port: u16, _username: String, _access_token: String,
        _auth_type: String, _folder: Option<String>, _page: Option<u32>, _per_page: Option<u32>,
    ) -> Result<Vec<EmailHeader>, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn fetch_email_body(
        _host: String, _port: u16, _username: String, _access_token: String,
        _auth_type: String, _uid: u32, _folder: Option<String>,
    ) -> Result<EmailBody, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn send_email(
        _smtp_host: String, _smtp_port: u16, _username: String, _access_token: String,
        _auth_type: String, _from: String, _to: String, _subject: String, _body: String,
        _html: Option<bool>,
    ) -> Result<String, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn list_email_folders(
        _host: String, _port: u16, _username: String, _access_token: String,
        _auth_type: String,
    ) -> Result<Vec<EmailFolder>, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn move_email(
        _imap_host: String, _imap_port: u16, _email: String, _auth_method: String,
        _access_token: Option<String>, _password: Option<String>,
        _folder: String, _uid: u32, _target_folder: String,
    ) -> Result<(), String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn delete_email(
        _imap_host: String, _imap_port: u16, _email: String, _auth_method: String,
        _access_token: Option<String>, _password: Option<String>,
        _folder: String, _uid: u32,
    ) -> Result<(), String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn batch_delete_emails(
        _imap_host: String, _imap_port: u16, _email: String, _auth_method: String,
        _access_token: Option<String>, _password: Option<String>,
        _folder: String, _uids: Vec<u32>,
    ) -> Result<(), String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn mark_email_flag(
        _imap_host: String, _imap_port: u16, _email: String, _auth_method: String,
        _access_token: Option<String>, _password: Option<String>,
        _folder: String, _uid: u32, _flag: String, _add: bool,
    ) -> Result<(), String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SpamAnalysis {
        pub score: f64,
        pub is_spam: bool,
        pub reasons: Vec<SpamReason>,
        pub spf_pass: bool,
        pub dkim_pass: bool,
        pub dmarc_pass: bool,
        pub has_unsubscribe: bool,
        pub unsubscribe_url: Option<String>,
        pub list_unsubscribe: Option<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct SpamReason {
        pub name: String,
        pub score: f64,
        pub description: String,
    }

    #[tauri::command]
    pub async fn fetch_spam_analysis(
        _imap_host: String, _imap_port: u16, _email: String, _auth_method: String,
        _access_token: Option<String>, _password: Option<String>,
        _folder: String, _uid: u32,
    ) -> Result<SpamAnalysis, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn search_emails(
        _imap_host: String, _imap_port: u16, _email: String, _auth_method: String,
        _access_token: Option<String>, _password: Option<String>,
        _folder: String, _query: String,
    ) -> Result<Vec<u32>, String> {
        Err("Email client is not available on mobile".to_string())
    }

    #[tauri::command]
    pub fn sanitize_email_html(_html: String, _dark_mode: bool) -> String {
        String::new()
    }

    // ─── Email Cache stubs (desktop-only IMAP syncer) ─────────────────────────
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct CachedEmailHeader {
        pub id: i64,
        pub account_id: String,
        pub uid: u32,
        pub message_id: String,
        pub folder: String,
        pub from_address: String,
        pub from_name: String,
        pub to_address: String,
        pub subject: String,
        pub preview: String,
        pub date_str: String,
        pub date_epoch: i64,
        pub is_read: bool,
        pub is_starred: bool,
        pub has_attachments: bool,
        pub in_reply_to: Option<String>,
        pub references_header: Option<String>,
        pub category: String,
    }

    #[tauri::command]
    pub async fn get_cached_emails(
        _account_id: String, _folder: String, _category: Option<String>,
        _offset: i64, _limit: i64,
    ) -> Result<Vec<CachedEmailHeader>, String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn get_cached_email_body(
        _account_id: String, _uid: u32,
    ) -> Result<serde_json::Value, String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn search_cached_emails(
        _query: String, _account_id: Option<String>, _limit: i64,
    ) -> Result<Vec<CachedEmailHeader>, String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn get_unread_count(
        _account_id: String, _folder: String,
    ) -> Result<i64, String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn register_email_token(
        _account_id: String, _access_token: String, _refresh_token: Option<String>,
        _expires_in: u64, _provider: String, _client_id: String,
    ) -> Result<(), String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn start_email_sync(
        _account_id: String, _imap_host: String, _imap_port: u16,
        _email: String, _auth_method: String, _password: Option<String>,
        _folders: Vec<String>,
    ) -> Result<(), String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn stop_email_sync(_account_id: String) -> Result<(), String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn force_email_sync(
        _account_id: String, _imap_host: String, _imap_port: u16,
        _email: String, _auth_method: String, _password: Option<String>,
        _folder: String,
    ) -> Result<(), String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn fetch_and_cache_email_body(
        _account_id: String, _uid: u32, _imap_host: String, _imap_port: u16,
        _email_addr: String, _auth_method: String, _password: Option<String>,
        _folder: String,
    ) -> Result<serde_json::Value, String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn mark_cached_email_read(
        _account_id: String, _uid: u32, _folder: String, _read: bool,
        _imap_host: String, _imap_port: u16, _email_addr: String,
        _auth_method: String, _password: Option<String>,
    ) -> Result<(), String> {
        Err("Email cache is not available on mobile".to_string())
    }

    #[tauri::command]
    pub async fn purge_email_cache(_account_id: String) -> Result<(), String> {
        Err("Email cache is not available on mobile".to_string())
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
use outlook_stubs::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_notification::init());

    // Updater plugin — desktop only (Android/iOS use app stores)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            tauri::async_runtime::block_on(async {
                let db_pool = Database::setup(app.handle()).await;

                // Run email cache migrations
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    if let Err(e) = email_cache::EmailCacheDb::migrate(&db_pool).await {
                        eprintln!("[EmailCache] Migration failed: {}", e);
                    }
                    // Run messaging DB migrations
                    if let Err(e) = messaging::MessagingDb::migrate(&db_pool).await {
                        eprintln!("[Messaging] Migration failed: {}", e);
                    }
                }
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    if let Err(e) = messaging::MessagingDb::migrate(&db_pool).await {
                        eprintln!("[Messaging] Migration failed: {}", e);
                    }
                }

                // Photos & Cloud Drive migrations (all platforms)
                if let Err(e) = photos::PhotosDb::migrate(&db_pool).await {
                    eprintln!("[Photos] Migration failed: {}", e);
                }
                if let Err(e) = cloud::CloudDb::migrate(&db_pool).await {
                    eprintln!("[Cloud] Migration failed: {}", e);
                }

                app.manage(db_pool.clone());

                // Initialize OAuth interceptor + background syncer (desktop only)
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    let interceptor = Arc::new(email_cache::OAuthInterceptor::new());
                    let syncer = Arc::new(email_cache::BackgroundSyncer::new(db_pool.clone(), interceptor.clone()));
                    app.manage(interceptor);
                    app.manage(syncer);
                }

                // ─── Onyx Transport v3.0 Initialization ─────────────────────
                // 1. Load or create cryptographic identity
                let identity = match crypto::OnyxIdentity::load_or_create(
                    &app.path().app_data_dir().unwrap_or_default()
                ) {
                    Ok(id) => Arc::new(id),
                    Err(e) => {
                        eprintln!("[Crypto] Identity init failed: {}", e);
                        Arc::new(crypto::OnyxIdentity::generate())
                    }
                };
                app.manage(identity.clone());

                // 2. Load relay config
                let relay_config = relay_config::RelayConfig::load(
                    app.path().app_data_dir().ok().as_ref()
                );

                // 3. Start Iroh node
                let iroh_node = match network::OnyxNode::start(identity.clone(), &relay_config).await {
                    Ok(node) => {
                        println!("[Iroh] Node started — NodeId: {}", node.node_id_hex());
                        Arc::new(node)
                    }
                    Err(e) => {
                        eprintln!("[Iroh] Node start failed: {}", e);
                        // Create a placeholder — commands will fail gracefully
                        panic!("[Iroh] Fatal: Cannot start network node: {}", e);
                    }
                };
                app.manage(iroh_node.clone());

                // 4. Initialize CRDT Document Store
                let doc_store = Arc::new(doc_store::DocStore::new(db_pool.clone()));
                if let Err(e) = doc_store::DocStore::migrate(&db_pool).await {
                    eprintln!("[DocStore] Migration failed: {}", e);
                }
                app.manage(doc_store.clone());

                // 5. Initialize CRDT Sync Engine
                let sync_engine = Arc::new(sync::SyncEngine::new(
                    iroh_node.clone(),
                    doc_store.clone(),
                ));
                app.manage(sync_engine.clone());

                // 6. Initialize Messaging V2 Engine (Signal Protocol)
                let msg_v2_engine = Arc::new(messaging_v2::MessagingEngine::new(
                    db_pool.clone(),
                    identity.clone(),
                ));
                if let Err(e) = msg_v2_engine.migrate().await {
                    eprintln!("[MessagingV2] Migration failed: {}", e);
                }
                app.manage(msg_v2_engine.clone());

                // 7. Initialize Media Engine (voice/video calls)
                let media_engine = Arc::new(media::MediaEngine::new(identity.clone()));
                app.manage(media_engine.clone());

                // 8. Initialize Shield Engine (traffic analysis resistance)
                let shield_engine = Arc::new(shield::ShieldEngine::new());
                app.manage(shield_engine.clone());

                // 9. Initialize Sentinel Engine (relay karma system)
                let sentinel_engine = Arc::new(sentinel::SentinelEngine::new(
                    db_pool.clone(),
                    identity.clone(),
                ));
                if let Err(e) = sentinel_engine.migrate().await {
                    eprintln!("[Sentinel] Migration failed: {}", e);
                }
                sentinel_engine.start_hourly_reset();
                app.manage(sentinel_engine.clone());

                // 10. Initialize Blind Cache Client (offline relay)
                let cache_url = std::env::var("ONYX_CACHE_URL")
                    .unwrap_or_else(|_| "https://cache.onyxvoid.com".to_string());
                let cache_client = Arc::new(cache::BlindCacheClient::new(
                    cache_url,
                    identity.clone(),
                ));
                app.manage(cache_client.clone());
                println!("[BlindCache] Client initialized");

                // 11. Initialize Home Station Engine (always-on sync)
                let home_station_engine = Arc::new(home_station::HomeStationEngine::new(
                    identity.clone(),
                    app.path().app_data_dir().ok().as_ref(),
                ));
                app.manage(home_station_engine.clone());
                println!("[HomeStation] Engine initialized");

                // 12. Spawn Iroh accept loop (routes incoming connections by ALPN)
                {
                    let node = iroh_node.clone();
                    let sync_eng = sync_engine.clone();
                    let msg_eng = msg_v2_engine.clone();
                    let media_eng = media_engine.clone();
                    let sentinel_eng = sentinel_engine.clone();
                    tokio::spawn(async move {
                        loop {
                            match node.accept_connection().await {
                                Ok(Some((alpn, conn))) => {
                                    let alpn_str = String::from_utf8_lossy(&alpn).to_string();
                                    match alpn.as_slice() {
                                        b"onyx-sync/1" => {
                                            let se = sync_eng.clone();
                                            tokio::spawn(async move {
                                                if let Err(e) = se.handle_incoming_sync(conn).await {
                                                    eprintln!("[Sync] Incoming error: {}", e);
                                                }
                                            });
                                        }
                                        b"onyx-msg/1" => {
                                            let me = msg_eng.clone();
                                            tokio::spawn(async move {
                                                let (send, recv) = match conn.accept_bi().await {
                                                    Ok(sr) => sr,
                                                    Err(e) => { eprintln!("[Msg] Accept bi: {}", e); return; }
                                                };
                                                if let Err(e) = me.handle_incoming(recv, send).await {
                                                    eprintln!("[Msg] Incoming error: {}", e);
                                                }
                                            });
                                        }
                                        b"onyx-media/1" => {
                                            let me = media_eng.clone();
                                            tokio::spawn(async move {
                                                let (send, recv) = match conn.accept_bi().await {
                                                    Ok(sr) => sr,
                                                    Err(e) => { eprintln!("[Media] Accept bi: {}", e); return; }
                                                };
                                                if let Err(e) = me.handle_incoming_call(conn, recv, send).await {
                                                    eprintln!("[Media] Incoming error: {}", e);
                                                }
                                            });
                                        }
                                        b"onyx-sentinel/1" => {
                                            let se = sentinel_eng.clone();
                                            let node_ref = node.clone();
                                            tokio::spawn(async move {
                                                let (send, recv) = match conn.accept_bi().await {
                                                    Ok(sr) => sr,
                                                    Err(e) => { eprintln!("[Sentinel] Accept bi: {}", e); return; }
                                                };
                                                // Extract peer node id from connection
                                                let peer_id = conn.remote_node_id()
                                                    .map(|id| id.to_string())
                                                    .unwrap_or_else(|_| "unknown".to_string());
                                                if let Err(e) = se.handle_relay_request(&*node_ref, recv, send, &peer_id).await {
                                                    eprintln!("[Sentinel] Relay error: {}", e);
                                                }
                                            });
                                        }
                                        _ => {
                                            eprintln!("[Iroh] Unknown ALPN: {}", alpn_str);
                                        }
                                    }
                                }
                                Ok(None) => {
                                    println!("[Iroh] Accept loop ended (node shutdown)");
                                    break;
                                }
                                Err(e) => {
                                    eprintln!("[Iroh] Accept error: {}", e);
                                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                                }
                            }
                        }
                    });
                }
            });

            // Initialize Email manager
            let email_manager = Arc::new(EmailManager::new());
            app.manage(email_manager);

            // Initialize Messaging manager (legacy — kept alongside v2)
            let msg_manager = Arc::new(messaging::MessagingManager::new());
            app.manage(msg_manager);

            // Handle close event — flush docs + shutdown Iroh (desktop only)
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let app_handle = app.handle().clone();
                let main_window = app.get_webview_window("main");
                if let Some(window) = main_window {
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            println!("[Onyx] App closing — flushing docs...");
                            if let Some(store) = app_handle.try_state::<Arc<doc_store::DocStore>>() {
                                let rt = tokio::runtime::Handle::current();
                                let _ = rt.block_on(store.flush_all());
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Existing commands
            greet,
            send_magic_link_email,
            send_otp_email,
            check_relay_health,
            create_note,
            get_notes,
            get_note_content,
            update_note,
            update_note_pb_id,
            import_note_from_pb,
            delete_note,
            delete_note_by_pb_id,
            ensure_local_uuid,
            move_to_trash,
            transcribe_audio,
            // Email Client commands
            detect_email_provider,
            exchange_oauth_code,
            refresh_oauth_token,
            fetch_email_headers,
            fetch_email_body,
            send_email,
            list_email_folders,
            move_email,
            delete_email,
            batch_delete_emails,
            mark_email_flag,
            fetch_spam_analysis,
            search_emails,
            sanitize_email_html,
            // Email Cache commands (local SQLite cache + background sync)
            get_cached_emails,
            get_cached_email_body,
            search_cached_emails,
            get_unread_count,
            register_email_token,
            start_email_sync,
            stop_email_sync,
            force_email_sync,
            fetch_and_cache_email_body,
            mark_cached_email_read,
            purge_email_cache,
            // Messaging commands (E2EE decentralized)
            generate_messaging_keypair,
            get_messaging_identity,
            create_server,
            join_server,
            get_servers,
            create_channel,
            get_channels,
            send_message,
            get_messages,
            get_dm_conversations,
            send_dm,
            get_dm_messages,
            // Outlook WebView commands (stubs on Android)
            open_outlook_onyx,
            close_outlook_onyx,
            onyx_import_email,
            outlook_console,
            // Photos commands (E2EE gallery)
            upload_photo,
            upload_photos_batch,
            get_photo_data,
            get_photos,
            toggle_photo_favorite,
            delete_photo,
            restore_photo,
            permanently_delete_photo,
            move_photo_to_album,
            get_albums,
            create_album,
            rename_album,
            delete_album,
            set_album_cover,
            get_photo_stats,
            empty_photo_trash,
            export_photo,
            // Cloud Drive commands (E2EE file manager)
            cloud_upload_file,
            cloud_upload_batch,
            cloud_create_folder,
            cloud_list_files,
            cloud_get_breadcrumbs,
            cloud_get_file_data,
            cloud_rename_file,
            cloud_move_file,
            cloud_toggle_star,
            cloud_delete_file,
            cloud_restore_file,
            cloud_permanently_delete,
            cloud_search_files,
            cloud_get_versions,
            cloud_get_stats,
            cloud_export_file,
            cloud_empty_trash,
            // ─── Onyx Transport v3.0 commands ─────────────────────────────
            // Iroh Network commands
            network::iroh_get_status,
            network::iroh_get_node_id,
            network::iroh_get_peers,
            network::iroh_connect_peer,
            network::iroh_set_relay_url,
            network::iroh_shutdown,
            // Relay Config
            relay_config::get_relay_config,
            // CRDT Doc Store commands
            doc_store::doc_get_state_vector,
            doc_store::doc_apply_update,
            doc_store::doc_get_full_state,
            doc_store::doc_list,
            doc_store::doc_flush_all,
            // CRDT Sync commands
            sync::sync_doc_with_peer,
            sync::sync_broadcast_update,
            sync::sync_set_master_key,
            sync::sync_replay_pending,
            // Messaging V2 commands (Signal Protocol)
            messaging_v2::msg_v2_get_conversations,
            messaging_v2::msg_v2_get_messages,
            messaging_v2::msg_v2_send_dm,
            messaging_v2::msg_v2_initiate_session,
            messaging_v2::msg_v2_get_prekey_bundle,
            messaging_v2::msg_v2_set_master_key,
            messaging_v2::msg_v2_create_group,
            // Media commands (voice/video)
            media::media_start_call,
            media::media_end_call,
            media::media_toggle_mute,
            media::media_toggle_video,
            media::media_get_active_calls,
            media::media_get_call_info,
            media::media_answer_call,
            media::media_send_audio,
            // Shield commands (traffic analysis resistance)
            shield::shield_get_config,
            shield::shield_set_config,
            shield::shield_get_stats,
            shield::shield_enable,
            // Sentinel commands (relay karma)
            sentinel::sentinel_get_status,
            sentinel::sentinel_set_config,
            sentinel::sentinel_get_config,
            sentinel::sentinel_enable,
            sentinel::sentinel_get_peer_karma,
            sentinel::sentinel_block_peer,
            sentinel::sentinel_unblock_peer,
            sentinel::sentinel_get_blocklist,
            // Blind Cache commands (offline relay)
            cache::cache_push,
            cache::cache_pull,
            cache::cache_status,
            // Home Station commands (always-on sync)
            home_station::home_station_enable,
            home_station::home_station_disable,
            home_station::home_station_pair,
            home_station::home_station_unpair,
            home_station::home_station_list,
            home_station::home_station_status,
            home_station::home_station_start_pairing
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
