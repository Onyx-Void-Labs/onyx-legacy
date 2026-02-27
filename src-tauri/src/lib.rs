mod commands;
mod database;
mod email;
mod email_client;
mod p2p_sync;

use database::Database;
use tauri::Manager;
use std::sync::Arc;

// We "use" everything from the commands module so the generate_handler can see them
use commands::*;
use email::*;
use email_client::*;
use p2p_sync::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            // Handle close event — flush P2P ops
            let p2p_for_close = p2p_manager.clone();
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        println!("[P2P] App closing — attempting final sync flush...");
                        // The frontend should have already called flush_p2p_ops
                        // but as a safety net, signal shutdown
                        let _ = p2p_for_close.stop_discovery();
                    }
                });
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
            list_email_folders
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
