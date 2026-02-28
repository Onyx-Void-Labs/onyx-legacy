/**
 * UndoToast.tsx — 15-minute undo-send countdown toast.
 * Shows for each queued draft with a live countdown timer.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, Undo2, Clock, Send, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { IS_TAURI } from '../../hooks/usePlatform';
import { type QueuedDraft, type EmailAccount } from '../../store/emailStore';

/* ─── Component ──────────────────────────────────────────────── */

interface UndoToastProps {
    drafts: QueuedDraft[];
    accounts: EmailAccount[];
    onCancel: (draftId: string) => void;
    onSent: (draftId: string) => void;
}

export default function UndoToast({ drafts, accounts, onCancel, onSent }: UndoToastProps) {
    const [now, setNow] = useState(Date.now());
    const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
    const isTauri = IS_TAURI;

    // Tick every second
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Auto-send when timer expires
    useEffect(() => {
        for (const draft of drafts) {
            if (draft.scheduledAt <= now && !sendingIds.has(draft.id)) {
                sendDraft(draft);
            }
        }
    }, [now, drafts, sendingIds]);

    const sendDraft = useCallback(async (draft: QueuedDraft) => {
        if (sendingIds.has(draft.id)) return;
        setSendingIds(prev => new Set(prev).add(draft.id));

        const account = accounts.find(a => a.id === draft.accountId);
        if (!account || !isTauri) {
            onSent(draft.id);
            return;
        }

        try {
            // Refresh OAuth token before send (tokens expire in ~1hr, but
            // the 15-minute undo window may push past the original token's life)
            let token = account.accessToken || null;
            if (account.authMethod === 'oauth2' && account.refreshToken && account.clientId) {
                try {
                    const freshTokenResponse = await invoke<{ access_token: string }>('refresh_oauth_token', {
                        provider: account.provider?.toLowerCase() || 'google',
                        refreshToken: account.refreshToken,
                        clientId: account.clientId,
                    });
                    token = freshTokenResponse.access_token;
                    // Update account in-memory so subsequent retries use fresh token
                    account.accessToken = token;
                } catch (refreshErr) {
                    console.warn('[UndoToast] Token refresh failed, using cached token:', refreshErr);
                }
            }

            await invoke('send_email', {
                smtpHost: account.smtpHost,
                smtpPort: account.smtpPort,
                fromEmail: account.email,
                fromName: account.displayName,
                authMethod: account.authMethod === 'oauth2' ? 'oauth2' : 'password',
                accessToken: token,
                password: account.password || null,
                to: draft.to,
                cc: draft.cc,
                subject: draft.subject,
                bodyHtml: draft.bodyHtml,
                bodyText: draft.bodyText,
                inReplyTo: draft.inReplyTo || null,
                referencesHeader: draft.references || null,
                attachments: draft.attachments?.map(a => ({
                    filename: a.filename,
                    mime_type: a.mimeType,
                    data_base64: a.dataBase64,
                })) || null,
            });
            onSent(draft.id);
        } catch (err) {
            console.error('[UndoToast] Send failed:', err);
            // Keep in queue for retry
            setSendingIds(prev => {
                const next = new Set(prev);
                next.delete(draft.id);
                return next;
            });
        }
    }, [accounts, isTauri, onSent, sendingIds]);

    // Force send immediately
    const handleForceSend = (draft: QueuedDraft) => {
        sendDraft(draft);
    };

    if (drafts.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-99999 flex flex-col gap-2 max-w-sm">
            {drafts.map((draft) => {
                const remaining = Math.max(0, Math.ceil((draft.scheduledAt - now) / 1000));
                const minutes = Math.floor(remaining / 60);
                const seconds = remaining % 60;
                const isSending = sendingIds.has(draft.id);
                const progress = Math.max(0, 1 - remaining / (15 * 60));

                return (
                    <div
                        key={draft.id}
                        className="relative overflow-hidden rounded-xl shadow-2xl border border-zinc-700/30"
                        style={{
                            background: 'linear-gradient(135deg, #27272a, #18181b)',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                        }}
                    >
                        {/* Progress bar */}
                        <div
                            className="absolute top-0 left-0 h-0.5 bg-amber-500/50 transition-all duration-1000"
                            style={{ width: `${progress * 100}%` }}
                        />

                        <div className="px-4 py-3 flex items-center gap-3">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                {isSending ? (
                                    <Loader2 size={14} className="animate-spin text-amber-400 shrink-0" />
                                ) : (
                                    <Clock size={14} className="text-amber-400 shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <div className="text-xs font-semibold text-zinc-200 truncate">
                                        {isSending ? 'Sending...' : 'Sent!'}
                                    </div>
                                    <div className="text-[10px] text-zinc-500 truncate">
                                        To: {draft.to.join(', ')} · {draft.subject || '(No subject)'}
                                    </div>
                                </div>
                            </div>

                            {!isSending && remaining > 0 && (
                                <>
                                    {/* Timer */}
                                    <span className="text-sm font-mono font-bold text-amber-400 shrink-0 tabular-nums">
                                        {minutes}:{seconds.toString().padStart(2, '0')}
                                    </span>

                                    {/* Undo button */}
                                    <button
                                        onClick={() => onCancel(draft.id)}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors shrink-0"
                                    >
                                        <Undo2 size={12} />
                                        Undo
                                    </button>

                                    {/* Send now */}
                                    <button
                                        onClick={() => handleForceSend(draft)}
                                        className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
                                        title="Send now"
                                    >
                                        <Send size={12} />
                                    </button>
                                </>
                            )}

                            {!isSending && remaining <= 0 && (
                                <span className="text-[10px] text-emerald-400 font-medium">
                                    Delivered ✓
                                </span>
                            )}

                            <button
                                onClick={() => onCancel(draft.id)}
                                className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
