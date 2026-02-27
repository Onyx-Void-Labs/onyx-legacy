mod commands;
mod database;
mod email;
mod email_client;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod onyx_outlook;
mod p2p_sync;

use database::Database;
use tauri::Manager;
use std::sync::Arc;

// We "use" everything from the commands module so the generate_handler can see them
use commands::*;
use email::*;
use email_client::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use onyx_outlook::*;
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
                app.manage(db_pool);
            });

            // Initialize P2P manager
            let p2p_manager = Arc::new(p2p_sync::P2PManager::new());
            app.manage(p2p_manager.clone());

            // Initialize Email manager
            let email_manager = Arc::new(email_client::EmailManager::new());
            app.manage(email_manager);

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
            // Outlook WebView commands (stubs on Android)
            open_outlook_onyx,
            close_outlook_onyx,
            onyx_import_email,
            outlook_console
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
