import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta, NoteType } from '../../types/sync';

interface TopicQueryProps {
    topicTitle: string;
    onOpenNote: (id: string) => void;
}

const TYPE_ICON: Record<NoteType, string> = {
    note: '📄',
    topic: '🗂',
    idea: '💡',
    task: '✅',
    resource: '🔗',
    journal: '📅',
    study: '📚',
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

export default function TopicQuery({ topicTitle, onOpenNote }: TopicQueryProps) {
    const { files } = useSync();

    // Find related files — match by subject field or title keyword
    const relatedGroups = useMemo(() => {
        if (!topicTitle) return {};

        const keyword = topicTitle.toLowerCase().trim();
        if (!keyword) return {};

        const matches = files.filter((f) => {
            if (f.type === 'topic') return false; // Don't list other topics
            const titleMatch = f.title.toLowerCase().includes(keyword);
            const subjectMatch = (f.subject ?? '').toLowerCase().includes(keyword);
            return titleMatch || subjectMatch;
        });

        // Group by type
        const groups: Partial<Record<NoteType, FileMeta[]>> = {};
        for (const m of matches) {
            const t = m.type ?? 'note';
            if (!groups[t]) groups[t] = [];
            groups[t]!.push(m);
        }

        // Sort each group by updatedAt descending
        for (const key of Object.keys(groups) as NoteType[]) {
            groups[key]!.sort((a, b) => b.updatedAt - a.updatedAt);
        }

        return groups;
    }, [files, topicTitle]);

    const groupKeys = Object.keys(relatedGroups) as NoteType[];

    if (groupKeys.length === 0) {
        return (
            <div className="border-t border-zinc-800/40 px-8 py-4">
                <div className="text-[11px] uppercase tracking-wider text-zinc-600 font-semibold mb-2">
                    Related Notes
                </div>
                <p className="text-[12px] text-zinc-600">
                    No related notes found. Notes with &quot;{topicTitle}&quot; in their title or subject will appear here.
                </p>
            </div>
        );
    }

    return (
        <div className="border-t border-zinc-800/40 px-8 py-4 space-y-4">
            <div className="text-[11px] uppercase tracking-wider text-zinc-600 font-semibold">
                Related to &ldquo;{topicTitle}&rdquo;
            </div>

            {groupKeys.map((type) => {
                const group = relatedGroups[type]!;
                return (
                    <div key={type}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-sm">{TYPE_ICON[type]}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                {TYPE_LABEL[type]}
                            </span>
                            <span className="text-[10px] text-zinc-700 font-mono">{group.length}</span>
                        </div>
                        <div className="space-y-px">
                            {group.slice(0, 6).map((note) => (
                                <button
                                    key={note.id}
                                    onClick={() => onOpenNote(note.id)}
                                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-purple-900/20 transition-colors duration-150 text-left group cursor-pointer"
                                >
                                    <span className="text-[13px] text-zinc-300 truncate flex-1 group-hover:text-white transition-colors">
                                        {note.title || 'Untitled'}
                                    </span>
                                    <ArrowRight size={11} className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </button>
                            ))}
                            {group.length > 6 && (
                                <div className="text-[11px] text-zinc-600 px-3 pt-0.5">
                                    +{group.length - 6} more
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
