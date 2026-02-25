import { useMemo } from 'react';
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

interface Backlink {
    noteId: string;
    noteTitle: string;
    noteType: NoteType;
    context: string;
}

interface BacklinksPanelProps {
    currentNoteId: string;
    onOpenNote: (id: string) => void;
}

export default function BacklinksPanel({ currentNoteId, onOpenNote }: BacklinksPanelProps) {
    const { files } = useSync();

    // Scan all notes for NoteLink nodes referencing current note.
    // Since note content lives in per-note Yjs docs we can't deeply inspect
    // content from here without loading every doc. Instead we use a lightweight
    // approach: look for notes that store link metadata in properties, or
    // check IndexedDB. For now we rely on a global event bus populated by
    // the editor when notes are opened. As a fallback we surface any note
    // whose title contains a '+' reference to the current note's title.
    const currentNote = useMemo(
        () => files.find((f) => f.id === currentNoteId),
        [files, currentNoteId]
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
                });
            }

            // Also check if the note's title references the current note with +prefix
            if (currentTitle && file.title?.toLowerCase().includes(`+${currentTitle}`)) {
                if (!results.find((r) => r.noteId === file.id)) {
                    results.push({
                        noteId: file.id,
                        noteTitle: file.title || 'Untitled',
                        noteType: file.type || 'note',
                        context: `Mentions "+${currentNote.title}"`,
                    });
                }
            }
        }

        return results;
    }, [files, currentNoteId, currentNote]);

    if (backlinks.length === 0) return null;

    return (
        <div className="px-12 pb-8">
            <div className="border-t border-zinc-800 pt-4 mt-4">
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
                        Linked from
                    </span>
                    <span className="text-[10px] font-mono text-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                        {backlinks.length} {backlinks.length === 1 ? 'note' : 'notes'}
                    </span>
                </div>
                <div className="space-y-1.5">
                    {backlinks.map((bl) => (
                        <button
                            key={bl.noteId}
                            onClick={() => onOpenNote(bl.noteId)}
                            className="w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 hover:bg-violet-500/8 group cursor-pointer"
                        >
                            <span className="text-sm shrink-0 mt-0.5">{TYPE_ICON[bl.noteType]}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-zinc-200 truncate">
                                        {bl.noteTitle}
                                    </span>
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
            </div>
        </div>
    );
}
