use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

/// The JS to inject into the Outlook WebView.
/// Kept as a const so it ships inside the binary — no external file needed at runtime.
const OUTLOOK_INJECT_JS: &str = include_str!("../../scripts/outlook_onyx_inject.js");

/// Console forwarding: overrides console.log/warn/error in the Outlook webview
/// so messages are relayed to the main Onyx window via `outlook_console` command.
const CONSOLE_FORWARD_JS: &str = r#"
(function() {
    var _log = console.log, _warn = console.warn, _err = console.error;
    function fwd(level, args) {
        try {
            if (window.__TAURI_INTERNALS__) {
                window.__TAURI_INTERNALS__.invoke('outlook_console', {
                    level: level,
                    message: Array.from(args).map(String).join(' ')
                });
            }
        } catch(e) {}
    }
    console.log  = function() { _log.apply(console, arguments);  fwd('log',   arguments); };
    console.warn = function() { _warn.apply(console, arguments); fwd('warn',  arguments); };
    console.error= function() { _err.apply(console, arguments);  fwd('error', arguments); };
})();
"#;

// ─── Data types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedEmail {
    pub sender: String,
    pub subject: String,
    pub body: String,
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Open Outlook 365 **embedded** inside the main Onyx window.
///
/// Uses `Window::add_child` to create a child `Webview` within the existing
/// main window — no new OS window is opened.
///
/// - `realm` — optional SSO realm for university/org login (e.g. "student.rmit.edu.au").
///   When provided the URL becomes `…/mail/?realm=<value>` so Outlook skips the
///   generic Microsoft login page and goes straight to the org's IdP.
/// - Keeps Outlook branding visible → 100 % legal.
/// - Injects Onyx overlay (purple toolbar + "Import to Note" button).
/// - Console forwarding for full dev-tools visibility.
/// - Zero scraping — user explicitly triggers any data import.
#[tauri::command]
pub fn open_outlook_onyx(app: AppHandle, realm: Option<String>) -> Result<(), String> {
    // If the embedded webview already exists, just bring it to focus
    if let Some(existing) = app.get_webview("onyx-outlook") {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Build URL — append realm query param for university SSO
    let base_url = match &realm {
        Some(r) if !r.is_empty() => {
            format!("https://outlook.office365.com/mail/?realm={}", r)
        }
        _ => "https://outlook.office365.com/mail/".to_string(),
    };

    let url: url::Url = base_url
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;

    println!("[Onyx-Outlook] Opening embedded: {}", url);

    // Get the underlying Window (not WebviewWindow) so we can add a child webview
    let window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    // Calculate logical dimensions (below the 30 px custom titlebar)
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let w = inner.width as f64 / scale;
    let h = inner.height as f64 / scale;

    // Build the embedded webview with console forwarding + Onyx overlay
    let builder = WebviewBuilder::new("onyx-outlook", WebviewUrl::External(url))
        .initialization_script(CONSOLE_FORWARD_JS)
        .initialization_script(OUTLOOK_INJECT_JS)
        .auto_resize();

    // Add as a child of the main window, positioned below the titlebar
    window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 30.0),
            LogicalSize::new(w, h - 30.0),
        )
        .map_err(|e| {
            eprintln!("[Onyx-Outlook] Failed to create embedded WebView: {}", e);
            e.to_string()
        })?;

    // Notify frontend that the Outlook WebView is now embedded
    let _ = app.emit("onyx-outlook-opened", ());

    Ok(())
}

/// Close the embedded Outlook WebView and return to the normal Onyx email UI.
#[tauri::command]
pub fn close_outlook_onyx(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview("onyx-outlook") {
        webview.close().map_err(|e| e.to_string())?;
    }
    let _ = app.emit("onyx-outlook-closed", ());
    Ok(())
}

/// Receive an email the user chose to import from the Outlook WebView.
///
/// The data is passed client-side (never scraped) and emitted to the main
/// Onyx window so the frontend can create a note from it.
#[tauri::command]
pub fn onyx_import_email(app: AppHandle, email: ImportedEmail) -> Result<(), String> {
    println!(
        "[Onyx-Outlook] Import request — subject: {}",
        email.subject
    );

    // Emit to the main window so the React UI can handle it
    app.emit("onyx-email-imported", &email)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Receives console messages forwarded from the embedded Outlook WebView
/// and re-emits them as events so the React UI can log them.
#[tauri::command]
pub fn outlook_console(app: AppHandle, level: String, message: String) -> Result<(), String> {
    println!("[Onyx-Outlook Console][{}] {}", level, message);
    let _ = app.emit(
        "onyx-outlook-console",
        serde_json::json!({ "level": level, "message": message }),
    );
    Ok(())
}
