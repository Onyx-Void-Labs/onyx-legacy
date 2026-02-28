// src/components/settings/v2/tabs/CloudTab.tsx
// ─── Cloud Drive E2EE Settings ─────────────────────────────────────────────

import { useState, useEffect } from 'react';
import { Cloud, Shield, HardDrive, FolderOpen, Trash2, Download, Loader2, RotateCcw, History, Upload } from 'lucide-react';
import { IS_TAURI } from '@/hooks/usePlatform';
import { useCloudStore } from '@/store/cloudStore';

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

export default function CloudTab() {
    const store = useCloudStore();
    const [versioning, setVersioning] = useState(true);
    const [maxVersions, setMaxVersions] = useState(10);
    const [autoDeleteTrash, setAutoDeleteTrash] = useState(true);
    const [trashDays, setTrashDays] = useState(30);
    const [deduplication, setDeduplication] = useState(true);
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

    const totalBytes = store.stats?.total_size_bytes ?? 0;
    const maxBytes = 200 * 1024 * 1024 * 1024; // 200 GB
    const usagePercent = Math.min((totalBytes / maxBytes) * 100, 100);

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Header */}
            <div>
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
                        <Cloud size={20} className="text-sky-400" />
                    </div>
                    Cloud Drive
                </h2>
                <p className="text-sm text-zinc-500 mt-2">Manage your encrypted cloud storage settings.</p>
            </div>

            {/* Encryption Info */}
            <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/15">
                <div className="flex items-start gap-3">
                    <Shield size={18} className="text-purple-400 mt-0.5 shrink-0" />
                    <div>
                        <div className="text-sm font-semibold text-purple-300">End-to-End Encrypted</div>
                        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                            All files are encrypted on your device using SHA-256 key derivation before being stored.
                            File metadata (name, type, size) is also encrypted. Only you can access your files.
                        </p>
                    </div>
                </div>
            </div>

            {/* Storage Stats */}
            <Section title="Storage">
                <div className="py-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FolderOpen size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">Total Files</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">{store.stats?.total_files ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FolderOpen size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">Folders</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">{store.stats?.total_folders ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <HardDrive size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">Used Space</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">
                            {(() => {
                                if (totalBytes === 0) return '0 B';
                                const k = 1024;
                                const sizes = ['B', 'KB', 'MB', 'GB'];
                                const i = Math.floor(Math.log(totalBytes) / Math.log(k));
                                return `${parseFloat((totalBytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
                            })()}
                        </span>
                    </div>
                    {/* Progress bar */}
                    <div className="space-y-1.5 pt-1">
                        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-linear-to-r from-sky-500 to-blue-500 rounded-full transition-all"
                                style={{ width: `${usagePercent}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[10px] text-zinc-600">
                            <span>{usagePercent.toFixed(1)}% used</span>
                            <span>200 GB total</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Trash2 size={16} className="text-zinc-500" />
                            <span className="text-sm text-zinc-300">In Trash</span>
                        </div>
                        <span className="text-sm font-mono text-zinc-400">{store.stats?.trash_items ?? 0}</span>
                    </div>
                </div>
            </Section>

            {/* File Settings */}
            <Section title="Files">
                <ToggleRow
                    icon={History}
                    label="Version History"
                    description="Keep previous versions of files when re-uploading with the same name."
                    checked={versioning}
                    onChange={setVersioning}
                />
                {versioning && (
                    <div className="py-3 flex items-start gap-4">
                        <div className="w-9 h-9 rounded-xl bg-zinc-800/50 flex items-center justify-center shrink-0">
                            <History size={16} className="text-zinc-400" />
                        </div>
                        <div className="flex-1">
                            <div className="text-sm font-medium text-zinc-200">Max Versions</div>
                            <div className="text-xs text-zinc-500 mt-0.5 mb-2">Number of previous versions to retain per file.</div>
                            <div className="flex gap-2">
                                {[3, 5, 10, 25, 50].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setMaxVersions(n)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                            maxVersions === n
                                                ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                                : 'bg-zinc-800/50 text-zinc-400 border border-zinc-700/30 hover:bg-zinc-800'
                                        }`}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                <ToggleRow
                    icon={Upload}
                    label="Deduplication"
                    description="Skip uploading files that already exist in your drive (hash-based detection)."
                    checked={deduplication}
                    onChange={setDeduplication}
                />
            </Section>

            {/* Trash Settings */}
            <Section title="Trash Management">
                <ToggleRow
                    icon={RotateCcw}
                    label="Auto-delete Trash"
                    description={`Permanently delete trashed files after ${trashDays} days.`}
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
                        <div className="text-xs text-zinc-500 mt-0.5">Permanently delete all trashed files. This cannot be undone.</div>
                    </div>
                    <button
                        onClick={handleEmptyTrash}
                        disabled={purging || (store.stats?.trash_items ?? 0) === 0}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-semibold disabled:opacity-40 disabled:pointer-events-none"
                    >
                        {purging ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Empty Trash
                    </button>
                </div>
                <div className="py-4 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-zinc-200">Export All Files</div>
                        <div className="text-xs text-zinc-500 mt-0.5">Decrypt and export your entire cloud drive.</div>
                    </div>
                    <button
                        onClick={async () => {
                            if (!IS_TAURI) return;
                            const { open } = await import('@tauri-apps/plugin-dialog');
                            const dir = await open({ directory: true, title: 'Export all files to...' });
                            if (dir && typeof dir === 'string') {
                                console.log('[Cloud] Export to:', dir);
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
