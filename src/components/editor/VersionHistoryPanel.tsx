import { useEffect, useState, useCallback } from 'react';
import { Clock, RotateCcw, Trash2, Plus, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import {
    saveSnapshot,
    getSnapshots,
    deleteSnapshot,
    type DocSnapshot,
} from '../../services/VersionHistoryService';

interface VersionHistoryPanelProps {
    noteId: string;
    /** Function to get the current Loro doc state as Uint8Array */
    getDocState: () => Uint8Array | null;
    /** Function to get a text-only preview of the current doc */
    getDocPreview: () => string;
    /** Function to get the current word count */
    getWordCount: () => number;
    /** Function to restore a snapshot's state */
    onRestore: (state: Uint8Array) => void;
}

export default function VersionHistoryPanel({
    noteId,
    getDocState,
    getDocPreview,
    getWordCount,
    onRestore,
}: VersionHistoryPanelProps) {
    const [snapshots, setSnapshots] = useState<DocSnapshot[]>([]);
    const [collapsed, setCollapsed] = useState(true);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    const loadSnapshots = useCallback(async () => {
        if (!noteId) return;
        const snaps = await getSnapshots(noteId);
        setSnapshots(snaps);
    }, [noteId]);

    useEffect(() => {
        loadSnapshots();
    }, [loadSnapshots]);

    const handleSaveVersion = useCallback(async () => {
        const state = getDocState();
        if (!state) return;

        setSaving(true);
        const now = new Date();
        const label = `${now.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
        })} ${now.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
        })}`;

        await saveSnapshot(noteId, state, label, getDocPreview(), getWordCount());
        await loadSnapshots();
        setSaving(false);
    }, [noteId, getDocState, getDocPreview, getWordCount, loadSnapshots]);

    const handleDelete = useCallback(
        async (id: number) => {
            await deleteSnapshot(id);
            if (selectedId === id) setSelectedId(null);
            await loadSnapshots();
        },
        [selectedId, loadSnapshots],
    );

    const handleRestore = useCallback(
        (snap: DocSnapshot) => {
            onRestore(snap.state);
        },
        [onRestore],
    );

    const formatTimestamp = (ts: number) => {
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHr / 24);

        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHr < 24) return `${diffHr}h ago`;
        if (diffDay < 7) return `${diffDay}d ago`;
        return d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        });
    };

    return (
        <div className="px-12 pb-4">
            <div className="border-t border-zinc-800 pt-4 mt-2">
                <div className="flex items-center justify-between mb-3">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="flex items-center gap-2 cursor-pointer group"
                    >
                        {collapsed ? (
                            <ChevronRight size={10} className="text-zinc-600" />
                        ) : (
                            <ChevronDown size={10} className="text-zinc-600" />
                        )}
                        <Clock size={10} className="text-zinc-600" />
                        <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider group-hover:text-zinc-500 transition-colors">
                            Version History
                        </span>
                        <span className="text-[10px] font-mono text-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                            {snapshots.length}
                        </span>
                    </button>

                    {!collapsed && (
                        <button
                            onClick={handleSaveVersion}
                            disabled={saving}
                            className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            <Plus size={10} />
                            {saving ? 'Saving...' : 'Save version'}
                        </button>
                    )}
                </div>

                {!collapsed && (
                    <div className="space-y-1">
                        {snapshots.length === 0 ? (
                            <p className="text-[11px] text-zinc-600 italic pl-5">
                                No versions saved yet. Click "Save version" to create a checkpoint.
                            </p>
                        ) : (
                            snapshots.map((snap) => (
                                <div
                                    key={snap.id}
                                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 group ${
                                        selectedId === snap.id
                                            ? 'bg-violet-500/10 border border-violet-500/20'
                                            : 'hover:bg-zinc-800/40'
                                    }`}
                                >
                                    <FileText
                                        size={12}
                                        className="text-zinc-600 shrink-0 mt-0.5"
                                    />
                                    <div
                                        className="flex-1 min-w-0 cursor-pointer"
                                        onClick={() =>
                                            setSelectedId(
                                                selectedId === snap.id ? null : snap.id,
                                            )
                                        }
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium text-zinc-300">
                                                {snap.label}
                                            </span>
                                            <span className="text-[9px] text-zinc-600">
                                                {formatTimestamp(snap.timestamp)}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-zinc-600 truncate mt-0.5">
                                            {snap.preview || 'Empty document'}
                                            {snap.wordCount > 0 && (
                                                <span className="ml-2 text-zinc-700">
                                                    · {snap.wordCount} words
                                                </span>
                                            )}
                                        </p>
                                    </div>

                                    {selectedId === snap.id && (
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => handleRestore(snap)}
                                                className="p-1 rounded text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors cursor-pointer"
                                                title="Restore this version"
                                            >
                                                <RotateCcw size={11} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(snap.id)}
                                                className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                                title="Delete this version"
                                            >
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
