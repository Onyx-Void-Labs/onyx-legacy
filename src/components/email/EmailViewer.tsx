/**
 * EmailViewer.tsx — HTML email renderer with dark mode, sanitization,
 * sandboxed iframe, link safety, and attachment display.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
    Reply, ReplyAll, Forward, Trash2, Archive, ChevronLeft,
    Paperclip, Download, Shield, ShieldCheck, ShieldAlert,
    Loader2, Eye, EyeOff, Tag,
} from 'lucide-react';
import { IS_TAURI } from '../../hooks/usePlatform';
import { useEmailStore, type EmailHeader, type EmailBody } from '../../store/emailStore';
import SpamAnalyzer from './SpamAnalyzer';

/* ─── Helpers ────────────────────────────────────────────────── */

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

function formatFullDate(dateStr: string): string {
    try {
        return new Date(dateStr).toLocaleString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric',
            year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

function extractSenderEmail(from: string): string {
    const match = from.match(/<(.+?)>/);
    return match ? match[1] : from;
}

/* ─── Component ──────────────────────────────────────────────── */

interface EmailViewerProps {
    email: EmailHeader;
    body: EmailBody | null;
    loadingBody: boolean;
    onBack?: () => void;
    onReply?: (email: EmailHeader) => void;
    onReplyAll?: (email: EmailHeader) => void;
    onForward?: (email: EmailHeader) => void;
    onDelete?: (email: EmailHeader) => void;
    onArchive?: (email: EmailHeader) => void;
    onMarkRead?: (email: EmailHeader, read: boolean) => void;
}

export default function EmailViewer({
    email,
    body,
    loadingBody,
    onBack,
    onReply,
    onReplyAll,
    onForward,
    onDelete,
    onArchive,
    onMarkRead,
}: EmailViewerProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [iframeHeight, setIframeHeight] = useState(400);
    const [showSpam, setShowSpam] = useState(false);
    const [showRawText, setShowRawText] = useState(false);
    const [sanitizedHtml, setSanitizedHtml] = useState<string | null>(null);
    const spamAnalysis = useEmailStore(s => s.selectedSpamAnalysis);
    const isTauri = IS_TAURI;

    // Reset panels when switching emails
    useEffect(() => {
        setShowSpam(false);
        setShowRawText(false);
    }, [email.uid]);

    // Sanitize HTML via Rust command or client-side fallback
    useEffect(() => {
        if (!body?.html) {
            setSanitizedHtml(null);
            return;
        }

        const sanitize = async () => {
            if (isTauri) {
                try {
                    const safe = await invoke<string>('sanitize_email_html', {
                        html: body.html,
                        darkMode: true,
                    });
                    setSanitizedHtml(safe);
                    return;
                } catch (err) {
                    console.warn('[EmailViewer] Rust sanitize failed, using fallback:', err);
                }
            }

            // Client-side fallback — inject dark mode CSS
            const darkCss = `
                <style>
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
                    img { max-width: 100% !important; height: auto !important; }
                    blockquote { border-left-color: #52525b !important; }
                    hr { border-color: #3f3f46 !important; }
                    [style*="background"] {
                        background-color: transparent !important;
                        background-image: none !important;
                    }
                    [style*="color"] { color: #e4e4e7 !important; }
                    font { color: #e4e4e7 !important; }
                </style>
            `;
            const baseCss = `
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        font-size: 14px; line-height: 1.6; padding: 16px; margin: 0;
                        word-wrap: break-word; overflow-wrap: break-word;
                    }
                </style>
            `;

            // Strip script tags
            let cleaned = body.html!.replace(/<script[\s\S]*?<\/script>/gi, '');
            // Strip event handlers
            cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
            // Strip javascript: URLs
            cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

            const doc = `<!DOCTYPE html><html><head><meta charset="utf-8">${baseCss}${darkCss}</head><body>${cleaned}</body></html>`;
            setSanitizedHtml(doc);
        };

        sanitize();
    }, [body?.html, isTauri]);

    // Auto-resize iframe
    useEffect(() => {
        if (!iframeRef.current || !sanitizedHtml) return;

        const iframe = iframeRef.current;
        const handleLoad = () => {
            try {
                const doc = iframe.contentDocument;
                if (doc?.body) {
                    const h = doc.body.scrollHeight + 32;
                    setIframeHeight(Math.min(Math.max(h, 200), 2000));
                }
            } catch {
                // Cross-origin — can't measure
            }
        };

        iframe.addEventListener('load', handleLoad);
        return () => iframe.removeEventListener('load', handleLoad);
    }, [sanitizedHtml]);

    // Handle link clicks inside iframe — open in system browser
    useEffect(() => {
        if (!iframeRef.current || !sanitizedHtml) return;

        const iframe = iframeRef.current;
        const handleLoad = () => {
            try {
                const doc = iframe.contentDocument;
                if (!doc) return;

                doc.addEventListener('click', (e: Event) => {
                    const target = (e.target as HTMLElement)?.closest('a');
                    if (target) {
                        e.preventDefault();
                        const href = target.getAttribute('href');
                        if (href && href !== '#' && !href.startsWith('javascript:')) {
                            if (isTauri) {
                                openUrl(href).catch(console.error);
                            } else {
                                window.open(href, '_blank', 'noopener');
                            }
                        }
                    }
                });
            } catch {
                // sandbox restriction
            }
        };

        iframe.addEventListener('load', handleLoad);
        return () => iframe.removeEventListener('load', handleLoad);
    }, [sanitizedHtml, isTauri]);

    // Attachment download handler
    const handleDownloadAttachment = useCallback(async (att: { filename: string; mime_type: string; data: string }) => {
        try {
            const binaryString = atob(att.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            if (isTauri) {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { writeFile } = await import('@tauri-apps/plugin-fs');
                const path = await save({
                    defaultPath: att.filename,
                    filters: [{ name: 'All Files', extensions: ['*'] }],
                });
                if (path) {
                    await writeFile(path, bytes);
                }
            } else {
                const blob = new Blob([bytes], { type: att.mime_type });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = att.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.error('[EmailViewer] Attachment download failed:', err);
        }
    }, [isTauri]);

    const senderEmail = extractSenderEmail(email.from);

    return (
        <div className="flex-1 flex flex-col bg-zinc-950/50 overflow-hidden">
            {/* Toolbar */}
            <div className="shrink-0 px-5 py-3 border-b border-zinc-800/30 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors mr-1"
                        >
                            <ChevronLeft size={18} />
                        </button>
                    )}
                    <button
                        onClick={() => onReply?.(email)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
                        title="Reply (R)"
                    >
                        <Reply size={14} />
                        Reply
                    </button>
                    <button
                        onClick={() => onReplyAll?.(email)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
                    >
                        <ReplyAll size={14} />
                    </button>
                    <button
                        onClick={() => onForward?.(email)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
                    >
                        <Forward size={14} />
                    </button>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onArchive?.(email)}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Archive (E)"
                    >
                        <Archive size={14} />
                    </button>
                    <button
                        onClick={() => onDelete?.(email)}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Delete (#)"
                    >
                        <Trash2 size={14} />
                    </button>
                    <button
                        onClick={() => onMarkRead?.(email, !!email.is_read)}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                        title={email.is_read ? 'Mark unread' : 'Mark read'}
                    >
                        {email.is_read ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        onClick={() => setShowSpam(!showSpam)}
                        className={`p-1.5 rounded-md hover:bg-zinc-800 transition-colors ${showSpam ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                        title="Spam analysis"
                    >
                        <Shield size={14} />
                    </button>
                </div>
            </div>

            {/* Email header */}
            <div className="shrink-0 px-6 py-4 border-b border-zinc-800/20">
                <h2 className="text-lg font-bold text-zinc-100 mb-3 leading-tight">
                    {email.subject || '(No subject)'}
                </h2>

                <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${getAvatarColor(email.from)}`}>
                        {getInitials(email.from)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-zinc-200">{email.from}</span>
                            {/* Auth badges */}
                            {spamAnalysis && (
                                <div className="flex items-center gap-1">
                                    {spamAnalysis.spf_pass && spamAnalysis.dkim_pass ? (
                                        <span title="SPF + DKIM verified"><ShieldCheck size={13} className="text-emerald-400" /></span>
                                    ) : (
                                        <span title="Authentication incomplete"><ShieldAlert size={13} className="text-amber-400" /></span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="text-xs text-zinc-600 mt-0.5">
                            To: {email.to}
                        </div>
                        <div className="text-[11px] text-zinc-600 mt-0.5">
                            {formatFullDate(email.date)}
                        </div>
                    </div>

                    {/* Category badge */}
                    {email.category && email.category !== 'all' && (
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            email.category === 'personal' ? 'bg-emerald-500/10 text-emerald-400' :
                            email.category === 'newsletters' ? 'bg-orange-500/10 text-orange-400' :
                            email.category === 'transactional' ? 'bg-blue-500/10 text-blue-400' :
                            'bg-red-500/10 text-red-400'
                        }`}>
                            {email.category === 'personal' ? '🟢 Personal' :
                             email.category === 'newsletters' ? '🟠 Newsletter' :
                             email.category === 'transactional' ? '🔵 Transaction' :
                             '🔴 Spam'}
                        </span>
                    )}
                </div>

                {/* Unsubscribe link */}
                {spamAnalysis?.has_unsubscribe && spamAnalysis.unsubscribe_url && (
                    <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                        <Tag size={12} className="text-amber-400" />
                        <span className="text-[11px] text-zinc-500">This is a mailing list.</span>
                        <button
                            onClick={() => {
                                if (spamAnalysis.unsubscribe_url) {
                                    if (isTauri) openUrl(spamAnalysis.unsubscribe_url).catch(console.error);
                                    else window.open(spamAnalysis.unsubscribe_url, '_blank');
                                }
                            }}
                            className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold transition-colors"
                        >
                            Unsubscribe
                        </button>
                    </div>
                )}
            </div>

            {/* Spam Analysis Panel (collapsible) */}
            {showSpam && spamAnalysis && (
                <div className="shrink-0 border-b border-zinc-800/20">
                    <SpamAnalyzer analysis={spamAnalysis} senderEmail={senderEmail} />
                </div>
            )}

            {/* Email body */}
            <div className="flex-1 overflow-y-auto">
                {loadingBody && (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={20} className="animate-spin text-zinc-600" />
                    </div>
                )}

                {body && sanitizedHtml && !showRawText && (
                    <div className="email-body-render">
                        <iframe
                            ref={iframeRef}
                            sandbox="allow-same-origin"
                            className="w-full border-none"
                            style={{ height: iframeHeight, background: '#18181b' }}
                            srcDoc={sanitizedHtml}
                            title="Email content"
                        />
                    </div>
                )}

                {body && !body.html && body.text && !showRawText && (
                    <div className="px-6 py-4">
                        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-[inherit] leading-relaxed">
                            {body.text}
                        </pre>
                    </div>
                )}

                {body && showRawText && body.text && (
                    <div className="px-6 py-4">
                        <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed bg-zinc-900 rounded-lg p-4">
                            {body.text}
                        </pre>
                    </div>
                )}

                {body && !body.html && !body.text && !loadingBody && (
                    <div className="flex items-center justify-center py-12">
                        <span className="text-sm text-zinc-600 italic">No content available</span>
                    </div>
                )}

                {/* Attachments */}
                {body && body.attachments.length > 0 && (
                    <div className="px-6 py-4 border-t border-zinc-800/20">
                        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                            Attachments ({body.attachments.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {body.attachments.map((att, i) => (
                                <button
                                    key={i}
                                    onClick={() => handleDownloadAttachment(att)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/20 hover:bg-zinc-800/50 transition-colors cursor-pointer group"
                                >
                                    <Paperclip size={12} className="text-zinc-500" />
                                    <span className="text-xs text-zinc-300 truncate max-w-40">{att.filename}</span>
                                    <span className="text-[10px] text-zinc-600">{formatBytes(att.size)}</span>
                                    <Download size={12} className="text-zinc-500 group-hover:text-amber-400 transition-colors" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Toggle raw text */}
                {body?.html && body?.text && (
                    <div className="px-6 py-2 border-t border-zinc-800/20">
                        <button
                            onClick={() => setShowRawText(!showRawText)}
                            className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                            {showRawText ? 'Show HTML' : 'Show plain text'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
