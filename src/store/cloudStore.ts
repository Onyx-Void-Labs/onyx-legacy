/**
 * cloudStore.ts — Zustand store for E2EE Cloud Drive module.
 * Manages folders, files, breadcrumbs, search, and upload state.
 */

import { create } from 'zustand';
import { IS_TAURI } from '@/hooks/usePlatform';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CloudFile {
    id: string;
    parent_id: string | null;
    name: string;
    file_type: 'file' | 'folder';
    mime_type: string;
    file_size: number;
    encrypted_path: string | null;
    checksum: string | null;
    created_at: string;
    updated_at: string;
    is_deleted: boolean;
    is_starred: boolean;
    version: number;
    shared_with: string | null;
}

export interface BreadcrumbItem {
    id: string;
    name: string;
}

export interface CloudStats {
    total_files: number;
    total_folders: number;
    total_size_bytes: number;
    trash_items: number;
    starred_items: number;
    recent_files: CloudFile[];
}

export interface FileVersion {
    id: string;
    file_id: string;
    version: number;
    file_size: number;
    encrypted_path: string;
    checksum: string;
    created_at: string;
}

type CloudView = 'files' | 'recent' | 'starred' | 'trash';
type SortBy = 'name' | 'size' | 'date' | 'type';
type SortOrder = 'asc' | 'desc';

interface CloudState {
    // Data
    files: CloudFile[];
    breadcrumbs: BreadcrumbItem[];
    stats: CloudStats | null;
    versions: FileVersion[];

    // Navigation
    view: CloudView;
    currentFolderId: string | null;
    folderHistory: (string | null)[];

    // UI State
    selectedIds: Set<string>;
    searchQuery: string;
    sortBy: SortBy;
    sortOrder: SortOrder;
    loading: boolean;
    uploading: boolean;
    uploadProgress: number;
    renamingId: string | null;
    masterKey: string | null;

    // Actions — Navigation
    setView: (view: CloudView) => void;
    navigateToFolder: (folderId: string | null) => void;
    navigateBack: () => void;
    setSearchQuery: (query: string) => void;
    setSortBy: (sortBy: SortBy) => void;
    setSortOrder: (order: SortOrder) => void;
    setMasterKey: (key: string) => void;

    // Actions — Selection
    toggleSelected: (id: string) => void;
    selectAll: () => void;
    clearSelection: () => void;

    // Actions — Data
    loadFiles: () => Promise<void>;
    loadBreadcrumbs: () => Promise<void>;
    loadStats: () => Promise<void>;
    uploadFiles: (filePaths: string[]) => Promise<void>;
    createFolder: (name: string) => Promise<CloudFile>;
    renameFile: (id: string, name: string) => Promise<void>;
    moveFile: (id: string, newParentId: string | null) => Promise<void>;
    toggleStar: (id: string) => Promise<void>;
    deleteFile: (id: string) => Promise<void>;
    restoreFile: (id: string) => Promise<void>;
    permanentlyDelete: (id: string) => Promise<void>;
    emptyTrash: () => Promise<number>;
    searchFiles: (query: string) => Promise<void>;
    getFileData: (id: string) => Promise<string>;
    exportFile: (id: string, exportDir: string) => Promise<string>;
    loadVersions: (id: string) => Promise<void>;
    setRenamingId: (id: string | null) => void;
}

export const useCloudStore = create<CloudState>()((set, get) => ({
    // Initial state
    files: [],
    breadcrumbs: [],
    stats: null,
    versions: [],
    view: 'files',
    currentFolderId: null,
    folderHistory: [],
    selectedIds: new Set(),
    searchQuery: '',
    sortBy: 'date',
    sortOrder: 'desc',
    loading: false,
    uploading: false,
    uploadProgress: 0,
    renamingId: null,
    masterKey: null,

    // Navigation
    setView: (view) => {
        set({ view, currentFolderId: null, breadcrumbs: [], folderHistory: [] });
        get().loadFiles();
    },

    navigateToFolder: (folderId) => {
        const { currentFolderId, folderHistory } = get();
        set({
            currentFolderId: folderId,
            folderHistory: [...folderHistory, currentFolderId],
            view: 'files',
        });
        get().loadFiles();
        if (folderId) get().loadBreadcrumbs();
        else set({ breadcrumbs: [] });
    },

    navigateBack: () => {
        const { folderHistory } = get();
        if (folderHistory.length === 0) return;
        const prev = folderHistory[folderHistory.length - 1];
        set({
            currentFolderId: prev,
            folderHistory: folderHistory.slice(0, -1),
        });
        get().loadFiles();
        if (prev) get().loadBreadcrumbs();
        else set({ breadcrumbs: [] });
    },

    setSearchQuery: (searchQuery) => {
        set({ searchQuery });
        if (searchQuery.length > 1) get().searchFiles(searchQuery);
        else get().loadFiles();
    },

    setSortBy: (sortBy) => { set({ sortBy }); get().loadFiles(); },
    setSortOrder: (order) => { set({ sortOrder: order }); get().loadFiles(); },
    setMasterKey: (masterKey) => set({ masterKey }),
    setRenamingId: (renamingId) => set({ renamingId }),

    // Selection
    toggleSelected: (id) => set((state) => {
        const next = new Set(state.selectedIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        return { selectedIds: next };
    }),
    selectAll: () => set((state) => ({ selectedIds: new Set(state.files.map(f => f.id)) })),
    clearSelection: () => set({ selectedIds: new Set() }),

    // Data
    loadFiles: async () => {
        if (!IS_TAURI) return;
        set({ loading: true });
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { view, currentFolderId, sortBy, sortOrder } = get();

            const sortByMap: Record<SortBy, string> = { name: 'name', size: 'size', date: 'updated_at', type: 'type' };

            const files = await invoke<CloudFile[]>('cloud_list_files', {
                parentId: view === 'files' ? currentFolderId : null,
                showDeleted: view === 'trash',
                starredOnly: view === 'starred',
                sortBy: sortByMap[sortBy],
                sortOrder: sortOrder,
            });
            set({ files, loading: false });
        } catch (e) {
            console.error('[Cloud] Load failed:', e);
            set({ loading: false });
        }
    },

    loadBreadcrumbs: async () => {
        if (!IS_TAURI) return;
        const { currentFolderId } = get();
        if (!currentFolderId) { set({ breadcrumbs: [] }); return; }
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const breadcrumbs = await invoke<BreadcrumbItem[]>('cloud_get_breadcrumbs', { folderId: currentFolderId });
            set({ breadcrumbs });
        } catch (e) {
            console.error('[Cloud] Breadcrumbs failed:', e);
        }
    },

    loadStats: async () => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const stats = await invoke<CloudStats>('cloud_get_stats');
            set({ stats });
        } catch (e) {
            console.error('[Cloud] Stats failed:', e);
        }
    },

    uploadFiles: async (filePaths) => {
        if (!IS_TAURI) return;
        const { masterKey, currentFolderId } = get();
        if (!masterKey) { console.error('[Cloud] No master key'); return; }

        set({ uploading: true, uploadProgress: 0 });
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            for (let i = 0; i < filePaths.length; i++) {
                await invoke('cloud_upload_file', {
                    filePath: filePaths[i],
                    masterKey,
                    parentId: currentFolderId,
                });
                set({ uploadProgress: Math.round(((i + 1) / filePaths.length) * 100) });
            }
            set({ uploading: false, uploadProgress: 100 });
            await get().loadFiles();
            await get().loadStats();
            setTimeout(() => set({ uploadProgress: 0 }), 1500);
        } catch (e) {
            console.error('[Cloud] Upload failed:', e);
            set({ uploading: false });
        }
    },

    createFolder: async (name) => {
        if (!IS_TAURI) throw new Error('Not available');
        const { invoke } = await import('@tauri-apps/api/core');
        const { currentFolderId } = get();
        const folder = await invoke<CloudFile>('cloud_create_folder', { name, parentId: currentFolderId });
        set(state => ({ files: [folder, ...state.files] }));
        return folder;
    },

    renameFile: async (id, name) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('cloud_rename_file', { fileId: id, name });
            set(state => ({ files: state.files.map(f => f.id === id ? { ...f, name } : f), renamingId: null }));
        } catch (e) {
            console.error('[Cloud] Rename failed:', e);
        }
    },

    moveFile: async (id, newParentId) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('cloud_move_file', { fileId: id, newParentId });
            set(state => ({ files: state.files.filter(f => f.id !== id) }));
        } catch (e) {
            console.error('[Cloud] Move failed:', e);
        }
    },

    toggleStar: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const starred = await invoke<boolean>('cloud_toggle_star', { fileId: id });
            set(state => ({
                files: state.files.map(f => f.id === id ? { ...f, is_starred: starred } : f),
            }));
        } catch (e) {
            console.error('[Cloud] Star failed:', e);
        }
    },

    deleteFile: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('cloud_delete_file', { fileId: id });
            set(state => ({
                files: state.files.filter(f => f.id !== id),
                selectedIds: (() => { const s = new Set(state.selectedIds); s.delete(id); return s; })(),
            }));
            await get().loadStats();
        } catch (e) {
            console.error('[Cloud] Delete failed:', e);
        }
    },

    restoreFile: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('cloud_restore_file', { fileId: id });
            set(state => ({ files: state.files.filter(f => f.id !== id) }));
            await get().loadStats();
        } catch (e) {
            console.error('[Cloud] Restore failed:', e);
        }
    },

    permanentlyDelete: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('cloud_permanently_delete', { fileId: id });
            set(state => ({ files: state.files.filter(f => f.id !== id) }));
            await get().loadStats();
        } catch (e) {
            console.error('[Cloud] Permanent delete failed:', e);
        }
    },

    emptyTrash: async () => {
        if (!IS_TAURI) return 0;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const count = await invoke<number>('cloud_empty_trash');
            set({ files: [] });
            await get().loadStats();
            return count;
        } catch (e) {
            console.error('[Cloud] Empty trash failed:', e);
            return 0;
        }
    },

    searchFiles: async (query) => {
        if (!IS_TAURI || !query) return;
        set({ loading: true });
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const files = await invoke<CloudFile[]>('cloud_search_files', { query, limit: 50 });
            set({ files, loading: false });
        } catch (e) {
            console.error('[Cloud] Search failed:', e);
            set({ loading: false });
        }
    },

    getFileData: async (id) => {
        if (!IS_TAURI) throw new Error('Not available');
        const { masterKey } = get();
        if (!masterKey) throw new Error('No master key');
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<string>('cloud_get_file_data', { fileId: id, masterKey });
    },

    exportFile: async (id, exportDir) => {
        if (!IS_TAURI) throw new Error('Not available');
        const { masterKey } = get();
        if (!masterKey) throw new Error('No master key');
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<string>('cloud_export_file', { fileId: id, masterKey, exportDir });
    },

    loadVersions: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const versions = await invoke<FileVersion[]>('cloud_get_versions', { fileId: id });
            set({ versions });
        } catch (e) {
            console.error('[Cloud] Versions failed:', e);
        }
    },
}));
