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
use lettre::message::{Mailbox, MultiPart, SinglePart, Attachment};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use mailparse::parse_mail;
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
            // ISPDB miss — try MX-based detection (DNS-over-HTTPS)
            if let Ok(mx_base) = resolve_mx_base_domain(&domain).await {
                // Try ISPDB for the MX provider domain
                if let Ok(config) = fetch_autoconfig(&mx_base, &local_part).await {
                    return Ok(ProviderConfig {
                        provider: EmailProvider::Custom,
                        provider_name: mx_base.clone(),
                        imap_host: config.imap_host,
                        imap_port: config.imap_port,
                        smtp_host: config.smtp_host,
                        smtp_port: config.smtp_port,
                        auth_method: AuthMethod::Password,
                        oauth_auth_url: None,
                        oauth_token_url: None,
                        oauth_scopes: None,
                    });
                }
                // ISPDB miss for MX domain too — guess imap/smtp from MX base
                return Ok(ProviderConfig {
                    provider: EmailProvider::Custom,
                    provider_name: mx_base.clone(),
                    imap_host: format!("imap.{}", mx_base),
                    imap_port: 993,
                    smtp_host: format!("smtp.{}", mx_base),
                    smtp_port: 587,
                    auth_method: AuthMethod::Password,
                    oauth_auth_url: None,
                    oauth_token_url: None,
                    oauth_scopes: None,
                });
            }

            // Final fallback: guess from original domain
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

// ─── MX-based provider detection (DNS-over-HTTPS via Cloudflare) ─────────────

/// Query MX records for `domain` via Cloudflare DoH and return the base domain
/// of the highest-priority MX host (e.g. mailserver.purelymail.com → purelymail.com).
async fn resolve_mx_base_domain(domain: &str) -> Result<String, String> {
    let url = format!(
        "https://cloudflare-dns.com/dns-query?name={}&type=MX",
        domain
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("Accept", "application/dns-json")
        .send()
        .await
        .map_err(|e| format!("MX DoH query failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("MX DoH returned {}", response.status()));
    }

    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    // Parse the Answer array — each entry has "data": "10 mailserver.purelymail.com."
    let answers = body["Answer"]
        .as_array()
        .ok_or("No MX answers")?;

    let mut best_priority = u16::MAX;
    let mut best_host = String::new();

    for answer in answers {
        if answer["type"].as_u64() != Some(15) {
            // type 15 = MX
            continue;
        }
        if let Some(data) = answer["data"].as_str() {
            let parts: Vec<&str> = data.split_whitespace().collect();
            if parts.len() == 2 {
                let priority: u16 = parts[0].parse().unwrap_or(u16::MAX);
                let host = parts[1].trim_end_matches('.');
                if priority < best_priority {
                    best_priority = priority;
                    best_host = host.to_lowercase();
                }
            }
        }
    }

    if best_host.is_empty() {
        return Err("No valid MX record found".to_string());
    }

    // Extract base domain: take last two labels (e.g. mailserver.purelymail.com → purelymail.com)
    let labels: Vec<&str> = best_host.split('.').collect();
    if labels.len() >= 2 {
        Ok(format!("{}.{}", labels[labels.len() - 2], labels[labels.len() - 1]))
    } else {
        Ok(best_host)
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
    client_secret: Option<String>,
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

    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
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
            // Build XOAUTH2 SASL string (raw — imap crate base64-encodes internally)
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", email, token);

            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_string })
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
                    let email_addr = format!("{}@{}", mailbox, host);
                    if name.is_empty() {
                        email_addr
                    } else {
                        format!("{} <{}>", name, email_addr)
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

        // Check for attachments from BODYSTRUCTURE
        let has_attachments = msg.bodystructure()
            .map(|bs| {
                fn check_attachment(bs: &imap_proto::types::BodyStructure) -> bool {
                    match bs {
                        imap_proto::types::BodyStructure::Multipart { bodies, .. } => {
                            bodies.iter().any(|b| check_attachment(b))
                        }
                        imap_proto::types::BodyStructure::Basic { other: _, common, .. }
                        | imap_proto::types::BodyStructure::Text { common, .. }
                        | imap_proto::types::BodyStructure::Message { common, .. } => {
                            // Check Content-Disposition: attachment
                            if let Some(ref disp) = common.disposition {
                                if disp.ty.eq_ignore_ascii_case("attachment") {
                                    return true;
                                }
                            }
                            // Check if MIME type suggests attachment (not text/html, not text/plain)
                            let mime = common.ty.ty.to_lowercase();
                            let subtype = common.ty.subtype.to_lowercase();
                            if mime == "application" || mime == "image" || mime == "audio" || mime == "video" {
                                return true;
                            }
                            if mime == "text" && subtype != "plain" && subtype != "html" {
                                return true;
                            }
                            false
                        }
                    }
                }
                check_attachment(bs)
            })
            .unwrap_or(false);

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
            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_string })
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

    // Parse with mailparse for proper MIME handling (nested multipart, attachments, charset)
    let (html, text, attachments) = parse_email_parts(body_bytes);

    // Mark as read
    let _ = session.uid_store(&uid_str, "+FLAGS (\\Seen)");

    session.logout().ok();

    Ok(EmailBody {
        uid,
        html,
        text,
        attachments,
    })
}

// ─── MIME Parser (mailparse) ──────────────────────────────────────────────────

fn parse_email_parts(raw: &[u8]) -> (Option<String>, Option<String>, Vec<EmailAttachment>) {
    let mut html_body = None;
    let mut text_body = None;
    let mut attachments = Vec::new();

    match parse_mail(raw) {
        Ok(parsed) => {
            extract_mime_parts(&parsed, &mut html_body, &mut text_body, &mut attachments);
        }
        Err(e) => {
            eprintln!("[Email] mailparse error: {}", e);
            // Fallback: treat as plain text
            let raw_str = String::from_utf8_lossy(raw);
            if let Some(body_start) = raw_str.find("\r\n\r\n").or_else(|| raw_str.find("\n\n")) {
                let offset = if raw_str[body_start..].starts_with("\r\n\r\n") { 4 } else { 2 };
                let body = raw_str[body_start + offset..].to_string();
                if raw_str.to_lowercase().contains("content-type: text/html") {
                    html_body = Some(body);
                } else {
                    text_body = Some(body);
                }
            }
        }
    }

    (html_body, text_body, attachments)
}

fn extract_mime_parts(
    mail: &mailparse::ParsedMail,
    html: &mut Option<String>,
    text: &mut Option<String>,
    attachments: &mut Vec<EmailAttachment>,
) {
    let content_type = mail.ctype.mimetype.to_lowercase();

    // Check Content-Disposition for attachment detection
    let disposition = mail
        .headers
        .iter()
        .find(|h| h.get_key().eq_ignore_ascii_case("content-disposition"))
        .map(|h| h.get_value())
        .unwrap_or_default()
        .to_lowercase();

    let is_attachment = disposition.starts_with("attachment")
        || (disposition.starts_with("inline")
            && !content_type.starts_with("text/")
            && !content_type.starts_with("multipart/"));

    if !mail.subparts.is_empty() {
        // Multipart — recurse into sub-parts
        for subpart in &mail.subparts {
            extract_mime_parts(subpart, html, text, attachments);
        }
    } else if is_attachment
        || (!content_type.starts_with("text/") && !content_type.starts_with("multipart/"))
    {
        // Attachment (binary part or explicit attachment disposition)
        if let Ok(body) = mail.get_body_raw() {
            if body.is_empty() {
                return;
            }
            let filename = mail
                .ctype
                .params
                .get("name")
                .cloned()
                .or_else(|| {
                    // Try Content-Disposition filename parameter
                    disposition.split(';').find_map(|p: &str| {
                        let p = p.trim();
                        if p.starts_with("filename=") {
                            Some(
                                p[9..]
                                    .trim_matches('"')
                                    .trim_matches('\'')
                                    .to_string(),
                            )
                        } else {
                            None
                        }
                    })
                })
                .unwrap_or_else(|| "attachment".to_string());

            attachments.push(EmailAttachment {
                filename,
                mime_type: content_type,
                size: body.len(),
                data: general_purpose::STANDARD.encode(&body),
            });
        }
    } else if content_type == "text/html" && html.is_none() {
        if let Ok(body) = mail.get_body() {
            *html = Some(body);
        }
    } else if content_type == "text/plain" && text.is_none() {
        if let Ok(body) = mail.get_body() {
            *text = Some(body);
        }
    }
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
    attachments: Option<Vec<EmailAttachmentInput>>,
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
            &attachments.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAttachmentInput {
    pub filename: String,
    pub mime_type: String,
    pub data_base64: String,
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
    attachments: &[EmailAttachmentInput],
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

    // Build email body — multipart if attachments present, simple otherwise
    let email = if attachments.is_empty() {
        builder
            .header(ContentType::TEXT_HTML)
            .body(body_html.to_string())
            .map_err(|e| format!("Failed to build email: {}", e))?
    } else {
        // Build HTML body part
        let html_part = SinglePart::builder()
            .header(ContentType::TEXT_HTML)
            .body(body_html.to_string());

        let mut multipart = MultiPart::mixed().singlepart(html_part);

        // Add each attachment
        for att in attachments {
            let file_data = general_purpose::STANDARD
                .decode(&att.data_base64)
                .map_err(|e| format!("Failed to decode attachment '{}': {}", att.filename, e))?;
            let content_type: ContentType = att.mime_type.parse().unwrap_or(ContentType::TEXT_PLAIN);
            let attachment_part = Attachment::new(att.filename.clone())
                .body(file_data, content_type);
            multipart = multipart.singlepart(attachment_part);
        }

        builder
            .multipart(multipart)
            .map_err(|e| format!("Failed to build multipart email: {}", e))?
    };

    // Build SMTP transport
    let tls_params = TlsParameters::builder(host.to_string())
        .build_rustls()
        .map_err(|e| format!("TLS params error: {}", e))?;

    let mut transport_builder = SmtpTransport::starttls_relay(host)
        .map_err(|e| format!("SMTP relay error: {}", e))?
        .port(port)
        .tls(Tls::Required(tls_params));

    match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token for OAuth2 SMTP")?;
            // lettre's Xoauth2 mechanism builds the SASL string internally.
            // Pass the raw OAuth2 access token as the password.
            transport_builder = transport_builder
                .credentials(Credentials::new(from_email.to_string(), token.to_string()))
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
            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_string })
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

// ─── Move Email (IMAP COPY + Delete) ──────────────────────────────────────────

#[command]
pub async fn move_email(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    uid: u32,
    target_folder: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        move_email_sync(
            &imap_host, imap_port, &email, &auth_method,
            access_token.as_deref(), password.as_deref(),
            &folder, uid, &target_folder,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn move_email_sync(
    host: &str, port: u16, email: &str, auth_method: &str,
    access_token: Option<&str>, password: Option<&str>,
    folder: &str, uid: u32, target_folder: &str,
) -> Result<(), String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = imap_authenticate(client, email, auth_method, access_token, password)?;

    session.select(folder).map_err(|e| format!("Folder select failed: {}", e))?;

    let uid_str = uid.to_string();

    // COPY to target folder, then mark deleted + expunge
    session.uid_copy(&uid_str, target_folder)
        .map_err(|e| format!("IMAP COPY failed: {}", e))?;

    session.uid_store(&uid_str, "+FLAGS (\\Deleted)")
        .map_err(|e| format!("IMAP store failed: {}", e))?;

    session.expunge().map_err(|e| format!("IMAP expunge failed: {}", e))?;

    session.logout().ok();
    Ok(())
}

// ─── Delete Email ─────────────────────────────────────────────────────────────

#[command]
pub async fn delete_email(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    uid: u32,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        delete_email_sync(
            &imap_host, imap_port, &email, &auth_method,
            access_token.as_deref(), password.as_deref(),
            &folder, uid,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn delete_email_sync(
    host: &str, port: u16, email: &str, auth_method: &str,
    access_token: Option<&str>, password: Option<&str>,
    folder: &str, uid: u32,
) -> Result<(), String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = imap_authenticate(client, email, auth_method, access_token, password)?;

    session.select(folder).map_err(|e| format!("Folder select failed: {}", e))?;

    let uid_str = uid.to_string();
    session.uid_store(&uid_str, "+FLAGS (\\Deleted)")
        .map_err(|e| format!("IMAP store failed: {}", e))?;
    session.expunge().map_err(|e| format!("IMAP expunge failed: {}", e))?;

    session.logout().ok();
    Ok(())
}

// ─── Batch Delete Emails ──────────────────────────────────────────────────────

#[command]
pub async fn batch_delete_emails(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    uids: Vec<u32>,
) -> Result<(), String> {
    if uids.is_empty() { return Ok(()); }
    tokio::task::spawn_blocking(move || {
        batch_delete_emails_sync(
            &imap_host, imap_port, &email, &auth_method,
            access_token.as_deref(), password.as_deref(),
            &folder, &uids,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn batch_delete_emails_sync(
    host: &str, port: u16, email: &str, auth_method: &str,
    access_token: Option<&str>, password: Option<&str>,
    folder: &str, uids: &[u32],
) -> Result<(), String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = imap_authenticate(client, email, auth_method, access_token, password)?;
    session.select(folder).map_err(|e| format!("Folder select failed: {}", e))?;

    // Build comma-separated UID sequence set: "1,2,3,4,5"
    let uid_set: String = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
    session.uid_store(&uid_set, "+FLAGS (\\Deleted)")
        .map_err(|e| format!("IMAP store failed: {}", e))?;
    session.expunge().map_err(|e| format!("IMAP expunge failed: {}", e))?;

    session.logout().ok();
    Ok(())
}

// ─── Mark Email Read/Unread ───────────────────────────────────────────────────

#[command]
pub async fn mark_email_flag(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    uid: u32,
    flag: String,
    add: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        mark_flag_sync(
            &imap_host, imap_port, &email, &auth_method,
            access_token.as_deref(), password.as_deref(),
            &folder, uid, &flag, add,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn mark_flag_sync(
    host: &str, port: u16, email: &str, auth_method: &str,
    access_token: Option<&str>, password: Option<&str>,
    folder: &str, uid: u32, flag: &str, add: bool,
) -> Result<(), String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = imap_authenticate(client, email, auth_method, access_token, password)?;

    session.select(folder).map_err(|e| format!("Folder select failed: {}", e))?;

    let uid_str = uid.to_string();
    let store_cmd = if add {
        format!("+FLAGS ({})", flag)
    } else {
        format!("-FLAGS ({})", flag)
    };

    session.uid_store(&uid_str, &store_cmd)
        .map_err(|e| format!("IMAP store failed: {}", e))?;

    session.logout().ok();
    Ok(())
}

// ─── Fetch Raw Headers (for spam analysis) ────────────────────────────────────

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

#[command]
pub async fn fetch_spam_analysis(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    uid: u32,
) -> Result<SpamAnalysis, String> {
    tokio::task::spawn_blocking(move || {
        fetch_spam_sync(
            &imap_host, imap_port, &email, &auth_method,
            access_token.as_deref(), password.as_deref(),
            &folder, uid,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn fetch_spam_sync(
    host: &str, port: u16, email: &str, auth_method: &str,
    access_token: Option<&str>, password: Option<&str>,
    folder: &str, uid: u32,
) -> Result<SpamAnalysis, String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = imap_authenticate(client, email, auth_method, access_token, password)?;

    session.select(folder).map_err(|e| format!("Folder select failed: {}", e))?;

    let uid_str = uid.to_string();
    let fetch_result = session
        .uid_fetch(&uid_str, "BODY.PEEK[HEADER.FIELDS (X-Spam-Score X-Spam-Status X-Spam-Report X-Spam-Flag Authentication-Results ARC-Authentication-Results DKIM-Signature List-Unsubscribe List-Unsubscribe-Post Received-SPF)]")
        .map_err(|e| format!("Fetch spam headers failed: {}", e))?;

    let msg = fetch_result.iter().next().ok_or("Message not found")?;
    let header_bytes = msg.header().unwrap_or_default();
    let headers_raw = String::from_utf8_lossy(header_bytes).to_string();

    session.logout().ok();

    analyze_spam_from_headers(&headers_raw)
}

fn analyze_spam_from_headers(headers: &str) -> Result<SpamAnalysis, String> {
    let headers_lower = headers.to_lowercase();
    let mut score: f64 = 0.0;
    let mut reasons = Vec::new();

    // Parse X-Spam-Score header
    if let Some(score_line) = extract_header_value(headers, "X-Spam-Score") {
        if let Ok(s) = score_line.trim().parse::<f64>() {
            score = s;
        }
    }

    // Parse X-Spam-Status for details
    if let Some(status) = extract_header_value(headers, "X-Spam-Status") {
        let status_lower = status.to_lowercase();
        if status_lower.starts_with("yes") {
            score = score.max(5.0);
        }
        // Extract individual test scores: tests=TEST1=1.2,TEST2=3.4
        if let Some(tests_start) = status.find("tests=") {
            let tests_str = &status[tests_start + 6..];
            let tests_end = tests_str.find(|c: char| c == '\r' || c == '\n').unwrap_or(tests_str.len());
            let tests = &tests_str[..tests_end];
            for test in tests.split(',') {
                let parts: Vec<&str> = test.trim().splitn(2, '=').collect();
                if parts.len() == 2 {
                    let name = parts[0].trim().to_string();
                    let s: f64 = parts[1].trim().parse().unwrap_or(0.0);
                    if s.abs() > 0.01 {
                        reasons.push(SpamReason {
                            name: name.clone(),
                            score: s,
                            description: format!("{}: {:.1}", name, s),
                        });
                    }
                }
            }
        }
    }

    // SPF check
    let spf_pass = headers_lower.contains("spf=pass")
        || headers_lower.contains("received-spf: pass");

    // DKIM check
    let dkim_pass = headers_lower.contains("dkim=pass");

    // DMARC check
    let dmarc_pass = headers_lower.contains("dmarc=pass");

    // Auth failures add to spam score
    if !spf_pass {
        score += 2.0;
        reasons.push(SpamReason {
            name: "SPF_FAIL".to_string(),
            score: 2.0,
            description: "SPF authentication failed".to_string(),
        });
    }
    if !dkim_pass {
        score += 1.5;
        reasons.push(SpamReason {
            name: "DKIM_FAIL".to_string(),
            score: 1.5,
            description: "DKIM signature missing/failed".to_string(),
        });
    }
    if !dmarc_pass {
        score += 1.5;
        reasons.push(SpamReason {
            name: "DMARC_FAIL".to_string(),
            score: 1.5,
            description: "DMARC policy check failed".to_string(),
        });
    }

    // List-Unsubscribe header
    let has_unsubscribe = headers_lower.contains("list-unsubscribe");
    let unsubscribe_url = extract_header_value(headers, "List-Unsubscribe")
        .and_then(|v| {
            // Extract URL from <url> format
            if let Some(start) = v.find('<') {
                if let Some(end) = v[start..].find('>') {
                    let url = &v[start + 1..start + end];
                    if url.starts_with("http") {
                        return Some(url.to_string());
                    }
                }
            }
            None
        });
    let list_unsubscribe = extract_header_value(headers, "List-Unsubscribe");

    // Apply client-side heuristics if no X-Spam-Score header present  
    if score == 0.0 && reasons.is_empty() && !spf_pass && !dkim_pass {
        score = 5.0;
    }

    let is_spam = score >= 5.0;

    // Sort reasons by score descending
    reasons.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    Ok(SpamAnalysis {
        score,
        is_spam,
        reasons,
        spf_pass,
        dkim_pass,
        dmarc_pass,
        has_unsubscribe,
        unsubscribe_url,
        list_unsubscribe,
    })
}

fn extract_header_value(headers: &str, name: &str) -> Option<String> {
    let search = format!("{}:", name);
    let search_lower = search.to_lowercase();
    for line in headers.lines() {
        if line.to_lowercase().starts_with(&search_lower) {
            let value = line[search.len()..].trim().to_string();
            return Some(value);
        }
    }
    None
}

// ─── IMAP Search ──────────────────────────────────────────────────────────────

#[command]
pub async fn search_emails(
    imap_host: String,
    imap_port: u16,
    email: String,
    auth_method: String,
    access_token: Option<String>,
    password: Option<String>,
    folder: String,
    query: String,
) -> Result<Vec<u32>, String> {
    tokio::task::spawn_blocking(move || {
        search_emails_sync(
            &imap_host, imap_port, &email, &auth_method,
            access_token.as_deref(), password.as_deref(),
            &folder, &query,
        )
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn search_emails_sync(
    host: &str, port: u16, email: &str, auth_method: &str,
    access_token: Option<&str>, password: Option<&str>,
    folder: &str, query: &str,
) -> Result<Vec<u32>, String> {
    let client = imap::ClientBuilder::new(host, port)
        .connect()
        .map_err(|e| format!("IMAP connect failed: {}", e))?;

    let mut session = imap_authenticate(client, email, auth_method, access_token, password)?;

    session.select(folder).map_err(|e| format!("Folder select failed: {}", e))?;

    // IMAP SEARCH with subject/from/body
    let search_query = format!(
        "OR OR SUBJECT \"{}\" FROM \"{}\" BODY \"{}\"",
        query, query, query
    );

    let uids = session.uid_search(&search_query)
        .map_err(|e| format!("IMAP search failed: {}", e))?;

    let result: Vec<u32> = uids.into_iter().collect();

    session.logout().ok();
    Ok(result)
}

// ─── Sanitize HTML for rendering ──────────────────────────────────────────────

#[command]
pub fn sanitize_email_html(html: String, dark_mode: bool) -> String {
    let mut sanitized = html;

    // 1. Remove script tags and content
    while let Some(start) = sanitized.to_lowercase().find("<script") {
        if let Some(end) = sanitized.to_lowercase()[start..].find("</script>") {
            sanitized = format!("{}{}", &sanitized[..start], &sanitized[start + end + 9..]);
        } else {
            // Unclosed script tag — remove to end
            sanitized = sanitized[..start].to_string();
            break;
        }
    }

    // 2. Remove event handlers (onclick, onload, onerror, etc.)
    let event_pattern = regex_lite::Regex::new(r#"\s+on\w+\s*=\s*["'][^"']*["']"#).unwrap();
    sanitized = event_pattern.replace_all(&sanitized, "").to_string();

    // 3. Remove javascript: URLs
    let js_pattern = regex_lite::Regex::new(r#"href\s*=\s*["']javascript:[^"']*["']"#).unwrap();
    sanitized = js_pattern.replace_all(&sanitized, r##"href="#""##).to_string();

    // 4. Remove <style> blocks that might conflict
    // Keep them but inject our overrides after

    // 5. Dark mode CSS injection
    let dark_css = if dark_mode {
        r#"<style>
            *, *::before, *::after {
                color: #e4e4e7 !important;
                border-color: #3f3f46 !important;
            }
            body, html { background-color: #18181b !important; }
            div, td, th, tr, table, section, article, header, footer, main, aside, nav {
                background-color: transparent !important;
                background-image: none !important;
            }
            a, a * { color: #93c5fd !important; }
            blockquote { border-left-color: #52525b !important; color: #a1a1aa !important; }
            hr { border-color: #3f3f46 !important; }
            img { max-width: 100% !important; height: auto !important; }
            pre, code { background-color: #27272a !important; color: #d4d4d8 !important; }
            [style*="background"] {
                background-color: transparent !important;
                background-image: none !important;
            }
            [style*="color"] { color: #e4e4e7 !important; }
            font { color: #e4e4e7 !important; }
            /* Preserve dark-on-light images */
            img[style*="background"], img[class*="logo"] { filter: none !important; }
        </style>"#
    } else {
        r#"<style>
            body { background-color: #ffffff; color: #333333; }
            img { max-width: 100% !important; height: auto !important; }
        </style>"#
    };

    // 6. Build complete document
    let base_css = r#"<style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            padding: 16px;
            margin: 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
        }
        img { max-width: 100% !important; height: auto !important; }
        a { text-decoration: underline; }
        table { max-width: 100% !important; }
        pre { white-space: pre-wrap; overflow-x: auto; }
    </style>"#;

    format!(
        "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>{}{}</head><body>{}</body></html>",
        base_css, dark_css, sanitized
    )
}

// ─── Shared IMAP Auth Helper ──────────────────────────────────────────────────

fn imap_authenticate<C: std::io::Read + std::io::Write>(
    client: imap::Client<C>,
    email: &str,
    auth_method: &str,
    access_token: Option<&str>,
    password: Option<&str>,
) -> Result<imap::Session<C>, String> {
    match auth_method {
        "oauth2" => {
            let token = access_token.ok_or("No access token for OAuth2")?;
            let auth_string = format!("user={}\x01auth=Bearer {}\x01\x01", email, token);
            client
                .authenticate("XOAUTH2", &XOAuth2Authenticator { response: auth_string })
                .map_err(|(e, _)| format!("XOAUTH2 auth failed: {}", e))
        }
        _ => {
            let pass = password.ok_or("No password")?;
            client
                .login(email, pass)
                .map_err(|(e, _)| format!("IMAP login failed: {}", e))
        }
    }
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
