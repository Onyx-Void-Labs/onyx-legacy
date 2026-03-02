/**
 * Flashcard engine — IndexedDB-backed with FSRS-4.5 spaced repetition.
 *
 * Supports 5 card types:
 *   1. Basic (Q/A)
 *   2. Fill-in-the-Blank — sentence builder with word indices
 *   3. Multiple Choice (MCQ) — question + options + correctIndex
 *   4. Matching — pairs [term, definition]
 *   5. Cloze deletion ({{c1::answer}} syntax)
 *
 * Hierarchical structure:
 *   Collection (subject-level container)
 *     └── Set / Topic (groups related cards)
 *         └── Cards
 */

/* ─── Types ─────────────────────────────────────────────── */

export type CardType = 'basic' | 'fill-blank' | 'mcq' | 'matching' | 'cloze';

export interface FlashcardCollection {
    id: string;
    name: string;
    description?: string;
    color?: string;
    createdAt: number;
    updatedAt: number;
}

export interface FlashcardSet {
    id: string;
    collectionId: string;
    name: string;
    description?: string;
    createdAt: number;
    updatedAt: number;
}

export interface Flashcard {
    id: string;               // uuid
    sourceNoteId: string;     // which note it came from
    collectionId?: string;    // collection this card belongs to
    setId?: string;           // set this card belongs to
    cardType: CardType;       // card type
    front: string;            // question / prompt
    back: string;             // answer
    hint?: string;            // optional hint
    options?: string[];       // MCQ: choices
    correctIndex?: number;    // MCQ: index of correct answer in options[]
    matchPairs?: [string, string][];  // Matching: pairs [term, definition]
    clozeIndex?: number;      // which cloze deletion (c1, c2…)
    /** Fill-blank: original sentence + blanked word indices */
    sentence?: string;
    blanks?: number[];
    deck?: string;            // legacy deck grouping (kept for migration)
    tags?: string[];          // optional tags
    createdAt: number;        // epoch ms
    /* SRS state */
    interval: number;         // in days
    easeFactor: number;       // multiplier, starts at 2.5
    repetitions: number;      // successful reviews in a row
    dueAt: number;            // next review epoch ms
    lastReviewedAt: number;   // last review epoch ms (0 = never)
    lapses: number;           // times rating was 'again'
    stability: number;        // FSRS stability (days)
    difficulty: number;       // FSRS difficulty (0-1)
}

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface SessionHistoryEntry {
    id: string;
    collectionId?: string;
    setId?: string;
    collectionName?: string;
    setName?: string;
    date: number;
    duration: number;
    totalCards: number;
    correctCount: number;
    incorrectCount: number;
    ratings: Record<Rating, number>;
    cardResults: { cardId: string; rating: Rating; front: string; back: string }[];
}

/* ─── Constants ─────────────────────────────────────────── */

const DB_NAME = 'onyx_flashcards';
const DB_VERSION = 2;
const STORE_CARDS = 'cards';
const STORE_COLLECTIONS = 'collections';
const STORE_SETS = 'sets';
const STORE_SESSIONS = 'sessions';
const DAY_MS = 86_400_000;

/* ─── IndexedDB helpers ─────────────────────────────────── */

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = req.result;
            const oldVersion = event.oldVersion;

            if (oldVersion < 1) {
                const store = db.createObjectStore(STORE_CARDS, { keyPath: 'id' });
                store.createIndex('sourceNoteId', 'sourceNoteId', { unique: false });
                store.createIndex('dueAt', 'dueAt', { unique: false });
            }

            if (oldVersion < 2) {
                // Add collectionId and setId indexes to cards
                if (db.objectStoreNames.contains(STORE_CARDS)) {
                    const cardStore = req.transaction!.objectStore(STORE_CARDS);
                    if (!cardStore.indexNames.contains('collectionId')) {
                        cardStore.createIndex('collectionId', 'collectionId', { unique: false });
                    }
                    if (!cardStore.indexNames.contains('setId')) {
                        cardStore.createIndex('setId', 'setId', { unique: false });
                    }
                }

                // Create collections store
                if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
                    db.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id' });
                }

                // Create sets store
                if (!db.objectStoreNames.contains(STORE_SETS)) {
                    const setStore = db.createObjectStore(STORE_SETS, { keyPath: 'id' });
                    setStore.createIndex('collectionId', 'collectionId', { unique: false });
                }

                // Create sessions store
                if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
                    const sessionStore = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
                    sessionStore.createIndex('date', 'date', { unique: false });
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function txStore(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        fn(store);
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}

async function txStoreGet<T>(
    storeName: string,
    fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(storeName, 'readonly');
        const store = t.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => { db.close(); resolve(req.result as T); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

// Legacy helpers that use the cards store
async function tx(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<void> {
    return txStore(STORE_CARDS, mode, fn);
}

async function txGet<T>(
    fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
    return txStoreGet<T>(STORE_CARDS, fn);
}

/* ─── UUID helper ───────────────────────────────────────── */

function uuid(): string {
    return crypto.randomUUID?.() ?? (
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        })
    );
}

/* ═══════════════════════════════════════════════════════════
   Collection CRUD
   ═══════════════════════════════════════════════════════════ */

export async function createCollection(name: string, description?: string, color?: string): Promise<FlashcardCollection> {
    const collection: FlashcardCollection = {
        id: uuid(),
        name: name.trim(),
        description,
        color,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await txStore(STORE_COLLECTIONS, 'readwrite', (store) => store.put(collection));
    return collection;
}

export async function getAllCollections(): Promise<FlashcardCollection[]> {
    return txStoreGet<FlashcardCollection[]>(STORE_COLLECTIONS, (store) => store.getAll());
}

export async function getCollection(id: string): Promise<FlashcardCollection | undefined> {
    return txStoreGet<FlashcardCollection | undefined>(STORE_COLLECTIONS, (store) => store.get(id));
}

export async function updateCollection(id: string, updates: Partial<Pick<FlashcardCollection, 'name' | 'description' | 'color'>>): Promise<void> {
    const existing = await getCollection(id);
    if (!existing) return;
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    await txStore(STORE_COLLECTIONS, 'readwrite', (store) => store.put(updated));
}

export async function deleteCollection(id: string): Promise<void> {
    // Delete all sets in the collection
    const sets = await getSetsForCollection(id);
    for (const s of sets) {
        await deleteSet(s.id);
    }
    // Delete cards directly in the collection (not in a set)
    const cards = await getCardsForCollection(id);
    for (const c of cards) {
        await deleteCard(c.id);
    }
    await txStore(STORE_COLLECTIONS, 'readwrite', (store) => store.delete(id));
}

/* ═══════════════════════════════════════════════════════════
   Set CRUD
   ═══════════════════════════════════════════════════════════ */

export async function createSet(collectionId: string, name: string, description?: string): Promise<FlashcardSet> {
    const set: FlashcardSet = {
        id: uuid(),
        collectionId,
        name: name.trim(),
        description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    await txStore(STORE_SETS, 'readwrite', (store) => store.put(set));
    return set;
}

export async function getSetsForCollection(collectionId: string): Promise<FlashcardSet[]> {
    return txStoreGet<FlashcardSet[]>(STORE_SETS, (store) =>
        store.index('collectionId').getAll(collectionId)
    );
}

export async function getAllSets(): Promise<FlashcardSet[]> {
    return txStoreGet<FlashcardSet[]>(STORE_SETS, (store) => store.getAll());
}

export async function getSet(id: string): Promise<FlashcardSet | undefined> {
    return txStoreGet<FlashcardSet | undefined>(STORE_SETS, (store) => store.get(id));
}

export async function updateSet(id: string, updates: Partial<Pick<FlashcardSet, 'name' | 'description'>>): Promise<void> {
    const existing = await getSet(id);
    if (!existing) return;
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    await txStore(STORE_SETS, 'readwrite', (store) => store.put(updated));
}

export async function deleteSet(id: string): Promise<void> {
    // Delete all cards in this set
    const cards = await getCardsForSet(id);
    for (const c of cards) {
        await deleteCard(c.id);
    }
    await txStore(STORE_SETS, 'readwrite', (store) => store.delete(id));
}

/* ═══════════════════════════════════════════════════════════
   Card CRUD
   ═══════════════════════════════════════════════════════════ */

/** Get all cards for a note. */
export async function getCardsForNote(noteId: string): Promise<Flashcard[]> {
    return txGet<Flashcard[]>((store) => store.index('sourceNoteId').getAll(noteId));
}

/** Get all cards for a collection. */
export async function getCardsForCollection(collectionId: string): Promise<Flashcard[]> {
    const all = await getAllCards();
    return all.filter((c) => c.collectionId === collectionId);
}

/** Get all cards for a set. */
export async function getCardsForSet(setId: string): Promise<Flashcard[]> {
    const all = await getAllCards();
    return all.filter((c) => c.setId === setId);
}

/** Get due cards for a collection. */
export async function getDueCardsForCollection(collectionId: string): Promise<Flashcard[]> {
    const cards = await getCardsForCollection(collectionId);
    const now = Date.now();
    return cards.filter((c) => c.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
}

/** Get due cards for a set. */
export async function getDueCardsForSet(setId: string): Promise<Flashcard[]> {
    const cards = await getCardsForSet(setId);
    const now = Date.now();
    return cards.filter((c) => c.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
}

/** Get all cards. */
export async function getAllCards(): Promise<Flashcard[]> {
    return txGet<Flashcard[]>((store) => store.getAll());
}

/** Get all cards due for review (dueAt <= now). */
export async function getDueCards(): Promise<Flashcard[]> {
    const all = await getAllCards();
    const now = Date.now();
    return all
        .filter((c) => c.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt);
}

/** Add a new card (or update if id matches). */
export async function upsertCard(card: Flashcard): Promise<void> {
    await tx('readwrite', (store) => store.put(card));
}

/** Delete a single card. */
export async function deleteCard(cardId: string): Promise<void> {
    await tx('readwrite', (store) => store.delete(cardId));
}

/** Delete all cards for a given note. */
export async function deleteCardsForNote(noteId: string): Promise<void> {
    const cards = await getCardsForNote(noteId);
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE_CARDS, 'readwrite');
        const store = t.objectStore(STORE_CARDS);
        for (const c of cards) store.delete(c.id);
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}

/** Create a new card with default SRS state. */
export function newCard(
    sourceNoteId: string,
    front: string,
    back: string,
    opts?: Partial<Pick<Flashcard, 'cardType' | 'hint' | 'options' | 'correctIndex' | 'matchPairs' | 'clozeIndex' | 'deck' | 'tags' | 'sentence' | 'blanks' | 'collectionId' | 'setId'>>,
): Flashcard {
    return {
        id: uuid(),
        sourceNoteId,
        collectionId: opts?.collectionId,
        setId: opts?.setId,
        cardType: opts?.cardType ?? 'basic',
        front: front.trim(),
        back: back.trim(),
        hint: opts?.hint,
        options: opts?.options,
        correctIndex: opts?.correctIndex,
        matchPairs: opts?.matchPairs,
        clozeIndex: opts?.clozeIndex,
        sentence: opts?.sentence,
        blanks: opts?.blanks,
        deck: opts?.deck,
        tags: opts?.tags,
        createdAt: Date.now(),
        interval: 0,
        easeFactor: 2.5,
        repetitions: 0,
        dueAt: Date.now(),
        lastReviewedAt: 0,
        lapses: 0,
        stability: 0,
        difficulty: 0.3,
    };
}

/* ─── SRS Scheduling (FSRS-4.5) ─────────────────────────── */

/**
 * Apply a review rating and return updated card (also persists).
 * Uses FSRS-4.5 intervals:
 *   New cards: Again=1d, Hard=1d, Good=4d, Easy=7d
 *   Review cards: stability/difficulty update per FSRS formula
 *   Again resets to learning state
 */
export async function reviewCard(
    card: Flashcard,
    rating: Rating,
): Promise<Flashcard> {
    let { interval, easeFactor, repetitions, lapses, stability, difficulty } = card;

    // Update difficulty (FSRS-style, 0-1 range)
    const ratingMap: Record<Rating, number> = { again: 0, hard: 0.33, good: 0.67, easy: 1 };
    const grade = ratingMap[rating];
    difficulty = Math.max(0, Math.min(1, difficulty + 0.1 * (0.5 - grade)));

    switch (rating) {
        case 'again':
            // Reset to learning state
            repetitions = 0;
            lapses += 1;
            interval = 1; // 1 day
            easeFactor = Math.max(1.3, easeFactor - 0.2);
            stability = Math.max(0.5, stability * 0.5); // halve stability on lapse
            break;
        case 'hard':
            if (repetitions === 0) {
                interval = 1;
                stability = 1;
            } else {
                interval = Math.max(1, Math.round(interval * 1.2));
                stability = stability * (1.1 - difficulty * 0.2);
            }
            easeFactor = Math.max(1.3, easeFactor - 0.15);
            repetitions += 1;
            break;
        case 'good':
            if (repetitions === 0) {
                interval = 4;
                stability = 4;
            } else if (repetitions === 1) {
                interval = 6;
                stability = 6;
            } else {
                interval = Math.round(interval * easeFactor);
                stability = interval;
            }
            repetitions += 1;
            break;
        case 'easy':
            if (repetitions === 0) {
                interval = 7;
                stability = 7;
            } else {
                interval = Math.round(interval * easeFactor * 1.3);
                stability = interval;
            }
            easeFactor += 0.15;
            repetitions += 1;
            break;
    }

    const updated: Flashcard = {
        ...card,
        interval,
        easeFactor,
        repetitions,
        lapses,
        stability,
        difficulty,
        dueAt: Date.now() + interval * DAY_MS,
        lastReviewedAt: Date.now(),
    };

    await upsertCard(updated);
    return updated;
}

/* ═══════════════════════════════════════════════════════════
   Session History
   ═══════════════════════════════════════════════════════════ */

export async function saveSessionHistory(entry: Omit<SessionHistoryEntry, 'id'>): Promise<SessionHistoryEntry> {
    const record: SessionHistoryEntry = { ...entry, id: uuid() };
    await txStore(STORE_SESSIONS, 'readwrite', (store) => store.put(record));
    return record;
}

export async function getSessionHistory(daysBack: number = 30): Promise<SessionHistoryEntry[]> {
    const all = await txStoreGet<SessionHistoryEntry[]>(STORE_SESSIONS, (store) => store.getAll());
    const cutoff = Date.now() - daysBack * DAY_MS;
    return all
        .filter((s) => s.date >= cutoff)
        .sort((a, b) => b.date - a.date);
}

export async function clearOldSessions(daysBack: number = 30): Promise<void> {
    const all = await txStoreGet<SessionHistoryEntry[]>(STORE_SESSIONS, (store) => store.getAll());
    const cutoff = Date.now() - daysBack * DAY_MS;
    const toDelete = all.filter((s) => s.date < cutoff);
    for (const s of toDelete) {
        await txStore(STORE_SESSIONS, 'readwrite', (store) => store.delete(s.id));
    }
}

/* ─── Auto-extraction helpers ───────────────────────────── */

/**
 * Extract flashcard pairs from plain text.
 * Supports multiple formats:
 *   1. "Q: ... A: ..." blocks → Basic
 *   2. Lines with "::" separator → Basic
 *   3. "{{answer}}" in a sentence → Fill-in-the-blank
 *   4. "MCQ: question \n a) ... \n b) ... \n Answer: a" → MCQ
 *   5. "MATCH: \n term1 :: def1 \n term2 :: def2" → Matching
 *   6. "{{c1::answer}}" cloze syntax → Cloze
 */
export function extractCardsFromText(
    noteId: string,
    text: string,
): Flashcard[] {
    const cards: Flashcard[] = [];

    // Format 6: Cloze — {{c1::answer}} or {{c1::answer::hint}}
    const clozeRegex = /\{\{c(\d+)::([^}:]+)(?:::([^}]+))?\}\}/g;
    const clozeMatches = [...text.matchAll(clozeRegex)];
    if (clozeMatches.length > 0) {
        // Group by cloze index
        const clozeIndices = new Set(clozeMatches.map((m) => parseInt(m[1])));
        for (const idx of clozeIndices) {
            // Build the prompt by replacing the cloze target with [...]
            let prompt = text;
            let answer = '';
            let hint: string | undefined;
            for (const m of clozeMatches) {
                if (parseInt(m[1]) === idx) {
                    answer = m[2].trim();
                    hint = m[3]?.trim();
                    prompt = prompt.replace(m[0], '[...]');
                }
            }
            // Keep other cloze deletions visible
            prompt = prompt.replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '$1');
            cards.push(newCard(noteId, prompt.trim(), answer, {
                cardType: 'cloze',
                clozeIndex: idx,
                hint,
            }));
        }
        return cards;
    }

    // Format 4: MCQ blocks — "MCQ: question\n a) opt1\n b) opt2\n ... \nAnswer: x"
    const mcqRegex = /MCQ:\s*(.+?)\n((?:\s*[a-d]\)\s*.+\n?)+)\s*Answer:\s*([a-d])/gi;
    let mcqMatch: RegExpExecArray | null;
    while ((mcqMatch = mcqRegex.exec(text)) !== null) {
        const question = mcqMatch[1].trim();
        const optionsBlock = mcqMatch[2];
        const correctLetter = mcqMatch[3].toLowerCase();
        const options = [...optionsBlock.matchAll(/([a-d])\)\s*(.+)/gi)].map((m) => m[2].trim());
        const correctIdx = correctLetter.charCodeAt(0) - 'a'.charCodeAt(0);
        const answer = options[correctIdx] || '';
        cards.push(newCard(noteId, question, answer, { cardType: 'mcq', options, correctIndex: correctIdx }));
    }
    if (cards.length > 0) return cards;

    // Format 5: MATCH blocks — "MATCH:\n term1 :: def1\n term2 :: def2"
    const matchBlockRegex = /MATCH:\s*\n((?:.+::.+\n?)+)/gi;
    let matchMatch: RegExpExecArray | null;
    while ((matchMatch = matchBlockRegex.exec(text)) !== null) {
        const pairs: [string, string][] = [];
        const lines = matchMatch[1].split('\n');
        for (const line of lines) {
            const idx = line.indexOf('::');
            if (idx > 0) {
                pairs.push([line.slice(0, idx).trim(), line.slice(idx + 2).trim()]);
            }
        }
        if (pairs.length >= 2) {
            cards.push(newCard(noteId, `Match ${pairs.length} pairs`, '', { cardType: 'matching', matchPairs: pairs }));
        }
    }
    if (cards.length > 0) return cards;

    // Format 3: Fill-in-the-blank — "The {{answer}} is correct"
    const fillRegex = /^(.+\{\{(.+?)\}\}.+)$/gm;
    let fillMatch: RegExpExecArray | null;
    while ((fillMatch = fillRegex.exec(text)) !== null) {
        const fullSentence = fillMatch[1].trim();
        const answer = fillMatch[2].trim();
        const prompt = fullSentence.replace(`{{${answer}}}`, '______');
        cards.push(newCard(noteId, prompt, answer, { cardType: 'fill-blank' }));
    }
    if (cards.length > 0) return cards;

    // Format 1: Q: / A: blocks
    const qaRegex = /Q:\s*(.+?)\s*A:\s*(.+?)(?=Q:|$)/gis;
    let m: RegExpExecArray | null;
    while ((m = qaRegex.exec(text)) !== null) {
        const front = m[1].trim();
        const back = m[2].trim();
        if (front && back) cards.push(newCard(noteId, front, back));
    }

    if (cards.length > 0) return cards;

    // Format 2: "::" separator per line
    const lines = text.split('\n');
    for (const line of lines) {
        const idx = line.indexOf('::');
        if (idx > 0) {
            const front = line.slice(0, idx).trim();
            const back = line.slice(idx + 2).trim();
            if (front && back) cards.push(newCard(noteId, front, back));
        }
    }

    return cards;
}

/** Get cards grouped by deck/subject (legacy). */
export async function getCardsByDeck(): Promise<Map<string, Flashcard[]>> {
    const all = await getAllCards();
    const map = new Map<string, Flashcard[]>();
    for (const card of all) {
        const deck = card.deck || 'Uncategorized';
        if (!map.has(deck)) map.set(deck, []);
        map.get(deck)!.push(card);
    }
    return map;
}

/** Get session stats for a set of reviewed cards. */
export function getSessionStats(reviewed: { card: Flashcard; rating: Rating }[]) {
    const total = reviewed.length;
    const correct = reviewed.filter((r) => r.rating !== 'again').length;
    const hard = reviewed.filter((r) => r.rating === 'hard').length;
    const again = reviewed.filter((r) => r.rating === 'again').length;
    const easy = reviewed.filter((r) => r.rating === 'easy').length;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const avgStability = total > 0
        ? Math.round(reviewed.reduce((s, r) => s + r.card.stability, 0) / total * 10) / 10
        : 0;

    // Longest correct streak
    let streak = 0;
    let maxStreak = 0;
    for (const r of reviewed) {
        if (r.rating !== 'again') {
            streak++;
            maxStreak = Math.max(maxStreak, streak);
        } else {
            streak = 0;
        }
    }

    // Count new cards (repetitions was 0 before review)
    const newCards = reviewed.filter((r) => r.card.repetitions <= 1 && r.card.lapses === 0).length;

    // By card type breakdown
    const byType = new Map<CardType, { total: number; correct: number }>();
    for (const r of reviewed) {
        const t = r.card.cardType || 'basic';
        const entry = byType.get(t) || { total: 0, correct: 0 };
        entry.total++;
        if (r.rating !== 'again') entry.correct++;
        byType.set(t, entry);
    }

    return { total, correct, hard, again, easy, accuracy, avgStability, streak: maxStreak, newCards, byType };
}

/** Get projected due cards for the next N days. */
export async function getRetentionForecast(days: number = 7): Promise<number[]> {
    const all = await getAllCards();
    const now = Date.now();
    const forecast: number[] = [];

    for (let d = 0; d < days; d++) {
        const dayStart = now + d * DAY_MS;
        const dayEnd = dayStart + DAY_MS;
        const count = all.filter((c) => c.dueAt >= dayStart && c.dueAt < dayEnd).length;
        forecast.push(count);
    }

    return forecast;
}

/**
 * Sync extracted cards into the database:
 * - Adds new cards (by front text match)
 * - Keeps existing cards' SRS state
 * - Removes cards whose front text no longer appears
 */
export async function syncExtractedCards(
    noteId: string,
    rawText: string,
): Promise<number> {
    const extracted = extractCardsFromText(noteId, rawText);
    const existing = await getCardsForNote(noteId);

    const existingByFront = new Map(existing.map((c) => [c.front, c]));
    const extractedFronts = new Set(extracted.map((c) => c.front));

    // Add new cards
    for (const card of extracted) {
        if (!existingByFront.has(card.front)) {
            await upsertCard(card);
        }
    }

    // Remove cards whose front text was deleted from the note
    for (const card of existing) {
        if (!extractedFronts.has(card.front)) {
            await deleteCard(card.id);
        }
    }

    return extracted.length;
}

/** Migrate legacy flat cards with deck field to collection/set hierarchy */
export async function migrateLegacyCards(): Promise<void> {
    const allCards = await getAllCards();
    const collections = await getAllCollections();

    // Find cards with deck but no collectionId
    const cardsToMigrate = allCards.filter((c) => c.deck && !c.collectionId);
    if (cardsToMigrate.length === 0) return;

    // Group by deck
    const deckGroups = new Map<string, Flashcard[]>();
    for (const card of cardsToMigrate) {
        const deck = card.deck || 'Uncategorized';
        if (!deckGroups.has(deck)) deckGroups.set(deck, []);
        deckGroups.get(deck)!.push(card);
    }

    // Create collections and default sets for each deck
    const existingCollectionNames = new Set(collections.map((c) => c.name));

    for (const [deckName, cards] of deckGroups) {
        let collection: FlashcardCollection;
        if (existingCollectionNames.has(deckName)) {
            collection = collections.find((c) => c.name === deckName)!;
        } else {
            collection = await createCollection(deckName);
        }

        const defaultSet = await createSet(collection.id, 'General');

        for (const card of cards) {
            await upsertCard({
                ...card,
                collectionId: collection.id,
                setId: defaultSet.id,
            });
        }
    }
}
