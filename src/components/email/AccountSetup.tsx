/**
 * AccountSetup.tsx — Extracted account setup modal with OAuth + manual auth.
 * Preserved from the original EmailView.tsx with full OAuth PKCE flow.
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { start, cancel, onUrl } from '@fabianlars/tauri-plugin-oauth';
import {
    X, AlertCircle, Loader2, Shield, ExternalLink,
} from 'lucide-react';
import { IS_TAURI } from '../../hooks/usePlatform';
import { type EmailAccount } from '../../store/emailStore';

/* ─── Types ──────────────────────────────────────────────────── */

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

/* ─── PKCE Helpers ───────────────────────────────────────────── */

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

function getOutlookRealm(email: string): string | null {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;
    if (domain.includes('rmit.edu.au')) return 'student.rmit.edu.au';
    if (domain.endsWith('.edu') || domain.endsWith('.edu.au') || domain.endsWith('.ac.uk')) return domain;
    return null;
}

/* ─── Component ──────────────────────────────────────────────── */

interface AccountSetupProps {
    isOpen: boolean;
    onClose: () => void;
    onAccountAdded: (account: EmailAccount) => void;
}

export default function AccountSetup({ isOpen, onClose, onAccountAdded }: AccountSetupProps) {
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

    const isTauri = IS_TAURI;

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
                        provider: 'Gmail', provider_name: 'Google',
                        imap_host: 'imap.gmail.com', imap_port: 993,
                        smtp_host: 'smtp.gmail.com', smtp_port: 587,
                        auth_method: 'OAuth2', oauth_auth_url: null,
                        oauth_token_url: null, oauth_scopes: null,
                    });
                    setStep('provider');
                } else if (['outlook.com', 'hotmail.com', 'live.com'].includes(domain)) {
                    setProviderConfig({
                        provider: 'Microsoft', provider_name: 'Microsoft',
                        imap_host: 'outlook.office365.com', imap_port: 993,
                        smtp_host: 'smtp.office365.com', smtp_port: 587,
                        auth_method: 'OAuth2', oauth_auth_url: null,
                        oauth_token_url: null, oauth_scopes: null,
                    });
                    setStep('provider');
                } else {
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
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            oauthPort = await start({ ports: [17927, 17928, 17929, 17930] });
            const redirectUri = `http://localhost:${oauthPort}`;
            let authUrl: string;
            let clientId: string;

            if (providerConfig.provider === 'Gmail') {
                clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
                authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://mail.google.com/')}&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256`;
            } else {
                clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;
                authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access')}&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256&prompt=consent`;
            }

            const tokenPromise = new Promise<OAuthTokenResponse>((resolve, reject) => {
                let resolved = false;
                const timeout = setTimeout(() => { if (!resolved) { resolved = true; reject(new Error('OAuth timed out after 120 seconds')); } }, 120_000);
                onUrl(async (urlStr: string) => {
                    if (resolved) return;
                    try {
                        const url = new URL(urlStr);
                        const code = url.searchParams.get('code');
                        const errorParam = url.searchParams.get('error');
                        if (errorParam) { resolved = true; clearTimeout(timeout); reject(new Error(`OAuth error: ${errorParam}`)); return; }
                        if (!code) { resolved = true; clearTimeout(timeout); reject(new Error('No authorization code received')); return; }
                        const clientSecret = providerConfig.provider === 'Gmail'
                            ? (import.meta.env.VITE_GOOGLE_CLIENT_SECRET || null)
                            : null;
                        const tokenResponse = await invoke<OAuthTokenResponse>('exchange_oauth_code', {
                            provider: providerConfig.provider === 'Gmail' ? 'google' : 'microsoft',
                            code, redirectUri, clientId, codeVerifier, clientSecret,
                        });
                        resolved = true; clearTimeout(timeout); resolve(tokenResponse);
                    } catch (err) { resolved = true; clearTimeout(timeout); reject(err); }
                });
            });

            await openUrl(authUrl);
            const tokenResponse = await tokenPromise;

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
            const errStr = err.toString();
            setError(errStr);
            const blockedPatterns = ['admin', 'blocked', 'approval', 'consent', 'AADSTS', 'unauthorized_client', 'access_denied'];
            const isBlocked = blockedPatterns.some(p => errStr.toLowerCase().includes(p.toLowerCase()));
            if (errStr.toLowerCase().includes('redirect_uri') || errStr.toLowerCase().includes('redirect_uri_mismatch')) {
                setError('OAuth redirect mismatch. Ensure these URIs are registered: http://localhost:17927-17930');
            } else if (errStr.toLowerCase().includes('client_secret') || errStr.toLowerCase().includes('secret is missing')) {
                setError('Set VITE_GOOGLE_CLIENT_SECRET in your .env — Google OAuth requires a client secret even with PKCE.');
            } else if (isBlocked && isTauri) {
                setError('Your university/org IT blocks third-party apps. Use the "Open Outlook in Onyx" button below.');
            }
        } finally {
            setOauthLoading(false);
            if (oauthPort !== null) cancel(oauthPort).catch(() => {});
        }
    };

    const handleManualAdd = async () => {
        if (!manualPassword) { setError('Password is required'); return; }
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
        setStep('email'); setEmail(''); setProviderConfig(null); setError('');
        setManualPassword(''); setOauthLoading(false); onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-110 bg-zinc-900 border border-zinc-800/80 rounded-2xl shadow-2xl overflow-hidden" style={{ animation: 'fadeIn 0.15s ease-out' }}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
                    <h3 className="text-lg font-bold text-zinc-100">Add Email Account</h3>
                    <button onClick={handleClose} className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                            <AlertCircle size={14} /> {error}
                        </div>
                    )}

                    {step === 'email' && (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-400">Email Address</label>
                                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleDetectProvider()} placeholder="you@example.com" className="w-full px-3 py-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-sm placeholder-zinc-600 outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all" autoFocus />
                            </div>
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                                <Shield size={14} className="text-amber-400 shrink-0" />
                                <span className="text-[11px] text-zinc-500">100% client-side. Your credentials never leave this device.</span>
                            </div>
                            <button onClick={handleDetectProvider} disabled={detecting || !email} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold">
                                {detecting ? <Loader2 size={16} className="animate-spin" /> : null}
                                {detecting ? 'Detecting provider...' : 'Continue'}
                            </button>
                        </>
                    )}

                    {step === 'provider' && providerConfig && (
                        <>
                            <div className="text-center space-y-3">
                                <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700/30 flex items-center justify-center mx-auto">
                                    {providerConfig.provider === 'Gmail' ? (
                                        <svg viewBox="0 0 48 48" className="w-8 h-8"><path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/><path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/><path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/><path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/></svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" className="w-8 h-8"><path d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z" fill="#00A4EF"/></svg>
                                    )}
                                </div>
                                <div>
                                    <p className="text-sm text-zinc-300"><span className="font-semibold text-zinc-100">{providerConfig.provider_name}</span> detected</p>
                                    <p className="text-xs text-zinc-600 mt-0.5">{email}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div className="px-2.5 py-1.5 rounded bg-zinc-800/50 border border-zinc-700/20">
                                    <span className="text-zinc-600">IMAP</span><span className="ml-1 text-zinc-400">{providerConfig.imap_host}:{providerConfig.imap_port}</span>
                                </div>
                                <div className="px-2.5 py-1.5 rounded bg-zinc-800/50 border border-zinc-700/20">
                                    <span className="text-zinc-600">SMTP</span><span className="ml-1 text-zinc-400">{providerConfig.smtp_host}:{providerConfig.smtp_port}</span>
                                </div>
                            </div>
                            <button onClick={handleOAuthSign} disabled={oauthLoading} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold">
                                {oauthLoading ? <Loader2 size={16} className="animate-spin" /> : null}
                                {oauthLoading ? 'Waiting for sign-in...' : `Sign in with ${providerConfig.provider_name}`}
                            </button>
                            {providerConfig.provider === 'Microsoft' && isTauri && (
                                <button onClick={() => { const realm = getOutlookRealm(email); invoke('open_outlook_onyx', { realm }).catch(() => {}); handleClose(); }} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-colors text-xs font-medium">
                                    <ExternalLink size={14} /> Open Outlook in Onyx (if sign-in is blocked)
                                </button>
                            )}
                            <button onClick={() => setStep('email')} className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1">← Back</button>
                        </>
                    )}

                    {step === 'manual' && (
                        <>
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-zinc-500">Password</label>
                                    <input type="password" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} placeholder="Your email password or app password" className="w-full px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-sm placeholder-zinc-600 outline-none focus:border-amber-500/50 transition-all" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5"><label className="text-xs font-medium text-zinc-500">IMAP Host</label><input type="text" value={manualImapHost} onChange={(e) => setManualImapHost(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all" /></div>
                                    <div className="space-y-1.5"><label className="text-xs font-medium text-zinc-500">IMAP Port</label><input type="text" value={manualImapPort} onChange={(e) => setManualImapPort(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all" /></div>
                                    <div className="space-y-1.5"><label className="text-xs font-medium text-zinc-500">SMTP Host</label><input type="text" value={manualSmtpHost} onChange={(e) => setManualSmtpHost(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all" /></div>
                                    <div className="space-y-1.5"><label className="text-xs font-medium text-zinc-500">SMTP Port</label><input type="text" value={manualSmtpPort} onChange={(e) => setManualSmtpPort(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/30 text-zinc-200 text-xs outline-none focus:border-amber-500/50 transition-all" /></div>
                                </div>
                            </div>
                            <button onClick={handleManualAdd} disabled={!manualPassword} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-semibold">Add Account</button>
                            <button onClick={() => setStep('email')} className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1">← Back</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
