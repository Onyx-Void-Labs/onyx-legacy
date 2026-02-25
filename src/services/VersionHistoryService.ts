/**
 * VersionHistoryService — stores Y.Doc snapshots in IndexedDB for version history.
 *
 * Each snapshot is a compressed binary encoding of the Y.Doc state at a point in time.
 * Snapshots are taken:
 *   - On explicit "Save Version" action
 *   - Periodically (auto-snapshot every N minutes of editing)
 *
 * Storage: IndexedDB store 'doc_snapshots' keyed by auto-incremented id,
 *   indexed on noteId + timestamp.
 */

/* ─── Types ─────────────────────────────────────────────── */

export interface DocSnapshot {
    id: number;
    noteId: string;
    label: string;
    timestamp: number;
    /** Y.Doc binary state as Uint8Array */
    state: Uint8Array;
    /** Text-only preview of the document (first ~200 chars) */
    preview: string;
    /** Word count at time of snapshot */
    wordCount: number;
}

/* ─── Constants ─────────────────────────────────────────── */

const DB_NAME = 'onyx_version_history';
const DB_VERSION = 1;
const STORE_NAME = 'doc_snapshots';
const MAX_SNAPSHOTS_PER_NOTE = 50;

/* ─── IndexedDB helpers ─────────────────────────────────── */

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                store.createIndex('noteId', 'noteId', { unique: false });
                store.createIndex('noteId_timestamp', ['noteId', 'timestamp'], {
                    unique: false,
                });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/* ─── Public API ────────────────────────────────────────── */

/**
 * Save a snapshot of a Y.Doc state.
 */
export async function saveSnapshot(
    noteId: string,
    state: Uint8Array,
    label: string,
    preview: string,
    wordCount: number,
): Promise<DocSnapshot> {
    const db = await openDB();

    const snapshot: Omit<DocSnapshot, 'id'> = {
        noteId,
        label,
        timestamp: Date.now(),
        state,
        preview: preview.slice(0, 200),
        wordCount,
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const addReq = store.add(snapshot);

        addReq.onsuccess = () => {
            const saved: DocSnapshot = { ...snapshot, id: addReq.result as number };
            db.close();
            resolve(saved);
        };

        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Get all snapshots for a note, ordered by most recent first.
 */
export async function getSnapshots(noteId: string): Promise<DocSnapshot[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('noteId');
        const req = index.getAll(noteId);

        req.onsuccess = () => {
            db.close();
            const results = (req.result as DocSnapshot[]).sort(
                (a, b) => b.timestamp - a.timestamp,
            );
            resolve(results);
        };

        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * Get a single snapshot by ID.
 */
export async function getSnapshot(id: number): Promise<DocSnapshot | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);

        req.onsuccess = () => {
            db.close();
            resolve(req.result as DocSnapshot | undefined);
        };

        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

/**
 * Delete a snapshot.
 */
export async function deleteSnapshot(id: number): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);

        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Prune old snapshots, keeping only the most recent MAX_SNAPSHOTS_PER_NOTE.
 */
export async function pruneSnapshots(noteId: string): Promise<void> {
    const snapshots = await getSnapshots(noteId);
    if (snapshots.length <= MAX_SNAPSHOTS_PER_NOTE) return;

    const toDelete = snapshots.slice(MAX_SNAPSHOTS_PER_NOTE);
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const snap of toDelete) {
            store.delete(snap.id);
        }
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}
