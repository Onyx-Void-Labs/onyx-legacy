/* ------------------------------------------------------------------ */
/*  CalendarService — IndexedDB CRUD for calendar events               */
/* ------------------------------------------------------------------ */

const DB_NAME = 'onyx_calendar';
const DB_VERSION = 1;
const STORE_NAME = 'events';

export interface CalendarEvent {
    id: string;
    title: string;
    date: string;          // YYYY-MM-DD
    startTime?: string;    // HH:MM (24h)
    endTime?: string;      // HH:MM (24h)
    color: EventColor;
    description?: string;
    isAllDay: boolean;
}

export type EventColor = 'emerald' | 'blue' | 'amber' | 'red' | 'violet' | 'pink' | 'cyan';

export const EVENT_COLORS: { value: EventColor; label: string; bg: string; border: string; text: string; dot: string }[] = [
    { value: 'emerald', label: 'Green',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' },
    { value: 'blue',    label: 'Blue',   bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400',    dot: 'bg-blue-400' },
    { value: 'amber',   label: 'Amber',  bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400',   dot: 'bg-amber-400' },
    { value: 'red',     label: 'Red',    bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400',     dot: 'bg-red-400' },
    { value: 'violet',  label: 'Violet', bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  text: 'text-violet-400',  dot: 'bg-violet-400' },
    { value: 'pink',    label: 'Pink',   bg: 'bg-pink-500/10',    border: 'border-pink-500/20',    text: 'text-pink-400',    dot: 'bg-pink-400' },
    { value: 'cyan',    label: 'Cyan',   bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-400',    dot: 'bg-cyan-400' },
];

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('date', 'date', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllEvents(): Promise<CalendarEvent[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as CalendarEvent[]);
        req.onerror = () => reject(req.error);
    });
}

export async function getEventsForDate(date: string): Promise<CalendarEvent[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index('date');
        const req = idx.getAll(date);
        req.onsuccess = () => resolve(req.result as CalendarEvent[]);
        req.onerror = () => reject(req.error);
    });
}

export async function getEventsForMonth(year: number, month: number): Promise<CalendarEvent[]> {
    const mm = String(month + 1).padStart(2, '0');
    const prefix = `${year}-${mm}`;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index('date');
        const range = IDBKeyRange.bound(`${prefix}-01`, `${prefix}-31`);
        const req = idx.getAll(range);
        req.onsuccess = () => resolve(req.result as CalendarEvent[]);
        req.onerror = () => reject(req.error);
    });
}

export async function createEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    const db = await openDB();
    const full: CalendarEvent = { ...event, id: crypto.randomUUID() };
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add(full);
        req.onsuccess = () => resolve(full);
        req.onerror = () => reject(req.error);
    });
}

export async function updateEvent(event: CalendarEvent): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(event);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function deleteEvent(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
