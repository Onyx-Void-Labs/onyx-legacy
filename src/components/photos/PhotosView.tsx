import {
    Image, Grid3X3, LayoutGrid, Search, Upload, Shield, Heart, FolderOpen,
    Trash2, Download, X, Check,
    ChevronLeft, ChevronRight, Maximize2, HardDrive, FolderPlus
} from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { usePhotosStore, type PhotoMeta } from '@/store/photosStore';
import { IS_TAURI } from '@/hooks/usePlatform';

// ─── Format Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}


// ─── Photo Thumbnail Component ──────────────────────────────────────────────

function PhotoThumbnail({
    photo, isSelected, onSelect, onClick, onFavorite, gridSize
}: {
    photo: PhotoMeta;
    isSelected: boolean;
    onSelect: () => void;
    onClick: () => void;
    onFavorite: () => void;
    gridSize: 'small' | 'medium' | 'large';
}) {
    const store = usePhotosStore();
    const thumbUrl = store.thumbnailCache.get(photo.id);

    useEffect(() => {
        store.loadThumbnail(photo.id);
    }, [photo.id]);

    const sizeClass = gridSize === 'small' ? 'h-28' : gridSize === 'medium' ? 'h-40' : 'h-56';

    return (
        <div
            className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${sizeClass} ${
                isSelected ? 'ring-2 ring-rose-500 ring-offset-2 ring-offset-zinc-950' : 'hover:ring-1 hover:ring-zinc-600'
            }`}
            onClick={onClick}
        >
            {/* Image / Placeholder */}
            {thumbUrl ? (
                <img src={thumbUrl} alt={photo.filename} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full bg-zinc-800/50 flex items-center justify-center">
                    <Image size={24} className="text-zinc-600" />
                </div>
            )}

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors">
                {/* Selection checkbox */}
                <button
                    onClick={(e) => { e.stopPropagation(); onSelect(); }}
                    className={`absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                        isSelected
                            ? 'bg-rose-500 border-rose-500 text-white'
                            : 'border-white/60 text-transparent group-hover:text-white/60 opacity-0 group-hover:opacity-100'
                    }`}
                >
                    <Check size={12} />
                </button>

                {/* Favorite button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onFavorite(); }}
                    className={`absolute top-2 right-2 p-1 rounded-full transition-all opacity-0 group-hover:opacity-100 ${
                        photo.is_favorite ? 'text-rose-400 opacity-100' : 'text-white/70 hover:text-rose-400'
                    }`}
                >
                    <Heart size={16} fill={photo.is_favorite ? 'currentColor' : 'none'} />
                </button>
            </div>

            {/* Bottom info bar */}
            <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="text-[10px] text-white/80 truncate">{photo.filename}</div>
                <div className="text-[9px] text-white/50">{formatBytes(photo.file_size)}</div>
            </div>
        </div>
    );
}

// ─── Lightbox Viewer ────────────────────────────────────────────────────────

function PhotoViewer({ photoId, onClose, onPrev, onNext }: {
    photoId: string;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
}) {
    const store = usePhotosStore();
    const photo = store.photos.find(p => p.id === photoId);
    const [fullData, setFullData] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        setFullData(null);
        store.getPhotoData(photoId, false)
            .then(b64 => {
                const mime = photo?.mime_type || 'image/jpeg';
                setFullData(`data:${mime};base64,${b64}`);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [photoId]);

    // Keyboard navigation
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') onPrev();
            if (e.key === 'ArrowRight') onNext();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose, onPrev, onNext]);

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center">
            {/* Close */}
            <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 z-10">
                <X size={24} />
            </button>

            {/* Info bar */}
            <div className="absolute top-4 left-4 flex items-center gap-3 z-10">
                <div className="text-sm text-white/80 font-medium">{photo?.filename}</div>
                {photo && (
                    <>
                        <span className="text-xs text-white/40">{photo.width}×{photo.height}</span>
                        <span className="text-xs text-white/40">{formatBytes(photo.file_size)}</span>
                    </>
                )}
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 text-[10px] font-semibold">
                    <Shield size={10} />
                    E2EE
                </div>
            </div>

            {/* Nav buttons */}
            <button onClick={onPrev} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white rounded-full hover:bg-white/10">
                <ChevronLeft size={28} />
            </button>
            <button onClick={onNext} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/50 hover:text-white rounded-full hover:bg-white/10">
                <ChevronRight size={28} />
            </button>

            {/* Image */}
            <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center">
                {loading ? (
                    <div className="text-white/40 animate-pulse">Decrypting...</div>
                ) : fullData ? (
                    <img src={fullData} alt={photo?.filename} className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" />
                ) : (
                    <div className="text-white/40">Failed to load</div>
                )}
            </div>

            {/* Bottom toolbar */}
            {photo && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-zinc-900/80 rounded-full px-4 py-2 border border-zinc-700/30 backdrop-blur-md">
                    <button
                        onClick={() => store.toggleFavorite(photo.id)}
                        className={`p-2 rounded-full transition-colors ${photo.is_favorite ? 'text-rose-400' : 'text-zinc-400 hover:text-rose-400'}`}
                    >
                        <Heart size={18} fill={photo.is_favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                        onClick={async () => {
                            if (!IS_TAURI) return;
                            const { open } = await import('@tauri-apps/plugin-dialog');
                            const dir = await open({ directory: true, title: 'Export photo to...' });
                            if (dir && typeof dir === 'string') {
                                await store.exportPhoto(photo.id, dir);
                            }
                        }}
                        className="p-2 rounded-full text-zinc-400 hover:text-sky-400 transition-colors"
                    >
                        <Download size={18} />
                    </button>
                    <button
                        onClick={() => { store.deletePhoto(photo.id); onClose(); }}
                        className="p-2 rounded-full text-zinc-400 hover:text-red-400 transition-colors"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Albums Sidebar ─────────────────────────────────────────────────────────

function AlbumsSidebar({ collapsed }: { collapsed: boolean }) {
    const store = usePhotosStore();
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { if (creating && inputRef.current) inputRef.current.focus(); }, [creating]);

    const navItems = [
        { id: 'all' as const, label: 'All Photos', icon: Image, count: store.stats?.total_photos ?? 0 },
        { id: 'favorites' as const, label: 'Favorites', icon: Heart, count: store.stats?.favorites_count ?? 0 },
        { id: 'trash' as const, label: 'Trash', icon: Trash2, count: store.stats?.trash_count ?? 0 },
    ];

    return (
        <div className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${collapsed ? 'w-0 opacity-0 border-none' : 'w-56 opacity-100 border-r border-zinc-800/30'}`}>
            <div className="w-56 h-full flex flex-col bg-zinc-900/60">
                <div className="h-12 px-4 flex items-center gap-2 border-b border-zinc-800/30 shrink-0">
                    <Image size={16} className="text-rose-400" />
                    <span className="text-sm font-semibold text-zinc-200">Photos</span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {/* Navigation */}
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => store.setView(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                store.view === item.id && !store.activeAlbumId
                                    ? 'bg-zinc-800/60 text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                            }`}
                        >
                            <item.icon size={16} className={store.view === item.id && !store.activeAlbumId ? 'text-rose-400' : 'text-zinc-600'} />
                            <span className="flex-1 text-left truncate">{item.label}</span>
                            <span className="text-xs text-zinc-600">{item.count}</span>
                        </button>
                    ))}

                    {/* Albums section */}
                    <div className="pt-4">
                        <div className="px-3 text-[10px] uppercase tracking-widest font-bold text-zinc-600 mb-2">Albums</div>

                        {store.albums.map(album => (
                            <button
                                key={album.id}
                                onClick={() => store.setActiveAlbum(album.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    store.activeAlbumId === album.id
                                        ? 'bg-zinc-800/60 text-zinc-100'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                                }`}
                            >
                                <FolderOpen size={16} className={store.activeAlbumId === album.id ? 'text-rose-400' : 'text-zinc-600'} />
                                <span className="flex-1 text-left truncate">{album.name}</span>
                                <span className="text-xs text-zinc-600">{album.photo_count}</span>
                            </button>
                        ))}

                        {/* Create album */}
                        {creating ? (
                            <div className="flex items-center gap-1 px-2 py-1">
                                <input
                                    ref={inputRef}
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    onKeyDown={async e => {
                                        if (e.key === 'Enter' && newName.trim()) {
                                            await store.createAlbum(newName.trim());
                                            setNewName('');
                                            setCreating(false);
                                        }
                                        if (e.key === 'Escape') { setNewName(''); setCreating(false); }
                                    }}
                                    className="flex-1 bg-zinc-800 rounded-md px-2 py-1 text-sm text-zinc-200 outline-none border border-zinc-700 focus:border-rose-500/50"
                                    placeholder="Album name..."
                                />
                            </div>
                        ) : (
                            <button
                                onClick={() => setCreating(true)}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-rose-400 hover:bg-rose-500/8 border border-dashed border-zinc-800 hover:border-rose-500/30 transition-all mt-1"
                            >
                                <FolderPlus size={14} />
                                <span>New Album</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Storage info */}
                <div className="border-t border-zinc-800/30 p-4 shrink-0 space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                        <HardDrive size={14} className="text-zinc-500" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Storage</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-400">{formatBytes(store.stats?.total_size_bytes ?? 0)}</span>
                        <span className="text-zinc-600">200 GB</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-linear-to-r from-rose-500 to-pink-500 rounded-full transition-all"
                            style={{ width: `${Math.min(((store.stats?.total_size_bytes ?? 0) / (200 * 1024 * 1024 * 1024)) * 100, 100)}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Main Photos View ───────────────────────────────────────────────────────

interface PhotosViewProps {
    sidebarCollapsed?: boolean;
}

export default function PhotosView({ sidebarCollapsed = false }: PhotosViewProps) {
    const store = usePhotosStore();

    // Load on mount
    useEffect(() => {
        store.loadPhotos();
        store.loadAlbums();
        store.loadStats();
    }, []);

    // Reload photos when view changes
    useEffect(() => {
        store.loadPhotos();
    }, [store.view, store.activeAlbumId]);

    // Filter by search
    const filteredPhotos = useMemo(() => {
        if (!store.searchQuery) return store.photos;
        const q = store.searchQuery.toLowerCase();
        return store.photos.filter(p =>
            p.filename.toLowerCase().includes(q) ||
            p.mime_type.toLowerCase().includes(q)
        );
    }, [store.photos, store.searchQuery]);

    const handleUpload = async () => {
        if (!IS_TAURI) return;
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const files = await open({
                multiple: true,
                title: 'Select photos to upload',
                filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'avif', 'tiff'] }],
            });
            if (files) {
                const paths = Array.isArray(files) ? files.map((f: any) => typeof f === 'string' ? f : f.path) : [typeof files === 'string' ? files : (files as any).path];
                await store.uploadPhotos(paths);
            }
        } catch (e) {
            console.error('[Photos] Upload dialog failed:', e);
        }
    };

    // Lightbox navigation
    const viewerIndex = store.viewerPhotoId ? filteredPhotos.findIndex((p: PhotoMeta) => p.id === store.viewerPhotoId) : -1;
    const handlePrev = () => {
        if (viewerIndex > 0) store.setViewerPhoto(filteredPhotos[viewerIndex - 1].id);
    };
    const handleNext = () => {
        if (viewerIndex < filteredPhotos.length - 1) store.setViewerPhoto(filteredPhotos[viewerIndex + 1].id);
    };

    const viewTitle = store.view === 'all' ? 'All Photos'
        : store.view === 'favorites' ? 'Favorites'
            : store.view === 'trash' ? 'Trash'
                : store.albums.find(a => a.id === store.activeAlbumId)?.name || 'Album';

    const hasSelection = store.selectedPhotoIds.size > 0;

    // Grid column classes
    const gridCols = store.gridSize === 'small'
        ? 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10'
        : store.gridSize === 'medium'
            ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
            : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4';

    return (
        <div className="flex h-full overflow-hidden">
            <AlbumsSidebar collapsed={sidebarCollapsed} />

            {/* Main gallery */}
            <div className="flex-1 flex flex-col bg-zinc-950/50 overflow-hidden">
                {/* Toolbar */}
                <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800/30 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-zinc-200">{viewTitle}</span>
                        <span className="text-xs text-zinc-600">{filteredPhotos.length} items</span>

                        {hasSelection && (
                            <div className="flex items-center gap-1.5 ml-2">
                                <span className="text-xs text-rose-400 font-medium">{store.selectedPhotoIds.size} selected</span>
                                <button
                                    onClick={() => store.clearSelection()}
                                    className="p-1 rounded-md text-zinc-500 hover:text-zinc-300"
                                >
                                    <X size={14} />
                                </button>
                                {store.view !== 'trash' && (
                                    <button
                                        onClick={async () => {
                                            for (const id of store.selectedPhotoIds) {
                                                await store.deletePhoto(id);
                                            }
                                            store.clearSelection();
                                        }}
                                        className="p-1 rounded-md text-zinc-500 hover:text-red-400"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Grid size toggle */}
                        <div className="flex items-center bg-zinc-800/30 rounded-lg overflow-hidden border border-zinc-700/20">
                            <button
                                onClick={() => store.setGridSize('small')}
                                className={`p-1.5 transition-colors ${store.gridSize === 'small' ? 'bg-zinc-700/50 text-zinc-200' : 'text-zinc-500'}`}
                            >
                                <Grid3X3 size={14} />
                            </button>
                            <button
                                onClick={() => store.setGridSize('medium')}
                                className={`p-1.5 transition-colors ${store.gridSize === 'medium' ? 'bg-zinc-700/50 text-zinc-200' : 'text-zinc-500'}`}
                            >
                                <LayoutGrid size={14} />
                            </button>
                            <button
                                onClick={() => store.setGridSize('large')}
                                className={`p-1.5 transition-colors ${store.gridSize === 'large' ? 'bg-zinc-700/50 text-zinc-200' : 'text-zinc-500'}`}
                            >
                                <Maximize2 size={14} />
                            </button>
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                            <input
                                value={store.searchQuery}
                                onChange={e => store.setSearchQuery(e.target.value)}
                                placeholder="Search photos..."
                                className="pl-8 pr-3 py-1.5 rounded-lg bg-zinc-800/30 border border-zinc-700/20 text-sm text-zinc-300 w-44 placeholder-zinc-600 outline-none focus:border-rose-500/40"
                            />
                        </div>

                        {/* Upload button */}
                        <button
                            onClick={handleUpload}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors text-xs font-semibold"
                        >
                            <Upload size={14} />
                            Upload
                        </button>

                        {/* Trash actions */}
                        {store.view === 'trash' && filteredPhotos.length > 0 && (
                            <button
                                onClick={() => store.emptyTrash()}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors text-xs font-semibold"
                            >
                                <Trash2 size={14} />
                                Empty Trash
                            </button>
                        )}
                    </div>
                </div>

                {/* Upload progress bar */}
                {store.uploading.length > 0 && (
                    <div className="px-4 py-2 border-b border-zinc-800/20 bg-zinc-900/40">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <Upload size={12} className="text-rose-400 animate-pulse" />
                            <span>Uploading {store.uploading.filter(u => u.status !== 'done').length} of {store.uploading.length}...</span>
                        </div>
                        <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-rose-500 rounded-full transition-all"
                                style={{
                                    width: `${(store.uploading.filter(u => u.status === 'done').length / store.uploading.length) * 100}%`
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Photo Grid */}
                {filteredPhotos.length > 0 ? (
                    <div className="flex-1 overflow-y-auto p-3">
                        <div className={`grid ${gridCols} gap-2`}>
                            {filteredPhotos.map((photo: PhotoMeta) => (
                                <PhotoThumbnail
                                    key={photo.id}
                                    photo={photo}
                                    isSelected={store.selectedPhotoIds.has(photo.id)}
                                    onSelect={() => store.toggleSelected(photo.id)}
                                    onClick={() => {
                                        if (store.view === 'trash') return;
                                        store.setViewerPhoto(photo.id);
                                    }}
                                    onFavorite={() => store.toggleFavorite(photo.id)}
                                    gridSize={store.gridSize}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Empty state */
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-4 max-w-sm">
                            <div className="w-20 h-20 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto">
                                <Shield size={32} className="text-rose-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-zinc-100 mb-1">
                                    {store.view === 'trash' ? 'Trash is Empty' : store.view === 'favorites' ? 'No Favorites' : 'Encrypted Photos'}
                                </h3>
                                <p className="text-sm text-zinc-500 leading-relaxed">
                                    {store.view === 'trash'
                                        ? 'Deleted photos will appear here for 30 days.'
                                        : store.view === 'favorites'
                                            ? 'Heart a photo to add it to your favorites.'
                                            : 'Your photos, encrypted before they leave your device. Up to 200GB of private cloud storage.'
                                    }
                                </p>
                            </div>
                            {store.view === 'all' && (
                                <button
                                    onClick={handleUpload}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/15 text-rose-400 hover:bg-rose-500/20 transition-colors text-sm font-semibold"
                                >
                                    <Upload size={16} />
                                    Upload Photos
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* E2EE badge */}
                <div className="absolute bottom-6 right-6 flex items-center gap-2 pointer-events-none">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-xs font-medium text-rose-400">
                        <Shield size={12} />
                        <span>End-to-end encrypted</span>
                    </div>
                </div>
            </div>

            {/* Lightbox */}
            {store.viewerPhotoId && (
                <PhotoViewer
                    photoId={store.viewerPhotoId}
                    onClose={() => store.setViewerPhoto(null)}
                    onPrev={handlePrev}
                    onNext={handleNext}
                />
            )}
        </div>
    );
}
