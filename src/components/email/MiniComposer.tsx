/**
 * MiniComposer.tsx — Always-visible bottom mini-composer.
 * Can expand to full compose mode. Handles reply/forward prefilling.
 * Sends through the draft queue for undo-send support.
 */

import { useState, useEffect, useRef } from 'react';
import {
    Send, X, ChevronUp, ChevronDown, Loader2, Clock,
    AlertCircle, Paperclip, File as FileIcon,
} from 'lucide-react';
import { type EmailHeader, type EmailAccount, type QueuedDraft, type DraftAttachment } from '../../store/emailStore';
import { useEmailStore } from '../../store/emailStore';
import { IS_TAURI } from '../../hooks/usePlatform';

/* ─── Constants ──────────────────────────────────────────────── */

const UNDO_SEND_DELAY = 15 * 60; // 15 minutes in seconds

/* ─── Component ──────────────────────────────────────────────── */

interface MiniComposerProps {
    account: EmailAccount | null;
    accounts?: EmailAccount[];
    replyTo?: EmailHeader | null;
    expanded?: boolean;
    onToggleExpand?: () => void;
    onClose?: () => void;
    onQueueSend: (draft: QueuedDraft) => void;
}

export default function MiniComposer({
    account,
    accounts = [],
    replyTo,
    expanded = false,
    onToggleExpand,
    onClose,
    onQueueSend,
}: MiniComposerProps) {
    const [to, setTo] = useState('');
    const [cc, setCc] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [showCc, setShowCc] = useState(false);
    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);
    const [scheduledTime, setScheduledTime] = useState<string>('');
    const [showSchedule, setShowSchedule] = useState(false);
    const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
    const [selectedFromId, setSelectedFromId] = useState<string>(account?.id || '');

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const toRef = useRef<HTMLInputElement>(null);
    const isTauri = IS_TAURI;
    const { getContactSuggestions } = useEmailStore();

    // Derive active "from" account — defaults to prop, overridable via dropdown
    const activeFromAccount = (accounts.length > 0
        ? accounts.find(a => a.id === selectedFromId) || accounts[0]
        : account) || null;

    // Sync selectedFromId if account prop changes
    useEffect(() => {
        if (account?.id && !selectedFromId) setSelectedFromId(account.id);
    }, [account?.id]);

    // Autocomplete state
    const [toSuggestions, setToSuggestions] = useState<string[]>([]);
    const [ccSuggestions, setCcSuggestions] = useState<string[]>([]);
    const [showToSuggestions, setShowToSuggestions] = useState(false);
    const [showCcSuggestions, setShowCcSuggestions] = useState(false);
    const [activeSuggestion, setActiveSuggestion] = useState(-1);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    const updateToSuggestions = (value: string) => {
        setTo(value);
        // Get the current token (last comma-separated value being typed)
        const lastToken = value.split(',').pop()?.trim() || '';
        if (lastToken.length >= 2) {
            const alreadyEntered = value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const suggestions = getContactSuggestions(lastToken).filter(s => !alreadyEntered.includes(s));
            setToSuggestions(suggestions);
            setShowToSuggestions(suggestions.length > 0);
        } else {
            setToSuggestions([]);
            setShowToSuggestions(false);
        }
        setActiveSuggestion(-1);
    };

    const updateCcSuggestions = (value: string) => {
        setCc(value);
        const lastToken = value.split(',').pop()?.trim() || '';
        if (lastToken.length >= 2) {
            const alreadyEntered = value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const suggestions = getContactSuggestions(lastToken).filter(s => !alreadyEntered.includes(s));
            setCcSuggestions(suggestions);
            setShowCcSuggestions(suggestions.length > 0);
        } else {
            setCcSuggestions([]);
            setShowCcSuggestions(false);
        }
        setActiveSuggestion(-1);
    };

    const selectSuggestion = (suggestion: string, field: 'to' | 'cc') => {
        const setter = field === 'to' ? setTo : setCc;
        const getter = field === 'to' ? to : cc;
        // Replace last token with the selected suggestion
        const parts = getter.split(',').map(s => s.trim()).filter(Boolean);
        parts.pop(); // remove the partial token
        parts.push(suggestion);
        setter(parts.join(', ') + ', ');
        setShowToSuggestions(false);
        setShowCcSuggestions(false);
        setActiveSuggestion(-1);
    };

    const handleSuggestionKeyDown = (
        e: React.KeyboardEvent,
        suggestions: string[],
        field: 'to' | 'cc',
    ) => {
        if (!suggestions.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveSuggestion(prev => Math.min(prev + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveSuggestion(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Tab' || e.key === 'Enter') {
            if (activeSuggestion >= 0 && activeSuggestion < suggestions.length) {
                e.preventDefault();
                selectSuggestion(suggestions[activeSuggestion], field);
            }
        } else if (e.key === 'Escape') {
            setShowToSuggestions(false);
            setShowCcSuggestions(false);
        }
    };

    // Prefill when replying
    useEffect(() => {
        if (replyTo) {
            setTo(replyTo.from.includes('<') ? replyTo.from : replyTo.from);
            setSubject(replyTo.subject.startsWith('Re:') ? replyTo.subject : `Re: ${replyTo.subject}`);
            setBody('');
            setCc('');
            setError('');
        } else {
            setTo('');
            setCc('');
            setSubject('');
            setBody('');
            setError('');
        }
    }, [replyTo]);

    // Auto focus textarea when expanded
    useEffect(() => {
        if (expanded && textareaRef.current) {
            textareaRef.current.focus();
        }
    }, [expanded]);

    const handlePickFiles = async () => {
        if (!isTauri) return;
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const selected = await open({ multiple: true, title: 'Attach files' });
            if (!selected) return;
            const paths = Array.isArray(selected) ? selected : [selected];
            const newAttachments: DraftAttachment[] = [];
            for (const filePath of paths) {
                if (typeof filePath !== 'string') continue;
                const filename = filePath.split(/[\\/]/).pop() || 'file';
                const ext = filename.split('.').pop()?.toLowerCase() || '';
                const mimeMap: Record<string, string> = {
                    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
                    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    zip: 'application/zip', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
                    mp4: 'video/mp4', mp3: 'audio/mpeg',
                };
                const mimeType = mimeMap[ext] || 'application/octet-stream';
                const data = await readFile(filePath);
                // Convert Uint8Array to base64
                let binary = '';
                const bytes = new Uint8Array(data);
                for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                const dataBase64 = btoa(binary);
                newAttachments.push({ filename, mimeType, dataBase64 });
            }
            setAttachments(prev => [...prev, ...newAttachments]);
        } catch (err) {
            console.error('[MiniComposer] File pick error:', err);
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const formatFileSize = (base64Str: string) => {
        const bytes = Math.ceil(base64Str.length * 3 / 4);
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    };

    const handleSend = () => {
        if (!to.trim()) {
            setError('Please enter a recipient');
            return;
        }
        if (!activeFromAccount) {
            setError('No active account');
            return;
        }

        setError('');
        setSending(true);

        const toList = to.split(',').map(s => s.trim()).filter(Boolean);
        const ccList = cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : [];
        const bodyHtml = `<div style="font-family: -apple-system, sans-serif; font-size: 14px; color: #333;">${body.replace(/\n/g, '<br/>')}</div>`;

        // Calculate scheduled time
        let sendAt: number;
        if (scheduledTime) {
            sendAt = new Date(scheduledTime).getTime();
        } else {
            // Default: 15 minutes from now (undo window)
            sendAt = Date.now() + UNDO_SEND_DELAY * 1000;
        }

        const draft: QueuedDraft = {
            id: crypto.randomUUID(),
            accountId: activeFromAccount.id,
            to: toList,
            cc: ccList,
            subject,
            bodyHtml,
            bodyText: body,
            inReplyTo: replyTo?.message_id,
            references: replyTo ? replyTo.references.concat(replyTo.message_id).join(' ') : undefined,
            scheduledAt: sendAt,
            createdAt: Date.now(),
            attachments: attachments.length > 0 ? attachments : undefined,
        };

        onQueueSend(draft);

        // Reset form
        setTo('');
        setCc('');
        setSubject('');
        setBody('');
        setShowCc(false);
        setShowSchedule(false);
        setScheduledTime('');
        setAttachments([]);
        setSending(false);

        onClose?.();
    };

    // Mini bar (collapsed)
    if (!expanded) {
        return (
            <div className="shrink-0 border-t border-zinc-800/30 bg-zinc-900/60">
                <button
                    onClick={onToggleExpand}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                >
                    <div className="flex items-center gap-2 text-zinc-500">
                        <Send size={14} />
                        <span className="text-xs font-medium">Quick compose...</span>
                    </div>
                    <ChevronUp size={14} className="text-zinc-600" />
                </button>
            </div>
        );
    }

    return (
        <div className="shrink-0 border-t border-zinc-800/30 bg-zinc-900/80 backdrop-blur-sm" style={{ animation: 'slideUp 0.15s ease-out' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/20">
                <h4 className="text-xs font-bold text-zinc-300">
                    {replyTo ? 'Reply' : 'New Message'}
                </h4>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleSend}
                        disabled={sending || !to.trim() || !account}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-semibold"
                    >
                        {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        Send
                    </button>
                    <button
                        onClick={handlePickFiles}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                        title="Attach files"
                    >
                        <Paperclip size={14} />
                    </button>
                    <button
                        onClick={() => setShowSchedule(!showSchedule)}
                        className={`p-1.5 rounded-md hover:bg-zinc-800 transition-colors ${showSchedule ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                        title="Schedule send"
                    >
                        <Clock size={14} />
                    </button>
                    <button
                        onClick={onToggleExpand}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                        <ChevronDown size={14} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mx-3 mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
                    <AlertCircle size={11} />
                    {error}
                </div>
            )}

            {/* Fields */}
            <div className="px-4 py-1 space-y-0">
                <div className="flex items-center border-b border-zinc-800/20 py-1.5">
                    <span className="text-[11px] text-zinc-600 w-9">From</span>
                    {accounts.length > 1 ? (
                        <select
                            value={selectedFromId}
                            onChange={(e) => setSelectedFromId(e.target.value)}
                            className="flex-1 bg-transparent text-[11px] text-zinc-400 outline-none cursor-pointer appearance-none hover:text-zinc-200 transition-colors"
                        >
                            {accounts.map(a => (
                                <option key={a.id} value={a.id} className="bg-zinc-900 text-zinc-300">{a.email}</option>
                            ))}
                        </select>
                    ) : (
                        <span className="text-[11px] text-zinc-400">{activeFromAccount?.email || 'No account'}</span>
                    )}
                </div>
                <div className="flex items-center border-b border-zinc-800/20 py-1.5 relative">
                    <span className="text-[11px] text-zinc-600 w-9">To</span>
                    <input
                        ref={toRef}
                        type="text"
                        value={to}
                        onChange={(e) => updateToSuggestions(e.target.value)}
                        onFocus={() => { if (toSuggestions.length > 0) setShowToSuggestions(true); }}
                        onBlur={() => setTimeout(() => setShowToSuggestions(false), 200)}
                        onKeyDown={(e) => handleSuggestionKeyDown(e, toSuggestions, 'to')}
                        className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-600"
                        placeholder="recipient@example.com"
                    />
                    {!showCc && (
                        <button
                            onClick={() => setShowCc(true)}
                            className="text-[10px] text-zinc-600 hover:text-zinc-400 ml-2"
                        >
                            CC
                        </button>
                    )}
                    {/* To suggestions dropdown */}
                    {showToSuggestions && toSuggestions.length > 0 && (
                        <div ref={suggestionsRef} className="absolute top-full left-9 right-0 z-50 mt-0.5 bg-zinc-800 border border-zinc-700/30 rounded-lg shadow-xl overflow-hidden">
                            {toSuggestions.map((s, i) => (
                                <button
                                    key={s}
                                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s, 'to'); }}
                                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                        i === activeSuggestion
                                            ? 'bg-amber-500/15 text-zinc-200'
                                            : 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
                                    }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {showCc && (
                    <div className="flex items-center border-b border-zinc-800/20 py-1.5 relative">
                        <span className="text-[11px] text-zinc-600 w-9">CC</span>
                        <input
                            type="text"
                            value={cc}
                            onChange={(e) => updateCcSuggestions(e.target.value)}
                            onFocus={() => { if (ccSuggestions.length > 0) setShowCcSuggestions(true); }}
                            onBlur={() => setTimeout(() => setShowCcSuggestions(false), 200)}
                            onKeyDown={(e) => handleSuggestionKeyDown(e, ccSuggestions, 'cc')}
                            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-600"
                            placeholder="Optional"
                        />
                        {showCcSuggestions && ccSuggestions.length > 0 && (
                            <div className="absolute top-full left-9 right-0 z-50 mt-0.5 bg-zinc-800 border border-zinc-700/30 rounded-lg shadow-xl overflow-hidden">
                                {ccSuggestions.map((s, i) => (
                                    <button
                                        key={s}
                                        onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s, 'cc'); }}
                                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                            i === activeSuggestion
                                                ? 'bg-amber-500/15 text-zinc-200'
                                                : 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div className="flex items-center border-b border-zinc-800/20 py-1.5">
                    <span className="text-[11px] text-zinc-600 w-9">Subj</span>
                    <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder-zinc-600"
                        placeholder="Subject"
                    />
                </div>
            </div>

            {/* Schedule picker */}
            {showSchedule && (
                <div className="px-4 py-2 border-b border-zinc-800/20">
                    <div className="flex items-center gap-2">
                        <Clock size={12} className="text-amber-400" />
                        <span className="text-[11px] text-zinc-400">Schedule for:</span>
                        <input
                            type="datetime-local"
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="flex-1 bg-zinc-800/30 border border-zinc-700/20 rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                        />
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="px-4 py-2">
                <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full h-28 bg-transparent text-sm text-zinc-200 outline-none resize-none placeholder-zinc-600 leading-relaxed"
                    placeholder="Write your message..."
                    onKeyDown={(e) => {
                        // Ctrl+Enter to send
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                />
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
                <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                    {attachments.map((att, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-800/50 border border-zinc-700/20 text-[11px] text-zinc-400 group"
                        >
                            <FileIcon size={10} className="text-zinc-500 shrink-0" />
                            <span className="truncate max-w-30">{att.filename}</span>
                            <span className="text-zinc-600">{formatFileSize(att.dataBase64)}</span>
                            <button
                                onClick={() => removeAttachment(i)}
                                className="p-0.5 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                            >
                                <X size={10} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Undo send info */}
            {!scheduledTime && (
                <div className="px-4 pb-2">
                    <span className="text-[10px] text-zinc-600">
                        ⏳ 15-minute undo window after sending • Ctrl+Enter to send
                    </span>
                </div>
            )}
        </div>
    );
}
