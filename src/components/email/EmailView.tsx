import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { start, cancel, onUrl } from '@fabianlars/tauri-plugin-oauth';
import {
    Inbox, Send, Star, Trash2, Archive, Clock, Paperclip, Search,
    MailPlus, Shield, RefreshCw, ChevronLeft, Reply, ReplyAll, Forward,
    X, AlertCircle, Plus, Loader2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailAccount {
    id: string;
    email: string;
    displayName: string;
    provider: 'Gmail' | 'Microsoft' | 'Custom';
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    authMethod: 'oauth2' | 'password';
    accessToken?: string;
    refreshToken?: string;
    password?: string;
    clientId?: string;
}

interface EmailHeader {
    uid: number;
    from: string;
    to: string;
    subject: string;
    date: string;
    preview: string;
    is_read: boolean;
    has_attachments: boolean;
    message_id: string;
    in_reply_to: string | null;
    references: string[];
}

interface EmailBody {
    uid: number;
    html: string | null;
    text: string | null;
    attachments: { filename: string; mime_type: string; size: number; data: string }[];
}

interface ProviderConfig {
    provider: 'Gmail' | 'Microsoft' | 'Custom';
    provider_name: string;
    imap_host: string;
    imap_port: number;
    smtp_host: string;
    smtp_port: number;
    auth_method: 'OAuth2' | 'Password';
    oauth_auth_url: string | null;
    oauth_token_url: string | null;
    oauth_scopes: string[] | null;
}

interface OAuthTokenResponse {
    access_token: string;
    refresh_token: string | null;
    token_type: string;
    expires_in: number | null;
    scope: string | null;
}

type Folder = {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    imapName: string;
    count: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNTS_STORAGE_KEY = 'onyx-email-accounts';
const POLL_INTERVAL = 60_000; // 60 seconds

const DEFAULT_FOLDERS: Folder[] = [
    { icon: Inbox, label: 'Inbox', imapName: 'INBOX', count: 0 },
    { icon: Star, label: 'Starred', imapName: '[Gmail]/Starred', count: 0 },
    { icon: Send, label: 'Sent', imapName: '[Gmail]/Sent Mail', count: 0 },
    { icon: Clock, label: 'Drafts', imapName: '[Gmail]/Drafts', count: 0 },
    { icon: Archive, label: 'Archive', imapName: '[Gmail]/All Mail', count: 0 },
    { icon: Trash2, label: 'Trash', imapName: '[Gmail]/Trash', count: 0 },
];

// ─── OAuth Client IDs (read from .env — public / native, no secret needed) ───

// ─── Helper: Encrypt for IndexedDB storage ────────────────────────────────────

async function encryptForStorage(data: string): Promise<string> {
    const mk = localStorage.getItem('onyx_mk') || localStorage.getItem('onyx_offline_mk');
    if (!mk) return data;

    try {
        const keyBuffer = Uint8Array.from(atob(mk), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', keyBuffer, 'AES-GCM', false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(data);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.byteLength);
        return btoa(String.fromCharCode(...combined));
    } catch {
        return data;
    }
}

async function decryptFromStorage(data: string): Promise<string> {
    const mk = localStorage.getItem('onyx_mk') || localStorage.getItem('onyx_offline_mk');
    if (!mk) return data;

    try {
        const combined = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);
        const keyBuffer = Uint8Array.from(atob(mk), c => c.charCodeAt(0));
        const key = await crypto.subtle.importKey('raw', keyBuffer, 'AES-GCM', false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return new TextDecoder().decode(decrypted);
    } catch {
        return data;
    }
}

// ─── Helper: Avatar initials ──────────────────────────────────────────────────

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name[0] || '?').toUpperCase();
}

function getAvatarColor(name: string): string {
    const colors = [
        'bg-violet-500/20 text-violet-400',
        'bg-blue-500/20 text-blue-400',
        'bg-emerald-500/20 text-emerald-400',
        'bg-amber-500/20 text-amber-400',
        'bg-rose-500/20 text-rose-400',
        'bg-cyan-500/20 text-cyan-400',
        'bg-indigo-500/20 text-indigo-400',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

// ─── Helper: Relative time ────────────────────────────────────────────────────

function formatRelativeDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Now';
        if (diffMins < 60) return `${diffMins}m`;
        if (diffHours < 24) return `${diffHours}h`;
        if (diffDays < 7) return `${diffDays}d`;
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

// ─── Helper: PKCE ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// ─── Email Cache (localStorage + E2EE) ────────────────────────────────────────

const EMAIL_CACHE_KEY = 'onyx-email-cache';

async function cacheEmails(accountId: string, folder: string, headers: EmailHeader[]): Promise<void> {
    try {
        const key = `${EMAIL_CACHE_KEY}-${accountId}-${folder}`;
        const data = JSON.stringify(headers);
        const encrypted = await encryptForStorage(data);
        localStorage.setItem(key, encrypted);
    } catch (err) {
        console.error('[Email] Cache write error:', err);
    }
}

async function getCachedEmails(accountId: string, folder: string): Promise<EmailHeader[]> {
    try {
        const key = `${EMAIL_CACHE_KEY}-${accountId}-${folder}`;
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return [];
        const data = await decryptFromStorage(encrypted);
        return JSON.parse(data);
    } catch {
        return [];
    }
}

// ─── Account Setup Modal ──────────────────────────────────────────────────────

function AccountSetupModal({
    isOpen,
    onClose,
    onAccountAdded,
}: {
    isOpen: boolean;
    onClose: () => void;
    onAccountAdded: (account: EmailAccount) => void;
}) {
    const [step, setStep] = useState<'email' | 'provider' | 'auth' | 'manual'>('email');
    const [email, setEmail] = useState('');
    const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
    const [detecting, setDetecting] = useState(false);
    const [error, setError] = useState('');
    const [manualPassword, setManualPassword] = useState('');
    const [manualImapHost, setManualImapHost] = useState('');
    const [manualImapPort, setManualImapPort] = useState('993');
    const [manualSmtpHost, setManualSmtpHost] = useState('');
    const [manualSmtpPort, setManualSmtpPort] = useState('587');
    const [oauthLoading, setOauthLoading] = useState(false);

    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

    const handleDetectProvider = async () => {
        if (!email.includes('@')) {
            setError('Please enter a valid email address');
            return;
        }

        setDetecting(true);
        setError('');

        try {
            if (isTauri) {
                const config = await invoke<ProviderConfig>('detect_email_provider', { email });
                setProviderConfig(config);

                if (config.auth_method === 'OAuth2') {
                    setStep('provider');
                } else {
                    setManualImapHost(config.imap_host);
                    setManualImapPort(config.imap_port.toString());
                    setManualSmtpHost(config.smtp_host);
                    setManualSmtpPort(config.smtp_port.toString());
                    setStep('manual');
                }
            } else {
                const domain = email.split('@')[1]?.toLowerCase();
                if (domain === 'gmail.com') {
                    setProviderConfig({
                        provider: 'Gmail',
                        provider_name: 'Google',
                        imap_host: 'imap.gmail.com',
                        imap_port: 993,
                        smtp_host: 'smtp.gmail.com',
                        smtp_port: 587,
                        auth_method: 'OAuth2',
                        oauth_auth_url: null,
                        oauth_token_url: null,
                        oauth_scopes: null,
                    });
                    setStep('provider');
                } else if (
                    domain === 'outlook.com' ||
                    domain === 'hotmail.com' ||
                    domain === 'live.com'
                ) {
                    setProviderConfig({
                        provider: 'Microsoft',
                        provider_name: 'Microsoft',
                        imap_host: 'outlook.office365.com',
                        imap_port: 993,
                        smtp_host: 'smtp.office365.com',
                        smtp_port: 587,
                        auth_method: 'OAuth2',
                        oauth_auth_url: null,
                        oauth_token_url: null,
                        oauth_scopes: null,
                    });
                    setStep('provider');
                } else {
                    // Bug 3 fix: use raw domain directly, never append .com
                    setManualImapHost(`imap.${domain}`);
                    setManualSmtpHost(`smtp.${domain}`);
                    setStep('manual');
                }
            }
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setDetecting(false);
        }
    };

    const handleOAuthSign = async () => {
        if (!providerConfig || !isTauri) return;
        setError('');
        setOauthLoading(true);

        let oauthPort: number | null = null;

        try {
            // 1) Generate PKCE pair
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);

            // 2) Start local OAuth redirect server
            oauthPort = await start({ ports: [17927, 17928, 17929, 17930] });
            const redirectUri = `http://localhost:${oauthPort}`;

            // 3) Determine OAuth params based on provider
            let authUrl: string;
            let clientId: string;

            if (providerConfig.provider === 'Gmail') {
                clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
                authUrl =
                    `https://accounts.google.com/o/oauth2/v2/auth` +
                    `?client_id=${encodeURIComponent(clientId)}` +
                    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                    `&scope=${encodeURIComponent('https://mail.google.com/')}` +
                    `&response_type=code` +
                    `&code_challenge=${codeChallenge}` +
                    `&code_challenge_method=S256`;
            } else {
                // Microsoft Graph
                clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
                authUrl =
                    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
                    `?client_id=${encodeURIComponent(clientId)}` +
                    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                    `&scope=${encodeURIComponent('https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access')}` +
                    `&response_type=code` +
                    `&code_challenge=${codeChallenge}` +
                    `&code_challenge_method=S256` +
                    `&prompt=consent`;
            }

            // 4) Set up URL listener to receive the OAuth redirect
            const tokenPromise = new Promise<OAuthTokenResponse>((resolve, reject) => {
                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error('OAuth timed out after 120 seconds'));
                    }
                }, 120_000);

                onUrl(async (urlStr: string) => {
                    if (resolved) return;
                    try {
                        const url = new URL(urlStr);
                        const code = url.searchParams.get('code');
                        const errorParam = url.searchParams.get('error');

                        if (errorParam) {
                            resolved = true;
                            clearTimeout(timeout);
                            reject(new Error(`OAuth error: ${errorParam}`));
                            return;
                        }

                        if (!code) {
                            resolved = true;
                            clearTimeout(timeout);
                            reject(new Error('No authorization code received'));
                            return;
                        }

                        // Exchange code for token via Tauri command
                        const tokenResponse = await invoke<OAuthTokenResponse>(
                            'exchange_oauth_code',
                            {
                                provider: providerConfig.provider === 'Gmail' ? 'google' : 'microsoft',
                                code,
                                redirectUri,
                                clientId,
                                codeVerifier,
                            }
                        );

                        resolved = true;
                        clearTimeout(timeout);
                        resolve(tokenResponse);
                    } catch (err) {
                        resolved = true;
                        clearTimeout(timeout);
                        reject(err);
                    }
                });
            });

            // 5) Open browser for user to sign in
            await openUrl(authUrl);

            // 6) Wait for the token exchange to complete
            const tokenResponse = await tokenPromise;

            // 7) Build account with access token
            const account: EmailAccount = {
                id: crypto.randomUUID(),
                email,
                displayName: email.split('@')[0],
                provider: providerConfig.provider,
                imapHost: providerConfig.imap_host,
                imapPort: providerConfig.imap_port,
                smtpHost: providerConfig.smtp_host,
                smtpPort: providerConfig.smtp_port,
                authMethod: 'oauth2',
                accessToken: tokenResponse.access_token,
                refreshToken: tokenResponse.refresh_token ?? undefined,
                clientId,
            };

            onAccountAdded(account);
            handleClose();
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setOauthLoading(false);
            if (oauthPort !== null) {
                cancel(oauthPort).catch(() => {});
            }
        }
    };

    const handleManualAdd = async () => {
        if (!manualPassword) {
            setError('Password is required');
            return;
        }

        // Bug 3 fix: extract domain directly — never append .com or any suffix.
        // Use the IMAP host from the input or fall back to imap.<domain>.
        const domain = email.split('@')[1];

        const account: EmailAccount = {
            id: crypto.randomUUID(),
            email,
            displayName: email.split('@')[0],
            provider: 'Custom',
            imapHost: manualImapHost || `imap.${domain}`,
            imapPort: parseInt(manualImapPort) || 993,
            smtpHost: manualSmtpHost || `smtp.${domain}`,
            smtpPort: parseInt(manualSmtpPort) || 587,
            authMethod: 'password',
            password: manualPassword,
        };

        onAccountAdded(account);
        handleClose();
    };

    const handleClose = () => {
        setStep('email');
        setEmail('');
        setProviderConfig(null);
        setError('');
        setManualPassword('');
        setOauthLoading(false);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-110 bg-zinc-900 border border-zinc-800/80 rounded-2xl shadow-2xl overflow-hidden" style={{ animation: 'fadeIn 0.15s ease-out' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
                    <h3 className="text-lg font-bold text-zinc-100">Add Email Account</h3>
                    <button onClick={handleClose} className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                            <AlertCircle size={14} />
                            {error}
                        </div>
                    )}

                    {/* Step 1: Enter email */}
                    {step === 'email' && (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-400">Email Address</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleDetectProvider()}
                                    placeholder="you@example.com"
                                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-sm placeholder-zinc-600 outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
                                    autoFocus
                                />
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                <Shield size={14} className="text-amber-400 shrink-0" />
                                <span className="text-[11px] text-zinc-500">
                                    100% client-side. Your credentials never leave this device.
                                </span>
                            </div>
                            <button
                                onClick={handleDetectProvider}
                                disabled={detecting || !email}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
                            >
                                {detecting ? <Loader2 size={16} className="animate-spin" /> : null}
                                {detecting ? 'Detecting provider...' : 'Continue'}
                            </button>
                        </>
                    )}

                    {/* Step 2: Provider detected — OAuth */}
                    {step === 'provider' && providerConfig && (
                        <>
                            <div className="text-center space-y-3">
                                <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700/30 flex items-center justify-center mx-auto">
                                    {providerConfig.provider === 'Gmail' && (
                                        <span className="text-2xl">📧</span>
                                    )}
                                    {providerConfig.provider === 'Microsoft' && (
                                        <span className="text-2xl">📬</span>
                                    )}
                                </div>
                                <div>
                                    <p className="text-sm text-zinc-300">
                                        <span className="font-semibold text-zinc-100">{providerConfig.provider_name}</span> detected
                                    </p>
                                    <p className="text-xs text-zinc-600 mt-0.5">{email}</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                    <div className="px-2.5 py-1.5 rounded bg-zinc-800/50 border border-zinc-700/20">
                                        <span className="text-zinc-600">IMAP</span>
                                        <span className="ml-1 text-zinc-400">{providerConfig.imap_host}:{providerConfig.imap_port}</span>
                                    </div>
                                    <div className="px-2.5 py-1.5 rounded bg-zinc-800/50 border border-zinc-700/20">
                                        <span className="text-zinc-600">SMTP</span>
                                        <span className="ml-1 text-zinc-400">{providerConfig.smtp_host}:{providerConfig.smtp_port}</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleOAuthSign}
                                disabled={oauthLoading}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
                            >
                                {oauthLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                                {oauthLoading
                                    ? 'Waiting for sign-in...'
                                    : `Sign in with ${providerConfig.provider_name}`}
                            </button>

                            <button
                                onClick={() => setStep('email')}
                                className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
                            >
                                ← Back
                            </button>
                        </>
                    )}

                    {/* Step 3: Manual credentials */}
                    {step === 'manual' && (
                        <>
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-zinc-500">Password</label>
                                    <input
                                        type="password"
                                        value={manualPassword}
                                        onChange={(e) => setManualPassword(e.target.value)}
                                        placeholder="Your email password or app password"
                                        className="w-full px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-sm placeholder-zinc-600 outline-none focus:border-amber-500/50 transition-all"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-zinc-500">IMAP Host</label>
                                        <input
                                            type="text"
                                            value={manualImapHost}
                                            onChange={(e) => setManualImapHost(e.target.value)}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-zinc-500">IMAP Port</label>
                                        <input
                                            type="text"
                                            value={manualImapPort}
                                            onChange={(e) => setManualImapPort(e.target.value)}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-zinc-500">SMTP Host</label>
                                        <input
                                            type="text"
                                            value={manualSmtpHost}
                                            onChange={(e) => setManualSmtpHost(e.target.value)}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-zinc-500">SMTP Port</label>
                                        <input
                                            type="text"
                                            value={manualSmtpPort}
                                            onChange={(e) => setManualSmtpPort(e.target.value)}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={handleManualAdd}
                                disabled={!manualPassword}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold"
                            >
                                Add Account
                            </button>

                            <button
                                onClick={() => setStep('email')}
                                className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
                            >
                                ← Back
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Compose Modal ────────────────────────────────────────────────────────────

function ComposeModal({
    isOpen,
    onClose,
    onSend,
    account,
    replyTo,
}: {
    isOpen: boolean;
    onClose: () => void;
    onSend: (to: string[], cc: string[], subject: string, bodyHtml: string, bodyText: string, inReplyTo?: string, references?: string) => Promise<void>;
    account: EmailAccount | null;
    replyTo?: EmailHeader | null;
}) {
    const [to, setTo] = useState('');
    const [cc, setCc] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (replyTo) {
            setTo(replyTo.from.includes('<') ? replyTo.from : replyTo.from);
            setSubject(replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`);
            setBody('');
        } else {
            setTo('');
            setCc('');
            setSubject('');
            setBody('');
        }
    }, [replyTo, isOpen]);

    const handleSend = async () => {
        if (!to.trim()) {
            setError('Please enter a recipient');
            return;
        }

        setSending(true);
        setError('');

        try {
            const toList = to.split(',').map(s => s.trim()).filter(Boolean);
            const ccList = cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : [];
            const bodyHtml = `<div style="font-family: -apple-system, sans-serif; font-size: 14px; color: #333;">${body.replace(/\n/g, '<br/>')}</div>`;

            await onSend(
                toList,
                ccList,
                subject,
                bodyHtml,
                body,
                replyTo?.message_id,
                replyTo ? replyTo.references.concat(replyTo.message_id).join(' ') : undefined,
            );

            onClose();
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setSending(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-9999 flex items-end justify-center pb-6 bg-black/40 backdrop-blur-sm">
            <div className="w-160 bg-zinc-900 border border-zinc-800/80 rounded-2xl shadow-2xl overflow-hidden" style={{ animation: 'slideUp 0.2s ease-out' }}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
                    <h3 className="text-sm font-bold text-zinc-100">{replyTo ? 'Reply' : 'New Message'}</h3>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleSend}
                            disabled={sending || !to.trim()}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-semibold"
                        >
                            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            Send
                        </button>
                        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                        <AlertCircle size={12} />
                        {error}
                    </div>
                )}

                <div className="px-4 py-2 space-y-0">
                    <div className="flex items-center border-b border-zinc-800/30 py-2">
                        <span className="text-xs text-zinc-600 w-10">From</span>
                        <span className="text-xs text-zinc-400">{account?.email || 'No account selected'}</span>
                    </div>
                    <div className="flex items-center border-b border-zinc-800/30 py-2">
                        <span className="text-xs text-zinc-600 w-10">To</span>
                        <input
                            type="text"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-600"
                            placeholder="recipient@example.com"
                            autoFocus={!replyTo}
                        />
                    </div>
                    <div className="flex items-center border-b border-zinc-800/30 py-2">
                        <span className="text-xs text-zinc-600 w-10">CC</span>
                        <input
                            type="text"
                            value={cc}
                            onChange={(e) => setCc(e.target.value)}
                            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-600"
                            placeholder="Optional"
                        />
                    </div>
                    <div className="flex items-center border-b border-zinc-800/30 py-2">
                        <span className="text-xs text-zinc-600 w-10">Subj</span>
                        <input
                            type="text"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-600"
                            placeholder="Subject"
                        />
                    </div>
                </div>

                <div className="px-4 py-3">
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        className="w-full h-48 bg-transparent text-sm text-zinc-200 outline-none resize-none placeholder-zinc-600 leading-relaxed"
                        placeholder="Write your message..."
                        autoFocus={!!replyTo}
                    />
                </div>
            </div>
        </div>
    );
}

// ─── Main Email View ──────────────────────────────────────────────────────────

export default function EmailView() {
    // ─── State ────────────────────────────────────────────────────────────
    const [accounts, setAccounts] = useState<EmailAccount[]>(() => {
        try {
            const saved = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch {}
        return [];
    });

    const [activeAccountId, setActiveAccountId] = useState<string | null>(() => accounts[0]?.id || null);
    const [activeFolder, setActiveFolder] = useState('INBOX');
    const [headers, setHeaders] = useState<EmailHeader[]>([]);
    const [selectedEmail, setSelectedEmail] = useState<EmailHeader | null>(null);
    const [emailBody, setEmailBody] = useState<EmailBody | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingBody, setLoadingBody] = useState(false);
    const [setupOpen, setSetupOpen] = useState(false);
    const [composeOpen, setComposeOpen] = useState(false);
    const [replyToEmail, setReplyToEmail] = useState<EmailHeader | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
    const activeAccount = accounts.find(a => a.id === activeAccountId) || null;

    // ─── Persist accounts ─────────────────────────────────────────────────

    useEffect(() => {
        const sanitized = accounts.map(a => ({
            id: a.id,
            email: a.email,
            displayName: a.displayName,
            provider: a.provider,
            imapHost: a.imapHost,
            imapPort: a.imapPort,
            smtpHost: a.smtpHost,
            smtpPort: a.smtpPort,
            authMethod: a.authMethod,
        }));
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(sanitized));
    }, [accounts]);

    // ─── Fetch emails ─────────────────────────────────────────────────────

    const fetchEmails = useCallback(async (accountId?: string, folder?: string) => {
        const acct = accounts.find(a => a.id === (accountId || activeAccountId));
        if (!acct) return;

        // Bug 1 guard: if this is an OAuth account without a token, do not fetch
        if (acct.authMethod === 'oauth2' && !acct.accessToken) {
            console.warn('[Email] Skipping fetch — no access token for OAuth account');
            return;
        }

        const targetFolder = folder || activeFolder;
        setLoading(true);

        try {
            const cached = await getCachedEmails(acct.id, targetFolder);
            if (cached.length > 0) {
                setHeaders(cached);
            }

            if (!isTauri) {
                setLoading(false);
                return;
            }

            const result = await invoke<EmailHeader[]>('fetch_email_headers', {
                imapHost: acct.imapHost,
                imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder: targetFolder,
                offset: 0,
                limit: 50,
            });

            setHeaders(result);
            await cacheEmails(acct.id, targetFolder, result);
        } catch (err) {
            console.error('[Email] Fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [accounts, activeAccountId, activeFolder, isTauri]);

    // ─── Fetch body for selected email ────────────────────────────────────

    const fetchBody = useCallback(async (uid: number) => {
        if (!activeAccount || !isTauri) return;

        // Guard: no token for OAuth → skip
        if (activeAccount.authMethod === 'oauth2' && !activeAccount.accessToken) {
            console.warn('[Email] Skipping body fetch — no access token');
            return;
        }

        setLoadingBody(true);
        try {
            const result = await invoke<EmailBody>('fetch_email_body', {
                imapHost: activeAccount.imapHost,
                imapPort: activeAccount.imapPort,
                email: activeAccount.email,
                authMethod: activeAccount.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: activeAccount.accessToken || null,
                password: activeAccount.password || null,
                folder: activeFolder,
                uid,
            });
            setEmailBody(result);
        } catch (err) {
            console.error('[Email] Body fetch error:', err);
        } finally {
            setLoadingBody(false);
        }
    }, [activeAccount, activeFolder, isTauri]);

    // ─── Load emails when account/folder changes ──────────────────────────

    useEffect(() => {
        if (activeAccountId && activeFolder) {
            fetchEmails(activeAccountId, activeFolder);
            setSelectedEmail(null);
            setEmailBody(null);
        }
    }, [activeAccountId, activeFolder]);

    // ─── Polling (every 60s when in foreground) ───────────────────────────

    useEffect(() => {
        if (!activeAccountId || accounts.length === 0) return;

        pollRef.current = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchEmails();
            }
        }, POLL_INTERVAL);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeAccountId, fetchEmails]);

    // ─── Handle send ──────────────────────────────────────────────────────

    const handleSendEmail = useCallback(async (
        to: string[],
        cc: string[],
        subject: string,
        bodyHtml: string,
        bodyText: string,
        inReplyTo?: string,
        references?: string,
    ) => {
        if (!activeAccount || !isTauri) throw new Error('No active account');

        // Guard: no token for OAuth send
        if (activeAccount.authMethod === 'oauth2' && !activeAccount.accessToken) {
            throw new Error('No access token — please sign in again');
        }

        await invoke('send_email', {
            smtpHost: activeAccount.smtpHost,
            smtpPort: activeAccount.smtpPort,
            fromEmail: activeAccount.email,
            fromName: activeAccount.displayName,
            authMethod: activeAccount.authMethod === 'oauth2' ? 'oauth2' : 'password',
            accessToken: activeAccount.accessToken || null,
            password: activeAccount.password || null,
            to,
            cc,
            subject,
            bodyHtml,
            bodyText,
            inReplyTo: inReplyTo || null,
            referencesHeader: references || null,
        });
    }, [activeAccount, isTauri]);

    // ─── Handle account added ─────────────────────────────────────────────

    const handleAccountAdded = useCallback((account: EmailAccount) => {
        setAccounts(prev => [...prev, account]);
        setActiveAccountId(account.id);
    }, []);

    const handleRemoveAccount = useCallback((id: string) => {
        setAccounts(prev => prev.filter(a => a.id !== id));
        if (activeAccountId === id) {
            const remaining = accounts.filter(a => a.id !== id);
            setActiveAccountId(remaining[0]?.id || null);
        }
    }, [accounts, activeAccountId]);

    // ─── Refresh handler ──────────────────────────────────────────────────

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchEmails();
        setRefreshing(false);
    }, [fetchEmails]);

    // ─── Filter emails by search ──────────────────────────────────────────

    const filteredHeaders = searchQuery
        ? headers.filter(h =>
            h.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
            h.from.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : headers;

    // ─── No accounts — empty state ────────────────────────────────────────

    if (accounts.length === 0) {
        return (
            <>
                <div className="flex-1 flex items-center justify-center bg-zinc-950/50">
                    <div className="text-center space-y-4 max-w-sm">
                        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
                            <Shield size={32} className="text-amber-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-zinc-100 mb-1">Private Email Client</h3>
                            <p className="text-sm text-zinc-500 leading-relaxed">
                                Connect your Gmail, Outlook, or any IMAP mailbox. All data stays on your device — encrypted with your Onyx key.
                            </p>
                        </div>
                        <button
                            onClick={() => setSetupOpen(true)}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors text-sm font-semibold"
                        >
                            <Plus size={16} />
                            Add Email Account
                        </button>
                    </div>
                </div>

                <AccountSetupModal
                    isOpen={setupOpen}
                    onClose={() => setSetupOpen(false)}
                    onAccountAdded={handleAccountAdded}
                />
            </>
        );
    }

    // ─── Main 3-Panel Layout ──────────────────────────────────────────────

    return (
        <div className="flex h-full overflow-hidden">
            {/* Left Panel: Accounts + Folders */}
            <div className="w-56 h-full flex flex-col bg-zinc-900/60 border-r border-zinc-800/30 shrink-0">
                {/* Compose button */}
                <div className="p-3 shrink-0">
                    <button
                        onClick={() => { setReplyToEmail(null); setComposeOpen(true); }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 text-amber-400 hover:bg-amber-500/20 transition-colors text-sm font-semibold"
                    >
                        <MailPlus size={16} />
                        Compose
                    </button>
                </div>

                {/* Account list */}
                <div className="px-2 pb-2">
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-2 py-1">
                        Accounts
                    </div>
                    {accounts.map(account => (
                        <div
                            key={account.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveAccountId(account.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveAccountId(account.id); }}
                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors group cursor-pointer ${
                                activeAccountId === account.id
                                    ? 'bg-amber-500/10 text-zinc-200'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                            }`}
                        >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${getAvatarColor(account.email)}`}>
                                {account.provider === 'Gmail' ? '📧' : account.provider === 'Microsoft' ? '📬' : getInitials(account.email)}
                            </div>
                            <span className="truncate flex-1 text-left">{account.email}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveAccount(account.id); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-all"
                            >
                                <X size={10} />
                            </button>
                        </div>
                    ))}
                    <button
                        onClick={() => setSetupOpen(true)}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/30 transition-colors mt-0.5"
                    >
                        <Plus size={12} />
                        Add account
                    </button>
                </div>

                <div className="mx-3 h-px bg-zinc-800/40" />

                {/* Folders */}
                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
                    {DEFAULT_FOLDERS.map(folder => {
                        const isActive = activeFolder === folder.imapName;
                        return (
                            <button
                                key={folder.label}
                                onClick={() => setActiveFolder(folder.imapName)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    isActive
                                        ? 'bg-zinc-800/60 text-zinc-100'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                                }`}
                            >
                                <folder.icon
                                    size={16}
                                    className={isActive ? 'text-amber-400' : 'text-zinc-600'}
                                />
                                <span className="flex-1 text-left truncate">{folder.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Center Panel: Email List */}
            <div className="w-80 bg-zinc-900/30 flex flex-col border-r border-zinc-800/30 shrink-0">
                {/* Search + Refresh */}
                <div className="p-3 border-b border-zinc-800/30 shrink-0 space-y-2">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-700/20">
                            <Search size={14} className="text-zinc-600" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search emails..."
                                className="flex-1 bg-transparent text-sm text-zinc-300 placeholder-zinc-600 outline-none"
                            />
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Loading indicator */}
                {loading && headers.length === 0 && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                    </div>
                )}

                {/* Email items */}
                <div className="flex-1 overflow-y-auto">
                    {filteredHeaders.length === 0 && !loading && (
                        <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
                            <Inbox size={24} className="mb-2 text-zinc-700" />
                            <span className="text-sm">No emails</span>
                        </div>
                    )}

                    {filteredHeaders.map((email) => {
                        const isSelected = selectedEmail?.uid === email.uid;
                        return (
                            <div
                                key={email.uid}
                                onClick={() => {
                                    setSelectedEmail(email);
                                    setEmailBody(null);
                                    fetchBody(email.uid);
                                }}
                                className={`px-4 py-3 border-b border-zinc-800/20 cursor-pointer transition-colors ${
                                    isSelected
                                        ? 'bg-amber-500/5 border-l-2 border-l-amber-400'
                                        : 'hover:bg-zinc-800/20 border-l-2 border-l-transparent'
                                }`}
                            >
                                <div className="flex items-center gap-2.5 mb-0.5">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${getAvatarColor(email.from)}`}>
                                        {getInitials(email.from)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className={`text-sm truncate ${email.is_read ? 'text-zinc-400' : 'font-semibold text-zinc-100'}`}>
                                                {email.from}
                                            </span>
                                            <span className="text-[10px] text-zinc-600 shrink-0 ml-2">
                                                {formatRelativeDate(email.date)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="pl-9.5">
                                    <div className="flex items-center gap-1.5">
                                        {!email.is_read && (
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                        )}
                                        <span className={`text-sm truncate ${email.is_read ? 'text-zinc-500' : 'text-zinc-300'}`}>
                                            {email.subject || '(No subject)'}
                                        </span>
                                        {email.has_attachments && <Paperclip size={11} className="text-zinc-600 shrink-0" />}
                                    </div>
                                    {email.preview && (
                                        <p className="text-xs text-zinc-600 truncate mt-0.5">{email.preview}</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Right Panel: Reading Pane */}
            <div className="flex-1 flex flex-col bg-zinc-950/50 overflow-hidden">
                {selectedEmail ? (
                    <>
                        {/* Email header bar */}
                        <div className="shrink-0 px-6 py-4 border-b border-zinc-800/30">
                            <div className="flex items-center justify-between mb-3">
                                <button
                                    onClick={() => { setSelectedEmail(null); setEmailBody(null); }}
                                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors md:hidden"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => { setReplyToEmail(selectedEmail); setComposeOpen(true); }}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
                                    >
                                        <Reply size={14} />
                                        Reply
                                    </button>
                                    <button
                                        onClick={() => { setReplyToEmail(selectedEmail); setComposeOpen(true); }}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
                                    >
                                        <ReplyAll size={14} />
                                        Reply All
                                    </button>
                                    <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors text-xs">
                                        <Forward size={14} />
                                        Forward
                                    </button>
                                </div>
                            </div>

                            <h2 className="text-lg font-bold text-zinc-100 mb-2">
                                {selectedEmail.subject || '(No subject)'}
                            </h2>

                            <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${getAvatarColor(selectedEmail.from)}`}>
                                    {getInitials(selectedEmail.from)}
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-zinc-200">{selectedEmail.from}</div>
                                    <div className="text-xs text-zinc-600">
                                        To: {selectedEmail.to} · {formatRelativeDate(selectedEmail.date)}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Email body */}
                        <div className="flex-1 overflow-y-auto px-6 py-4">
                            {loadingBody && (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 size={20} className="animate-spin text-zinc-600" />
                                </div>
                            )}

                            {emailBody && emailBody.html && (
                                <div className="email-body-html" style={{ color: '#e4e4e7', lineHeight: 1.7, fontSize: '14px' }}>
                                    <iframe
                                        sandbox="allow-same-origin"
                                        className="w-full border-none bg-white rounded-lg"
                                        style={{ minHeight: 400 }}
                                        srcDoc={`<!DOCTYPE html><html><head><style>body{font-family:-apple-system,sans-serif;font-size:14px;color:#333;padding:16px;margin:0;line-height:1.6}img{max-width:100%;height:auto}a{color:#2563eb}blockquote{border-left:3px solid #d4d4d8;padding-left:12px;margin-left:0;color:#71717a}</style></head><body>${emailBody.html}</body></html>`}
                                    />
                                </div>
                            )}

                            {emailBody && !emailBody.html && emailBody.text && (
                                <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-[inherit] leading-relaxed">
                                    {emailBody.text}
                                </pre>
                            )}

                            {emailBody && !emailBody.html && !emailBody.text && (
                                <div className="text-sm text-zinc-600 italic">No content available</div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-2">
                            <Inbox size={28} className="text-zinc-700 mx-auto" />
                            <p className="text-sm text-zinc-600">Select an email to read</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            <AccountSetupModal
                isOpen={setupOpen}
                onClose={() => setSetupOpen(false)}
                onAccountAdded={handleAccountAdded}
            />

            <ComposeModal
                isOpen={composeOpen}
                onClose={() => { setComposeOpen(false); setReplyToEmail(null); }}
                onSend={handleSendEmail}
                account={activeAccount}
                replyTo={replyToEmail}
            />
        </div>
    );
}
