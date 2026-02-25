import { useMemo } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta, NoteType } from '../../types/sync';

const TYPE_ICON: Record<NoteType, string> = {
    note: '📄',
    topic: '🗂',
    idea: '💡',
    task: '✅',
    resource: '🔗',
    journal: '📅',
    study: '📚',
};

interface TrashViewProps {
    onOpenNote: (id: string) => void;
}

export default function TrashView({ onOpenNote }: TrashViewProps) {
    const { files, updateFile, deleteFile } = useSync();

    const trashedNotes = useMemo(
        () =>
            files
                .filter((f) => f.deletedAt)
                .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)),
        [files]
    );

    const restore = (id: string) => {
        updateFile(id, { deletedAt: undefined });
    };

    const permanentDelete = (id: string) => {
        if (window.confirm('Permanently delete this note? This cannot be undone.')) {
            deleteFile(id);
        }
    };

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
            <div className="px-8 pt-8 pb-4 shrink-0">
                <h1 className="text-xl font-bold text-zinc-100">Trash</h1>
                <p className="text-xs text-zinc-500 mt-1">
                    Notes in trash are automatically deleted after 30 days.
                </p>
            </div>

            {trashedNotes.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-600">
                    <div className="text-center space-y-2">
                        <Trash2 size={32} className="mx-auto text-zinc-700" />
                        <p className="text-sm">Trash is empty</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
                    <div className="space-y-1">
                        {trashedNotes.map((note) => (
                            <div
                                key={note.id}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800/40 transition-colors group"
                            >
                                <span className="text-sm shrink-0">{TYPE_ICON[note.type]}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-zinc-200 truncate">
                                        {note.title || 'Untitled'}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-zinc-600 mt-0.5">
                                        <span>Deleted {formatDate(note.deletedAt!)}</span>
                                        <span>·</span>
                                        <span>{daysUntilPurge(note.deletedAt!)} days until permanent delete</span>
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
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
