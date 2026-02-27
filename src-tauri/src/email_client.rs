// src-tauri/src/email_client.rs
// ─── Client-Side Email Client ────────────────────────────────────────────────
//
// 100% client-side — all IMAP/SMTP/OAuth happens on the user's device.
// No email data ever touches the VPS. OAuth tokens stored in OS keychain.
//
// Supports:
//   - Google (Gmail) via OAuth2 XOAUTH2
//   - Microsoft (Outlook/365) via OAuth2 XOAUTH2 (public client, no secret)
//   - Custom IMAP/SMTP via Thunderbird autoconfig (ISPDB)

use base64::{engine::general_purpose, Engine as _};
use lettre::message::header::ContentType;
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use reqwest;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::command;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAccount {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub provider: EmailProvider,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub auth_method: AuthMethod,
    /// OAuth access token (short-lived) — NOT persisted, refreshed at runtime
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub access_token: Option<String>,
    /// For manual auth only
    #[serde(skip_serializing)]
    #[allow(dead_code)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EmailProvider {
    Gmail,
    Microsoft,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthMethod {
    OAuth2,
    Password,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailHeader {
    pub uid: u32,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub date: String,
    pub preview: String,
    pub is_read: bool,
    pub has_attachments: bool,
    pub message_id: String,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailBody {
    pub uid: u32,
    pub html: Option<String>,
    pub text: Option<String>,
    pub attachments: Vec<EmailAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAttachment {
    pub filename: String,
    pub mime_type: String,
    pub size: usize,
    /// Base64 encoded content
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: EmailProvider,
    pub provider_name: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub auth_method: AuthMethod,
    pub oauth_auth_url: Option<String>,
    pub oauth_token_url: Option<String>,
    pub oauth_scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ComposeEmail {
    pub account_id: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub subject: String,
    pub body_html: String,
    pub body_text: String,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoconfigResult {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub imap_security: String,
    pub smtp_security: String,
}

// ─── Email Account Manager ───────────────────────────────────────────────────

#[allow(dead_code)]
pub struct EmailManager {
    pub accounts: Arc<Mutex<HashMap<String, EmailAccount>>>,
}

#[allow(dead_code)]
impl EmailManager {
    pub fn new() -> Self {
        Self {
            accounts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn add_account(&self, account: EmailAccount) -> Result<(), String> {
        let mut accounts = self.accounts.lock().map_err(|e| e.to_string())?;
        accounts.insert(account.id.clone(), account);
        Ok(())
    }

    pub fn remove_account(&self, id: &str) -> Result<(), String> {
        let mut accounts = self.accounts.lock().map_err(|e| e.to_string())?;
        accounts.remove(id);
        Ok(())
    }

    pub fn get_accounts(&self) -> Result<Vec<EmailAccount>, String> {
        let accounts = self.accounts.lock().map_err(|e| e.to_string())?;
        Ok(accounts.values().cloned().collect())
    }

    pub fn get_account(&self, id: &str) -> Result<EmailAccount, String> {
        let accounts = self.accounts.lock().map_err(|e| e.to_string())?;
        accounts
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Account not found: {}", id))
    }

    pub fn update_token(&self, id: &str, access_token: String) -> Result<(), String> {
        let mut accounts = self.accounts.lock().map_err(|e| e.to_string())?;
        if let Some(account) = accounts.get_mut(id) {
            account.access_token = Some(access_token);
            Ok(())
        } else {
            Err(format!("Account not found: {}", id))
        }
    }
}

// ─── Provider Detection ──────────────────────────────────────────────────────

#[command]
pub async fn detect_email_provider(email: String) -> Result<ProviderConfig, String> {
    let domain = email
        .split('@')
        .nth(1)
        .ok_or("Invalid email address")?
        .to_lowercase();

    // Google domains
    if domain == "gmail.com" || domain == "googlemail.com" {
        return Ok(ProviderConfig {
            provider: EmailProvider::Gmail,
            provider_name: "Google".to_string(),
            imap_host: "imap.gmail.com".to_string(),
            imap_port: 993,
            smtp_host: "smtp.gmail.com".to_string(),
            smtp_port: 587,
            auth_method: AuthMethod::OAuth2,
            oauth_auth_url: Some(
                "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
            ),
            oauth_token_url: Some(
                "https://oauth2.googleapis.com/token".to_string(),
            ),
            oauth_scopes: Some(vec![
                "https://mail.google.com/".to_string(),
                "openid".to_string(),
                "email".to_string(),
            ]),
        });
    }

    // Microsoft domains (including university tenants)
    let ms_domains = [
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "outlook.co.uk",
        "outlook.com.au",
    ];
    let is_microsoft = ms_domains.contains(&domain.as_str())
        || domain.ends_with(".edu.au")
        || domain.ends_with(".ac.uk")
        || domain.ends_with(".edu")
        || domain.ends_with(".ac.nz");

    if is_microsoft {
        return Ok(ProviderConfig {
            provider: EmailProvider::Microsoft,
            provider_name: "Microsoft".to_string(),
            imap_host: "outlook.office365.com".to_string(),
            imap_port: 993,
            smtp_host: "smtp.office365.com".to_string(),
            smtp_port: 587,
            auth_method: AuthMethod::OAuth2,
            oauth_auth_url: Some(
                "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".to_string(),
            ),
            oauth_token_url: Some(
                "https://login.microsoftonline.com/common/oauth2/v2.0/token".to_string(),
            ),
            oauth_scopes: Some(vec![
                "https://outlook.office.com/IMAP.AccessAsUser.All".to_string(),
                "https://outlook.office.com/SMTP.Send".to_string(),
                "offline_access".to_string(),
            ]),
        });
    }

    // Attempt Thunderbird autoconfig (ISPDB)
    let local_part = email
        .split('@')
        .next()
        .unwrap_or("")
        .to_string();
    match fetch_autoconfig(&domain, &local_part).await {
        Ok(config) => Ok(ProviderConfig {
            provider: EmailProvider::Custom,
            provider_name: domain.clone(),
            imap_host: config.imap_host,
            imap_port: config.imap_port,
            smtp_host: config.smtp_host,
            smtp_port: config.smtp_port,
            auth_method: AuthMethod::Password,
            oauth_auth_url: None,
            oauth_token_url: None,
            oauth_scopes: None,
        }),
        Err(_) => {
            // Fallback: guess standard settings
            Ok(ProviderConfig {
                provider: EmailProvider::Custom,
                provider_name: domain.clone(),
                imap_host: format!("imap.{}", domain),
                imap_port: 993,
                smtp_host: format!("smtp.{}", domain),
                smtp_port: 587,
                auth_method: AuthMethod::Password,
                oauth_auth_url: None,
                oauth_token_url: None,
                oauth_scopes: None,
            })
        }
    }
}

// ─── Thunderbird Autoconfig (ISPDB) ──────────────────────────────────────────

async fn fetch_autoconfig(domain: &str, local_part: &str) -> Result<AutoconfigResult, String> {
    let url = format!(
        "https://autoconfig.thunderbird.net/v1.1/{}",
        domain
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Autoconfig fetch failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Autoconfig returned {}", response.status()));
    }

    let text = response.text().await.map_err(|e| e.to_string())?;

    // Parse the XML response to extract IMAP/SMTP settings
    parse_autoconfig_xml(&text, domain, local_part)
}

fn parse_autoconfig_xml(xml: &str, domain: &str, local_part: &str) -> Result<AutoconfigResult, String> {
    // Simple XML parser for Thunderbird autoconfig format
    let mut imap_host = String::new();
    let mut imap_port = 993u16;
    let mut smtp_host = String::new();
    let mut smtp_port = 587u16;
    let mut imap_security = "SSL".to_string();
    let mut smtp_security = "STARTTLS".to_string();

    let mut in_incoming = false;
    let mut in_outgoing = false;
    let mut found_imap = false;
    let mut found_smtp = false;

    for line in xml.lines() {
        let trimmed = line.trim();

        if trimmed.contains("<incomingServer") && trimmed.contains("imap") {
            in_incoming = true;
            in_outgoing = false;
        } else if trimmed.contains("<outgoingServer") {
            in_outgoing = true;
            in_incoming = false;
        } else if trimmed.contains("</incomingServer") {
            in_incoming = false;
        } else if trimmed.contains("</outgoingServer") {
            in_outgoing = false;
        }

        if in_incoming && !found_imap {
            if let Some(val) = extract_xml_value(trimmed, "hostname") {
                imap_host = val;
            }
            if let Some(val) = extract_xml_value(trimmed, "port") {
                imap_port = val.parse().unwrap_or(993);
            }
            if let Some(val) = extract_xml_value(trimmed, "socketType") {
                imap_security = val;
            }
            if !imap_host.is_empty() {
                found_imap = true;
            }
        }

        if in_outgoing && !found_smtp {
            if let Some(val) = extract_xml_value(trimmed, "hostname") {
                smtp_host = val;
            }
            if let Some(val) = extract_xml_value(trimmed, "port") {
                smtp_port = val.parse().unwrap_or(587);
            }
            if let Some(val) = extract_xml_value(trimmed, "socketType") {
                smtp_security = val;
            }
            if !smtp_host.is_empty() {
                found_smtp = true;
            }
        }
    }

    if imap_host.is_empty() {
        return Err("Could not find IMAP settings in autoconfig".to_string());
    }

    // Replace Thunderbird ISPDB placeholders in hostnames
    imap_host = imap_host
        .replace("%EMAILDOMAIN%", domain)
        .replace("%EMAILLOCALPART%", local_part);
    smtp_host = smtp_host
        .replace("%EMAILDOMAIN%", domain)
        .replace("%EMAILLOCALPART%", local_part);

    Ok(AutoconfigResult {
        imap_host,
        imap_port,
        smtp_host,
        smtp_port,
        imap_security,
        smtp_security,
    })
}

fn extract_xml_value(line: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    if let Some(start) = line.find(&open) {
        if let Some(end) = line.find(&close) {
            let val_start = start + open.len();
            if val_start < end {
                return Some(line[val_start..end].trim().to_string());
            }
        }
    }
    None
}

// ─── OAuth2 Token Exchange ───────────────────────────────────────────────────

#[command]
pub async fn exchange_oauth_code(
    provider: String,
    code: String,
    redirect_uri: String,
    client_id: String,
    code_verifier: Option<String>,
) -> Result<OAuthTokenResponse, String> {
    let token_url = match provider.as_str() {
        "google" | "gmail" => "https://oauth2.googleapis.com/token",
        "microsoft" | "outlook" => {
            "https://login.microsoftonline.com/common/oauth2/v2.0/token"
        }
        _ => return Err("Unsupported OAuth provider".to_string()),
    };

    let mut params = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
    ];

    if let Some(verifier) = code_verifier {
        params.push(("code_verifier", verifier));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange error: {}", error_text));
    }

    response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

#[command]
pub async fn refresh_oauth_token(
    provider: String,
    refresh_token: String,
    client_id: String,
) -> Result<OAuthTokenResponse, String> {
    let token_url = match provider.as_str() {
        "google" | "gmail" => "https://oauth2.googleapis.com/token",
        "microsoft" | "outlook" => {
            "https://login.microsoftonline.com/common/oauth2/v2.0/token"
        }
        _ => return Err("Unsupported OAuth provider".to_string()),
    };

    let params = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh_token),
        ("client_id", &client_id),
    ];

    let client = reqwest::Client::new();
    let response = client
        .post(token_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Token refresh error: {}", error_text));
    }

    response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))
}

// ─── IMAP Operations ─────────────────────────────────────────────────────────

#[command]
pub async fn fetch_email_headers(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    offset: u32,
    limit: u32,
) -> Result<Vec<EmailHeader>, String> {
    tokio::task::spawn_blocking(move || {
        fetch_headers_sync(
            &imap_host,
            imap_port,
            &email,
            &auth_method,
            access_token.as_deref(),
            password.as_deref(),
            &folder,
            offset,
            limit,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn fetch_headers_sync(
    host: &str,
    port: u16,
    email: &str,
    auth_method: &str,
    access_token: Option<&str>,
    password: Option<&str>,
    folder: &str,
    offset: u32,
    limit: u32,
) -> Result<Vec<EmailHeader>, String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    // Authenticate
    let mut session = match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token for OAuth2")?;
            // Build XOAUTH2 SASL string: base64("user=<email>\x01auth=Bearer <token>\x01\x01")
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", email, token);
            let auth_b64 = general_purpose::STANDARD.encode(auth_string.as_bytes());

            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_b64 })
                .map_err(|(e, _)| format!("XOAUTH2 auth failed: {}", e))?
        }
        _ => {
            let pass = password.ok_or("No password for login auth")?;
            client
                .login(email, pass)
                .map_err(|(e, _)| format!("IMAP login failed: {}", e))?
        }
    };

    // Select folder
    let mailbox = session
        .select(folder)
        .map_err(|e| format!("Folder select failed: {}", e))?;

    let total = mailbox.exists;
    if total == 0 {
        session.logout().ok();
        return Ok(vec![]);
    }

    // Calculate range (fetch newest first)
    let end = total.saturating_sub(offset);
    let start = end.saturating_sub(limit).max(1);

    if start > end {
        session.logout().ok();
        return Ok(vec![]);
    }

    let range = format!("{}:{}", start, end);
    let fetch_result = session
        .fetch(
            &range,
            "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)] BODYSTRUCTURE)",
        )
        .map_err(|e| format!("IMAP fetch failed: {}", e))?;

    let mut headers = Vec::new();

    for msg in fetch_result.iter() {
        let uid = msg.uid.unwrap_or(0);
        let flags = msg.flags();
        let is_read = flags.iter().any(|f| matches!(f, imap::types::Flag::Seen));

        let mut from = String::new();
        let mut to = String::new();
        let mut subject = String::new();
        let mut date = String::new();
        let mut message_id = String::new();
        let mut in_reply_to = None;
        let references = Vec::new();

        // Parse envelope
        if let Some(envelope) = msg.envelope() {
            subject = envelope
                .subject
                .as_ref()
                .map(|s| decode_mime_header(s))
                .unwrap_or_default();

            from = envelope
                .from
                .as_ref()
                .and_then(|addrs| addrs.first())
                .map(|a| {
                    let name = a.name.as_ref().map(|n| decode_mime_header(n)).unwrap_or_default();
                    let mailbox = a.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string()).unwrap_or_default();
                    let host = a.host.as_ref().map(|h| String::from_utf8_lossy(h).to_string()).unwrap_or_default();
                    if name.is_empty() {
                        format!("{}@{}", mailbox, host)
                    } else {
                        name
                    }
                })
                .unwrap_or_default();

            to = envelope
                .to
                .as_ref()
                .and_then(|addrs| addrs.first())
                .map(|a| {
                    let mailbox = a.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string()).unwrap_or_default();
                    let host = a.host.as_ref().map(|h| String::from_utf8_lossy(h).to_string()).unwrap_or_default();
                    format!("{}@{}", mailbox, host)
                })
                .unwrap_or_default();

            date = envelope
                .date
                .as_ref()
                .map(|d| String::from_utf8_lossy(d).to_string())
                .unwrap_or_default();

            message_id = envelope
                .message_id
                .as_ref()
                .map(|m| String::from_utf8_lossy(m).to_string())
                .unwrap_or_default();

            in_reply_to = envelope
                .in_reply_to
                .as_ref()
                .map(|r| String::from_utf8_lossy(r).to_string());
        }

        // Check for attachments — detection deferred to body fetch in imap 3.x alpha
        let has_attachments = false;

        // Preview from text part (first 100 chars)
        let preview = String::new(); // Lazy-loaded on body fetch

        headers.push(EmailHeader {
            uid,
            from,
            to,
            subject,
            date,
            preview,
            is_read,
            has_attachments,
            message_id,
            in_reply_to,
            references,
        });
    }

    // Reverse so newest is first
    headers.reverse();

    session.logout().ok();
    Ok(headers)
}

// ─── Fetch Email Body ─────────────────────────────────────────────────────────

#[command]
pub async fn fetch_email_body(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    uid: u32,
) -> Result<EmailBody, String> {
    tokio::task::spawn_blocking(move || {
        fetch_body_sync(
            &imap_host,
            imap_port,
            &email,
            &auth_method,
            access_token.as_deref(),
            password.as_deref(),
            &folder,
            uid,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn fetch_body_sync(
    host: &str,
    port: u16,
    email: &str,
    auth_method: &str,
    access_token: Option<&str>,
    password: Option<&str>,
    folder: &str,
    uid: u32,
) -> Result<EmailBody, String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token for OAuth2")?;
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", email, token);
            let auth_b64 = general_purpose::STANDARD.encode(auth_string.as_bytes());
            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_b64 })
                .map_err(|(e, _)| format!("XOAUTH2 auth failed: {}", e))?
        }
        _ => {
            let pass = password.ok_or("No password")?;
            client
                .login(email, pass)
                .map_err(|(e, _)| format!("IMAP login failed: {}", e))?
        }
    };

    session
        .select(folder)
        .map_err(|e| format!("Folder select failed: {}", e))?;

    let uid_str = uid.to_string();
    let fetch_result = session
        .uid_fetch(&uid_str, "(BODY[] FLAGS)")
        .map_err(|e| format!("Fetch body failed: {}", e))?;

    let msg = fetch_result
        .iter()
        .next()
        .ok_or("Message not found")?;

    let body_bytes = msg.body().unwrap_or_default();

    // Parse the raw email using a simple approach
    let raw = String::from_utf8_lossy(body_bytes).to_string();

    let (html, text) = parse_email_body(&raw);

    // Mark as read
    let _ = session.uid_store(&uid_str, "+FLAGS (\\Seen)");

    session.logout().ok();

    Ok(EmailBody {
        uid,
        html,
        text,
        attachments: vec![], // Attachment parsing deferred for performance
    })
}

fn parse_email_body(raw: &str) -> (Option<String>, Option<String>) {
    // Find boundary for multipart messages
    let mut html_body = None;
    let mut text_body = None;

    if let Some(boundary_start) = raw.find("boundary=") {
        let boundary_value = &raw[boundary_start + 9..];
        let boundary = if boundary_value.starts_with('"') {
            // Quoted boundary
            boundary_value[1..]
                .split('"')
                .next()
                .unwrap_or("")
                .to_string()
        } else {
            boundary_value
                .split(|c: char| c.is_whitespace() || c == ';')
                .next()
                .unwrap_or("")
                .to_string()
        };

        if !boundary.is_empty() {
            let delimiter = format!("--{}", boundary);
            let parts: Vec<&str> = raw.split(&delimiter).collect();

            for part in parts.iter().skip(1) {
                let lower = part.to_lowercase();
                if lower.contains("content-type: text/html") {
                    if let Some(body_start) = part.find("\r\n\r\n").or_else(|| part.find("\n\n")) {
                        let offset = if part[body_start..].starts_with("\r\n\r\n") { 4 } else { 2 };
                        let body = &part[body_start + offset..];
                        // Remove trailing boundary marker
                        let cleaned = body.trim_end_matches("--").trim();
                        if lower.contains("content-transfer-encoding: base64") {
                            html_body = Some(
                                String::from_utf8(
                                    general_purpose::STANDARD
                                        .decode(cleaned.replace(['\r', '\n'], "").as_bytes())
                                        .unwrap_or_default(),
                                )
                                .unwrap_or_default(),
                            );
                        } else {
                            html_body = Some(cleaned.to_string());
                        }
                    }
                } else if lower.contains("content-type: text/plain") {
                    if let Some(body_start) = part.find("\r\n\r\n").or_else(|| part.find("\n\n")) {
                        let offset = if part[body_start..].starts_with("\r\n\r\n") { 4 } else { 2 };
                        let body = &part[body_start + offset..];
                        let cleaned = body.trim_end_matches("--").trim();
                        if lower.contains("content-transfer-encoding: base64") {
                            text_body = Some(
                                String::from_utf8(
                                    general_purpose::STANDARD
                                        .decode(cleaned.replace(['\r', '\n'], "").as_bytes())
                                        .unwrap_or_default(),
                                )
                                .unwrap_or_default(),
                            );
                        } else {
                            text_body = Some(cleaned.to_string());
                        }
                    }
                }
            }
        }
    }

    // Single-part message fallback
    if html_body.is_none() && text_body.is_none() {
        if let Some(body_start) = raw.find("\r\n\r\n").or_else(|| raw.find("\n\n")) {
            let offset = if raw[body_start..].starts_with("\r\n\r\n") { 4 } else { 2 };
            let body = &raw[body_start + offset..];
            if raw.to_lowercase().contains("content-type: text/html") {
                html_body = Some(body.to_string());
            } else {
                text_body = Some(body.to_string());
            }
        }
    }

    (html_body, text_body)
}

// ─── SMTP Send ────────────────────────────────────────────────────────────────

#[command]
pub async fn send_email(
    smtp_host: String,
    smtp_port: u16,
    from_email: String,
    from_name: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    to: Vec<String>,
    cc: Vec<String>,
    subject: String,
    body_html: String,
    body_text: String,
    in_reply_to: Option<String>,
    references_header: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        send_email_sync(
            &smtp_host,
            smtp_port,
            &from_email,
            &from_name,
            &auth_method,
            access_token.as_deref(),
            password.as_deref(),
            &to,
            &cc,
            &subject,
            &body_html,
            &body_text,
            in_reply_to.as_deref(),
            references_header.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn send_email_sync(
    host: &str,
    port: u16,
    from_email: &str,
    from_name: &str,
    auth_method: &str,
    access_token: Option<&str>,
    password: Option<&str>,
    to: &[String],
    cc: &[String],
    subject: &str,
    body_html: &str,
    _body_text: &str,
    in_reply_to: Option<&str>,
    references_header: Option<&str>,
) -> Result<(), String> {
    let from_mailbox: Mailbox = format!("{} <{}>", from_name, from_email)
        .parse()
        .map_err(|e: lettre::address::AddressError| format!("Invalid from address: {}", e))?;

    let mut builder = Message::builder()
        .from(from_mailbox)
        .subject(subject);

    for addr in to {
        let mailbox: Mailbox = addr
            .parse()
            .map_err(|e: lettre::address::AddressError| format!("Invalid to address: {}", e))?;
        builder = builder.to(mailbox);
    }

    for addr in cc {
        let mailbox: Mailbox = addr
            .parse()
            .map_err(|e: lettre::address::AddressError| format!("Invalid cc address: {}", e))?;
        builder = builder.cc(mailbox);
    }

    if let Some(reply_to) = in_reply_to {
        builder = builder.in_reply_to(reply_to.to_string());
    }

    if let Some(refs) = references_header {
        builder = builder.references(refs.to_string());
    }

    let email = builder
        .header(ContentType::TEXT_HTML)
        .body(body_html.to_string())
        .map_err(|e| format!("Failed to build email: {}", e))?;

    // Build SMTP transport
    let tls_params = TlsParameters::builder(host.to_string())
        .build_native()
        .map_err(|e| format!("TLS params error: {}", e))?;

    let mut transport_builder = SmtpTransport::starttls_relay(host)
        .map_err(|e| format!("SMTP relay error: {}", e))?
        .port(port)
        .tls(Tls::Required(tls_params));

    match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token for OAuth2 SMTP")?;
            // XOAUTH2 via lettre requires using a custom mechanism
            // We encode the XOAUTH2 string as the password per RFC
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", from_email, token);
            let auth_b64 = general_purpose::STANDARD.encode(auth_string.as_bytes());
            transport_builder = transport_builder
                .credentials(Credentials::new(from_email.to_string(), auth_b64))
                .authentication(vec![Mechanism::Xoauth2]);
        }
        _ => {
            let pass = password.ok_or("No password for SMTP")?;
            transport_builder = transport_builder
                .credentials(Credentials::new(from_email.to_string(), pass.to_string()));
        }
    }

    let transport = transport_builder.build();

    transport
        .send(&email)
        .map_err(|e| format!("SMTP send failed: {}", e))?;

    Ok(())
}

// ─── IMAP Folder List ─────────────────────────────────────────────────────────

#[command]
pub async fn list_email_folders(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        list_folders_sync(
            &imap_host,
            imap_port,
            &email,
            &auth_method,
            access_token.as_deref(),
            password.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn list_folders_sync(
    host: &str,
    port: u16,
    email: &str,
    auth_method: &str,
    access_token: Option<&str>,
    password: Option<&str>,
) -> Result<Vec<String>, String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token")?;
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", email, token);
            let auth_b64 = general_purpose::STANDARD.encode(auth_string.as_bytes());
            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_b64 })
                .map_err(|(e, _)| format!("Auth failed: {}", e))?
        }
        _ => {
            let pass = password.ok_or("No password")?;
            client
                .login(email, pass)
                .map_err(|(e, _)| format!("Login failed: {}", e))?
        }
    };

    let folders = session
        .list(None, Some("*"))
        .map_err(|e| format!("List folders failed: {}", e))?;

    let folder_names: Vec<String> = folders.iter().map(|f| f.name().to_string()).collect();

    session.logout().ok();
    Ok(folder_names)
}

// ─── XOAUTH2 Authenticator ──────────────────────────────────────────────────

struct XOAuth2Authenticator {
    response: String,
}

impl imap::Authenticator for XOAuth2Authenticator {
    type Response = String;

    fn process(&self, _challenge: &[u8]) -> Self::Response {
        self.response.clone()
    }
}

// ─── Helper: MIME Header Decoding ─────────────────────────────────────────────

fn decode_mime_header(data: &[u8]) -> String {
    let raw = String::from_utf8_lossy(data).to_string();

    // Handle RFC 2047 encoded words: =?charset?encoding?data?=
    if raw.contains("=?") {
        let mut result = raw.clone();
        while let Some(start) = result.find("=?") {
            if let Some(end) = result[start + 2..].find("?=") {
                let encoded = &result[start..start + 2 + end + 2];
                let parts: Vec<&str> = encoded[2..encoded.len() - 2].splitn(3, '?').collect();
                if parts.len() == 3 {
                    let _charset = parts[0];
                    let encoding = parts[1].to_uppercase();
                    let data = parts[2];

                    let decoded = match encoding.as_str() {
                        "B" => {
                            general_purpose::STANDARD
                                .decode(data)
                                .ok()
                                .and_then(|b| String::from_utf8(b).ok())
                                .unwrap_or_else(|| data.to_string())
                        }
                        "Q" => {
                            // Quoted-printable decoding
                            data.replace('_', " ")
                                .replace("=20", " ")
                                .to_string()
                        }
                        _ => data.to_string(),
                    };

                    result = result.replace(encoded, &decoded);
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        result
    } else {
        raw
    }
}
