import { useEffect, useState } from 'react';
import { LoroDoc } from 'loro-crdt';
import localforage from 'localforage';

const noteStore = localforage.createInstance({ name: 'onyx', storeName: 'notes' });

/**
 * Hook that creates a Loro doc for a given document ID and loads
 * its persisted snapshot from localforage (offline-first).
 *
 * Returns `{ doc, synced }` where `synced` is true once the local
 * snapshot has been loaded (or confirmed empty).
 */
export function useLoroStore(docId: string) {
    const [doc, setDoc] = useState<LoroDoc | null>(null);
    const [synced, setSynced] = useState(false);

    useEffect(() => {
        if (!docId) return;

        const loroDoc = new LoroDoc();
        let cancelled = false;

        (async () => {
            // Load from local persistence
            const snapshot = await noteStore.getItem<Uint8Array>(docId);
            if (cancelled) return;

            if (snapshot) {
                try {
                    loroDoc.import(snapshot);
                } catch (e) {
                    console.warn(`[useLoroStore] Failed to import snapshot for ${docId}:`, e);
                }
            }

            if (!cancelled) {
                setDoc(loroDoc);
                setSynced(true);
            }
        })();

        return () => {
            cancelled = true;
            setDoc(null);
            setSynced(false);
        };
    }, [docId]);

    return { doc, synced };
}
