/**
 * ThreadList.tsx — Virtualized, keyboard-navigable email list.
 * Compact layout with avatar, subject (bold unread), 1-line preview,
 * thread chips, and category badges.
 */

import { useEffect, useRef, useState } from 'react';
import {
    Inbox, Paperclip, Loader2, Trash2, Archive, Mail, MailOpen, Reply,
} from 'lucide-react';
import { type EmailHeader, type EmailCategory } from '../../store/emailStore';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

/* ─── Helpers ────────────────────────────────────────────────── */

/** Extract display name from "Name <email@host>" format */
function extractDisplayName(from: string): string {
    const match = from.match(/^(.+?)\s*<[^>]+>$/);
    if (match) return match[1].trim();
    return from;
}

function getInitials(name: string): string {
    const display = extractDisplayName(name);
    const parts = display.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (display[0] || '?').toUpperCase();
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

const categoryBadge: Record<EmailCategory, { label: string; className: string } | null> = {
    all: null,
    personal: { label: '🟢', className: 'text-emerald-400' },
    newsletters: { label: '🟠', className: 'text-orange-400' },
    transactional: { label: '🔵', className: 'text-blue-400' },
    spam: { label: '🔴', className: 'text-red-400' },
};

/* ─── Component ──────────────────────────────────────────────── */

interface ThreadListProps {
    emails: EmailHeader[];
    loading: boolean;
    selectedUid: number | null;
    selectedIndex: number;
    onSelectEmail: (email: EmailHeader, index: number) => void;
    onBulkSelect?: (uid: number, selected: boolean) => void;
    showCategoryBadge?: boolean;
    onDelete?: (email: EmailHeader) => void;
    onArchive?: (email: EmailHeader) => void;
    onMarkRead?: (email: EmailHeader, toggleOff: boolean) => void;
    onReply?: (email: EmailHeader) => void;
}

export default function ThreadList({
    emails,
    loading,
    selectedUid,
    selectedIndex,
    onSelectEmail,
    showCategoryBadge = true,
    onDelete,
    onArchive,
    onMarkRead,
    onReply,
}: ThreadListProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; email: EmailHeader } | null>(null);

    // Scroll selected item into view
    useEffect(() => {
        if (selectedIndex >= 0 && selectedIndex < emails.length) {
            const el = itemRefs.current.get(selectedIndex);
            if (el) {
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedIndex, emails.length]);

    if (loading && emails.length === 0) {
        return (
            <div className="flex items-center justify-center py-12 flex-1">
                <Loader2 size={20} className="animate-spin text-zinc-600" />
            </div>
        );
    }

    if (emails.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 flex-1 text-zinc-600">
                <Inbox size={28} className="mb-2 text-zinc-700" />
                <span className="text-sm">No emails</span>
                <span className="text-xs text-zinc-700 mt-1">Try a different category or refresh</span>
            </div>
        );
    }

    return (
        <div ref={listRef} className="flex-1 overflow-y-auto">
            {emails.map((email, index) => {
                const isSelected = selectedUid === email.uid || selectedIndex === index;
                const badge = email.category ? categoryBadge[email.category] : null;

                return (
                    <div
                        key={`${email.accountId || ''}-${email.uid}`}
                        ref={(el) => {
                            if (el) itemRefs.current.set(index, el);
                            else itemRefs.current.delete(index);
                        }}
                        onClick={() => onSelectEmail(email, index)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, email });
                        }}
                        className={`px-4 py-3 border-b border-zinc-800/20 cursor-pointer transition-all duration-100 ${
                            isSelected
                                ? 'bg-amber-500/5 border-l-2 border-l-amber-400'
                                : 'hover:bg-zinc-800/20 border-l-2 border-l-transparent'
                        }`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSelectEmail(email, index);
                            }
                        }}
                    >
                        <div className="flex items-center gap-2.5 mb-0.5">
                            {/* Avatar */}
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${getAvatarColor(extractDisplayName(email.from))}`}>
                                {getInitials(email.from)}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <span className={`text-sm truncate ${email.is_read ? 'text-zinc-400 font-normal' : 'font-semibold text-zinc-100'}`}>
                                        {extractDisplayName(email.from)}
                                    </span>
                                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                        {showCategoryBadge && badge && (
                                            <span className="text-[10px]" title={email.category}>
                                                {badge.label}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-zinc-600">
                                            {formatRelativeDate(email.date)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pl-9.5">
                            <div className="flex items-center gap-1.5">
                                {!email.is_read && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                )}
                                <span className={`text-sm truncate ${email.is_read ? 'text-zinc-500' : 'text-zinc-300 font-medium'}`}>
                                    {email.subject || '(No subject)'}
                                </span>
                                {email.has_attachments && (
                                    <Paperclip size={11} className="text-zinc-600 shrink-0" />
                                )}
                            </div>
                            {email.preview && (
                                <p className="text-xs text-zinc-600 truncate mt-0.5 leading-relaxed">
                                    {email.preview}
                                </p>
                            )}

                            {/* Thread chip: show reply count */}
                            {email.in_reply_to && (
                                <div className="flex items-center gap-1 mt-1">
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-800/50 text-zinc-500 font-medium">
                                        Thread
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    items={[
                        ...(onReply ? [{
                            label: 'Reply',
                            icon: <Reply size={13} />,
                            onClick: () => onReply(contextMenu.email),
                        }] : []),
                        ...(onMarkRead ? [{
                            label: contextMenu.email.is_read ? 'Mark as unread' : 'Mark as read',
                            icon: contextMenu.email.is_read ? <Mail size={13} /> : <MailOpen size={13} />,
                            onClick: () => onMarkRead(contextMenu.email, contextMenu.email.is_read),
                        }] : []),
                        ...(onArchive ? [{
                            label: 'Archive',
                            icon: <Archive size={13} />,
                            onClick: () => onArchive(contextMenu.email),
                            separator: true,
                        }] : []),
                        ...(onDelete ? [{
                            label: 'Delete',
                            icon: <Trash2 size={13} />,
                            onClick: () => onDelete(contextMenu.email),
                            danger: true,
                            separator: !onArchive,
                        }] : []),
                    ] as ContextMenuItem[]}
                />
            )}
        </div>
    );
}
