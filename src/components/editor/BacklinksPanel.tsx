import { useMemo, useState } from 'react';
import { Link2, ChevronDown, ChevronRight } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { NoteType } from '../../types/sync';
import { NoteTypeIcon } from '../../lib/noteIcons';

interface Backlink {
    noteId: string;
    noteTitle: string;
    noteType: NoteType;
    context: string;
    updatedAt?: number;
}

interface BacklinksPanelProps {
    currentNoteId: string;
    onOpenNote: (id: string) => void;
}

export default function BacklinksPanel({ currentNoteId, onOpenNote }: BacklinksPanelProps) {
    const { files } = useSync();
    const [collapsed, setCollapsed] = useState(false);

    const currentNote = useMemo(
        () => files.find((f) => f.id === currentNoteId),
        [files, currentNoteId],
    );

    const backlinks = useMemo<Backlink[]>(() => {
        if (!currentNote) return [];

        const results: Backlink[] = [];
        const currentTitle = currentNote.title?.toLowerCase() || '';

        for (const file of files) {
            if (file.id === currentNoteId) continue;
            if (file.deletedAt) continue;

            // Check if any note's properties contain a reference to this note
            const links = file.properties?.linkedNoteIds as string[] | undefined;
            if (links && links.includes(currentNoteId)) {
                results.push({
                    noteId: file.id,
                    noteTitle: file.title || 'Untitled',
                    noteType: file.type || 'note',
                    context: `Links to "${currentNote.title || 'Untitled'}"`,
                    updatedAt: file.updatedAt,
                });
                continue;
            }

            // Check if the note's title references the current note with +prefix
            if (currentTitle && file.title?.toLowerCase().includes(`+${currentTitle}`)) {
                results.push({
                    noteId: file.id,
                    noteTitle: file.title || 'Untitled',
                    noteType: file.type || 'note',
                    context: `Mentions "+${currentNote.title}"`,
                    updatedAt: file.updatedAt,
                });
                continue;
            }

            // Check for shared tags
            if (currentNote.tags && currentNote.tags.length > 0 && file.tags) {
                const shared = currentNote.tags.filter((t) => file.tags!.includes(t));
                if (shared.length > 0) {
                    results.push({
                        noteId: file.id,
                        noteTitle: file.title || 'Untitled',
                        noteType: file.type || 'note',
                        context: `Shares tags: ${shared.map((t) => `#${t}`).join(', ')}`,
                        updatedAt: file.updatedAt,
                    });
                }
            }
        }

        // Sort by most recently updated
        return results.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    }, [files, currentNoteId, currentNote]);

    const formatDate = (ts?: number) => {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };

    return (
        <div className="px-12 pb-8">
            <div className="border-t border-zinc-800 pt-4 mt-4">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex items-center gap-2 mb-3 cursor-pointer group"
                >
                    {collapsed ? (
                        <ChevronRight size={10} className="text-zinc-600" />
                    ) : (
                        <ChevronDown size={10} className="text-zinc-600" />
                    )}
                    <Link2 size={10} className="text-zinc-600" />
                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider group-hover:text-zinc-500 transition-colors">
                        Backlinks
                    </span>
                    <span className="text-[10px] font-mono text-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                        {backlinks.length}
                    </span>
                </button>

                {!collapsed && (
                    <>
                        {backlinks.length === 0 ? (
                            <p className="text-[11px] text-zinc-600 italic pl-5">
                                No notes link to this one yet. Use{' '}
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400 text-[10px]">+</code>{' '}
                                in other notes to create links.
                            </p>
                        ) : (
                            <div className="space-y-1.5">
                                {backlinks.map((bl) => (
                                    <button
                                        key={bl.noteId}
                                        onClick={() => onOpenNote(bl.noteId)}
                                        className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 hover:bg-violet-500/8 group cursor-pointer"
                                    >
                                        <span className="text-sm shrink-0 mt-0.5">
                                            <NoteTypeIcon type={bl.noteType} size={14} />
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-zinc-200 truncate">
                                                    {bl.noteTitle}
                                                </span>
                                                {bl.updatedAt && (
                                                    <span className="text-[9px] text-zinc-600 shrink-0">
                                                        {formatDate(bl.updatedAt)}
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                    → open
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                                                {bl.context}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
