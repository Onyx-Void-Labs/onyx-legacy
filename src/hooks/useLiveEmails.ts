/**
 * useLiveEmails.ts — Zero-latency email hook.
 *
 * Queries the local SQLite cache (via Tauri commands) for instant email loading.
 * Listens for background sync events and automatically refreshes.
 * Falls back to direct IMAP fetch if cache is empty (first launch).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type EmailAccount } from '../store/emailStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CachedEmailHeader {
    id: number;
    account_id: string;
    uid: number;
    message_id: string;
    folder: string;
    from_address: string;
    from_name: string;
    to_address: string;
    subject: string;
    preview: string;
    date_str: string;
    date_epoch: number;
    is_read: boolean;
    is_starred: boolean;
    has_attachments: boolean;
    in_reply_to: string | null;
    references_header: string | null;
    category: string;
}

export interface CachedEmailBody {
    uid: number;
    html_body: string | null;
    text_body: string | null;
    attachments: CachedAttachment[];
}

export interface CachedAttachment {
    id: number;
    email_id: number;
    filename: string;
    mime_type: string;
    size: number;
    data_b64: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseLiveEmailsOptions {
    account?: EmailAccount | null;
    folder?: string;
    category?: string;
    pageSize?: number;
    autoSync?: boolean;
}

interface UseLiveEmailsReturn {
    emails: CachedEmailHeader[];
    loading: boolean;
    syncing: boolean;
    error: string | null;
    unreadCount: number;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
    search: (query: string) => Promise<CachedEmailHeader[]>;
    markRead: (uid: number, read: boolean) => Promise<void>;
    getBody: (uid: number) => Promise<CachedEmailBody | null>;
}

export function useLiveEmails(options: UseLiveEmailsOptions = {}): UseLiveEmailsReturn {
    const {
        account = null,
        folder = 'INBOX',
        category,
        pageSize = 50,
        autoSync = true,
    } = options;

    const [emails, setEmails] = useState<CachedEmailHeader[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const offsetRef = useRef(0);
    const mountedRef = useRef(true);

    // ─── Load from cache (instant) ────────────────────────────────────────────
    const loadFromCache = useCallback(async (reset = false) => {
        if (!account) return;

        try {
            if (reset) {
                offsetRef.current = 0;
                setLoading(true);
            }

            const cached: CachedEmailHeader[] = await invoke('get_cached_emails', {
                accountId: account.id,
                folder,
                category: category || null,
                offset: offsetRef.current,
                limit: pageSize,
            });

            if (!mountedRef.current) return;

            if (reset) {
                setEmails(cached);
            } else {
                setEmails(prev => [...prev, ...cached]);
            }

            setHasMore(cached.length >= pageSize);
            offsetRef.current += cached.length;

            // Get unread count
            const count: number = await invoke('get_unread_count', {
                accountId: account.id,
                folder,
            });
            if (mountedRef.current) setUnreadCount(count);

            setError(null);
        } catch (e) {
            console.error('[useLiveEmails] Cache load failed:', e);
            setError(String(e));
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [account?.id, folder, category, pageSize]);

    // ─── Start background sync ────────────────────────────────────────────────
    const startSync = useCallback(async () => {
        if (!account || !autoSync) return;

        try {
            // Register OAuth token for auto-refresh (if OAuth account)
            if (account.authMethod === 'oauth2' && account.accessToken) {
                await invoke('register_email_token', {
                    accountId: account.id,
                    accessToken: account.accessToken,
                    refreshToken: account.refreshToken || null,
                    expiresIn: 3600,
                    provider: account.provider,
                    clientId: account.clientId || '',
                });
            }

            // Start background sync worker
            setSyncing(true);
            await invoke('start_email_sync', {
                accountId: account.id,
                imapHost: account.imapHost,
                imapPort: account.imapPort,
                email: account.email,
                authMethod: account.authMethod,
                password: account.password || null,
                folders: [folder],
            });
        } catch (e) {
            console.error('[useLiveEmails] Sync start failed:', e);
            // Non-fatal — cache still works
        }
    }, [account, folder, autoSync]);

    // ─── Manual refresh (pull-to-refresh) ─────────────────────────────────────
    const refresh = useCallback(async () => {
        if (!account) return;

        try {
            setSyncing(true);
            await invoke('force_email_sync', {
                accountId: account.id,
                imapHost: account.imapHost,
                imapPort: account.imapPort,
                email: account.email,
                authMethod: account.authMethod,
                password: account.password || null,
                folder,
            });
            // Reload from cache after sync
            await loadFromCache(true);
        } catch (e) {
            console.error('[useLiveEmails] Refresh failed:', e);
            setError(String(e));
        } finally {
            setSyncing(false);
        }
    }, [account, folder, loadFromCache]);

    // ─── Load more (infinite scroll) ──────────────────────────────────────────
    const loadMore = useCallback(async () => {
        if (!hasMore || loading) return;
        await loadFromCache(false);
    }, [hasMore, loading, loadFromCache]);

    // ─── Search ───────────────────────────────────────────────────────────────
    const search = useCallback(async (query: string): Promise<CachedEmailHeader[]> => {
        if (!query.trim()) {
            await loadFromCache(true);
            return emails;
        }
        try {
            const results: CachedEmailHeader[] = await invoke('search_cached_emails', {
                query,
                accountId: account?.id || null,
                limit: 50,
            });
            setEmails(results);
            return results;
        } catch (e) {
            console.error('[useLiveEmails] Search failed:', e);
            return [];
        }
    }, [account?.id, loadFromCache, emails]);

    // ─── Mark read (instant local + background IMAP) ──────────────────────────
    const markRead = useCallback(async (uid: number, read: boolean) => {
        if (!account) return;

        // Optimistic update
        setEmails(prev => prev.map(e =>
            e.uid === uid ? { ...e, is_read: read } : e
        ));
        setUnreadCount(prev => read ? Math.max(0, prev - 1) : prev + 1);

        try {
            await invoke('mark_cached_email_read', {
                accountId: account.id,
                uid,
                folder,
                read,
                imapHost: account.imapHost,
                imapPort: account.imapPort,
                emailAddr: account.email,
                authMethod: account.authMethod,
                password: account.password || null,
            });
        } catch (e) {
            console.error('[useLiveEmails] Mark read failed:', e);
            // Revert optimistic update
            setEmails(prev => prev.map(e =>
                e.uid === uid ? { ...e, is_read: !read } : e
            ));
        }
    }, [account, folder]);

    // ─── Get email body (instant from cache, fallback to IMAP) ────────────────
    const getBody = useCallback(async (uid: number): Promise<CachedEmailBody | null> => {
        if (!account) return null;

        try {
            // Try cache first
            const cached: CachedEmailBody | null = await invoke('get_cached_email_body', {
                accountId: account.id,
                uid,
                folder,
            });

            if (cached && (cached.html_body || cached.text_body)) {
                return cached;
            }

            // Fetch from IMAP and cache it (with automatic token refresh)
            const body: CachedEmailBody = await invoke('fetch_and_cache_email_body', {
                accountId: account.id,
                imapHost: account.imapHost,
                imapPort: account.imapPort,
                emailAddr: account.email,
                authMethod: account.authMethod,
                password: account.password || null,
                folder,
                uid,
            });

            return body;
        } catch (e) {
            console.error('[useLiveEmails] Get body failed:', e);
            return null;
        }
    }, [account, folder]);

    // ─── Initial load + sync ──────────────────────────────────────────────────
    useEffect(() => {
        mountedRef.current = true;

        // Load cached emails instantly
        loadFromCache(true);

        // Start background sync
        startSync();

        return () => {
            mountedRef.current = false;
            // Stop sync when unmounting
            if (account) {
                invoke('stop_email_sync', { accountId: account.id }).catch(() => {});
            }
        };
    }, [account?.id, folder, category]);

    // ─── Listen for sync events ───────────────────────────────────────────────
    useEffect(() => {
        if (!account) return;

        const unlisten1 = listen<{ accountId: string; folder: string; newCount: number }>(
            'email-sync-update',
            (event) => {
                if (event.payload.accountId === account.id && event.payload.folder === folder) {
                    // New emails arrived — reload from cache
                    loadFromCache(true);
                }
            }
        );

        const unlisten2 = listen<{ accountId: string; timestamp: number }>(
            'email-sync-complete',
            (event) => {
                if (event.payload.accountId === account.id) {
                    setSyncing(false);
                }
            }
        );

        return () => {
            unlisten1.then(fn => fn());
            unlisten2.then(fn => fn());
        };
    }, [account?.id, folder, loadFromCache]);

    return {
        emails,
        loading,
        syncing,
        error,
        unreadCount,
        hasMore,
        loadMore,
        refresh,
        search,
        markRead,
        getBody,
    };
}

// ─── Helper: Convert CachedEmailHeader to the existing EmailHeader format ────
export function toEmailHeader(cached: CachedEmailHeader): import('../store/emailStore').EmailHeader {
    return {
        uid: cached.uid,
        from: cached.from_name
            ? `${cached.from_name} <${cached.from_address}>`
            : cached.from_address,
        to: cached.to_address,
        subject: cached.subject,
        date: cached.date_str,
        preview: cached.preview,
        is_read: cached.is_read,
        has_attachments: cached.has_attachments,
        message_id: cached.message_id,
        in_reply_to: cached.in_reply_to,
        references: [],
        accountId: cached.account_id,
        category: cached.category as import('../store/emailStore').EmailCategory,
    };
}
