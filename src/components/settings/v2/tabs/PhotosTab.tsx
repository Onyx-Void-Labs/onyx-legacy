// src/components/settings/v2/tabs/PhotosTab.tsx
// ─── Photos E2EE Settings ──────────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Image, Shield, HardDrive, Grid3x3, Trash2, Download, Loader2, RotateCcw, Eye } from 'lucide-react';
import { IS_TAURI } from '@/hooks/usePlatform';
import { usePhotosStore } from '@/store/photosStore';

// ─── Toggle Row ──────────────────────────────────────────────────────────────

function ToggleRow({ label, description, checked, onChange, icon: Icon }: {
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
    return (
        <div className="flex items-start gap-4 py-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-800/50 flex items-center justify-center shrink-0">
                <Icon size={16} className="text-zinc-400" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-200">{label}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{description}</div>
            </div>
            <button
                onClick={() => onChange(!checked)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-purple-500' : 'bg-zinc-700'}`}
            >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
            </button>
        </div>
    );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-600 px-1 mb-3">{title}</h3>
            <div className="bg-zinc-900/40 rounded-xl border border-zinc-800/30 divide-y divide-zinc-800/20 px-4">
                {children}
            </div>
        </div>
    );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

export default function PhotosTab() {
    const store = usePhotosStore();
    const [autoThumbnails, setAutoThumbnails] = useState(true);
    const [gridSize, setGridSize] = useState<'small' | 'medium' | 'large'>('medium');
    const [autoDeleteTrash, setAutoDeleteTrash] = useState(true);
    const [trashDays, setTrashDays] = useState(30);
    const [showExif, setShowExif] = useState(false);
    const [purging, setPurging] = useState(false);

    useEffect(() => {
        store.loadStats();
    }, []);

    const handleEmptyTrash = async () => {
        setPurging(true);
        try {
            await store.emptyTrash();
        } finally {
            setPurging(false);
        }
    };

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Header */}
            <div>
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                        <Image size={20} className="text-rose-400" />
                    </div>
                    Photos
                </h2>
                <p className="text-sm text-zinc-500 mt-2">Manage your encrypted photo library settings.</p>
            </div>

            {/* Encryption Info */}
            <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/15">
                <div className="flex items-start gap-3">
                    <Shield size={18} className="text-purple-400 mt-0.5 shrink-0" />
                    <div>
                        <div className="text-sm font-semibold text-purple-300">End-to-End Encrypted</div>
                        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                            All photos are encrypted on-device using SHA-256 key derivation before storage.
                            Thumbnails are generated and encrypted separately. Only you can decrypt your photos.
                        </p>
                    </div>
                </div>
            </div>

            {/* Storage Stats */}
            <Section title="Storage">
                <div className="py-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <HardDrive size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">Total Photos</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">{store.stats?.total_photos ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <HardDrive size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">Encrypted Size</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">
                            {(() => {
                                const bytes = store.stats?.total_size_bytes ?? 0;
                                if (bytes === 0) return '0 B';
                                const k = 1024;
                                const sizes = ['B', 'KB', 'MB', 'GB'];
                                const i = Math.floor(Math.log(bytes) / Math.log(k));
                                return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
                            })()}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Trash2 size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">In Trash</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">{store.stats?.trash_count ?? 0}</span>
                    </div>
                </div>
            </Section>

            {/* Gallery Settings */}
            <Section title="Gallery">
                <ToggleRow
                    icon={Image}
                    label="Auto-generate Thumbnails"
                    description="Create encrypted thumbnails when uploading photos for faster browsing."
                    checked={autoThumbnails}
                    onChange={setAutoThumbnails}
                />
                <div className="py-3 flex items-start gap-4">
                    <div className="w-9 h-9 rounded-xl bg-zinc-800/50 flex items-center justify-center shrink-0">
                        <Grid3x3 size={16} className="text-zinc-400" />
                    </div>
                    <div className="flex-1">
                        <div className="text-sm font-medium text-zinc-200">Grid Size</div>
                        <div className="text-xs text-zinc-500 mt-0.5 mb-2">Default thumbnail grid density.</div>
                        <div className="flex gap-2">
                            {(['small', 'medium', 'large'] as const).map(size => (
                                <button
                                    key={size}
                                    onClick={() => setGridSize(size)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                        gridSize === size
                                            ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                            : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700/30 hover:bg-zinc-800'
                                    }`}
                                >
                                    {size.charAt(0).toUpperCase() + size.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <ToggleRow
                    icon={Eye}
                    label="Show EXIF Data"
                    description="Display camera and location metadata in the photo viewer."
                    checked={showExif}
                    onChange={setShowExif}
                />
            </Section>

            {/* Trash Settings */}
            <Section title="Trash Management">
                <ToggleRow
                    icon={RotateCcw}
                    label="Auto-delete Trash"
                    description={`Permanently delete trashed photos after ${trashDays} days.`}
                    checked={autoDeleteTrash}
                    onChange={setAutoDeleteTrash}
                />
                {autoDeleteTrash && (
                    <div className="py-3 flex items-start gap-4">
                        <div className="w-9 h-9 rounded-xl bg-zinc-800/50 flex items-center justify-center shrink-0">
                            <Trash2 size={16} className="text-zinc-400" />
                        </div>
                        <div className="flex-1">
                            <div className="text-sm font-medium text-zinc-200">Trash Retention</div>
                            <div className="text-xs text-zinc-500 mt-0.5 mb-2">Days before auto-delete.</div>
                            <div className="flex gap-2">
                                {[7, 14, 30, 60, 90].map(days => (
                                    <button
                                        key={days}
                                        onClick={() => setTrashDays(days)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                            trashDays === days
                                                ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                                : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700/30 hover:bg-zinc-800'
                                        }`}
                                    >
                                        {days}d
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </Section>

            {/* Danger Zone */}
            <Section title="Danger Zone">
                <div className="py-4 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-zinc-200">Empty Trash</div>
                        <div className="text-xs text-zinc-500 mt-0.5">Permanently delete all trashed photos. This cannot be undone.</div>
                    </div>
                    <button
                        onClick={handleEmptyTrash}
                        disabled={purging || (store.stats?.trash_count ?? 0) === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-semibold disabled:opacity-40 disabled:pointer-events-none"
                    >
                        {purging ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Empty Trash
                    </button>
                </div>
                <div className="py-4 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-zinc-200">Export All Photos</div>
                        <div className="text-xs text-zinc-500 mt-0.5">Decrypt and export your entire photo library.</div>
                    </div>
                    <button
                        onClick={async () => {
                            if (!IS_TAURI) return;
                            const { open } = await import('@tauri-apps/plugin-dialog');
                            const dir = await open({ directory: true, title: 'Export all photos to...' });
                            if (dir && typeof dir === 'string') {
                                // Mass export would be handled by iterating photos
                                console.log('[Photos] Export to:', dir);
                            }
                        }}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800 transition-colors text-xs font-semibold"
                    >
                        <Download size={14} />
                        Export All
                    </button>
                </div>
            </Section>
        </div>
    );
}
