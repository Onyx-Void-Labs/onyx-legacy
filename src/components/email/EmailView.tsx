/**
 * EmailView.tsx — Main email client shell.
 * Unified inbox across all accounts, category tabs, keyboard shortcuts,
 * 15-minute undo send, spam analysis, and modular component architecture.
 *
 * This replaces the original monolithic EmailView.tsx.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    Inbox, Send, Star, Trash2, Archive, Clock, Search, MailPlus,
    Shield, RefreshCw, X, Plus, ExternalLink, MailOpen,
} from 'lucide-react';
import { IS_TAURI } from '../../hooks/usePlatform';

// Modular components
import InboxTabs from './InboxTabs';
import ThreadList from './ThreadList';
import EmailViewer from './EmailViewer';
import MiniComposer from './MiniComposer';
import UndoToast from './UndoToast';
import AccountSetup from './AccountSetup';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

// Store
import {
    useEmailStore,
    categorizeEmail,
    type EmailAccount,
    type EmailHeader,
    type EmailBody,
    type EmailCategory,
    type QueuedDraft,
    type SpamAnalysis,
} from '../../store/emailStore';

// SQLite-backed email cache layer (Module 1 enhancement)
import { useLiveEmails, toEmailHeader } from '../../hooks/useLiveEmails';

/* ─── Constants ──────────────────────────────────────────────── */

const ACCOUNTS_STORAGE_KEY = 'onyx-email-accounts';
const ACCOUNTS_CREDS_KEY = 'onyx-email-creds';
const EMAIL_CACHE_KEY = 'onyx-email-cache';
const POLL_INTERVAL = 60_000;

/** Refresh OAuth2 access token if the account uses OAuth. Returns the (possibly refreshed) token. */
async function ensureFreshToken(acct: EmailAccount): Promise<string | null> {
    if (acct.authMethod !== 'oauth2') return null;
    if (!acct.refreshToken || !acct.clientId) return acct.accessToken || null;
    try {
        const resp = await invoke<{ access_token: string }>('refresh_oauth_token', {
            provider: (acct.provider || 'Gmail').toLowerCase(),
            refreshToken: acct.refreshToken,
            clientId: acct.clientId,
        });
        // Mutate in-place so all subsequent calls within this cycle use the fresh token
        acct.accessToken = resp.access_token;
        return resp.access_token;
    } catch (err) {
        console.warn(`[Email] Token refresh failed for ${acct.email}, using cached:`, err);
        return acct.accessToken || null;
    }
}

type FolderDef = {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    key: string;
};

const CANONICAL_FOLDERS: FolderDef[] = [
    { icon: Inbox, label: 'Inbox', key: 'INBOX' },
    { icon: Star, label: 'Starred', key: 'Starred' },
    { icon: Send, label: 'Sent', key: 'Sent' },
    { icon: Clock, label: 'Drafts', key: 'Drafts' },
    { icon: Archive, label: 'Archive', key: 'Archive' },
    { icon: Trash2, label: 'Trash', key: 'Trash' },
];

/* Maps canonical folder key → possible IMAP folder names (priority order).
   First match found on the server wins. */
const FOLDER_IMAP_ALIASES: Record<string, string[]> = {
    'INBOX': ['INBOX'],
    'Starred': ['[Gmail]/Starred', 'Flagged', 'INBOX.Flagged'],
    'Sent': ['[Gmail]/Sent Mail', 'Sent Items', 'Sent', 'INBOX.Sent'],
    'Drafts': ['[Gmail]/Drafts', 'Drafts', 'INBOX.Drafts'],
    'Archive': ['[Gmail]/All Mail', 'Archive', 'INBOX.Archive'],
    'Trash': ['[Gmail]/Trash', '[Gmail]/Bin', 'Deleted Items', 'Trash', 'INBOX.Trash'],
};

/** Resolve a folder key (canonical or raw IMAP name) to the actual server folder. */
function resolveImapFolder(key: string, serverFolders: string[]): string | null {
    if (key === 'INBOX') return 'INBOX';
    // Direct match
    const direct = serverFolders.find(f => f.toLowerCase() === key.toLowerCase());
    if (direct) return direct;
    // Canonical alias lookup
    const aliases = FOLDER_IMAP_ALIASES[key];
    if (aliases) {
        for (const alias of aliases) {
            const match = serverFolders.find(f => f.toLowerCase() === alias.toLowerCase());
            if (match) return match;
        }
    }
    // Reverse lookup: key might be a provider-specific IMAP name — find its canonical group
    for (const aliasList of Object.values(FOLDER_IMAP_ALIASES)) {
        if (aliasList.some(a => a.toLowerCase() === key.toLowerCase())) {
            for (const alias of aliasList) {
                const match = serverFolders.find(f => f.toLowerCase() === alias.toLowerCase());
                if (match) return match;
            }
        }
    }
    return null;
}

/* ─── Provider Icons ─────────────────────────────────────────── */

function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
    if (provider === 'Gmail') {
        // Google "G" multicolor logo
        return (
            <svg viewBox="0 0 48 48" className={className || 'w-4 h-4'}>
                <path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
                <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
                <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
                <path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
            </svg>
        );
    }
    if (provider === 'Microsoft') {
        return (
            <svg viewBox="0 0 24 24" className={className || 'w-4 h-4'}>
                <path d="M0 0h11.377v11.372H0z" fill="#F25022"/>
                <path d="M12.623 0H24v11.372H12.623z" fill="#7FBA00"/>
                <path d="M0 12.623h11.377V24H0z" fill="#00A4EF"/>
                <path d="M12.623 12.623H24V24H12.623z" fill="#FFB900"/>
            </svg>
        );
    }
    return null;
}

/* ─── Crypto Helpers (E2EE for localStorage) ─────────────────── */

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
    } catch { return data; }
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
    } catch { return data; }
}

async function cacheEmails(accountId: string, folder: string, headers: EmailHeader[]): Promise<void> {
    try {
        const key = `${EMAIL_CACHE_KEY}-${accountId}-${folder}`;
        const data = JSON.stringify(headers);
        const encrypted = await encryptForStorage(data);
        localStorage.setItem(key, encrypted);
    } catch (err) { console.error('[Email] Cache write error:', err); }
}

async function getCachedEmails(accountId: string, folder: string): Promise<EmailHeader[]> {
    try {
        const key = `${EMAIL_CACHE_KEY}-${accountId}-${folder}`;
        const encrypted = localStorage.getItem(key);
        if (!encrypted) return [];
        const data = await decryptFromStorage(encrypted);
        return JSON.parse(data);
    } catch { return []; }
}

/* ─── Avatar helpers ─────────────────────────────────────────── */

function getAvatarColor(name: string): string {
    const colors = [
        'bg-violet-500/20 text-violet-400', 'bg-blue-500/20 text-blue-400',
        'bg-emerald-500/20 text-emerald-400', 'bg-amber-500/20 text-amber-400',
        'bg-rose-500/20 text-rose-400', 'bg-cyan-500/20 text-cyan-400',
        'bg-indigo-500/20 text-indigo-400',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name[0] || '?').toUpperCase();
}

/* ─── Main Component ─────────────────────────────────────────── */

export default function EmailView() {
    const isTauri = IS_TAURI;

    // Zustand store
    const {
        accounts, activeAccountId, unifiedInbox, activeFolder, activeCategory,
        selectedEmailUid, selectedEmailBody, selectedIndex,
        loading, loadingBody, refreshing, searchQuery,
        draftQueue, replyToEmail, setupOpen,
        setAccounts: storeSetAccounts, addAccount, removeAccount,
        setActiveAccountId, setActiveFolder, setActiveCategory,
        setUnifiedInbox, appendToInbox, setSelectedEmail, setSelectedEmailBody,
        setSelectedSpamAnalysis, setSelectedIndex, setLoading, setLoadingBody,
        setRefreshing, setSearchQuery, setReplyToEmail,
        setSetupOpen, addDraft, removeDraft, getFilteredEmails, getActiveAccount,
    } = useEmailStore();

    // Local state
    const [accountsLoaded, setAccountsLoaded] = useState(false);
    const [foldersDiscovered, setFoldersDiscovered] = useState(false);
    const [composerExpanded, setComposerExpanded] = useState(false);
    const [outlookToast, setOutlookToast] = useState<string | null>(null);
    const [outlookOpen, setOutlookOpen] = useState(false);
    const [folderCtx, setFolderCtx] = useState<{ x: number; y: number; key: string } | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const accountFoldersRef = useRef<Record<string, string[]>>({});
    const fetchGenRef = useRef(0); // race-condition guard for folder switching

    const activeAccount = getActiveAccount();
    const storeFiltered = getFilteredEmails();
    // Filter by active account (null = all accounts / unified)
    const filteredEmails = activeAccountId
        ? storeFiltered.filter(e => e.accountId === activeAccountId)
        : storeFiltered;
    const selectedEmail = unifiedInbox.find(e => e.uid === selectedEmailUid && (!activeAccountId || e.accountId === activeAccountId)) || null;

    // ─── SQLite cache integration (Module 1) ─────────────────────
    // This hooks into the Rust-side BackgroundSyncer + OAuthInterceptor
    // for zero-latency email loading and automatic token refresh.
    const cacheAccount = activeAccount || accounts[0] || null;
    const liveCache = useLiveEmails({
        account: cacheAccount,
        folder: activeFolder,
        autoSync: true,
    });

    // Merge SQLite cached emails into the unified inbox on first load
    // This provides instant rendering before IMAP fetch completes
    useEffect(() => {
        if (liveCache.emails.length > 0 && unifiedInbox.length === 0 && cacheAccount) {
            const cacheHeaders = liveCache.emails.map(e => toEmailHeader(e));
            if (cacheHeaders.length > 0) {
                appendToInbox(cacheHeaders, cacheAccount.id);
            }
        }
    }, [liveCache.emails.length]);

    // ─── Category counts ────────────────────────────────────────
    const categoryCounts = useMemo(() => {
        const counts: Record<EmailCategory, number> = { all: 0, personal: 0, newsletters: 0, transactional: 0, spam: 0 };
        for (const e of unifiedInbox) {
            counts.all++;
            const cat = e.category || categorizeEmail(e);
            if (cat in counts) counts[cat]++;
        }
        return counts;
    }, [unifiedInbox]);

    // ─── Load accounts from localStorage on mount ────────────────

    useEffect(() => {
        (async () => {
            try {
                const metaStr = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
                if (!metaStr) { setAccountsLoaded(true); return; }
                const meta: EmailAccount[] = JSON.parse(metaStr);
                const credsStr = localStorage.getItem(ACCOUNTS_CREDS_KEY);
                if (credsStr) {
                    try {
                        const decrypted = await decryptFromStorage(credsStr);
                        const creds: Record<string, Partial<EmailAccount>> = JSON.parse(decrypted);
                        for (const a of meta) {
                            const c = creds[a.id];
                            if (c) Object.assign(a, c);
                        }
                    } catch (err) { console.warn('[Email] Could not decrypt credentials:', err); }
                }
                storeSetAccounts(meta);
                // Default to unified view if multiple accounts, else select the single account
                if (meta.length > 1 && activeAccountId === undefined) setActiveAccountId(null);
                else if (meta.length === 1 && !activeAccountId) setActiveAccountId(meta[0].id);
            } catch (err) { console.error('[Email] Failed to load accounts:', err); }
            setAccountsLoaded(true);
        })();
    }, []);

    // ─── Persist accounts (metadata + encrypted credentials) ─────

    useEffect(() => {
        if (!accountsLoaded) return;
        const sanitized = accounts.map(a => ({
            id: a.id, email: a.email, displayName: a.displayName,
            provider: a.provider, imapHost: a.imapHost, imapPort: a.imapPort,
            smtpHost: a.smtpHost, smtpPort: a.smtpPort, authMethod: a.authMethod,
        }));
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(sanitized));

        const creds: Record<string, Record<string, string>> = {};
        for (const a of accounts) {
            const c: Record<string, string> = {};
            if (a.password) c.password = a.password;
            if (a.accessToken) c.accessToken = a.accessToken;
            if (a.refreshToken) c.refreshToken = a.refreshToken;
            if (a.clientId) c.clientId = a.clientId;
            if (Object.keys(c).length > 0) creds[a.id] = c;
        }
        encryptForStorage(JSON.stringify(creds)).then(encrypted => {
            localStorage.setItem(ACCOUNTS_CREDS_KEY, encrypted);
        }).catch(console.error);
    }, [accounts, accountsLoaded]);

    // ─── Discover IMAP folders per account ───────────────────────

    useEffect(() => {
        if (!isTauri || !accountsLoaded || accounts.length === 0) return;
        setFoldersDiscovered(false);
        const promises = accounts.map(async (acct) => {
            if (accountFoldersRef.current[acct.id]) return;
            try {
                // Refresh OAuth token before IMAP folder discovery
                if (acct.authMethod === 'oauth2') await ensureFreshToken(acct);
                const folders = await invoke<string[]>('list_email_folders', {
                    imapHost: acct.imapHost,
                    imapPort: acct.imapPort,
                    email: acct.email,
                    authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                    accessToken: acct.accessToken || null,
                    password: acct.password || null,
                });
                console.log(`[Email] Discovered folders for ${acct.email}:`, folders);
                accountFoldersRef.current[acct.id] = folders;
            } catch (err) {
                console.warn(`[Email] Could not discover folders for ${acct.email}:`, err);
            }
        });
        Promise.allSettled(promises).then(() => setFoldersDiscovered(true));
    }, [accounts, accountsLoaded, isTauri]);

    // ─── Outlook WebView events ──────────────────────────────────

    useEffect(() => {
        if (!isTauri) return;
        const unlistenImport = listen<{ sender: string; subject: string; body: string }>('onyx-email-imported', (event) => {
            setOutlookToast(`Imported: ${event.payload.subject || '(no subject)'}`);
            setTimeout(() => setOutlookToast(null), 5000);
        });
        const unlistenOpened = listen('onyx-outlook-opened', () => setOutlookOpen(true));
        const unlistenClosed = listen('onyx-outlook-closed', () => setOutlookOpen(false));
        return () => {
            unlistenImport.then(fn => fn());
            unlistenOpened.then(fn => fn());
            unlistenClosed.then(fn => fn());
        };
    }, [isTauri]);

    // ─── Fetch emails (unified across ALL accounts) ──────────────

    const fetchEmailsForAccount = useCallback(async (acct: EmailAccount, folder: string, gen: number) => {
        if (!isTauri) return;

        // Resolve canonical folder key to actual IMAP folder for this account
        const sf = accountFoldersRef.current[acct.id] || [];
        const resolvedFolder = sf.length > 0 ? resolveImapFolder(folder, sf) : folder;
        if (!resolvedFolder) return; // folder doesn't exist for this account

        try {
            // Refresh OAuth token before IMAP call
            if (acct.authMethod === 'oauth2') {
                await ensureFreshToken(acct);
            }
            if (acct.authMethod === 'oauth2' && !acct.accessToken) return;

            // Stale check after token refresh
            if (fetchGenRef.current !== gen) return;

            const result = await invoke<EmailHeader[]>('fetch_email_headers', {
                imapHost: acct.imapHost,
                imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder: resolvedFolder,
                offset: 0,
                limit: 50,
            });

            // Stale check after network call — only apply if this is still the active folder
            if (fetchGenRef.current !== gen) return;

            appendToInbox(result, acct.id);
            await cacheEmails(acct.id, resolvedFolder, result);
        } catch (err) {
            console.error(`[Email] Fetch error for ${acct.email}:`, err);
        }
    }, [isTauri, appendToInbox]);

    const fetchAllEmails = useCallback(async (folder?: string, showSpinner = false) => {
        const targetFolder = folder || activeFolder;
        const gen = ++fetchGenRef.current; // bump generation — stale fetches will bail out

        if (showSpinner) setLoading(true);

        // Step 1: Clear inbox & immediately populate from cache (instant feel)
        setUnifiedInbox([]);
        const cachePromises = accounts.map(async (acct) => {
            const sf = accountFoldersRef.current[acct.id] || [];
            const resolved = sf.length > 0 ? resolveImapFolder(targetFolder, sf) : targetFolder;
            if (!resolved) return;
            const cached = await getCachedEmails(acct.id, resolved);
            if (cached.length > 0 && fetchGenRef.current === gen) {
                appendToInbox(cached, acct.id);
            }
        });
        await Promise.allSettled(cachePromises);
        if (fetchGenRef.current !== gen) { setLoading(false); return; }

        // Step 2: Fetch fresh from network (replaces cache data as it arrives)
        const promises = accounts.map(acct => fetchEmailsForAccount(acct, targetFolder, gen));
        await Promise.allSettled(promises);

        if (fetchGenRef.current === gen) setLoading(false);
    }, [accounts, activeFolder, fetchEmailsForAccount, setLoading, appendToInbox, setUnifiedInbox]);

    // ─── Fetch emails when folder changes or accounts load ───────

    useEffect(() => {
        if (accountsLoaded && accounts.length > 0 && foldersDiscovered) {
            fetchAllEmails(undefined, false);
        }
    }, [activeFolder, accountsLoaded, accounts.length, foldersDiscovered]);

    // ─── Polling ─────────────────────────────────────────────────

    useEffect(() => {
        if (accounts.length === 0) return;
        pollRef.current = setInterval(() => {
            if (document.visibilityState === 'visible') fetchAllEmails();
        }, POLL_INTERVAL);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [accounts.length, fetchAllEmails]);

    // ─── Fetch email body ────────────────────────────────────────

    const fetchBody = useCallback(async (email: EmailHeader) => {
        const acct = email.accountId
            ? accounts.find(a => a.id === email.accountId)
            : activeAccount;
        if (!acct || !isTauri) return;

        // Refresh OAuth token before IMAP call
        if (acct.authMethod === 'oauth2') await ensureFreshToken(acct);
        if (acct.authMethod === 'oauth2' && !acct.accessToken) return;

        // Resolve folder for this account
        const sf = accountFoldersRef.current[acct.id] || [];
        const folder = sf.length > 0 ? (resolveImapFolder(activeFolder, sf) || activeFolder) : activeFolder;

        setLoadingBody(true);
        try {
            const result = await invoke<EmailBody>('fetch_email_body', {
                imapHost: acct.imapHost, imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder,
                uid: email.uid,
            });
            setSelectedEmailBody(result);

            // Fetch spam analysis in background
            invoke<SpamAnalysis>('fetch_spam_analysis', {
                imapHost: acct.imapHost, imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder, uid: email.uid,
            }).then(setSelectedSpamAnalysis).catch(() => {
                setSelectedSpamAnalysis(null);
            });
        } catch (err) {
            console.error('[Email] Body fetch error:', err);
        } finally {
            setLoadingBody(false);
        }
    }, [accounts, activeAccount, activeFolder, isTauri]);

    // ─── Email actions ───────────────────────────────────────────

    const handleMarkRead = useCallback(async (email: EmailHeader, toggleOff: boolean) => {
        const acct = email.accountId
            ? accounts.find(a => a.id === email.accountId)
            : activeAccount;
        if (!acct || !isTauri) return;

        // Refresh OAuth token
        if (acct.authMethod === 'oauth2') await ensureFreshToken(acct);

        // Resolve folder for this account
        const sf = accountFoldersRef.current[acct.id] || [];
        const folder = sf.length > 0 ? (resolveImapFolder(activeFolder, sf) || activeFolder) : activeFolder;

        try {
            await invoke('mark_email_flag', {
                imapHost: acct.imapHost, imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder, uid: email.uid,
                flag: '\\Seen', add: !toggleOff,
            });
            // Update local state
            setUnifiedInbox(unifiedInbox.map(e =>
                (e.uid === email.uid && e.accountId === email.accountId)
                    ? { ...e, is_read: !toggleOff }
                    : e
            ));
        } catch (err) { console.error('[Email] Mark read error:', err); }
    }, [accounts, activeAccount, activeFolder, isTauri, unifiedInbox]);

    const handleSelectEmail = useCallback((email: EmailHeader, index: number) => {
        setSelectedEmail(email.uid);
        setSelectedIndex(index);
        fetchBody(email);
        // Auto-mark as read when opening
        if (!email.is_read) {
            handleMarkRead(email, false);
        }
    }, [setSelectedEmail, setSelectedIndex, fetchBody, handleMarkRead]);

    const handleDelete = useCallback(async (email: EmailHeader) => {
        const acct = email.accountId
            ? accounts.find(a => a.id === email.accountId)
            : activeAccount;
        if (!acct || !isTauri) return;

        // Refresh OAuth token
        if (acct.authMethod === 'oauth2') await ensureFreshToken(acct);

        // Resolve folder for this account
        const sf = accountFoldersRef.current[acct.id] || [];
        const folder = sf.length > 0 ? (resolveImapFolder(activeFolder, sf) || activeFolder) : activeFolder;

        try {
            await invoke('delete_email', {
                imapHost: acct.imapHost, imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder, uid: email.uid,
            });
            setUnifiedInbox(unifiedInbox.filter(e => !(e.uid === email.uid && e.accountId === email.accountId)));
            setSelectedEmail(null);
        } catch (err) { console.error('[Email] Delete error:', err); }
    }, [accounts, activeAccount, activeFolder, isTauri, unifiedInbox]);

    const handleArchive = useCallback(async (email: EmailHeader) => {
        const acct = email.accountId
            ? accounts.find(a => a.id === email.accountId)
            : activeAccount;
        if (!acct || !isTauri) return;

        // Refresh OAuth token
        if (acct.authMethod === 'oauth2') await ensureFreshToken(acct);

        // Resolve archive folder dynamically using server's actual folders
        const sf = accountFoldersRef.current[acct.id] || [];
        const archiveFolder = sf.length > 0
            ? resolveImapFolder('Archive', sf)
            : (acct.provider === 'Gmail' ? '[Gmail]/All Mail' : 'Archive');
        if (!archiveFolder) return;

        // Resolve current folder
        const folder = sf.length > 0 ? (resolveImapFolder(activeFolder, sf) || activeFolder) : activeFolder;

        try {
            await invoke('move_email', {
                imapHost: acct.imapHost, imapPort: acct.imapPort,
                email: acct.email,
                authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: acct.accessToken || null,
                password: acct.password || null,
                folder, uid: email.uid,
                targetFolder: archiveFolder,
            });
            setUnifiedInbox(unifiedInbox.filter(e => !(e.uid === email.uid && e.accountId === email.accountId)));
            setSelectedEmail(null);
        } catch (err) { console.error('[Email] Archive error:', err); }
    }, [accounts, activeAccount, activeFolder, isTauri, unifiedInbox]);

    const handleReply = useCallback((email: EmailHeader) => {
        setReplyToEmail(email);
        setComposerExpanded(true);
    }, []);

    const handleForward = useCallback((_email: EmailHeader) => {
        setReplyToEmail(null);
        setComposerExpanded(true);
    }, []);

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        await fetchAllEmails();
        setRefreshing(false);
    }, [fetchAllEmails]);

    const handleQueueSend = useCallback((draft: QueuedDraft) => {
        addDraft(draft);
        setComposerExpanded(false);
        setReplyToEmail(null);
    }, [addDraft]);

    const handleAccountAdded = useCallback((account: EmailAccount) => {
        addAccount(account);
        // Immediately fetch for the new account
        fetchEmailsForAccount(account, activeFolder, fetchGenRef.current);
    }, [addAccount, fetchEmailsForAccount, activeFolder]);

    const handleRemoveAccount = useCallback((id: string) => {
        removeAccount(id);
        // Clean cache
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.startsWith(`${EMAIL_CACHE_KEY}-${id}-`)) localStorage.removeItem(key);
        }
    }, [removeAccount]);

    // ─── Keyboard shortcuts ──────────────────────────────────────

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Don't handle shortcuts when typing in inputs
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

            const emails = filteredEmails;

            switch (e.key.toLowerCase()) {
                case 'j': {
                    // Next email
                    e.preventDefault();
                    const next = Math.min(selectedIndex + 1, emails.length - 1);
                    if (next >= 0 && next < emails.length) {
                        handleSelectEmail(emails[next], next);
                    }
                    break;
                }
                case 'k': {
                    // Previous email
                    e.preventDefault();
                    const prev = Math.max(selectedIndex - 1, 0);
                    if (prev >= 0 && prev < emails.length) {
                        handleSelectEmail(emails[prev], prev);
                    }
                    break;
                }
                case 'c': {
                    // Compose
                    e.preventDefault();
                    setReplyToEmail(null);
                    setComposerExpanded(true);
                    break;
                }
                case 'r': {
                    // Reply
                    if (selectedEmail) {
                        e.preventDefault();
                        handleReply(selectedEmail);
                    }
                    break;
                }
                case 'e': {
                    // Archive
                    if (selectedEmail) {
                        e.preventDefault();
                        handleArchive(selectedEmail);
                    }
                    break;
                }
                case '#': {
                    // Delete
                    if (selectedEmail) {
                        e.preventDefault();
                        handleDelete(selectedEmail);
                    }
                    break;
                }
                case '/': {
                    // Focus search
                    e.preventDefault();
                    const searchInput = document.querySelector('[data-email-search]') as HTMLInputElement;
                    searchInput?.focus();
                    break;
                }
                case 'escape': {
                    if (composerExpanded) {
                        setComposerExpanded(false);
                    } else if (selectedEmail) {
                        setSelectedEmail(null);
                    }
                    break;
                }
                // Vim-style: G = go to bottom, g = go to top (gg)
                case 'g': {
                    if (e.shiftKey) {
                        // G = last email
                        e.preventDefault();
                        const last = emails.length - 1;
                        if (last >= 0) handleSelectEmail(emails[last], last);
                    }
                    break;
                }
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [filteredEmails, selectedIndex, selectedEmail, composerExpanded, handleSelectEmail, handleReply, handleArchive, handleDelete]);

    // ─── No accounts — empty state ───────────────────────────────

    if (accountsLoaded && accounts.length === 0) {
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
                        <div className="space-y-2">
                            <button
                                onClick={() => setSetupOpen(true)}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors text-sm font-semibold"
                            >
                                <Plus size={16} /> Add Email Account
                            </button>
                            {isTauri && (
                                <button
                                    onClick={() => invoke('open_outlook_onyx', { realm: null as string | null }).catch(console.error)}
                                    className="block mx-auto items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-colors text-xs font-medium"
                                >
                                    <ExternalLink size={14} className="inline mr-1" />
                                    Open Outlook in Onyx
                                </button>
                            )}
                        </div>
                        {/* Keyboard shortcut hint */}
                        <div className="pt-4">
                            <div className="text-[10px] text-zinc-700 space-y-0.5">
                                <div><kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono text-[9px]">J/K</kbd> navigate · <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono text-[9px]">C</kbd> compose · <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono text-[9px]">/</kbd> search</div>
                            </div>
                        </div>
                    </div>
                </div>
                <AccountSetup
                    isOpen={setupOpen}
                    onClose={() => setSetupOpen(false)}
                    onAccountAdded={handleAccountAdded}
                />
            </>
        );
    }

    // ─── Main 3-Panel Layout ─────────────────────────────────────

    return (
        <div className="flex h-full overflow-hidden">
            {/* ─── Left Panel: Accounts + Folders ─────────────────── */}
            <div className="w-52 h-full flex flex-col bg-zinc-900/60 border-r border-zinc-800/30 shrink-0">
                {/* Compose button */}
                <div className="p-3 shrink-0">
                    <button
                        onClick={() => { setReplyToEmail(null); setComposerExpanded(true); }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-500/15 text-amber-400 hover:bg-amber-500/20 transition-colors text-sm font-semibold"
                    >
                        <MailPlus size={16} /> Compose
                    </button>
                </div>

                {/* Account list */}
                <div className="px-2 pb-2">
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-2 py-1">
                        Accounts ({accounts.length})
                    </div>
                    {/* Unified / All accounts */}
                    {accounts.length > 1 && (
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveAccountId(null)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveAccountId(null); }}
                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                                activeAccountId === null
                                    ? 'bg-amber-500/10 text-zinc-200'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                            }`}
                        >
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-linear-to-br from-amber-500/20 to-violet-500/20 text-amber-400">
                                <Inbox size={12} />
                            </div>
                            <span className="truncate flex-1 text-left">All accounts</span>
                        </div>
                    )}
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
                                {account.provider === 'Custom'
                                    ? getInitials(account.email)
                                    : <ProviderIcon provider={account.provider} className="w-3.5 h-3.5" />}
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
                        <Plus size={12} /> Add account
                    </button>
                </div>

                <div className="mx-3 h-px bg-zinc-800/40" />

                {/* Folders */}
                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
                    {CANONICAL_FOLDERS.map(folder => {
                        const isActive = activeFolder === folder.key;
                        return (
                            <button
                                key={folder.key}
                                onClick={() => setActiveFolder(folder.key)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setFolderCtx({ x: e.clientX, y: e.clientY, key: folder.key });
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    isActive
                                        ? 'bg-zinc-800/60 text-zinc-100'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                                }`}
                            >
                                <folder.icon size={16} className={isActive ? 'text-amber-400' : 'text-zinc-600'} />
                                <span className="flex-1 text-left truncate">{folder.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Outbox (draft queue) */}
                {draftQueue.length > 0 && (
                    <div className="px-2 pb-2">
                        <div className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                            <div className="flex items-center gap-2 text-[11px] text-amber-400 font-semibold">
                                <Clock size={12} />
                                Outbox ({draftQueue.length})
                            </div>
                        </div>
                    </div>
                )}

                {/* Keyboard hints */}
                <div className="px-3 pb-3 shrink-0">
                    <div className="text-[9px] text-zinc-700 space-y-0.5">
                        <div><kbd className="px-1 rounded bg-zinc-800/50 font-mono">J</kbd>/<kbd className="px-1 rounded bg-zinc-800/50 font-mono">K</kbd> nav · <kbd className="px-1 rounded bg-zinc-800/50 font-mono">C</kbd> compose</div>
                        <div><kbd className="px-1 rounded bg-zinc-800/50 font-mono">R</kbd> reply · <kbd className="px-1 rounded bg-zinc-800/50 font-mono">E</kbd> archive · <kbd className="px-1 rounded bg-zinc-800/50 font-mono">/</kbd> search</div>
                    </div>
                </div>
            </div>

            {/* ─── Center Panel: Category Tabs + Email List ────────── */}
            <div className="w-80 bg-zinc-900/30 flex flex-col border-r border-zinc-800/30 shrink-0">
                {/* Search + Refresh */}
                <div className="p-3 border-b border-zinc-800/30 shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-zinc-800/30 rounded-lg px-3 py-2 border border-zinc-700/20">
                            <Search size={14} className="text-zinc-600" />
                            <input
                                type="text"
                                data-email-search
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search emails... (/)"
                                className="flex-1 bg-transparent text-sm text-zinc-300 placeholder-zinc-600 outline-none"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="text-zinc-600 hover:text-zinc-400">
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="p-2 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="Refresh all accounts"
                        >
                            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Category tabs */}
                <InboxTabs
                    active={activeCategory}
                    onChange={setActiveCategory}
                    counts={categoryCounts}
                />

                {/* Thread list */}
                <ThreadList
                    emails={filteredEmails}
                    loading={loading}
                    selectedUid={selectedEmailUid}
                    selectedIndex={selectedIndex}
                    onSelectEmail={handleSelectEmail}
                    showCategoryBadge={activeCategory === 'all'}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onMarkRead={handleMarkRead}
                    onReply={handleReply}
                />
            </div>

            {/* ─── Right Panel: Email Viewer + Mini Composer ──────── */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selectedEmail ? (
                    <EmailViewer
                        email={selectedEmail}
                        body={selectedEmailBody}
                        loadingBody={loadingBody}
                        onBack={() => setSelectedEmail(null)}
                        onReply={handleReply}
                        onReplyAll={handleReply}
                        onForward={handleForward}
                        onDelete={handleDelete}
                        onArchive={handleArchive}
                        onMarkRead={handleMarkRead}
                    />
                ) : outlookOpen ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-3 max-w-xs">
                            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto">
                                <ExternalLink size={28} className="text-violet-400" />
                            </div>
                            <h3 className="text-base font-bold text-zinc-100">Outlook is open</h3>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                                Outlook Web is running in an Onyx window. Use the toolbar to import emails.
                            </p>
                            <button
                                onClick={() => invoke('close_outlook_onyx').catch(() => {})}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-colors text-xs font-medium"
                            >
                                Close Outlook WebView
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-3">
                            <Inbox size={32} className="text-zinc-700 mx-auto" />
                            <p className="text-sm text-zinc-600">Select an email to read</p>
                            <p className="text-[10px] text-zinc-700">
                                Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">J</kbd> to navigate down
                            </p>
                        </div>
                    </div>
                )}

                {/* Mini composer — always at bottom, independent of email selection */}
                <MiniComposer
                    account={activeAccount || accounts[0] || null}
                    accounts={accounts}
                    replyTo={replyToEmail}
                    expanded={composerExpanded}
                    onToggleExpand={() => setComposerExpanded(!composerExpanded)}
                    onClose={() => { setComposerExpanded(false); setReplyToEmail(null); }}
                    onQueueSend={handleQueueSend}
                />
            </div>

            {/* ─── Modals + Overlays ──────────────────────────────── */}
            <AccountSetup
                isOpen={setupOpen}
                onClose={() => setSetupOpen(false)}
                onAccountAdded={handleAccountAdded}
            />

            {/* Undo send toasts */}
            <UndoToast
                drafts={draftQueue}
                accounts={accounts}
                onCancel={(id) => removeDraft(id)}
                onSent={(id) => removeDraft(id)}
            />

            {/* Outlook import toast */}
            {outlookToast && (
                <div
                    className="fixed bottom-6 left-6 z-99999 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium text-white"
                    style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', boxShadow: '0 8px 32px rgba(139,92,246,0.4)' }}
                >
                    <span>✨ {outlookToast}</span>
                    <button onClick={() => setOutlookToast(null)} className="ml-2 p-0.5 rounded hover:bg-white/20 transition-colors">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Folder context menu */}
            {folderCtx && (
                <ContextMenu
                    x={folderCtx.x}
                    y={folderCtx.y}
                    onClose={() => setFolderCtx(null)}
                    items={[
                        {
                            label: 'Mark all as read',
                            icon: <MailOpen size={13} />,
                            onClick: () => {
                                const folderEmails = unifiedInbox.filter(e => {
                                    // In unified mode, check all; otherwise check active account
                                    if (activeAccountId && e.accountId !== activeAccountId) return false;
                                    return !e.is_read;
                                });
                                // Mark each unread email as read
                                folderEmails.forEach(e => handleMarkRead(e, false));
                            },
                        },
                        {
                            label: 'Refresh',
                            icon: <RefreshCw size={13} />,
                            onClick: () => fetchAllEmails(folderCtx.key, true),
                        },
                        ...(folderCtx.key === 'Trash' ? [{
                            label: 'Empty Trash',
                            icon: <Trash2 size={13} />,
                            onClick: async () => {
                                // Optimistic: remove all from UI instantly
                                const trashEmails = [...unifiedInbox];
                                setUnifiedInbox([]);
                                setSelectedEmail(null);

                                // Batch delete per account in background (one IMAP session per account)
                                const byAccount = new Map<string, { acct: EmailAccount; uids: number[] }>();
                                for (const e of trashEmails) {
                                    const acctId = e.accountId || activeAccountId;
                                    if (!acctId) continue;
                                    if (!byAccount.has(acctId)) {
                                        const acct = accounts.find(a => a.id === acctId);
                                        if (acct) byAccount.set(acctId, { acct, uids: [] });
                                    }
                                    byAccount.get(acctId)?.uids.push(e.uid);
                                }
                                for (const { acct, uids } of byAccount.values()) {
                                    if (acct.authMethod === 'oauth2') await ensureFreshToken(acct);
                                    const sf = accountFoldersRef.current[acct.id] || [];
                                    const folder = sf.length > 0 ? (resolveImapFolder('Trash', sf) || 'Trash') : 'Trash';
                                    invoke('batch_delete_emails', {
                                        imapHost: acct.imapHost, imapPort: acct.imapPort,
                                        email: acct.email,
                                        authMethod: acct.authMethod === 'oauth2' ? 'oauth2' : 'password',
                                        accessToken: acct.accessToken || null,
                                        password: acct.password || null,
                                        folder, uids,
                                    }).catch(err => console.error('[Email] Batch delete error:', err));
                                }
                            },
                        }] : []),
                    ] as ContextMenuItem[]}
                />
            )}
        </div>
    );
}
