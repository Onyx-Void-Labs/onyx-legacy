
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import localforage from 'localforage';
import { FileMeta, SyncStatus, NoteType } from '../types/sync';
import { IS_TAURI } from '../hooks/usePlatform';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

/** LocalForage instance for filesystem metadata (offline-first) */
const fsStore = localforage.createInstance({ name: 'onyx', storeName: 'filesystem' });

// ─── Context Type ─────────────────────────────────────────────────────────────

interface SyncContextType {
    files: FileMeta[];
    status: SyncStatus;
    createFile: (title?: string, type?: NoteType) => string;
    deleteFile: (id: string) => void;
    updateFile: (id: string, updates: Partial<FileMeta>) => void;
    softDeleteFile: (id: string) => void;
    restoreFile: (id: string) => void;
    archiveFile: (id: string) => void;
    unarchiveFile: (id: string) => void;
}

const SyncContext = createContext<SyncContextType | null>(null);

export const useSync = () => {
    const context = useContext(SyncContext);
    if (!context) throw new Error('useSync must be used within a SyncProvider');
    return context;
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [files, setFiles] = useState<FileMeta[]>([]);
    const [status, setStatus] = useState<SyncStatus>('connecting');
    const filesMapRef = useRef<Map<string, FileMeta>>(new Map());

    // ─── Persist helpers ──────────────────────────────────────────────────

    const persistFiles = useCallback(async (map: Map<string, FileMeta>) => {
        const obj = Object.fromEntries(map.entries());
        await fsStore.setItem('files', obj);
    }, []);

    const syncReactState = useCallback(() => {
        const sorted = Array.from(filesMapRef.current.values())
            .sort((a, b) => b.createdAt - a.createdAt);
        setFiles(sorted);
    }, []);

    // ─── Load from storage on mount ───────────────────────────────────────

    useEffect(() => {
        let cancelled = false;

        (async () => {
            // Load from localforage
            const stored = await fsStore.getItem<Record<string, FileMeta>>('files');
            if (cancelled) return;

            if (stored) {
                const map = new Map(Object.entries(stored));

                // Auto-purge: permanently delete notes trashed 30+ days ago
                const thirtyDays = 30 * 24 * 60 * 60 * 1000;
                const now = Date.now();
                for (const [key, file] of map.entries()) {
                    if (file.deletedAt && (now - file.deletedAt) > thirtyDays) {
                        map.delete(key);
                    }
                }

                filesMapRef.current = map;
                syncReactState();
                await persistFiles(map);
            }

            // DEMO MODE: Create Welcome Note if empty
            if (import.meta.env.VITE_DEMO_MODE && filesMapRef.current.size === 0) {
                const id = generateId();
                const newFile: FileMeta = {
                    id,
                    title: 'Welcome to Onyx',
                    type: 'note',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                filesMapRef.current.set(id, newFile);
                syncReactState();
                await persistFiles(filesMapRef.current);
            }

            // If inside Tauri, try to sync via Iroh (Loro CRDT sync happens in Rust)
            if (IS_TAURI) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    // Notify Rust that filesystem doc needs sync
                    await invoke('doc_get_state_vector', { docId: 'filesystem' });
                    setStatus('connected');
                } catch {
                    // Rust backend not ready yet — offline mode
                    setStatus('offline');
                }
            } else {
                setStatus('offline');
            }
        })();

        return () => { cancelled = true; };
    }, [syncReactState, persistFiles]);

    // ─── CRUD Operations ──────────────────────────────────────────────────

    const createFile = useCallback((title: string = 'Untitled Note', type: NoteType = 'note') => {
        const id = generateId();
        const newFile: FileMeta = {
            id,
            title,
            type,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        filesMapRef.current.set(id, newFile);
        syncReactState();
        persistFiles(filesMapRef.current);

        return id;
    }, [syncReactState, persistFiles]);

    const deleteFile = useCallback((id: string) => {
        filesMapRef.current.delete(id);
        syncReactState();
        persistFiles(filesMapRef.current);
    }, [syncReactState, persistFiles]);

    const softDeleteFile = useCallback((id: string) => {
        const current = filesMapRef.current.get(id);
        if (current) {
            filesMapRef.current.set(id, { ...current, deletedAt: Date.now(), updatedAt: Date.now() });
            syncReactState();
            persistFiles(filesMapRef.current);
        }
    }, [syncReactState, persistFiles]);

    const restoreFile = useCallback((id: string) => {
        const current = filesMapRef.current.get(id);
        if (current) {
            const { deletedAt, ...rest } = current;
            filesMapRef.current.set(id, { ...rest, updatedAt: Date.now() });
            syncReactState();
            persistFiles(filesMapRef.current);
        }
    }, [syncReactState, persistFiles]);

    const archiveFile = useCallback((id: string) => {
        const current = filesMapRef.current.get(id);
        if (current) {
            filesMapRef.current.set(id, { ...current, isArchived: true, updatedAt: Date.now() });
            syncReactState();
            persistFiles(filesMapRef.current);
        }
    }, [syncReactState, persistFiles]);

    const unarchiveFile = useCallback((id: string) => {
        const current = filesMapRef.current.get(id);
        if (current) {
            filesMapRef.current.set(id, { ...current, isArchived: false, updatedAt: Date.now() });
            syncReactState();
            persistFiles(filesMapRef.current);
        }
    }, [syncReactState, persistFiles]);

    const updateFile = useCallback((id: string, updates: Partial<FileMeta>) => {
        const current = filesMapRef.current.get(id);
        if (current) {
            filesMapRef.current.set(id, { ...current, ...updates, updatedAt: Date.now() });
            syncReactState();
            persistFiles(filesMapRef.current);
        }
    }, [syncReactState, persistFiles]);

    return (
        <SyncContext.Provider value={{ files, status, createFile, deleteFile, updateFile, softDeleteFile, restoreFile, archiveFile, unarchiveFile }}>
            {children}
        </SyncContext.Provider>
    );
};
