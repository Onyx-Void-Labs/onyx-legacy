import { ChevronLeft, ChevronRight, Clock, Plus, X, Trash2 } from 'lucide-react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    type CalendarEvent,
    type EventColor,
    EVENT_COLORS,
    getAllEvents,
    createEvent,
    updateEvent,
    deleteEvent,
} from '../../services/CalendarService';

// ─── Calendar View ───────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
}

function dateString(y: number, m: number, d: number): string {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatTime12(t: string): string {
    const [h, min] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(min).padStart(2, '0')} ${ampm}`;
}

function colorFor(c: EventColor) {
    return EVENT_COLORS.find((ec) => ec.value === c) ?? EVENT_COLORS[0];
}

/* ------------------------------------------------------------------ */
/*  Event Dialog                                                       */
/* ------------------------------------------------------------------ */

interface EventDialogProps {
    initial?: CalendarEvent;
    defaultDate: string;
    onSave: (ev: Omit<CalendarEvent, 'id'> & { id?: string }) => void;
    onDelete?: () => void;
    onClose: () => void;
}

function EventDialog({ initial, defaultDate, onSave, onDelete, onClose }: EventDialogProps) {
    const [title, setTitle] = useState(initial?.title ?? '');
    const [date, setDate] = useState(initial?.date ?? defaultDate);
    const [startTime, setStartTime] = useState(initial?.startTime ?? '09:00');
    const [endTime, setEndTime] = useState(initial?.endTime ?? '10:00');
    const [color, setColor] = useState<EventColor>(initial?.color ?? 'emerald');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [isAllDay, setIsAllDay] = useState(initial?.isAllDay ?? false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const handleSubmit = () => {
        if (!title.trim()) return;
        onSave({
            ...(initial ? { id: initial.id } : {}),
            title: title.trim(),
            date,
            startTime: isAllDay ? undefined : startTime,
            endTime: isAllDay ? undefined : endTime,
            color,
            description: description.trim() || undefined,
            isAllDay,
        });
    };

    const INPUT =
        'w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/50 transition-colors';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-96 bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                    <h3 className="text-sm font-semibold text-zinc-200">
                        {initial ? 'Edit Event' : 'New Event'}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 cursor-pointer">
                        <X size={14} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-3">
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Event title"
                        className={INPUT}
                        autoFocus
                    />

                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />

                    <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isAllDay}
                            onChange={(e) => setIsAllDay(e.target.checked)}
                            className="accent-emerald-500"
                        />
                        All day
                    </label>

                    {!isAllDay && (
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Start</label>
                                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} />
                            </div>
                            <div className="flex-1">
                                <label className="text-[10px] text-zinc-500 uppercase tracking-wider">End</label>
                                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT} />
                            </div>
                        </div>
                    )}

                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        className={INPUT + ' resize-y min-h-10'}
                    />

                    {/* Color picker */}
                    <div>
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Color</label>
                        <div className="flex gap-1.5">
                            {EVENT_COLORS.map((ec) => (
                                <button
                                    key={ec.value}
                                    onClick={() => setColor(ec.value)}
                                    className={`w-7 h-7 rounded-full ${ec.dot} cursor-pointer transition-all ${
                                        color === ec.value
                                            ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-white/40 scale-110'
                                            : 'opacity-50 hover:opacity-80'
                                    }`}
                                    title={ec.label}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800">
                    <div>
                        {initial && onDelete && (
                            confirmDelete ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-red-400">Delete?</span>
                                    <button
                                        onClick={onDelete}
                                        className="text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
                                    >
                                        Yes
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelete(false)}
                                        className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                                    >
                                        No
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setConfirmDelete(true)}
                                    className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                                >
                                    <Trash2 size={12} />
                                    Delete
                                </button>
                            )
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!title.trim()}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {initial ? 'Save' : 'Create'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Main CalendarView Component                                        */
/* ------------------------------------------------------------------ */

interface CalendarViewProps {
    sidebarCollapsed?: boolean;
}

export default function CalendarView({ sidebarCollapsed = false }: CalendarViewProps) {
    const today = new Date();
    const todayStr = dateString(today.getFullYear(), today.getMonth(), today.getDate());

    const [currentMonth, setCurrentMonth] = useState(today.getMonth());
    const [currentYear, setCurrentYear] = useState(today.getFullYear());
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [dialogState, setDialogState] = useState<
        | { mode: 'create'; date: string }
        | { mode: 'edit'; event: CalendarEvent }
        | null
    >(null);

    /* Load events */
    const loadEvents = useCallback(async () => {
        try {
            const all = await getAllEvents();
            setEvents(all);
        } catch (err) {
            console.error('Failed to load calendar events:', err);
        }
    }, []);

    useEffect(() => {
        loadEvents();
    }, [loadEvents]);

    /* Event map: date → events[] */
    const eventsByDate = useMemo(() => {
        const map = new Map<string, CalendarEvent[]>();
        for (const ev of events) {
            const list = map.get(ev.date) ?? [];
            list.push(ev);
            map.set(ev.date, list);
        }
        // Sort each day's events by startTime
        for (const list of map.values()) {
            list.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
        }
        return map;
    }, [events]);

    /* Today's events */
    const todayEvents = useMemo(() => eventsByDate.get(todayStr) ?? [], [eventsByDate, todayStr]);

    /* Grid helpers */
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
    const isToday = (day: number) =>
        day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();

    const prevMonth = () => {
        if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
        else setCurrentMonth((m) => m - 1);
    };

    const nextMonth = () => {
        if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
        else setCurrentMonth((m) => m + 1);
    };

    const goToToday = () => {
        setCurrentMonth(today.getMonth());
        setCurrentYear(today.getFullYear());
    };

    /* CRUD handlers */
    const handleSave = async (ev: Omit<CalendarEvent, 'id'> & { id?: string }) => {
        try {
            if (ev.id) {
                await updateEvent(ev as CalendarEvent);
            } else {
                await createEvent(ev);
            }
            await loadEvents();
            setDialogState(null);
        } catch (err) {
            console.error('Failed to save event:', err);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteEvent(id);
            await loadEvents();
            setDialogState(null);
        } catch (err) {
            console.error('Failed to delete event:', err);
        }
    };

    // Build the grid cells
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
        <div className="flex h-full overflow-hidden">
            {/* Calendar Sidebar (Agenda) */}
            <div
                className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
                    sidebarCollapsed
                        ? 'w-0 opacity-0 border-none'
                        : 'w-64 opacity-100 border-r border-zinc-800/30'
                }`}
            >
                <div className="w-64 h-full flex flex-col bg-zinc-900/60">
                    <div className="h-12 px-4 flex items-center gap-2 border-b border-zinc-800/30 shrink-0">
                        <Clock size={16} className="text-emerald-400" />
                        <span className="text-sm font-semibold text-zinc-200">Today's Agenda</span>
                        <span className="ml-auto text-[10px] text-zinc-600">
                            {todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''}
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {todayEvents.length === 0 && (
                            <div className="text-center text-zinc-600 text-xs py-6">
                                No events today
                            </div>
                        )}
                        {todayEvents.map((ev) => {
                            const c = colorFor(ev.color);
                            return (
                                <button
                                    key={ev.id}
                                    onClick={() => setDialogState({ mode: 'edit', event: ev })}
                                    className={`w-full text-left p-3 rounded-lg ${c.bg} border ${c.border} space-y-1 hover:brightness-110 transition-all cursor-pointer`}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                                        <span className={`text-xs ${c.text} font-medium`}>
                                            {ev.isAllDay
                                                ? 'All Day'
                                                : ev.startTime
                                                  ? formatTime12(ev.startTime)
                                                  : ''}
                                        </span>
                                    </div>
                                    <span className="text-sm text-zinc-300 block pl-4 truncate">
                                        {ev.title}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Quick-add for today */}
                    <div className="border-t border-zinc-800/30 p-3 shrink-0">
                        <button
                            onClick={() => setDialogState({ mode: 'create', date: todayStr })}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700/50 text-xs text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/30 transition-colors cursor-pointer"
                        >
                            <Plus size={14} />
                            Add event for today
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Calendar Grid */}
            <div className="flex-1 flex flex-col bg-zinc-950/50 overflow-hidden relative">
                {/* Header */}
                <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-800/30 shrink-0">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-zinc-100">
                            {MONTHS[currentMonth]}{' '}
                            <span className="text-zinc-500 font-normal">{currentYear}</span>
                        </h2>
                        <button
                            onClick={goToToday}
                            className="text-xs font-medium text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded-md hover:bg-emerald-500/10 transition-colors cursor-pointer"
                        >
                            Today
                        </button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={prevMonth}
                            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={nextMonth}
                            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 border-b border-zinc-800/30 shrink-0">
                    {DAYS.map((day) => (
                        <div
                            key={day}
                            className="py-2 text-center text-xs font-semibold text-zinc-600 uppercase tracking-wider"
                        >
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar grid */}
                <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-hidden">
                    {cells.map((day, i) => {
                        const ds = day ? dateString(currentYear, currentMonth, day) : '';
                        const dayEvents = ds ? eventsByDate.get(ds) ?? [] : [];
                        return (
                            <div
                                key={i}
                                onClick={() => {
                                    if (day) setDialogState({ mode: 'create', date: ds });
                                }}
                                className={`
                                    border-b border-r border-zinc-800/20 p-1 min-h-0 overflow-hidden
                                    ${day ? 'hover:bg-zinc-800/20 cursor-pointer transition-colors' : ''}
                                `}
                            >
                                {day && (
                                    <>
                                        <div
                                            className={`
                                                w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium mb-0.5
                                                ${
                                                    isToday(day)
                                                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                                                        : 'text-zinc-400'
                                                }
                                            `}
                                        >
                                            {day}
                                        </div>
                                        {/* Event pills (max 3 visible, +N more) */}
                                        <div className="space-y-0.5">
                                            {dayEvents.slice(0, 3).map((ev) => {
                                                const c = colorFor(ev.color);
                                                return (
                                                    <button
                                                        key={ev.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDialogState({ mode: 'edit', event: ev });
                                                        }}
                                                        className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] truncate ${c.bg} ${c.text} ${c.border} border hover:brightness-125 transition-all cursor-pointer`}
                                                        title={ev.title}
                                                    >
                                                        {!ev.isAllDay && ev.startTime && (
                                                            <span className="opacity-70 mr-1">
                                                                {ev.startTime}
                                                            </span>
                                                        )}
                                                        {ev.title}
                                                    </button>
                                                );
                                            })}
                                            {dayEvents.length > 3 && (
                                                <div className="text-[9px] text-zinc-500 pl-1">
                                                    +{dayEvents.length - 3} more
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Event Dialog */}
            {dialogState && (
                <EventDialog
                    initial={dialogState.mode === 'edit' ? dialogState.event : undefined}
                    defaultDate={dialogState.mode === 'create' ? dialogState.date : dialogState.event.date}
                    onSave={handleSave}
                    onDelete={
                        dialogState.mode === 'edit'
                            ? () => handleDelete(dialogState.event.id)
                            : undefined
                    }
                    onClose={() => setDialogState(null)}
                />
            )}
        </div>
    );
}
