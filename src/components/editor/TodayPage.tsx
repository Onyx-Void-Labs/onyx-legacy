import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
    ArrowRight,
    CheckCircle2,
    Clock,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Inbox,
    CalendarHeart,
    Flame,
    Target,
    Zap,
    Send,
    X,
    Check,
    HelpCircle,
} from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta } from '../../types/sync';
import { NoteTypeIcon } from '../../lib/noteIcons';
import {
    getCarriedOver,
    getDueToday,
    getScheduledToday,
    getSomeday,
    getThisWeek,
    getDueThisWeek,
    getTodayJournal,
} from '../../lib/today';
import { useTodayStore } from '../../store/todayStore';
import { useQuestionStore } from '../../store/questionStore';
import { useFeature } from '../../hooks/useFeature';

/* ─── Study Heatmap sub-component ─────────────────────────── */

function StudyHeatmap({ data }: { data: { date: string; minutes: number; sessions: number }[] }) {
    const getColor = (minutes: number): string => {
        if (minutes === 0) return 'bg-zinc-800/40';
        if (minutes < 15) return 'bg-violet-900/50';
        if (minutes < 30) return 'bg-violet-700/60';
        if (minutes < 60) return 'bg-violet-600/70';
        return 'bg-violet-500/80';
    };

    // 90-day grid: 13 columns x ~7 rows
    const weeks: typeof data[] = [];
    for (let i = 0; i < data.length; i += 7) {
        weeks.push(data.slice(i, i + 7));
    }

    return (
        <div className="flex gap-0.75 px-1 overflow-hidden">
            {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.75">
                    {week.map((day) => (
                        <div
                            key={day.date}
                            className={`w-2.75 h-2.75 rounded-xs ${getColor(day.minutes)} transition-colors`}
                            title={`${day.date}: ${day.minutes} min, ${day.sessions} sessions`}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

interface TodayPageProps {
    onOpenNote: (id: string) => void;
}

const PRIORITY_BADGE: Record<string, { label: string; class: string }> = {
    low: { label: 'Low', class: 'bg-zinc-700/50 text-zinc-400' },
    medium: { label: 'Med', class: 'bg-blue-900/40 text-blue-300' },
    high: { label: 'High', class: 'bg-amber-900/40 text-amber-300' },
    urgent: { label: 'Urgent', class: 'bg-red-900/40 text-red-300' },
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

export default function TodayPage({ onOpenNote: _onOpenNote }: TodayPageProps) {
    const { files, updateFile } = useSync();

    /* ── Today Store ─────────────────────────────────── */
    const {
        logStudyMinutes,
        getHeatmapData,
        getTodayMinutes,
        getStreak,
        brainDumpItems,
        addBrainDump,
        removeBrainDump,
        markBrainDumpProcessed,
        getTodayIntention,
        setIntention,
    } = useTodayStore();

    const questionLibraryEnabled = useFeature('question_library');
    const getDueQuestions = useQuestionStore((s) => s.getDueQuestions);
    const dueQuestions = useMemo(() => getDueQuestions(), [getDueQuestions]);

    const [dumpText, setDumpText] = useState('');
    const [intentionText, setIntentionText] = useState(() => getTodayIntention());
    const [intentionSaved, setIntentionSaved] = useState(!!getTodayIntention());
    const dumpInputRef = useRef<HTMLInputElement>(null);

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
                onClick={() => _onOpenNote(task.id)}
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

                {/* ── Daily Intention ────────────────────────────── */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2 px-1">
                        <Target size={13} className="text-violet-400" />
                        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-violet-400">
                            Today's Intention
                        </h3>
                    </div>
                    {intentionSaved ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
                            <span className="text-[13px] text-zinc-300 flex-1 italic">"{intentionText}"</span>
                            <button
                                onClick={() => setIntentionSaved(false)}
                                className="text-[11px] text-zinc-500 hover:text-violet-400 transition-colors cursor-pointer"
                            >
                                Edit
                            </button>
                        </div>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (intentionText.trim()) {
                                    setIntention(intentionText.trim());
                                    setIntentionSaved(true);
                                }
                            }}
                            className="flex items-center gap-2"
                        >
                            <input
                                type="text"
                                value={intentionText}
                                onChange={(e) => setIntentionText(e.target.value)}
                                placeholder="What's your main focus today?"
                                className="flex-1 bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/40 transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={!intentionText.trim()}
                                className="px-3 py-2 bg-violet-600/20 text-violet-300 text-[12px] font-medium rounded-lg hover:bg-violet-600/30 disabled:opacity-40 transition-colors cursor-pointer"
                            >
                                Set
                            </button>
                        </form>
                    )}
                </div>

                {/* ── Study Heatmap ──────────────────────────────── */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2 px-1">
                        <Flame size={13} className="text-orange-400" />
                        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-orange-400">
                            Study Activity
                        </h3>
                        <span className="text-[11px] text-zinc-500 font-mono ml-auto">
                            {getStreak()} day streak · {getTodayMinutes()} min today
                        </span>
                    </div>
                    <StudyHeatmap data={getHeatmapData()} />
                </div>

                {/* ── Brain Dump ─────────────────────────────────── */}
                <div className="mb-6">
                    <div className="flex items-center gap-2 mb-2 px-1">
                        <Zap size={13} className="text-amber-400" />
                        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-amber-400">
                            Brain Dump
                        </h3>
                        <span className="text-[11px] text-zinc-600 font-mono ml-1">
                            {brainDumpItems.filter((b) => !b.processed).length}
                        </span>
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (dumpText.trim()) {
                                addBrainDump(dumpText.trim());
                                setDumpText('');
                                dumpInputRef.current?.focus();
                            }
                        }}
                        className="flex items-center gap-2 mb-2"
                    >
                        <input
                            ref={dumpInputRef}
                            type="text"
                            value={dumpText}
                            onChange={(e) => setDumpText(e.target.value)}
                            placeholder="Quick thought, idea, or task…"
                            className="flex-1 bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-amber-500/40 transition-colors"
                        />
                        <button
                            type="submit"
                            disabled={!dumpText.trim()}
                            className="p-2 bg-amber-600/20 text-amber-300 rounded-lg hover:bg-amber-600/30 disabled:opacity-40 transition-colors cursor-pointer"
                        >
                            <Send size={14} />
                        </button>
                    </form>
                    {brainDumpItems.filter((b) => !b.processed).length > 0 && (
                        <div className="space-y-1">
                            {brainDumpItems
                                .filter((b) => !b.processed)
                                .slice(0, 10)
                                .map((item) => (
                                    <div
                                        key={item.id}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-800/40 transition-colors group"
                                    >
                                        <span className="text-[13px] text-zinc-400 flex-1 truncate">
                                            {item.text}
                                        </span>
                                        <button
                                            onClick={() => markBrainDumpProcessed(item.id)}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 text-green-400 hover:text-green-300 transition-all cursor-pointer"
                                            title="Mark processed"
                                        >
                                            <Check size={12} />
                                        </button>
                                        <button
                                            onClick={() => removeBrainDump(item.id)}
                                            className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-500 hover:text-red-400 transition-all cursor-pointer"
                                            title="Remove"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>

                {/* ── Question Digest ────────────────────────────── */}
                {questionLibraryEnabled && dueQuestions.length > 0 && (
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-2 px-1">
                            <HelpCircle size={13} className="text-sky-400" />
                            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-sky-400">
                                Questions Due
                            </h3>
                            <span className="text-[11px] text-zinc-600 font-mono ml-1">
                                {dueQuestions.length}
                            </span>
                        </div>
                        <div className="space-y-1">
                            {dueQuestions.slice(0, 5).map((q) => (
                                <div
                                    key={q.id}
                                    className="px-3 py-2 rounded-lg bg-sky-500/5 border border-sky-500/10"
                                >
                                    <p className="text-[13px] text-zinc-300">{q.question}</p>
                                    <p className="text-[11px] text-zinc-500 mt-0.5">
                                        {q.difficulty} · streak {q.streak}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="h-px bg-zinc-800/40 my-4" />

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
                                onClick={() => _onOpenNote(n.id)}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-violet-500/5 transition-colors duration-150 text-left group cursor-pointer"
                            >
                                <span className="text-[13px]"><NoteTypeIcon type={n.type} size={13} /></span>
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
