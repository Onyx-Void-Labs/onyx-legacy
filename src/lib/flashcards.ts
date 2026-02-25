/**
 * Flashcard engine — IndexedDB-backed with FSRS-4.5 spaced repetition.
 *
 * Supports 5 card types:
 *   1. Basic (Q/A)
 *   2. Fill-in-the-Blank — sentence builder with word indices
 *   3. Multiple Choice (MCQ) — question + options + correctIndex
 *   4. Matching — pairs [term, definition]
 *   5. Cloze deletion ({{c1::answer}} syntax)
 */

/* ─── Types ─────────────────────────────────────────────── */

export type CardType = 'basic' | 'fill-blank' | 'mcq' | 'matching' | 'cloze';

export interface Flashcard {
    id: string;               // uuid
    sourceNoteId: string;     // which note it came from
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
    deck?: string;            // deck/subject grouping
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

/* ─── Constants ─────────────────────────────────────────── */

const DB_NAME = 'onyx_flashcards';
const DB_VERSION = 1;
const STORE = 'cards';
const DAY_MS = 86_400_000;

/* ─── IndexedDB helpers ─────────────────────────────────── */

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex('sourceNoteId', 'sourceNoteId', { unique: false });
                store.createIndex('dueAt', 'dueAt', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function tx(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        fn(store);
        t.oncomplete = () => { db.close(); resolve(); };
        t.onerror = () => { db.close(); reject(t.error); };
    });
}

async function txGet<T>(
    fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const store = t.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => { db.close(); resolve(req.result as T); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
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

/* ─── Public API ────────────────────────────────────────── */

/** Get all cards for a note. */
export async function getCardsForNote(noteId: string): Promise<Flashcard[]> {
    return txGet<Flashcard[]>((store) => store.index('sourceNoteId').getAll(noteId));
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
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
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
    opts?: Partial<Pick<Flashcard, 'cardType' | 'hint' | 'options' | 'correctIndex' | 'matchPairs' | 'clozeIndex' | 'deck' | 'tags' | 'sentence' | 'blanks'>>,
): Flashcard {
    return {
        id: uuid(),
        sourceNoteId,
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

/** Get cards grouped by deck/subject. */
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
