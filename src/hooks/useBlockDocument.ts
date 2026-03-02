import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BlockDocument } from '../store/blockDocument';
import type { LoroBlock } from '../types/block';

export function useBlockDocument(noteId: string | null, blockDoc: BlockDocument | null) {
  const [blocks, setBlocks] = useState<LoroBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Sync React state whenever Loro list changes */
  const syncBlocks = useCallback(() => {
    if (blockDoc) {
      setBlocks(blockDoc.getAllBlocks());
    }
  }, [blockDoc]);

  /* Load note content (decrypted by Rust) into block document */
  useEffect(() => {
    if (!noteId || !blockDoc) return;

    let cancelled = false;
    setLoaded(false);

    // Subscribe to Loro changes
    const unsub = blockDoc.doc.subscribe(() => syncBlocks());
    syncBlocks();

    (async () => {
      try {
        const result = await invoke<{ content: string }>('load_note', { id: noteId });
        if (cancelled) return;

        const content = result.content ?? '';

        // Load into BlockDocument only if it has no blocks yet,
        // to prevent overwriting newer changes from local persistence
        if (content.trim().length > 0 && blockDoc.length === 0) {
          try {
            blockDoc.load(content);
          } catch {
            blockDoc.insertBlock(0, 'text', content);
          }
        }

        blockDoc.ensureNotEmpty();
        setLoaded(true);
      } catch (err) {
        console.warn('[useBlockDocument] load_note not found (Expected if Rust E2EE is not yet active)');
        if (!cancelled && blockDoc.length === 0) {
          blockDoc.ensureNotEmpty();
        }
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [noteId, blockDoc, syncBlocks]);

  /* Debounced save — serialises block tree and sends to Rust for encryption */
  const save = useCallback(() => {
    if (!noteId || !blockDoc) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const json = blockDoc.serialise();
        await invoke('save_note', { id: noteId, content: json });
      } catch (err) {
        console.warn('[useBlockDocument] save_note not found (Expected if Rust E2EE is not yet active)');
      }
    }, 400);
  }, [noteId, blockDoc]);

  /* Notify save on every Loro mutation */
  useEffect(() => {
    if (!loaded || !blockDoc) return;
    const unsub = blockDoc.doc.subscribe(() => save());
    return () => { unsub(); };
  }, [loaded, blockDoc, save]);

  return { blocks, loaded };
}
