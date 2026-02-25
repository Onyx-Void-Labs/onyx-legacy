import { useState } from 'react';

const ONBOARDED_KEY = 'onyx-onboarded';

interface OnboardingFlowProps {
    onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
    const [step, setStep] = useState(1);
    const [workspaceName, setWorkspaceName] = useState('My Notes');
    const [theme, setTheme] = useState<'dark' | 'soft-dark' | 'light'>('dark');

    const finish = () => {
        localStorage.setItem(ONBOARDED_KEY, 'true');
        if (workspaceName.trim()) {
            localStorage.setItem('onyx-workspace-name', workspaceName.trim());
        }
        onComplete();
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
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step 2 of 4</div>
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
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step 3 of 4</div>
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

                {/* Step 4 — Ready */}
                {step === 4 && (
                    <div className="space-y-6">
                        <div className="text-xs text-zinc-500 uppercase tracking-wider">Step 4 of 4</div>
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
