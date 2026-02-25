import { useState } from 'react';
import { FileText, Upload, CheckCircle2, Sparkles } from 'lucide-react';

const ONBOARDED_KEY = 'onyx-onboarded';
const TOTAL_STEPS = 5;

interface OnboardingFlowProps {
    onComplete: () => void;
}

interface ImportedNote {
    name: string;
    content: string;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
    const [step, setStep] = useState(1);
    const [workspaceName, setWorkspaceName] = useState('My Notes');
    const [theme, setTheme] = useState<'dark' | 'soft-dark' | 'light'>('dark');
    const [importedFiles, setImportedFiles] = useState<ImportedNote[]>([]);
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);

    const finish = () => {
        localStorage.setItem(ONBOARDED_KEY, 'true');
        if (workspaceName.trim()) {
            localStorage.setItem('onyx-workspace-name', workspaceName.trim());
        }
        // Store imported notes for App to pick up on mount
        if (importedFiles.length > 0) {
            localStorage.setItem('onyx-import-pending', JSON.stringify(importedFiles));
        }
        onComplete();
    };

    const handleImportFiles = async () => {
        setImporting(true);
        setImportError(null);
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const { readTextFile } = await import('@tauri-apps/plugin-fs');

            const selected = await open({
                multiple: true,
                filters: [
                    { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
                ],
            });

            if (selected && Array.isArray(selected)) {
                const notes: ImportedNote[] = [];
                for (const filePath of selected) {
                    try {
                        const content = await readTextFile(filePath);
                        // Extract filename without extension as note title
                        const parts = filePath.replace(/\\/g, '/').split('/');
                        const filename = parts[parts.length - 1];
                        const name = filename.replace(/\.(md|markdown|txt)$/i, '');
                        notes.push({ name, content });
                    } catch {
                        // Skip unreadable files
                    }
                }
                setImportedFiles((prev) => [...prev, ...notes]);
            }
        } catch (err) {
            setImportError('Import failed. You can import later from Settings.');
            console.error('Import error:', err);
        } finally {
            setImporting(false);
        }
    };

    const removeImported = (idx: number) => {
        setImportedFiles((prev) => prev.filter((_, i) => i !== idx));
    };

    return (
        <div className="fixed inset-0 z-99999 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)' }}>
            <div className="w-full max-w-md p-8 text-center animate-fade-in-up">

                {/* Step 1 — Welcome */}
                {step === 1 && (
                    <div className="space-y-6">
                        <div className="text-4xl font-bold tracking-tight text-zinc-100">
                            ONYX<span className="text-violet-400">.</span>
                        </div>
                        <p className="text-sm text-zinc-400 max-w-xs mx-auto">
                            Your private, offline-first workspace for notes, study, and thinking.
                        </p>
                        <button
                            onClick={() => setStep(2)}
                            className="px-6 py-2.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                        >
                            Get started →
                        </button>
                    </div>
                )}

                {/* Step 2 — Workspace Name */}
                {step === 2 && (
                    <div className="space-y-6">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step 2 of {TOTAL_STEPS}</div>
                        <h2 className="text-lg font-semibold text-zinc-200">Create your first workspace</h2>
                        <p className="text-sm text-zinc-500">Type a name for your workspace</p>
                        <input
                            type="text"
                            value={workspaceName}
                            onChange={(e) => setWorkspaceName(e.target.value)}
                            placeholder="My Notes"
                            className="w-full bg-zinc-800 text-sm text-zinc-200 rounded-lg px-4 py-2.5 outline-none border border-zinc-700/60 focus:border-violet-500 text-center"
                            autoFocus
                        />
                        <button
                            onClick={() => setStep(3)}
                            className="px-6 py-2.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                        >
                            Continue →
                        </button>
                    </div>
                )}

                {/* Step 3 — Theme */}
                {step === 3 && (
                    <div className="space-y-6">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step 3 of {TOTAL_STEPS}</div>
                        <h2 className="text-lg font-semibold text-zinc-200">Pick your style</h2>
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={() => setTheme('dark')}
                                className={`flex flex-col items-center gap-2 px-5 py-4 rounded-xl border transition-all cursor-pointer ${
                                    theme === 'dark'
                                        ? 'border-violet-500 bg-violet-500/10'
                                        : 'border-zinc-700/40 hover:border-zinc-600'
                                }`}
                            >
                                <span className="text-xl">🌑</span>
                                <span className="text-xs text-zinc-300">Dark</span>
                            </button>
                            <button
                                onClick={() => setTheme('soft-dark')}
                                className={`flex flex-col items-center gap-2 px-5 py-4 rounded-xl border transition-all cursor-pointer ${
                                    theme === 'soft-dark'
                                        ? 'border-violet-500 bg-violet-500/10'
                                        : 'border-zinc-700/40 hover:border-zinc-600'
                                }`}
                            >
                                <span className="text-xl">🌤</span>
                                <span className="text-xs text-zinc-300">Soft Dark</span>
                            </button>
                            <div className="flex flex-col items-center gap-2 px-5 py-4 rounded-xl border border-zinc-800/40 opacity-40 cursor-not-allowed">
                                <span className="text-xl">☀️</span>
                                <span className="text-xs text-zinc-500">Light</span>
                                <span className="text-[9px] text-zinc-600">Coming soon</span>
                            </div>
                        </div>
                        <button
                            onClick={() => setStep(4)}
                            className="px-6 py-2.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                        >
                            Continue →
                        </button>
                    </div>
                )}

                {/* Step 4 — Import */}
                {step === 4 && (
                    <div className="space-y-6">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step 4 of {TOTAL_STEPS}</div>
                        <h2 className="text-lg font-semibold text-zinc-200">Import your notes</h2>
                        <p className="text-sm text-zinc-500 max-w-xs mx-auto">
                            Bring in Markdown files from other apps, or skip to start fresh.
                        </p>

                        <button
                            onClick={handleImportFiles}
                            disabled={importing}
                            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg border border-dashed border-zinc-600 text-zinc-300 hover:border-violet-500/50 hover:text-violet-300 hover:bg-violet-500/5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Upload size={16} />
                            {importing ? 'Importing…' : 'Select files (.md, .txt)'}
                        </button>

                        {importError && (
                            <p className="text-xs text-amber-400">{importError}</p>
                        )}

                        {importedFiles.length > 0 && (
                            <div className="max-h-36 overflow-y-auto space-y-1 text-left bg-zinc-800/40 rounded-lg p-2">
                                {importedFiles.map((f, i) => (
                                    <div key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-700/30 group">
                                        <FileText size={12} className="text-zinc-500 shrink-0" />
                                        <span className="text-xs text-zinc-300 truncate flex-1">{f.name}</span>
                                        <button
                                            onClick={() => removeImported(i)}
                                            className="text-zinc-600 hover:text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                                <div className="text-[10px] text-zinc-600 text-center pt-1">
                                    {importedFiles.length} file{importedFiles.length !== 1 ? 's' : ''} ready to import
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={() => setStep(5)}
                                className="px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                            >
                                Skip
                            </button>
                            <button
                                onClick={() => setStep(5)}
                                className="px-6 py-2.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                            >
                                Continue →
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 5 — Ready */}
                {step === 5 && (
                    <div className="space-y-6">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step {TOTAL_STEPS} of {TOTAL_STEPS}</div>
                        <div className="flex items-center justify-center">
                            <Sparkles size={28} className="text-violet-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-200">You're ready</h2>
                        <p className="text-sm text-zinc-400 mb-4">Here's what you can do:</p>
                        <div className="text-left space-y-2 max-w-xs mx-auto">
                            <div className="flex items-center gap-2 text-xs text-zinc-300">
                                <span className="text-violet-400">•</span>
                                Type '/' in any note for commands
                            </div>
                            <div className="flex items-center gap-2 text-xs text-zinc-300">
                                <span className="text-violet-400">•</span>
                                Press Ctrl+P to search everything
                            </div>
                            <div className="flex items-center gap-2 text-xs text-zinc-300">
                                <span className="text-violet-400">•</span>
                                Use '+' to link notes together
                            </div>
                            <div className="flex items-center gap-2 text-xs text-zinc-300">
                                <span className="text-violet-400">•</span>
                                Flashcards auto-extract from your notes
                            </div>
                        </div>
                        {importedFiles.length > 0 && (
                            <div className="flex items-center justify-center gap-2 text-xs text-emerald-400">
                                <CheckCircle2 size={14} />
                                {importedFiles.length} note{importedFiles.length !== 1 ? 's' : ''} will be imported
                            </div>
                        )}
                        <button
                            onClick={finish}
                            className="px-6 py-2.5 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                        >
                            Open Onyx →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function shouldShowOnboarding(): boolean {
    return localStorage.getItem(ONBOARDED_KEY) === null;
}
