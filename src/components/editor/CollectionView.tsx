import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Plus, Search, List as ListIcon, Grid3X3, Columns3, Calendar } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta, NoteType } from '../../types/sync';

const TYPE_LABEL: Record<NoteType, string> = {
    note: 'Notes',
    topic: 'Topics',
    idea: 'Ideas',
    task: 'Tasks',
    resource: 'Resources',
    journal: 'Journal',
    study: 'Study',
};

const TYPE_ICON: Record<NoteType, string> = {
    note: '📄',
    topic: '🗂',
    idea: '💡',
    task: '✅',
    resource: '🔗',
    journal: '📅',
    study: '📚',
};

type SortField = 'title' | 'updatedAt' | 'subject';
type SortDir = 'asc' | 'desc';
type ViewMode = 'list' | 'grid' | 'board' | 'calendar';

const VIEW_MODE_KEY = (type: NoteType) => `onyx-collection-view-${type}`;

const VIEW_MODES: { id: ViewMode; icon: React.ReactNode; label: string }[] = [
    { id: 'list', icon: <ListIcon size={14} />, label: 'List' },
    { id: 'grid', icon: <Grid3X3 size={14} />, label: 'Grid' },
    { id: 'board', icon: <Columns3 size={14} />, label: 'Board' },
    { id: 'calendar', icon: <Calendar size={14} />, label: 'Calendar' },
];

interface CollectionViewProps {
    type: NoteType;
    onOpenNote: (id: string) => void;
    onNewNote: (type: NoteType) => void;
}

export default function CollectionView({ type, onOpenNote, onNewNote }: CollectionViewProps) {
    const { files } = useSync();
    const [search, setSearch] = useState('');
    const [sortField, setSortField] = useState<SortField>('updatedAt');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        try { return (localStorage.getItem(VIEW_MODE_KEY(type)) as ViewMode) || 'list'; }
        catch { return 'list'; }
    });

    const changeViewMode = (mode: ViewMode) => {
        setViewMode(mode);
        try { localStorage.setItem(VIEW_MODE_KEY(type), mode); } catch {}
    };

    const filtered = useMemo(() => {
        let list = files.filter((f) => f.type === type);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (f) =>
                    f.title.toLowerCase().includes(q) ||
                    (f.subject ?? '').toLowerCase().includes(q)
            );
        }
        list.sort((a, b) => {
            let cmp = 0;
            if (sortField === 'title') {
                cmp = (a.title || '').localeCompare(b.title || '');
            } else if (sortField === 'updatedAt') {
                cmp = a.updatedAt - b.updatedAt;
            } else if (sortField === 'subject') {
                cmp = (a.subject ?? '').localeCompare(b.subject ?? '');
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return list;
    }, [files, type, search, sortField, sortDir]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortField(field);
            setSortDir(field === 'title' ? 'asc' : 'desc');
        }
    };

    const formatDate = (ts: number) => {
        if (!ts) return '—';
        return new Date(ts).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    return (
        <div className="flex-1 overflow-auto pb-24" style={{ background: 'var(--onyx-bg)' }}>
            <div className="max-w-4xl mx-auto px-8 pt-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2.5">
                        <span className="text-xl">{TYPE_ICON[type]}</span>
                        <h1 className="text-xl font-bold text-zinc-100">{TYPE_LABEL[type]}</h1>
                        <span className="text-sm text-zinc-600 font-mono ml-1">{filtered.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* View Mode Switcher */}
                        <div className="flex items-center bg-zinc-800/40 rounded-lg p-0.5 border border-zinc-800/60">
                            {VIEW_MODES.map((vm) => (
                                <button
                                    key={vm.id}
                                    onClick={() => changeViewMode(vm.id)}
                                    title={vm.label}
                                    className={`p-1.5 rounded-md transition-all duration-100 cursor-pointer ${
                                        viewMode === vm.id
                                            ? 'bg-violet-500/20 text-violet-300'
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    {vm.icon}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => onNewNote(type)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-sm font-medium hover:bg-violet-500/20 transition-colors cursor-pointer"
                        >
                            <Plus size={14} />
                            New
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`Search ${TYPE_LABEL[type].toLowerCase()}…`}
                        className="w-full bg-zinc-800/40 text-sm text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-800/60 focus:border-violet-500/40 rounded-lg pl-9 pr-3 py-2 transition-colors"
                    />
                </div>

                {/* Content by view mode */}
                {filtered.length === 0 ? (
                    <div className="text-center py-12 text-zinc-600 text-sm">
                        {search ? 'No matching notes found.' : `No ${TYPE_LABEL[type].toLowerCase()} yet.`}
                    </div>
                ) : viewMode === 'list' ? (
                    <ListView notes={filtered} type={type} onOpenNote={onOpenNote} sortField={sortField} toggleSort={toggleSort} formatDate={formatDate} />
                ) : viewMode === 'grid' ? (
                    <GridView notes={filtered} type={type} onOpenNote={onOpenNote} formatDate={formatDate} />
                ) : viewMode === 'board' ? (
                    <BoardView notes={filtered} type={type} onOpenNote={onOpenNote} />
                ) : (
                    <CalendarView notes={filtered} type={type} onOpenNote={onOpenNote} />
                )}
            </div>
        </div>
    );
}

/* ─── List View ───────────────────────────────────────────── */

function ListView({
    notes, type, onOpenNote, sortField, toggleSort, formatDate,
}: {
    notes: FileMeta[]; type: NoteType; onOpenNote: (id: string) => void;
    sortField: SortField; toggleSort: (f: SortField) => void;
    formatDate: (ts: number) => string;
}) {
    const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
        <button
            onClick={() => toggleSort(field)}
            className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer transition-colors ${
                sortField === field ? 'text-violet-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
        >
            {label}
            {sortField === field && <ArrowUpDown size={10} className="text-violet-400" />}
        </button>
    );

    return (
        <>
            <div className="grid grid-cols-[1fr_120px_120px] gap-4 px-3 py-2 border-b border-zinc-800/40">
                <SortHeader field="title" label="Title" />
                <SortHeader field="updatedAt" label="Modified" />
                <SortHeader field="subject" label="Subject" />
            </div>
            <div className="divide-y divide-zinc-800/30">
                {notes.map((note) => (
                    <button
                        key={note.id}
                        onClick={() => onOpenNote(note.id)}
                        className="w-full grid grid-cols-[1fr_120px_120px] gap-4 px-3 py-2.5 text-left hover:bg-violet-500/5 transition-colors cursor-pointer group"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[13px] shrink-0">{TYPE_ICON[type]}</span>
                            <span className="text-[13px] text-zinc-300 truncate group-hover:text-white transition-colors">
                                {note.title || 'Untitled'}
                            </span>
                        </div>
                        <span className="text-[12px] text-zinc-500 truncate">{formatDate(note.updatedAt)}</span>
                        <span className="text-[12px] text-zinc-500 truncate">{note.subject || '—'}</span>
                    </button>
                ))}
            </div>
        </>
    );
}

/* ─── Grid View ───────────────────────────────────────────── */

function GridView({
    notes, type, onOpenNote, formatDate,
}: {
    notes: FileMeta[]; type: NoteType; onOpenNote: (id: string) => void;
    formatDate: (ts: number) => string;
}) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {notes.map((note) => (
                <button
                    key={note.id}
                    onClick={() => onOpenNote(note.id)}
                    className="text-left p-4 rounded-xl border border-zinc-800/40 bg-zinc-800/20 hover:bg-violet-500/5 hover:border-violet-500/20 transition-all cursor-pointer group"
                >
                    <div className="flex items-center gap-1.5 mb-2 min-h-18">
                        <span className="text-sm">{TYPE_ICON[type]}</span>
                        <span className="text-[13px] font-medium text-zinc-200 truncate group-hover:text-white transition-colors">
                            {note.title || 'Untitled'}
                        </span>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                        {formatDate(note.updatedAt)}
                        {note.subject && <span className="ml-2 text-zinc-600">· {note.subject}</span>}
                    </div>
                    {note.priority && (
                        <span className={`inline-block mt-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            note.priority === 'high' ? 'bg-red-500/15 text-red-400'
                            : note.priority === 'medium' ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-zinc-700/30 text-zinc-400'
                        }`}>
                            {note.priority}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}

/* ─── Board View (grouped by status or subject) ───────────── */

function BoardView({
    notes, type: _type, onOpenNote,
}: {
    notes: FileMeta[]; type: NoteType; onOpenNote: (id: string) => void;
}) {
    // Group by status for tasks, subject for others
    const groups = useMemo(() => {
        const map = new Map<string, FileMeta[]>();
        for (const note of notes) {
            const key = _type === 'task'
                ? (note.status || 'todo')
                : (note.subject || 'Uncategorized');
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(note);
        }
        return map;
    }, [notes, _type]);
    // const type = _type; // removed unused variable

    const columnColors: Record<string, string> = {
        'todo': 'border-zinc-600',
        'in-progress': 'border-amber-500/50',
        'done': 'border-green-500/50',
    };

    return (
        <div className="flex gap-3 overflow-x-auto pb-4">
            {Array.from(groups).map(([group, items]) => (
                <div
                    key={group}
                    className={`shrink-0 w-64 rounded-xl border bg-zinc-800/20 ${columnColors[group] || 'border-zinc-800/40'}`}
                >
                    <div className="px-3 py-2 border-b border-zinc-800/40">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">{group}</span>
                            <span className="text-[10px] text-zinc-600 font-mono">{items.length}</span>
                        </div>
                    </div>
                    <div className="p-2 space-y-1.5 max-h-[60vh] overflow-y-auto">
                        {items.map((note) => (
                            <button
                                key={note.id}
                                onClick={() => onOpenNote(note.id)}
                                className="w-full text-left p-2.5 rounded-lg bg-zinc-900/60 hover:bg-violet-500/5 border border-zinc-800/30 hover:border-violet-500/20 transition-all cursor-pointer group"
                            >
                                <span className="text-[12px] text-zinc-300 group-hover:text-white transition-colors line-clamp-2">
                                    {note.title || 'Untitled'}
                                </span>
                                {note.priority && (
                                    <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                                        note.priority === 'high' ? 'bg-red-500/15 text-red-400'
                                        : note.priority === 'medium' ? 'bg-amber-500/15 text-amber-400'
                                        : 'bg-zinc-700/30 text-zinc-400'
                                    }`}>
                                        {note.priority}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ─── Calendar View ───────────────────────────────────────── */

function CalendarView({
    notes, type, onOpenNote,
}: {
    notes: FileMeta[]; type: NoteType; onOpenNote: (id: string) => void;
}) {
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const firstDayOfWeek = currentMonth.getDay(); // 0=Sun

    // Map notes to days
    const notesByDay = useMemo(() => {
        const map = new Map<number, FileMeta[]>();
        for (const note of notes) {
            const ts = note.dueDate || note.updatedAt;
            if (!ts) continue;
            const d = new Date(ts);
            if (d.getFullYear() === currentMonth.getFullYear() && d.getMonth() === currentMonth.getMonth()) {
                const day = d.getDate();
                if (!map.has(day)) map.set(day, []);
                map.get(day)!.push(note);
            }
        }
        return map;
    }, [notes, currentMonth]);

    const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

    const today = new Date();
    const isToday = (day: number) =>
        today.getFullYear() === currentMonth.getFullYear() &&
        today.getMonth() === currentMonth.getMonth() &&
        today.getDate() === day;

    const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return (
        <div>
            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
                <button onClick={prevMonth} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 cursor-pointer">← Prev</button>
                <span className="text-sm font-medium text-zinc-200">{monthLabel}</span>
                <button onClick={nextMonth} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 cursor-pointer">Next →</button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-px mb-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
                    <div key={d} className="text-center text-[10px] text-zinc-500 uppercase tracking-wider py-1">{d}</div>
                ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-px">
                {/* Empty cells for first week offset */}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} className="min-h-18 bg-zinc-900/30 rounded-lg" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dayNotes = notesByDay.get(day) || [];
                    return (
                        <div
                            key={day}
                            className={`min-h-18 rounded-lg p-1 border transition-colors ${
                                isToday(day)
                                    ? 'border-violet-500/30 bg-violet-500/5'
                                    : 'border-zinc-800/20 bg-zinc-900/30'
                            }`}
                        >
                            <div className={`text-[10px] font-medium mb-0.5 ${isToday(day) ? 'text-violet-400' : 'text-zinc-500'}`}>
                                {day}
                            </div>
                            {dayNotes.slice(0, 2).map((note) => (
                                <button
                                    key={note.id}
                                    onClick={() => onOpenNote(note.id)}
                                    className="w-full text-left text-[10px] text-zinc-400 hover:text-violet-300 truncate leading-tight cursor-pointer"
                                >
                                    {note.title || 'Untitled'}
                                </button>
                            ))}
                            {dayNotes.length > 2 && (
                                <span className="text-[9px] text-zinc-600">+{dayNotes.length - 2} more</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
