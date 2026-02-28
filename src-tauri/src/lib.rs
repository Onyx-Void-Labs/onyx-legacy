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
mod p2p_sync;

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
use p2p_sync::*;

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
            });

            // Initialize P2P manager
            let p2p_manager = Arc::new(p2p_sync::P2PManager::new());
            app.manage(p2p_manager.clone());

            // Initialize Email manager
            let email_manager = Arc::new(EmailManager::new());
            app.manage(email_manager);

            // Initialize Messaging manager
            let msg_manager = Arc::new(messaging::MessagingManager::new());
            app.manage(msg_manager);

            // Handle close event — flush P2P ops (desktop only, mobile has no close event)
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let p2p_for_close = p2p_manager.clone();
                let main_window = app.get_webview_window("main");
                if let Some(window) = main_window {
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { .. } = event {
                            println!("[P2P] App closing — attempting final sync flush...");
                            let _ = p2p_for_close.stop_discovery();
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
            // P2P Sync commands
            discover_peers,
            sync_with_peer,
            get_p2p_status,
            enable_p2p,
            disable_p2p,
            flush_p2p_ops,
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
            cloud_empty_trash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
