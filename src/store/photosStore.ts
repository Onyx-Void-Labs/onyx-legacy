/**
 * photosStore.ts — Zustand store for E2EE Photos module.
 * Manages albums, photo metadata, upload queue, and decrypted thumbnail cache.
 */

import { create } from 'zustand';
import { IS_TAURI } from '@/hooks/usePlatform';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PhotoMeta {
    id: string;
    album_id: string | null;
    filename: string;
    mime_type: string;
    width: number;
    height: number;
    file_size: number;
    taken_at: string | null;
    created_at: string;
    is_favorite: boolean;
    is_deleted: boolean;
    checksum: string;
    encrypted_path: string;
    thumbnail_path: string | null;
}

export interface Album {
    id: string;
    name: string;
    cover_photo_id: string | null;
    photo_count: number;
    created_at: string;
    updated_at: string;
}

export interface PhotoStats {
    total_photos: number;
    total_size_bytes: number;
    total_albums: number;
    favorites_count: number;
    trash_count: number;
}

export interface UploadProgress {
    filename: string;
    progress: number; // 0-100
    status: 'pending' | 'uploading' | 'done' | 'error';
    error?: string;
}

type PhotoView = 'all' | 'favorites' | 'albums' | 'trash';

interface PhotosState {
    // Data
    photos: PhotoMeta[];
    albums: Album[];
    stats: PhotoStats | null;

    // UI State
    view: PhotoView;
    activeAlbumId: string | null;
    selectedPhotoIds: Set<string>;
    viewerPhotoId: string | null; // Lightbox
    gridSize: 'small' | 'medium' | 'large';
    uploading: UploadProgress[];
    loading: boolean;
    searchQuery: string;

    // Thumbnail cache (photo_id -> base64 data URL)
    thumbnailCache: Map<string, string>;

    // Master key (from vault context — set once on mount)
    masterKey: string | null;

    // Actions
    setView: (view: PhotoView) => void;
    setActiveAlbum: (albumId: string | null) => void;
    setGridSize: (size: 'small' | 'medium' | 'large') => void;
    setSearchQuery: (query: string) => void;
    setMasterKey: (key: string) => void;
    setViewerPhoto: (id: string | null) => void;
    toggleSelected: (id: string) => void;
    selectAll: () => void;
    clearSelection: () => void;

    // Data actions
    loadPhotos: () => Promise<void>;
    loadAlbums: () => Promise<void>;
    loadStats: () => Promise<void>;
    uploadPhotos: (filePaths: string[]) => Promise<void>;
    deletePhoto: (id: string) => Promise<void>;
    restorePhoto: (id: string) => Promise<void>;
    permanentlyDeletePhoto: (id: string) => Promise<void>;
    toggleFavorite: (id: string) => Promise<void>;
    moveToAlbum: (photoId: string, albumId: string | null) => Promise<void>;
    createAlbum: (name: string) => Promise<Album>;
    renameAlbum: (id: string, name: string) => Promise<void>;
    deleteAlbum: (id: string) => Promise<void>;
    emptyTrash: () => Promise<number>;
    getPhotoData: (id: string, thumbnail?: boolean) => Promise<string>;
    exportPhoto: (id: string, exportDir: string) => Promise<string>;
    loadThumbnail: (id: string) => Promise<void>;
}

export const usePhotosStore = create<PhotosState>()((set, get) => ({
    // Initial state
    photos: [],
    albums: [],
    stats: null,
    view: 'all',
    activeAlbumId: null,
    selectedPhotoIds: new Set(),
    viewerPhotoId: null,
    gridSize: 'medium',
    uploading: [],
    loading: false,
    searchQuery: '',
    thumbnailCache: new Map(),
    masterKey: null,

    // UI actions
    setView: (view) => set({ view, activeAlbumId: null }),
    setActiveAlbum: (albumId) => set({ activeAlbumId: albumId, view: 'albums' }),
    setGridSize: (gridSize) => set({ gridSize }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setMasterKey: (masterKey) => set({ masterKey }),
    setViewerPhoto: (viewerPhotoId) => set({ viewerPhotoId }),

    toggleSelected: (id) => set((state) => {
        const next = new Set(state.selectedPhotoIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { selectedPhotoIds: next };
    }),

    selectAll: () => set((state) => ({
        selectedPhotoIds: new Set(state.photos.map(p => p.id))
    })),

    clearSelection: () => set({ selectedPhotoIds: new Set() }),

    // ─── Data Actions ───────────────────────────────────────────────

    loadPhotos: async () => {
        if (!IS_TAURI) return;
        set({ loading: true });
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const { view, activeAlbumId } = get();
            const photos = await invoke<PhotoMeta[]>('get_photos', {
                albumId: view === 'albums' ? activeAlbumId : null,
                favoritesOnly: view === 'favorites',
                showDeleted: view === 'trash',
                offset: 0,
                limit: 1000,
            });
            set({ photos, loading: false });
        } catch (e) {
            console.error('[Photos] Load failed:', e);
            set({ loading: false });
        }
    },

    loadAlbums: async () => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const albums = await invoke<Album[]>('get_albums');
            set({ albums });
        } catch (e) {
            console.error('[Photos] Load albums failed:', e);
        }
    },

    loadStats: async () => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const stats = await invoke<PhotoStats>('get_photo_stats');
            set({ stats });
        } catch (e) {
            console.error('[Photos] Load stats failed:', e);
        }
    },

    uploadPhotos: async (filePaths) => {
        if (!IS_TAURI) return;
        const { masterKey, activeAlbumId } = get();
        if (!masterKey) {
            console.error('[Photos] No master key set');
            return;
        }

        const progress: UploadProgress[] = filePaths.map(fp => ({
            filename: fp.split(/[\\/]/).pop() || fp,
            progress: 0,
            status: 'pending' as const,
        }));
        set({ uploading: progress });

        try {
            const { invoke } = await import('@tauri-apps/api/core');

            for (let i = 0; i < filePaths.length; i++) {
                set(state => {
                    const uploading = [...state.uploading];
                    uploading[i] = { ...uploading[i], status: 'uploading', progress: 50 };
                    return { uploading };
                });

                try {
                    await invoke('upload_photo', {
                        filePath: filePaths[i],
                        masterKey,
                        albumId: activeAlbumId,
                        takenAt: null,
                    });
                    set(state => {
                        const uploading = [...state.uploading];
                        uploading[i] = { ...uploading[i], status: 'done', progress: 100 };
                        return { uploading };
                    });
                } catch (e) {
                    set(state => {
                        const uploading = [...state.uploading];
                        uploading[i] = { ...uploading[i], status: 'error', error: String(e) };
                        return { uploading };
                    });
                }
            }

            // Reload after upload
            await get().loadPhotos();
            await get().loadStats();

            // Clear upload progress after 2s
            setTimeout(() => set({ uploading: [] }), 2000);
        } catch (e) {
            console.error('[Photos] Upload batch failed:', e);
        }
    },

    deletePhoto: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('delete_photo', { photoId: id });
            set(state => ({
                photos: state.photos.filter(p => p.id !== id),
                selectedPhotoIds: (() => { const s = new Set(state.selectedPhotoIds); s.delete(id); return s; })(),
            }));
            await get().loadStats();
        } catch (e) {
            console.error('[Photos] Delete failed:', e);
        }
    },

    restorePhoto: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('restore_photo', { photoId: id });
            set(state => ({ photos: state.photos.filter(p => p.id !== id) }));
            await get().loadStats();
        } catch (e) {
            console.error('[Photos] Restore failed:', e);
        }
    },

    permanentlyDeletePhoto: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('permanently_delete_photo', { photoId: id });
            set(state => ({
                photos: state.photos.filter(p => p.id !== id),
                thumbnailCache: (() => { const m = new Map(state.thumbnailCache); m.delete(id); return m; })(),
            }));
            await get().loadStats();
        } catch (e) {
            console.error('[Photos] Permanent delete failed:', e);
        }
    },

    toggleFavorite: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const isFav = await invoke<boolean>('toggle_photo_favorite', { photoId: id });
            set(state => ({
                photos: state.photos.map(p => p.id === id ? { ...p, is_favorite: isFav } : p),
            }));
        } catch (e) {
            console.error('[Photos] Toggle fav failed:', e);
        }
    },

    moveToAlbum: async (photoId, albumId) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('move_photo_to_album', { photoId, albumId });
            await get().loadPhotos();
            await get().loadAlbums();
        } catch (e) {
            console.error('[Photos] Move to album failed:', e);
        }
    },

    createAlbum: async (name) => {
        if (!IS_TAURI) throw new Error('Not available in browser');
        const { invoke } = await import('@tauri-apps/api/core');
        const album = await invoke<Album>('create_album', { name });
        set(state => ({ albums: [...state.albums, album] }));
        return album;
    },

    renameAlbum: async (id, name) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('rename_album', { albumId: id, name });
            set(state => ({
                albums: state.albums.map(a => a.id === id ? { ...a, name } : a),
            }));
        } catch (e) {
            console.error('[Photos] Rename album failed:', e);
        }
    },

    deleteAlbum: async (id) => {
        if (!IS_TAURI) return;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('delete_album', { albumId: id });
            set(state => ({
                albums: state.albums.filter(a => a.id !== id),
                activeAlbumId: state.activeAlbumId === id ? null : state.activeAlbumId,
            }));
        } catch (e) {
            console.error('[Photos] Delete album failed:', e);
        }
    },

    emptyTrash: async () => {
        if (!IS_TAURI) return 0;
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const count = await invoke<number>('empty_photo_trash');
            set({ photos: [] });
            await get().loadStats();
            return count;
        } catch (e) {
            console.error('[Photos] Empty trash failed:', e);
            return 0;
        }
    },

    getPhotoData: async (id, thumbnail = false) => {
        if (!IS_TAURI) throw new Error('Not available in browser');
        const { masterKey } = get();
        if (!masterKey) throw new Error('No master key');
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<string>('get_photo_data', { photoId: id, masterKey, thumbnail });
    },

    exportPhoto: async (id, exportDir) => {
        if (!IS_TAURI) throw new Error('Not available in browser');
        const { masterKey } = get();
        if (!masterKey) throw new Error('No master key');
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke<string>('export_photo', { photoId: id, masterKey, exportDir });
    },

    loadThumbnail: async (id) => {
        const { thumbnailCache, masterKey } = get();
        if (thumbnailCache.has(id) || !masterKey || !IS_TAURI) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const b64 = await invoke<string>('get_photo_data', {
                photoId: id,
                masterKey,
                thumbnail: true,
            });
            set(state => {
                const cache = new Map(state.thumbnailCache);
                cache.set(id, `data:image/jpeg;base64,${b64}`);
                return { thumbnailCache: cache };
            });
        } catch (e) {
            console.error('[Photos] Thumbnail load failed:', id, e);
        }
    },
}));
