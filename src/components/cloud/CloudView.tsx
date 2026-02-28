import {
    Cloud, FolderOpen, File, Upload, Search, Shield, HardDrive, FolderPlus,
    MoreHorizontal, Star, Trash2, Download, ChevronRight, ArrowLeft,
    Edit3, X, Clock, Check
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useCloudStore, type CloudFile as CloudFileType } from '@/store/cloudStore';
import { IS_TAURI } from '@/hooks/usePlatform';

// ─── Format Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes === 0) return '—';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(timestamp: string): string {
    const num = parseInt(timestamp, 10);
    if (isNaN(num)) return timestamp;
    return new Date(num * 1000).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    });
}

function getFileIcon(file: CloudFileType) {
    if (file.file_type === 'folder') return { Icon: FolderOpen, color: 'text-sky-400' };

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
        case 'pdf': return { Icon: File, color: 'text-red-400' };
        case 'doc': case 'docx': return { Icon: File, color: 'text-blue-400' };
        case 'xls': case 'xlsx': return { Icon: File, color: 'text-emerald-400' };
        case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp':
            return { Icon: File, color: 'text-purple-400' };
        case 'zip': case 'rar': case '7z': case 'gz':
            return { Icon: File, color: 'text-amber-400' };
        case 'mp3': case 'wav': case 'ogg':
            return { Icon: File, color: 'text-pink-400' };
        case 'mp4': case 'mov': case 'webm':
            return { Icon: File, color: 'text-rose-400' };
        default: return { Icon: File, color: 'text-zinc-500' };
    }
}

// ─── File Row Component ─────────────────────────────────────────────────────

function FileRow({ file, isSelected, onSelect, onOpen, onContextMenu }: {
    file: CloudFileType;
    isSelected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}) {
    const store = useCloudStore();
    const { Icon, color } = getFileIcon(file);
    const isRenaming = store.renamingId === file.id;
    const [editName, setEditName] = useState(file.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            // Select filename without extension
            const dotIdx = file.name.lastIndexOf('.');
            inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : file.name.length);
        }
    }, [isRenaming]);

    return (
        <div
            className={`grid grid-cols-[24px_1fr_100px_140px_40px] px-4 py-2 cursor-pointer transition-colors border-b border-zinc-800/10 group ${
                isSelected ? 'bg-sky-500/8' : 'hover:bg-zinc-800/20'
            }`}
            onDoubleClick={onOpen}
            onContextMenu={onContextMenu}
        >
            {/* Checkbox */}
            <div className="flex items-center">
                <button
                    onClick={(e) => { e.stopPropagation(); onSelect(); }}
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-sky-500 border-sky-500 text-white' : 'border-zinc-700 text-transparent hover:border-zinc-500'
                    }`}
                >
                    <Check size={10} />
                </button>
            </div>

            {/* Name */}
            <div className="flex items-center gap-3 min-w-0">
                <Icon size={16} className={`${color} shrink-0`} />
                {isRenaming ? (
                    <input
                        ref={inputRef}
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') store.renameFile(file.id, editName);
                            if (e.key === 'Escape') store.setRenamingId(null);
                        }}
                        onBlur={() => store.setRenamingId(null)}
                        className="flex-1 bg-zinc-800 rounded px-2 py-0.5 text-sm text-zinc-200 outline-none border border-sky-500/50"
                        onClick={e => e.stopPropagation()}
                    />
                ) : (
                    <span className={`text-sm truncate ${file.file_type === 'folder' ? 'text-zinc-200 font-medium' : 'text-zinc-400'}`}>
                        {file.name}
                    </span>
                )}
                {file.is_starred && <Star size={12} className="text-amber-400 shrink-0" fill="currentColor" />}
            </div>

            {/* Size */}
            <span className="text-sm text-zinc-600 flex items-center">
                {file.file_type === 'folder' ? '—' : formatBytes(file.file_size)}
            </span>

            {/* Modified */}
            <span className="text-sm text-zinc-600 flex items-center">{formatDate(file.updated_at)}</span>

            {/* Actions */}
            <div className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
                    className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 transition-colors"
                >
                    <MoreHorizontal size={14} />
                </button>
            </div>
        </div>
    );
}

// ─── Context Menu ───────────────────────────────────────────────────────────

function FileContextMenu({ file, x, y, onClose }: {
    file: CloudFileType;
    x: number;
    y: number;
    onClose: () => void;
}) {
    const store = useCloudStore();

    const actions = [
        ...(file.file_type === 'folder' ? [{ label: 'Open', icon: FolderOpen, action: () => store.navigateToFolder(file.id) }] : []),
        { label: file.is_starred ? 'Unstar' : 'Star', icon: Star, action: () => store.toggleStar(file.id) },
        { label: 'Rename', icon: Edit3, action: () => store.setRenamingId(file.id) },
        ...(file.file_type === 'file' ? [{
            label: 'Download', icon: Download, action: async () => {
                if (!IS_TAURI) return;
                const { open } = await import('@tauri-apps/plugin-dialog');
                const dir = await open({ directory: true, title: 'Export to...' });
                if (dir && typeof dir === 'string') await store.exportFile(file.id, dir);
            }
        }] : []),
        { label: 'Delete', icon: Trash2, action: () => store.deleteFile(file.id), danger: true },
    ];

    return (
        <>
            <div className="fixed inset-0 z-50" onClick={onClose} />
            <div
                className="fixed z-50 w-48 bg-zinc-900 border border-zinc-700/30 rounded-xl shadow-2xl p-1 animate-in fade-in zoom-in-95 duration-150"
                style={{ top: y, left: x }}
            >
                {actions.map((action, i) => (
                    <button
                        key={i}
                        onClick={() => { action.action(); onClose(); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                            'danger' in action && action.danger
                                ? 'text-red-400 hover:bg-red-500/10'
                                : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                    >
                        <action.icon size={14} />
                        {action.label}
                    </button>
                ))}
            </div>
        </>
    );
}

// ─── Navigation Sidebar ─────────────────────────────────────────────────────

function CloudSidebar({ collapsed }: { collapsed: boolean }) {
    const store = useCloudStore();

    const navItems = [
        { id: 'files' as const, icon: FolderOpen, label: 'My Files', count: store.stats?.total_files ?? 0 },
        { id: 'recent' as const, icon: Clock, label: 'Recent', count: 0 },
        { id: 'starred' as const, icon: Star, label: 'Starred', count: store.stats?.starred_items ?? 0 },
        { id: 'trash' as const, icon: Trash2, label: 'Trash', count: store.stats?.trash_items ?? 0 },
    ];

    return (
        <div className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${collapsed ? 'w-0 opacity-0 border-none' : 'w-56 opacity-100 border-r border-zinc-800/30'}`}>
            <div className="w-56 h-full flex flex-col bg-zinc-900/60">
                <div className="h-12 px-4 flex items-center gap-2 border-b border-zinc-800/30 shrink-0">
                    <Cloud size={16} className="text-sky-400" />
                    <span className="text-sm font-semibold text-zinc-200">Cloud Drive</span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => store.setView(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                                store.view === item.id
                                    ? 'bg-zinc-800/60 text-zinc-100'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                            }`}
                        >
                            <item.icon size={16} className={store.view === item.id ? 'text-sky-400' : 'text-zinc-600'} />
                            <span className="flex-1 text-left truncate">{item.label}</span>
                            {item.count > 0 && <span className="text-xs text-zinc-600">{item.count}</span>}
                        </button>
                    ))}

                    {/* New folder button */}
                    <div className="pt-4">
                        <button
                            onClick={async () => {
                                const name = prompt('Folder name:');
                                if (name) await store.createFolder(name);
                            }}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-sky-400 hover:bg-sky-500/8 border border-dashed border-zinc-800 hover:border-sky-500/30 transition-all"
                        >
                            <FolderPlus size={14} />
                            <span>New Folder</span>
                        </button>
                    </div>
                </div>

                {/* Storage */}
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
                            className="h-full bg-linear-to-r from-sky-500 to-blue-500 rounded-full transition-all"
                            style={{ width: `${Math.min(((store.stats?.total_size_bytes ?? 0) / (200 * 1024 * 1024 * 1024)) * 100, 100)}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Main Cloud View ────────────────────────────────────────────────────────

interface CloudViewProps {
    sidebarCollapsed?: boolean;
}

export default function CloudView({ sidebarCollapsed = false }: CloudViewProps) {
    const store = useCloudStore();
    const [contextMenu, setContextMenu] = useState<{ file: CloudFileType; x: number; y: number } | null>(null);

    // Load on mount
    useEffect(() => {
        store.loadFiles();
        store.loadStats();
    }, []);

    const handleUpload = async () => {
        if (!IS_TAURI) return;
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const files = await open({ multiple: true, title: 'Select files to upload' });
            if (files) {
                const paths = Array.isArray(files) ? files.map((f: any) => typeof f === 'string' ? f : f.path) : [typeof files === 'string' ? files : (files as any).path];
                await store.uploadFiles(paths);
            }
        } catch (e) {
            console.error('[Cloud] Upload dialog error:', e);
        }
    };

    const handleFileOpen = (file: CloudFileType) => {
        if (file.file_type === 'folder') {
            store.navigateToFolder(file.id);
        }
        // For files, double-click triggers download/export
    };

    const viewTitle = store.view === 'files' ? 'My Files'
        : store.view === 'recent' ? 'Recent Files'
            : store.view === 'starred' ? 'Starred'
                : 'Trash';

    const hasSelection = store.selectedIds.size > 0;

    return (
        <div className="flex h-full overflow-hidden">
            <CloudSidebar collapsed={sidebarCollapsed} />

            <div className="flex-1 flex flex-col bg-zinc-950/50 overflow-hidden">
                {/* Toolbar */}
                <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800/30 shrink-0">
                    <div className="flex items-center gap-2">
                        {/* Back button */}
                        {store.currentFolderId && (
                            <button
                                onClick={() => store.navigateBack()}
                                className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 transition-colors"
                            >
                                <ArrowLeft size={16} />
                            </button>
                        )}

                        {/* Breadcrumbs */}
                        <div className="flex items-center gap-1 text-sm">
                            <button
                                onClick={() => store.navigateToFolder(null)}
                                className="text-zinc-400 hover:text-zinc-200 font-semibold"
                            >
                                {viewTitle}
                            </button>
                            {store.breadcrumbs.map(crumb => (
                                <div key={crumb.id} className="flex items-center gap-1">
                                    <ChevronRight size={12} className="text-zinc-600" />
                                    <button
                                        onClick={() => store.navigateToFolder(crumb.id)}
                                        className="text-zinc-400 hover:text-zinc-200"
                                    >
                                        {crumb.name}
                                    </button>
                                </div>
                            ))}
                        </div>

                        <span className="text-xs text-zinc-600 ml-2">{store.files.length} items</span>

                        {hasSelection && (
                            <div className="flex items-center gap-1.5 ml-2">
                                <span className="text-xs text-sky-400 font-medium">{store.selectedIds.size} selected</span>
                                <button onClick={() => store.clearSelection()} className="p-0.5 rounded text-zinc-500 hover:text-zinc-300">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Search */}
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                            <input
                                value={store.searchQuery}
                                onChange={e => store.setSearchQuery(e.target.value)}
                                placeholder="Search files..."
                                className="pl-8 pr-3 py-1.5 rounded-lg bg-zinc-800/30 border border-zinc-700/20 text-sm text-zinc-300 w-44 placeholder-zinc-600 outline-none focus:border-sky-500/40"
                            />
                        </div>

                        {/* Upload */}
                        <button
                            onClick={handleUpload}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 transition-colors text-xs font-semibold"
                        >
                            <Upload size={14} />
                            Upload
                        </button>

                        {/* Trash actions */}
                        {store.view === 'trash' && store.files.length > 0 && (
                            <button
                                onClick={() => store.emptyTrash()}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors text-xs font-semibold"
                            >
                                <Trash2 size={14} />
                                Empty
                            </button>
                        )}
                    </div>
                </div>

                {/* Upload progress */}
                {store.uploading && (
                    <div className="px-4 py-2 border-b border-zinc-800/20 bg-zinc-900/40">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <Upload size={12} className="text-sky-400 animate-pulse" />
                            <span>Uploading... {store.uploadProgress}%</span>
                        </div>
                        <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${store.uploadProgress}%` }} />
                        </div>
                    </div>
                )}

                {/* File Table */}
                {store.files.length > 0 ? (
                    <div className="flex-1 overflow-y-auto">
                        {/* Table Header */}
                        <div className="grid grid-cols-[24px_1fr_100px_140px_40px] px-4 py-2 text-xs font-semibold text-zinc-600 uppercase tracking-wider border-b border-zinc-800/20 sticky top-0 bg-zinc-950/80 backdrop-blur-sm">
                            <span></span>
                            <button onClick={() => { store.setSortBy('name'); store.setSortOrder(store.sortOrder === 'asc' ? 'desc' : 'asc'); }} className="text-left hover:text-zinc-400 transition-colors">Name</button>
                            <button onClick={() => { store.setSortBy('size'); store.setSortOrder(store.sortOrder === 'asc' ? 'desc' : 'asc'); }} className="text-left hover:text-zinc-400 transition-colors">Size</button>
                            <button onClick={() => { store.setSortBy('date'); store.setSortOrder(store.sortOrder === 'asc' ? 'desc' : 'asc'); }} className="text-left hover:text-zinc-400 transition-colors">Modified</button>
                            <span></span>
                        </div>

                        {/* Rows */}
                        {store.files.map(file => (
                            <FileRow
                                key={file.id}
                                file={file}
                                isSelected={store.selectedIds.has(file.id)}
                                onSelect={() => store.toggleSelected(file.id)}
                                onOpen={() => handleFileOpen(file)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({ file, x: e.clientX, y: e.clientY });
                                }}
                            />
                        ))}

                        {/* Trash items with restore button */}
                        {store.view === 'trash' && (
                            <div className="px-4 py-3 text-center">
                                <span className="text-xs text-zinc-600">Items in trash will be permanently deleted after 30 days.</span>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Empty state */
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center space-y-4 max-w-sm">
                            <div className="w-20 h-20 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto">
                                <Shield size={32} className="text-sky-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-zinc-100 mb-1">
                                    {store.view === 'trash' ? 'Trash is Empty' : store.view === 'starred' ? 'No Starred Files' : 'Cloud Drive'}
                                </h3>
                                <p className="text-sm text-zinc-500 leading-relaxed">
                                    {store.view === 'trash'
                                        ? 'Deleted files will appear here.'
                                        : store.view === 'starred'
                                            ? 'Star important files for quick access.'
                                            : 'Your files, encrypted on-device before upload. Up to 200GB of secure cloud storage.'
                                    }
                                </p>
                            </div>
                            {store.view === 'files' && (
                                <div className="flex items-center justify-center gap-3">
                                    <button onClick={handleUpload} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/15 text-sky-400 hover:bg-sky-500/20 transition-colors text-sm font-semibold">
                                        <Upload size={16} />
                                        Upload Files
                                    </button>
                                    <button
                                        onClick={async () => { const name = prompt('Folder name:'); if (name) await store.createFolder(name); }}
                                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 transition-colors text-sm font-semibold"
                                    >
                                        <FolderPlus size={16} />
                                        New Folder
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* E2EE badge */}
                <div className="absolute bottom-6 right-6 flex items-center gap-2 pointer-events-none">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-xs font-medium text-sky-400">
                        <Shield size={12} />
                        <span>End-to-end encrypted</span>
                    </div>
                </div>
            </div>

            {/* Context menu */}
            {contextMenu && (
                <FileContextMenu
                    file={contextMenu.file}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
