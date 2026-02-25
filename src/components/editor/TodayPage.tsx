import React, { useMemo, useState, useCallback } from 'react';
import {
    ArrowRight,
    CheckCircle2,
    Clock,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Inbox,
    CalendarHeart,
} from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta, NoteType } from '../../types/sync';
import {
    getCarriedOver,
    getDueToday,
    getScheduledToday,
    getSomeday,
    getThisWeek,
    getDueThisWeek,
    getTodayJournal,
} from '../../lib/today';

interface TodayPageProps {
    onOpenNote: (id: string) => void;
}

const PRIORITY_BADGE: Record<string, { label: string; class: string }> = {
    low: { label: 'Low', class: 'bg-zinc-700/50 text-zinc-400' },
    medium: { label: 'Med', class: 'bg-blue-900/40 text-blue-300' },
    high: { label: 'High', class: 'bg-amber-900/40 text-amber-300' },
    urgent: { label: 'Urgent', class: 'bg-red-900/40 text-red-300' },
};

const TYPE_ICON: Record<NoteType, string> = {
    note: '📄', topic: '🗂', idea: '💡', task: '✅',
    resource: '🔗', journal: '📅', study: '📚',
};

function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

function formatRelativeDate(dateStr: string): string {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today) return 'today';
    if (dateStr === yesterday) return 'yesterday';
    const diff = Math.floor((new Date(today).getTime() - new Date(dateStr).getTime()) / 86400000);
    if (diff > 0 && diff <= 7) return `${diff} days ago`;
    return dateStr;
}

export default function TodayPage({ onOpenNote }: TodayPageProps) {
    const { files, updateFile } = useSync();

    const dayLabel = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });

    const carriedOver = useMemo(() => getCarriedOver(files), [files]);
    const dueTasks = useMemo(() => getDueToday(files), [files]);
    const scheduledToday = useMemo(() => getScheduledToday(files), [files]);
    const somedayBacklog = useMemo(() => getSomeday(files), [files]);
    const thisWeek = useMemo(() => getDueThisWeek(files), [files]);
    const recentNotes = useMemo(() => getThisWeek(files), [files]);

    const handleCompleteTask = useCallback((e: React.MouseEvent, taskId: string) => {
        e.stopPropagation();
        updateFile(taskId, { status: 'done' });
    }, [updateFile]);

    const TaskRow = ({ task }: { task: FileMeta }) => {
        const badge = PRIORITY_BADGE[task.priority ?? 'low'];
        return (
            <button
                onClick={() => onOpenNote(task.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-violet-500/5 transition-colors duration-150 text-left group cursor-pointer"
            >
                <button
                    onClick={(e) => handleCompleteTask(e, task.id)}
                    className="shrink-0 w-4.5 h-4.5 rounded-[5px] border-2 border-zinc-600 hover:border-violet-400 flex items-center justify-center transition-colors cursor-pointer"
                    title="Mark as done"
                >
                    <CheckCircle2 size={10} className="text-transparent group-hover:text-zinc-600 transition-colors" />
                </button>
                <span className="flex-1 text-[14px] text-zinc-300 truncate group-hover:text-white transition-colors">
                    {task.title || 'Untitled Task'}
                </span>
                {task.subject && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-violet-500/8 text-violet-300/70 shrink-0 font-medium">
                        {task.subject}
                    </span>
                )}
                {task.dueDate && (
                    <span className="text-[11px] text-zinc-500 shrink-0">{formatRelativeDate(task.dueDate)}</span>
                )}
                {badge && task.priority !== 'low' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${badge.class}`}>
                        {badge.label}
                    </span>
                )}
                <ArrowRight size={12} className="text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
        );
    };

    const Section = ({
        title,
        icon,
        count,
        children,
        accentClass = 'text-violet-400',
        collapsible = false,
        defaultCollapsed = false,
    }: {
        title: string;
        icon?: React.ReactNode;
        count: number;
        children: React.ReactNode;
        accentClass?: string;
        collapsible?: boolean;
        defaultCollapsed?: boolean;
    }) => {
        const [collapsed, setCollapsed] = useState(defaultCollapsed);
        return (
            <div className="mb-5">
                <button
                    onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
                    className={`flex items-center gap-2 mb-1.5 px-1 ${collapsible ? 'cursor-pointer hover:opacity-80' : ''}`}
                >
                    {collapsible ? (
                        collapsed ? <ChevronRight size={13} className={accentClass} /> : <ChevronDown size={13} className={accentClass} />
                    ) : icon}
                    <h3 className={`text-[11px] font-semibold uppercase tracking-widest ${accentClass}`}>
                        {title}
                    </h3>
                    <span className="text-[11px] text-zinc-600 font-mono ml-1">{count}</span>
                </button>
                {(!collapsible || !collapsed) && (
                    count === 0 ? (
                        <div className="text-[13px] text-zinc-600 px-3 py-2 italic">Nothing here — nice work!</div>
                    ) : (
                        <div className="space-y-px">{children}</div>
                    )
                )}
            </div>
        );
    };

    return (
        <div className="flex-1 overflow-auto pb-24" style={{ background: 'var(--onyx-bg)' }}>
            <div className="max-w-2xl mx-auto px-8 pt-10">
                {/* Greeting */}
                <p className="text-[13px] text-zinc-500 mb-2">{getGreeting()}, let's get to work.</p>

                {/* Date heading */}
                <h1 className="text-2xl font-bold text-zinc-100 mb-1 flex items-center gap-2.5">
                    <span className="text-xl">📅</span>
                    {dayLabel}
                </h1>

                {/* Divider */}
                <div className="h-px bg-zinc-800/60 my-5" />

                {/* Overdue / Carried Over */}
                {carriedOver.length > 0 && (
                    <Section
                        title="Overdue"
                        count={carriedOver.length}
                        accentClass="text-red-400"
                        collapsible
                        icon={<AlertCircle size={13} className="text-red-400" />}
                    >
                        {carriedOver.map((t) => (
                            <TaskRow key={t.id} task={t} />
                        ))}
                    </Section>
                )}

                {/* Due Today */}
                <Section
                    title="Due Today"
                    count={dueTasks.length}
                    accentClass="text-violet-400"
                    icon={<Clock size={13} className="text-violet-400" />}
                >
                    {dueTasks.map((t) => (
                        <TaskRow key={t.id} task={t} />
                    ))}
                </Section>

                {/* Scheduled Today */}
                {scheduledToday.length > 0 && (
                    <Section
                        title="Scheduled Today"
                        count={scheduledToday.length}
                        accentClass="text-sky-400"
                        icon={<CalendarHeart size={13} className="text-sky-400" />}
                    >
                        {scheduledToday.map((t) => (
                            <TaskRow key={t.id} task={t} />
                        ))}
                    </Section>
                )}

                {/* This Week */}
                {thisWeek.length > 0 && (
                    <Section
                        title="This Week"
                        count={thisWeek.length}
                        accentClass="text-zinc-400"
                        collapsible
                        icon={<Clock size={13} className="text-zinc-400" />}
                    >
                        {thisWeek.map((t) => (
                            <TaskRow key={t.id} task={t} />
                        ))}
                    </Section>
                )}

                {/* Someday / Backlog */}
                {somedayBacklog.length > 0 && (
                    <Section
                        title="Someday / Backlog"
                        count={somedayBacklog.length}
                        accentClass="text-zinc-500"
                        collapsible
                        defaultCollapsed
                    >
                        {somedayBacklog.map((t) => (
                            <TaskRow key={t.id} task={t} />
                        ))}
                    </Section>
                )}

                {/* Divider before recent notes */}
                {recentNotes.length > 0 && <div className="h-px bg-zinc-800/40 my-4" />}

                {/* Recent Notes */}
                {recentNotes.length > 0 && (
                    <Section
                        title="Recent Notes"
                        count={recentNotes.length}
                        accentClass="text-zinc-500"
                        icon={<Inbox size={13} className="text-zinc-500" />}
                    >
                        {recentNotes.map((n) => (
                            <button
                                key={n.id}
                                onClick={() => onOpenNote(n.id)}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-violet-500/5 transition-colors duration-150 text-left group cursor-pointer"
                            >
                                <span className="text-[13px]">{TYPE_ICON[n.type] ?? '📄'}</span>
                                <span className="flex-1 text-[13px] text-zinc-400 truncate group-hover:text-white transition-colors">
                                    {n.title || 'Untitled'}
                                </span>
                                {n.subject && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-violet-500/8 text-violet-300/50 shrink-0">
                                        {n.subject}
                                    </span>
                                )}
                                <ArrowRight size={12} className="text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        ))}
                    </Section>
                )}
            </div>
        </div>
    );
}
