import { useState, useMemo, useCallback } from 'react';
import { RotateCcw, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta } from '../../types/sync';
import { NoteTypeIcon } from '../../lib/noteIcons';

interface TrashViewProps {
    onOpenNote: (id: string) => void;
}

export default function TrashView({ onOpenNote: _onOpenNote }: TrashViewProps) {
    const { files, updateFile, deleteFile } = useSync();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);

    const trashedNotes = useMemo(
        () =>
            files
                .filter((f) => f.deletedAt)
                .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)),
        [files]
    );

    const restore = useCallback((id: string) => {
        updateFile(id, { deletedAt: undefined });
        setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, [updateFile]);

    const permanentDelete = useCallback((id: string) => {
        if (window.confirm('Permanently delete this note? This cannot be undone.')) {
            deleteFile(id);
            setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [deleteFile]);

    const bulkRestore = useCallback(() => {
        for (const id of selectedIds) {
            updateFile(id, { deletedAt: undefined });
        }
        setSelectedIds(new Set());
    }, [selectedIds, updateFile]);

    const bulkDelete = useCallback(() => {
        if (!window.confirm(`Permanently delete ${selectedIds.size} notes? This cannot be undone.`)) return;
        for (const id of selectedIds) {
            deleteFile(id);
        }
        setSelectedIds(new Set());
    }, [selectedIds, deleteFile]);

    const emptyTrash = useCallback(() => {
        for (const note of trashedNotes) {
            deleteFile(note.id);
        }
        setSelectedIds(new Set());
        setShowEmptyConfirm(false);
    }, [trashedNotes, deleteFile]);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const toggleSelectAll = useCallback(() => {
        if (selectedIds.size === trashedNotes.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(trashedNotes.map((n) => n.id)));
        }
    }, [selectedIds, trashedNotes]);

    const allSelected = trashedNotes.length > 0 && selectedIds.size === trashedNotes.length;

    const formatDate = (ts: number) => {
        const d = new Date(ts);
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
        return d.toLocaleDateString();
    };

    const daysUntilPurge = (deletedAt: number) => {
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const purgeAt = deletedAt + thirtyDays;
        const remaining = Math.ceil((purgeAt - Date.now()) / (1000 * 60 * 60 * 24));
        return Math.max(0, remaining);
    };

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ background: 'var(--onyx-editor)' }}>
            <div className="px-8 pt-8 pb-4 shrink-0 flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                        <Trash2 size={20} className="text-zinc-400" />
                        Trash
                    </h1>
                    <p className="text-xs text-zinc-500 mt-1">
                        Notes in trash are automatically deleted after 30 days.
                    </p>
                </div>
                {trashedNotes.length > 0 && (
                    <button
                        onClick={() => setShowEmptyConfirm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                        <Trash2 size={12} />
                        Empty Trash
                    </button>
                )}
            </div>

            {/* Select all + bulk actions bar */}
            {trashedNotes.length > 0 && (
                <div className="px-8 pb-2 shrink-0 flex items-center gap-3">
                    <button
                        onClick={toggleSelectAll}
                        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                    >
                        {allSelected ? <CheckSquare size={14} className="text-violet-400" /> : <Square size={14} />}
                        {allSelected ? 'Deselect all' : 'Select all'}
                    </button>
                    {selectedIds.size > 0 && (
                        <>
                            <span className="text-xs text-zinc-600">|</span>
                            <span className="text-xs text-zinc-400">{selectedIds.size} selected</span>
                            <button
                                onClick={bulkRestore}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-300 hover:text-white hover:bg-violet-500/15 rounded-md transition-colors cursor-pointer"
                            >
                                <RotateCcw size={11} />
                                Restore
                            </button>
                            <button
                                onClick={bulkDelete}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
                            >
                                <Trash2 size={11} />
                                Delete
                            </button>
                        </>
                    )}
                </div>
            )}

            {trashedNotes.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-600">
                    <div className="text-center space-y-2">
                        <Trash2 size={32} className="mx-auto text-zinc-700" />
                        <p className="text-sm">Trash is empty</p>
                        <p className="text-xs text-zinc-700">Deleted notes will appear here</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
                    <div className="space-y-1">
                        {trashedNotes.map((note) => {
                            const isSelected = selectedIds.has(note.id);
                            return (
                                <div
                                    key={note.id}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                                        isSelected ? 'bg-violet-500/8 border border-violet-500/20' : 'hover:bg-zinc-800/40 border border-transparent'
                                    }`}
                                >
                                    <button
                                        onClick={() => toggleSelect(note.id)}
                                        className="shrink-0 cursor-pointer text-zinc-500 hover:text-violet-400 transition-colors"
                                    >
                                        {isSelected ? (
                                            <CheckSquare size={14} className="text-violet-400" />
                                        ) : (
                                            <Square size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                        )}
                                    </button>

                                    <span className="text-sm shrink-0"><NoteTypeIcon type={note.type} size={14} /></span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm text-zinc-200 truncate">
                                            {note.title || 'Untitled'}
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-zinc-600 mt-0.5">
                                            <span>Deleted {formatDate(note.deletedAt!)}</span>
                                            <span>·</span>
                                            <span className={daysUntilPurge(note.deletedAt!) <= 3 ? 'text-red-400' : ''}>
                                                {daysUntilPurge(note.deletedAt!)} days until permanent delete
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button
                                            onClick={() => restore(note.id)}
                                            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white hover:bg-violet-500/15 rounded-md transition-colors cursor-pointer"
                                            title="Restore"
                                        >
                                            <RotateCcw size={12} />
                                            Restore
                                        </button>
                                        <button
                                            onClick={() => permanentDelete(note.id)}
                                            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
                                            title="Delete Forever"
                                        >
                                            <Trash2 size={12} />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Empty Trash Confirmation Modal */}
            {showEmptyConfirm && (
                <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 99999, background: 'rgba(0,0,0,0.5)' }}>
                    <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-6 shadow-2xl shadow-black/60 animate-fade-in-up max-w-sm w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                                <AlertTriangle size={20} className="text-red-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-zinc-100">Empty Trash</h3>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                    This will permanently delete {trashedNotes.length} {trashedNotes.length === 1 ? 'item' : 'items'}. This cannot be undone.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowEmptyConfirm(false)}
                                className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={emptyTrash}
                                className="px-4 py-2 text-xs text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors cursor-pointer font-medium"
                            >
                                Delete All Permanently
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
