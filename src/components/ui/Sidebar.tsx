
import { Search, Plus, Trash2, Lock, ChevronRight, CalendarHeart, BookOpen, Pin, PinOff, Archive, ArchiveRestore, HelpCircle, LayoutDashboard } from "lucide-react";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import LockModal from "./LockModal";
import { useSync } from "../../contexts/SyncContext";
import { useSettings } from "../../contexts/SettingsContext";
import { NoteTypeIcon } from "../../lib/noteIcons";
import type { FileMeta, NoteType } from "../../types/sync";
import { usePlatform } from "../../hooks/usePlatform";

type Note = {
    id: string;
    title: string;
};

const TYPE_LABEL: Record<NoteType, string> = {
    note: 'Notes',
    topic: 'Topics',
    idea: 'Ideas',
    task: 'Tasks',
    resource: 'Resources',
    journal: 'Journal',
    study: 'Study',
};

// Which type groups are expanded by default
const DEFAULT_EXPANDED: Record<NoteType, boolean> = {
    note: true,
    topic: false,
    idea: false,
    task: false,
    resource: false,
    journal: false,
    study: false,
};

// Display order for groups
const TYPE_ORDER: NoteType[] = ['note', 'topic', 'idea', 'task', 'resource', 'journal', 'study'];

const MAX_PINNED = 8;
const MAX_RECENT_PER_GROUP = 5;
const PINNED_STORAGE_KEY = 'onyx-pinned-notes';

interface SidebarProps {
    onSelectNote: (id: string, forceNew: boolean) => void;
    activeNoteId: string | null;
    notes: Note[];
    openTabs: string[];
    onDeleteNote: (id: string) => void;
    onOpenSearch: () => void;
    onLockNote: (id: string, password: string) => Promise<void>;
    onOpenAuth: () => void;
    onNewNote?: () => void; // Opens the type picker modal
    onGoToToday?: () => void; // Navigate to today's daily note
    onGoToFlashcards?: () => void; // Navigate to flashcard view
    onOpenCollection?: (type: NoteType) => void; // Open collection page query view
    onGoToTrash?: () => void; // Navigate to trash view
    onGoToQuestions?: () => void; // Navigate to Question Library
    onGoToCanvas?: () => void;    // Navigate to canvas view
}

const Sidebar = React.memo(function Sidebar({
    onSelectNote,
    activeNoteId,
    notes,
    openTabs,
    onDeleteNote,
    onOpenSearch,
    onLockNote,
    onOpenAuth,
    onNewNote,
    onGoToToday,
    onGoToFlashcards,
    onOpenCollection,
    onGoToTrash,
    onGoToQuestions,
    onGoToCanvas,
}: SidebarProps) {

    const { isMobile } = usePlatform();
    const [lockingNoteId, setLockingNoteId] = useState<string | null>(null);
    const [lockingNoteTitle, setLockingNoteTitle] = useState("");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(DEFAULT_EXPANDED);
    const [settingsHover, setSettingsHover] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

    // Pinned notes state — persisted to localStorage
    const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
        try {
            const stored = localStorage.getItem(PINNED_STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch { return []; }
    });

    // Persist pinned notes
    useEffect(() => {
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinnedIds));
    }, [pinnedIds]);

    const { status, createFile, files: syncFiles, softDeleteFile, archiveFile, unarchiveFile } = useSync();
    const { offlineMode } = useSettings();

    const handleNewPage = () => {
        if (onNewNote) {
            onNewNote();
        } else {
            try {
                const newId = createFile();
                onSelectNote(newId, true);
            } catch (error) {
                console.error("Failed to create note:", error);
            }
        }
    };

    const handleLockClick = (id: string, title: string) => {
        setLockingNoteId(id);
        setLockingNoteTitle(title);
    };

    const toggleGroup = (type: string) => {
        setExpandedGroups(prev => ({ ...prev, [type]: !prev[type] }));
    };

    const togglePin = useCallback((noteId: string) => {
        setPinnedIds((prev) => {
            if (prev.includes(noteId)) {
                return prev.filter((id) => id !== noteId);
            }
            if (prev.length >= MAX_PINNED) return prev;
            return [...prev, noteId];
        });
    }, []);

    // Close context menu on click outside
    useEffect(() => {
        if (!contextMenu) return;
        const handler = () => setContextMenu(null);
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [contextMenu]);

    // Group notes by NoteType (exclude trashed and archived)
    const groupedNotes = useMemo(() => {
        const metaMap = new Map<string, FileMeta>();
        syncFiles.forEach((f) => metaMap.set(f.id, f));

        const groups: Record<NoteType, (Note & { meta?: FileMeta })[]> = {
            note: [], topic: [], idea: [], task: [], resource: [], journal: [], study: [],
        };

        for (const n of notes) {
            const meta = metaMap.get(n.id);
            // Skip trashed / archived notes from main listing
            if (meta?.deletedAt) continue;
            if (meta?.isArchived) continue;

            let type = meta?.type ?? 'note';
            if (typeof type !== 'string' || !(type in groups)) {
                type = 'note';
            }
            groups[type as NoteType].push({ ...n, meta });
        }

        // Sort each group by updatedAt descending
        for (const key of Object.keys(groups) as NoteType[]) {
            groups[key].sort((a, b) => {
                const ua = a.meta?.updatedAt ?? 0;
                const ub = b.meta?.updatedAt ?? 0;
                return ub - ua;
            });
        }

        return groups;
    }, [notes, syncFiles]);

    // Pinned notes resolved
    const pinnedNotes = useMemo(() => {
        const metaMap = new Map<string, FileMeta>();
        syncFiles.forEach((f) => metaMap.set(f.id, f));
        return pinnedIds
            .map((id) => {
                const meta = metaMap.get(id);
                const note = notes.find((n) => n.id === id);
                if (!note) return null;
                return { ...note, meta };
            })
            .filter(Boolean) as (Note & { meta?: FileMeta })[];
    }, [pinnedIds, notes, syncFiles]);

    // Debounce status
    const [displayedStatus, setDisplayedStatus] = useState(status);
    useEffect(() => {
        const timer = setTimeout(() => setDisplayedStatus(status), 1000);
        return () => clearTimeout(timer);
    }, [status]);

    // ─── Shared hover transition style ───
    const hoverTransition = "transition-all duration-150 ease-out";
    // Quick action button base: consistent hover with violet tint + slide right
    const quickActionBase = `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer ${hoverTransition} text-zinc-500 hover:text-zinc-100 hover:bg-[rgba(124,110,247,0.08)] hover:translate-x-0.5`;

    return (
        <aside className={`${isMobile ? 'w-full' : 'w-55'} h-full text-zinc-400 flex flex-col ${isMobile ? '' : 'border-r border-zinc-800/40'}`} style={{ background: 'var(--onyx-sidebar)' }}>
            <LockModal
                isOpen={!!lockingNoteId}
                onClose={() => setLockingNoteId(null)}
                onConfirm={async (password) => {
                    if (lockingNoteId) {
                        await onLockNote(lockingNoteId, password);
                        setLockingNoteId(null);
                    }
                }}
                noteTitle={lockingNoteTitle}
            />

            {/* ─── Quick Actions ─────────────────────────── */}
            <div className="px-2.5 pt-3 pb-1 space-y-1">
                {/* Search */}
                <button
                    onClick={onOpenSearch}
                    className={`${quickActionBase} border border-transparent hover:border-zinc-700/30 focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/30 focus:outline-none group`}
                >
                    <Search size={14} className="group-focus:text-violet-400 transition-colors" />
                    <span className="text-[13px]">Search</span>
                    {!isMobile && <span className="ml-auto text-[10px] text-zinc-600 font-mono">Ctrl+P</span>}
                </button>

                {/* Today / Flashcards / Questions / Canvas — hidden on mobile (handled by BottomTabBar) */}
                {!isMobile && (
                    <>
                        <button onClick={onGoToToday} className={quickActionBase}>
                            <CalendarHeart size={14} />
                            <span className="text-[13px] font-medium">Today</span>
                        </button>

                        <button onClick={onGoToFlashcards} className={quickActionBase}>
                            <BookOpen size={14} />
                            <span className="text-[13px] font-medium">Flashcards</span>
                        </button>

                        {onGoToQuestions && (
                            <button onClick={onGoToQuestions} className={quickActionBase}>
                                <HelpCircle size={14} />
                                <span className="text-[13px] font-medium">Questions</span>
                            </button>
                        )}

                        {onGoToCanvas && (
                            <button onClick={onGoToCanvas} className={quickActionBase}>
                                <LayoutDashboard size={14} />
                                <span className="text-[13px] font-medium">Canvas</span>
                            </button>
                        )}
                    </>
                )}

                {/* New Page — primary CTA with more pronounced hover */}
                <button
                    onClick={handleNewPage}
                    className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${hoverTransition} bg-violet-600 text-white font-medium text-[13px] hover:bg-violet-500 hover:shadow-[0_0_12px_rgba(124,110,247,0.35)] hover:-translate-y-px active:scale-[0.98]`}
                >
                    <Plus size={15} strokeWidth={2.5} />
                    <span>New Page</span>
                </button>
            </div>

            {/* ─── Divider ───────────────────────────────── */}
            <div className="mx-3 my-1.5 h-px bg-zinc-800/40" />

            {/* ─── Pinned Section ──────────────────────────── */}
            {pinnedNotes.length > 0 && (
                <div className="px-1 pb-1">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.12em] rounded-md ${hoverTransition} hover:text-zinc-400 hover:bg-[rgba(124,110,247,0.08)] hover:translate-x-0.5`}>
                        <Pin size={10} className="text-zinc-600" />
                        Pinned
                    </div>
                    <div className="space-y-px">
                        {pinnedNotes.map((note) => {
                            const isActive = activeNoteId === note.id;
                            const noteType = note.meta?.type ?? 'note';
                            return (
                                <div
                                    key={note.id}
                                    onMouseDown={(e) => {
                                        if (e.button === 0) onSelectNote(note.id, false);
                                        if (e.button === 1) onSelectNote(note.id, true);
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setContextMenu({ id: note.id, x: e.clientX, y: e.clientY });
                                    }}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer group rounded-md mx-1 ${hoverTransition} ${
                                        isActive
                                            ? 'bg-violet-500/10 text-white'
                                            : 'text-zinc-400 hover:bg-[rgba(124,110,247,0.08)] hover:text-zinc-100 hover:translate-x-0.5'
                                    }`}
                                >
                                    <span className="text-sm shrink-0 leading-none"><NoteTypeIcon type={noteType} size={14} /></span>
                                    <span className={`text-[13px] truncate flex-1 ${isActive ? 'font-medium' : ''}`}>
                                        {note.title || 'Untitled'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mx-3 my-1.5 h-px bg-zinc-800/30" />
                </div>
            )}

            {/* ─── Note List grouped by type ──────────────── */}
            <div className="flex-1 overflow-y-auto px-1 py-1 custom-scrollbar">
                {TYPE_ORDER.map((type) => {
                    const group = groupedNotes[type];
                    if (group.length === 0) return null;

                    const isExpanded = expandedGroups[type] ?? false;
                    const recentGroup = group.slice(0, MAX_RECENT_PER_GROUP);
                    const hasMore = group.length > MAX_RECENT_PER_GROUP;

                    return (
                        <div key={type} className="mb-0.5">
                            {/* Section header — click toggles tree, double-click opens collection */}
                            <button
                                onClick={() => toggleGroup(type)}
                                onDoubleClick={() => onOpenCollection?.(type)}
                                className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.12em] rounded-md ${hoverTransition} hover:text-zinc-400 hover:bg-[rgba(124,110,247,0.08)] hover:translate-x-0.5`}
                            >
                                <ChevronRight
                                    size={11}
                                    className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                />
                                <span className="text-sm not-italic" style={{ fontStyle: 'normal' }}><NoteTypeIcon type={type} size={14} /></span>
                                {TYPE_LABEL[type]}
                                <span className="ml-auto text-zinc-700 font-mono text-[10px] normal-case">
                                    {group.length}
                                </span>
                            </button>

                            {isExpanded && (
                                <div className="space-y-px mt-0.5">
                                    {recentGroup.map((note) => {
                                        const isOpen = openTabs.includes(note.id);
                                        const isActive = activeNoteId === note.id;
                                        const isPinned = pinnedIds.includes(note.id);

                                        return (
                                            <div
                                                key={note.id}
                                                onMouseDown={(e) => {
                                                    if (e.button === 1) e.preventDefault();
                                                    if (e.button === 0) onSelectNote(note.id, false);
                                                    if (e.button === 1) onSelectNote(note.id, true);
                                                }}
                                                onAuxClick={(e) => e.preventDefault()}
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setContextMenu({ id: note.id, x: e.clientX, y: e.clientY });
                                                }}
                                                className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer group rounded-md mx-1 ${hoverTransition} ${
                                                    isActive
                                                        ? 'bg-violet-500/10 text-white border-l-3 border-violet-500'
                                                        : 'text-zinc-400 hover:bg-[rgba(124,110,247,0.08)] hover:text-zinc-100 hover:translate-x-0.5 border-l-3 border-transparent'
                                                }`}
                                            >
                                                <span className="text-sm shrink-0 leading-none"><NoteTypeIcon type={type} size={14} /></span>

                                                {isOpen && !isActive && (
                                                    <div className="w-1 h-1 rounded-full bg-violet-400 shrink-0" />
                                                )}

                                                <span
                                                    className={`text-[13px] truncate flex-1 ${
                                                        isActive ? 'font-medium' : ''
                                                    }`}
                                                >
                                                    {note.title || 'Untitled'}
                                                </span>

                                                {/* Actions on hover */}
                                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            togglePin(note.id);
                                                        }}
                                                        className={`p-0.5 rounded transition-colors ${
                                                            isPinned ? 'text-violet-400 hover:text-violet-300' : 'text-zinc-600 hover:text-zinc-300'
                                                        }`}
                                                        title={isPinned ? 'Unpin' : 'Pin to sidebar'}
                                                    >
                                                        {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleLockClick(note.id, note.title);
                                                        }}
                                                        className="p-0.5 hover:bg-zinc-700 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                                                        title="Lock Note"
                                                    >
                                                        <Lock size={11} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteNote(note.id);
                                                        }}
                                                        className="p-0.5 hover:bg-red-500/20 rounded text-zinc-600 hover:text-red-400 transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* Show all link */}
                                    {hasMore && (
                                        <button
                                            onClick={() => onOpenCollection?.(type)}
                                            className={`w-full px-6 py-1.5 text-[11px] text-zinc-500 hover:text-violet-400 ${hoverTransition} hover:translate-x-0.5 text-left cursor-pointer`}
                                        >
                                            Show all {group.length} →
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ─── Custom Context Menu (right-click) ────── */}
            {contextMenu && (() => {
                const ctxMeta = syncFiles.find((f) => f.id === contextMenu.id);
                const isArchived = ctxMeta?.isArchived;
                return (
                    <div
                        className="fixed z-9999 w-48 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1 text-[13px]"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => {
                                togglePin(contextMenu.id);
                                setContextMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-violet-500/10 hover:text-white transition-colors cursor-pointer"
                        >
                            {pinnedIds.includes(contextMenu.id) ? (
                                <><PinOff size={13} /> Unpin</>
                            ) : (
                                <><Pin size={13} /> Pin to sidebar</>
                            )}
                        </button>
                        <button
                            onClick={() => {
                                if (isArchived) {
                                    unarchiveFile(contextMenu.id);
                                } else {
                                    archiveFile(contextMenu.id);
                                }
                                setContextMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-violet-500/10 hover:text-white transition-colors cursor-pointer"
                        >
                            {isArchived ? (
                                <><ArchiveRestore size={13} /> Unarchive</>
                            ) : (
                                <><Archive size={13} /> Archive</>
                            )}
                        </button>
                        <div className="h-px bg-zinc-800 my-1" />
                        <button
                            onClick={() => {
                                softDeleteFile(contextMenu.id);
                                setContextMenu(null);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        >
                            <Trash2 size={13} /> Move to Trash
                        </button>
                    </div>
                );
            })()}

            {/* ─── Bottom: Trash + Settings ──────────────── */}
            <div className="px-2.5 py-2 border-t border-zinc-800/30 space-y-0.5">
                {/* Trash link */}
                {(() => {
                    const trashCount = syncFiles.filter((f) => f.deletedAt).length;
                    return (
                        <button
                            onClick={onGoToTrash}
                            className={`${quickActionBase}`}
                        >
                            <Trash2 size={14} />
                            <span className="text-[13px]">Trash</span>
                            {trashCount > 0 && (
                                <span className="ml-auto text-[10px] font-mono text-zinc-600 bg-zinc-800/50 px-1.5 py-0.5 rounded">
                                    {trashCount}
                                </span>
                            )}
                        </button>
                    );
                })()}

                {/* Settings — hidden on mobile (accessible from More page) */}
                {!isMobile && !import.meta.env.VITE_DEMO_MODE && (
                    <button
                        onClick={onOpenAuth}
                        onMouseEnter={() => setSettingsHover(true)}
                        onMouseLeave={() => setSettingsHover(false)}
                        className={`${quickActionBase}`}
                    >
                        <svg
                            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className="transition-transform duration-500"
                            style={{ transform: settingsHover ? 'rotate(360deg)' : 'rotate(0deg)' }}
                        >
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        <span className="text-[13px]">Settings</span>
                        {!offlineMode && (
                            <div
                                className={`ml-auto w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                                    displayedStatus === 'connected'
                                        ? 'bg-emerald-500'
                                        : displayedStatus === 'connecting'
                                            ? 'bg-amber-500 animate-pulse'
                                            : 'bg-red-500'
                                }`}
                                style={{ boxShadow: displayedStatus === 'connected' ? '0 0 6px rgba(16,185,129,0.4)' : 'none' }}
                            />
                        )}
                    </button>
                )}
            </div>
        </aside>
    );
});

export default Sidebar;
