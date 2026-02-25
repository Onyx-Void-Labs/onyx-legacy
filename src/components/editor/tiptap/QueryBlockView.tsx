import { useState, useMemo, useCallback } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import {
    Search,
    Settings2,
    List,
    LayoutGrid,
    Table as TableIcon,
    Columns3,
    ArrowRight,
    ChevronDown,
    FileText,
    Clock,
} from 'lucide-react';
import { useSync } from '../../../contexts/SyncContext';
import type { FileMeta, NoteType } from '../../../types/sync';

const TYPE_ICON: Record<NoteType, string> = {
    note: '📄', topic: '🗂', idea: '💡', task: '✅',
    resource: '🔗', journal: '📅', study: '📚',
};

const VIEW_OPTIONS = [
    { value: 'list', label: 'List', icon: List },
    { value: 'card', label: 'Card', icon: LayoutGrid },
    { value: 'table', label: 'Table', icon: TableIcon },
    { value: 'kanban', label: 'Kanban', icon: Columns3 },
];

const GROUP_OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'week', label: 'Week' },
    { value: 'module', label: 'Module' },
    { value: 'type', label: 'Type' },
];

const NOTE_TYPES: { value: string; label: string }[] = [
    { value: '', label: 'All Types' },
    { value: 'note', label: 'Notes' },
    { value: 'topic', label: 'Topics' },
    { value: 'idea', label: 'Ideas' },
    { value: 'task', label: 'Tasks' },
    { value: 'resource', label: 'Resources' },
    { value: 'journal', label: 'Journal' },
    { value: 'study', label: 'Study' },
];

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
}

function groupNotes(
    notes: FileMeta[],
    groupBy: string
): Record<string, FileMeta[]> {
    if (groupBy === 'none') return { 'All Results': notes };

    const groups: Record<string, FileMeta[]> = {};
    for (const n of notes) {
        let key: string;
        switch (groupBy) {
            case 'week':
                key = n.week !== undefined ? `Week ${n.week}` : 'No Week';
                break;
            case 'module':
                key = n.module || 'No Module';
                break;
            case 'type':
                key = n.type.charAt(0).toUpperCase() + n.type.slice(1);
                break;
            default:
                key = 'All';
        }
        if (!groups[key]) groups[key] = [];
        groups[key].push(n);
    }
    return groups;
}

export default function QueryBlockView({ node, updateAttributes }: ReactNodeViewProps) {
    const { files } = useSync();
    const { filterSubject, filterType, groupBy, view } = node.attrs;
    const [showConfig, setShowConfig] = useState(false);

    // All unique subjects for autocomplete
    const allSubjects = useMemo(() => {
        const subjects = new Set<string>();
        files.forEach((f) => { if (f.subject?.trim()) subjects.add(f.subject.trim()); });
        return ['', ...Array.from(subjects).sort()];
    }, [files]);

    // Filter results
    const results = useMemo(() => {
        return files.filter((f) => {
            if (filterType && f.type !== filterType) return false;
            if (filterSubject && f.subject !== filterSubject) return false;
            return true;
        }).sort((a, b) => b.updatedAt - a.updatedAt);
    }, [files, filterSubject, filterType]);

    const grouped = useMemo(() => groupNotes(results, groupBy), [results, groupBy]);

    const handleOpenNote = useCallback((noteId: string) => {
        window.dispatchEvent(new CustomEvent('onyx:open-note', { detail: { noteId } }));
    }, []);

    // ─── Render views ─────────────────────────────────────────────
    const renderListView = (items: FileMeta[]) => (
        <div className="space-y-px">
            {items.map((n) => (
                <button
                    key={n.id}
                    onClick={() => handleOpenNote(n.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-purple-500/10 transition-colors text-left group cursor-pointer"
                >
                    <span className="text-sm shrink-0">{TYPE_ICON[n.type] ?? '📄'}</span>
                    <span className="flex-1 text-[13px] text-zinc-300 truncate group-hover:text-white transition-colors">
                        {n.title || 'Untitled'}
                    </span>
                    <span className="text-[10px] text-zinc-600 font-mono flex items-center gap-1 shrink-0">
                        <Clock size={10} />
                        {timeAgo(n.updatedAt)}
                    </span>
                    {n.subject && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-300/70 shrink-0">
                            {n.subject}
                        </span>
                    )}
                    <ArrowRight size={11} className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
            ))}
        </div>
    );

    const renderCardView = (items: FileMeta[]) => (
        <div className="grid grid-cols-2 gap-2">
            {items.map((n) => (
                <button
                    key={n.id}
                    onClick={() => handleOpenNote(n.id)}
                    className="p-3 rounded-lg border border-zinc-800/40 hover:border-purple-500/30 bg-zinc-900/40 hover:bg-purple-500/5 transition-all text-left group cursor-pointer"
                >
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-sm">{TYPE_ICON[n.type] ?? '📄'}</span>
                        <span className="text-[12px] text-zinc-300 font-medium truncate group-hover:text-white transition-colors">
                            {n.title || 'Untitled'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span>{timeAgo(n.updatedAt)}</span>
                        {n.subject && (
                            <span className="px-1 py-0.5 rounded bg-purple-500/10 text-purple-300/60">
                                {n.subject}
                            </span>
                        )}
                    </div>
                </button>
            ))}
        </div>
    );

    const renderTableView = (items: FileMeta[]) => (
        <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
                <thead>
                    <tr className="border-b border-zinc-800/40">
                        <th className="text-left py-1.5 px-2 text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">Title</th>
                        <th className="text-left py-1.5 px-2 text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">Subject</th>
                        <th className="text-left py-1.5 px-2 text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">Week</th>
                        <th className="text-left py-1.5 px-2 text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">Type</th>
                        <th className="text-left py-1.5 px-2 text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">Updated</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((n) => (
                        <tr
                            key={n.id}
                            onClick={() => handleOpenNote(n.id)}
                            className="border-b border-zinc-800/20 hover:bg-purple-500/5 cursor-pointer transition-colors group"
                        >
                            <td className="py-1.5 px-2 text-zinc-300 group-hover:text-white transition-colors">
                                <span className="flex items-center gap-1.5">
                                    <span className="text-sm">{TYPE_ICON[n.type] ?? '📄'}</span>
                                    {n.title || 'Untitled'}
                                </span>
                            </td>
                            <td className="py-1.5 px-2 text-zinc-500">{n.subject ?? '—'}</td>
                            <td className="py-1.5 px-2 text-zinc-500 font-mono">{n.week ?? '—'}</td>
                            <td className="py-1.5 px-2 text-zinc-500 capitalize">{n.type}</td>
                            <td className="py-1.5 px-2 text-zinc-600 font-mono">{timeAgo(n.updatedAt)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    const renderKanbanView = (items: FileMeta[]) => {
        const columns: Record<string, FileMeta[]> = {
            'To Do': [],
            'In Progress': [],
            'Done': [],
        };
        for (const n of items) {
            const status = n.status ?? 'todo';
            if (status === 'done') columns['Done'].push(n);
            else if (status === 'in-progress') columns['In Progress'].push(n);
            else columns['To Do'].push(n);
        }

        return (
            <div className="flex gap-3 overflow-x-auto pb-2">
                {Object.entries(columns).map(([col, notes]) => (
                    <div key={col} className="flex-1 min-w-45 max-w-65">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2 px-1 flex items-center gap-1">
                            {col}
                            <span className="text-zinc-700 font-mono">{notes.length}</span>
                        </div>
                        <div className="space-y-1.5">
                            {notes.map((n) => (
                                <button
                                    key={n.id}
                                    onClick={() => handleOpenNote(n.id)}
                                    className="w-full p-2.5 rounded-lg border border-zinc-800/40 bg-zinc-900/40 hover:border-purple-500/30 hover:bg-purple-500/5 text-left transition-all cursor-pointer"
                                >
                                    <div className="text-[12px] text-zinc-300 font-medium truncate">
                                        {n.title || 'Untitled'}
                                    </div>
                                    {n.priority && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block ${
                                            n.priority === 'urgent' ? 'bg-red-900/60 text-red-300' :
                                            n.priority === 'high' ? 'bg-amber-900/60 text-amber-300' :
                                            n.priority === 'medium' ? 'bg-blue-900/60 text-blue-300' :
                                            'bg-zinc-700 text-zinc-300'
                                        }`}>
                                            {n.priority}
                                        </span>
                                    )}
                                </button>
                            ))}
                            {notes.length === 0 && (
                                <div className="text-[11px] text-zinc-700 px-2 py-3 text-center">
                                    Empty
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderView = (items: FileMeta[]) => {
        switch (view) {
            case 'card': return renderCardView(items);
            case 'table': return renderTableView(items);
            case 'kanban': return renderKanbanView(items);
            default: return renderListView(items);
        }
    };

    return (
        <NodeViewWrapper className="my-3">
            <div
                className="query-block rounded-xl border border-purple-500/15 bg-purple-500/2 p-4"
                contentEditable={false}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Search size={14} className="text-purple-400" />
                        <span className="text-xs font-semibold text-purple-300/80 uppercase tracking-wider">
                            Query Block
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono">
                            {results.length} results
                        </span>
                    </div>
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            showConfig
                                ? 'bg-purple-500/15 text-purple-400'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                    >
                        <Settings2 size={13} />
                    </button>
                </div>

                {/* Config panel */}
                {showConfig && (
                    <div className="mb-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/40 space-y-3">
                        {/* Filter by subject */}
                        <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 block">
                                Filter Subject
                            </label>
                            <select
                                value={filterSubject}
                                onChange={(e) => updateAttributes({ filterSubject: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-purple-500 transition-colors appearance-none cursor-pointer"
                            >
                                <option value="">All Subjects</option>
                                {allSubjects.filter(Boolean).map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>

                        {/* Filter by type */}
                        <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 block">
                                Filter Type
                            </label>
                            <select
                                value={filterType}
                                onChange={(e) => updateAttributes({ filterType: e.target.value })}
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-zinc-200 outline-none focus:border-purple-500 transition-colors appearance-none cursor-pointer"
                            >
                                {NOTE_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Group by */}
                        <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 block">
                                Group By
                            </label>
                            <div className="flex gap-1">
                                {GROUP_OPTIONS.map((g) => (
                                    <button
                                        key={g.value}
                                        onClick={() => updateAttributes({ groupBy: g.value })}
                                        className={`text-[10px] px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
                                            groupBy === g.value
                                                ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30'
                                                : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'
                                        }`}
                                    >
                                        {g.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* View mode */}
                        <div>
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 block">
                                View
                            </label>
                            <div className="flex gap-1">
                                {VIEW_OPTIONS.map((v) => {
                                    const Icon = v.icon;
                                    return (
                                        <button
                                            key={v.value}
                                            onClick={() => updateAttributes({ view: v.value })}
                                            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium transition-all cursor-pointer ${
                                                view === v.value
                                                    ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30'
                                                    : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'
                                            }`}
                                        >
                                            <Icon size={11} />
                                            {v.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Results */}
                {results.length === 0 ? (
                    <div className="text-center py-6">
                        <FileText size={24} className="text-zinc-700 mx-auto mb-2" />
                        <p className="text-[12px] text-zinc-600">
                            No results match your query.{' '}
                            <button
                                onClick={() => setShowConfig(true)}
                                className="text-purple-400 hover:text-purple-300 cursor-pointer"
                            >
                                Adjust filters
                            </button>
                        </p>
                    </div>
                ) : (
                    <div>
                        {Object.entries(grouped).map(([groupLabel, items]) => (
                            <div key={groupLabel} className="mb-3 last:mb-0">
                                {groupBy !== 'none' && (
                                    <div className="flex items-center gap-1.5 mb-1.5 px-1">
                                        <ChevronDown size={11} className="text-zinc-600" />
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                            {groupLabel}
                                        </span>
                                        <span className="text-[10px] text-zinc-700 font-mono">{items.length}</span>
                                    </div>
                                )}
                                {renderView(items)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </NodeViewWrapper>
    );
}
