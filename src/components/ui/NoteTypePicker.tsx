import { useEffect, useRef } from 'react';
import type { NoteType } from '../../types/sync';

interface NoteTypePickerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (type: NoteType) => void;
}

const TYPES: { type: NoteType; icon: string; label: string; desc: string }[] = [
    { type: 'note', icon: '📄', label: 'Note', desc: 'General-purpose note' },
    { type: 'topic', icon: '🗂', label: 'Topic', desc: 'Organise related notes' },
    { type: 'idea', icon: '💡', label: 'Idea', desc: 'Capture a thought' },
    { type: 'task', icon: '✅', label: 'Task', desc: 'Track progress with metadata' },
    { type: 'resource', icon: '🔗', label: 'Resource', desc: 'Link to external content' },
    { type: 'study', icon: '📚', label: 'Study', desc: 'Flashcards auto-extract from Q:/A:' },
];

export default function NoteTypePicker({ isOpen, onClose, onSelect }: NoteTypePickerProps) {
    const ref = useRef<HTMLDivElement>(null);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Use timeout so the triggering click doesn't immediately close
        const t = setTimeout(() => document.addEventListener('mousedown', onClick), 50);
        return () => {
            clearTimeout(t);
            document.removeEventListener('mousedown', onClick);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
            <div
                ref={ref}
                className="bg-zinc-900 border border-purple-900/40 rounded-2xl p-5 shadow-2xl shadow-black/50 w-85"
                style={{ animation: 'fadeIn 0.15s ease-out' }}
            >
                <h2 className="text-sm font-semibold text-zinc-200 mb-1">New Page</h2>
                <p className="text-[12px] text-zinc-500 mb-4">Choose a page type to get started.</p>

                <div className="space-y-1.5">
                    {TYPES.map((t) => (
                        <button
                            key={t.type}
                            onClick={() => {
                                onSelect(t.type);
                                onClose();
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-purple-900/25 transition-all duration-150 text-left group cursor-pointer"
                        >
                            <span className="text-2xl">{t.icon}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium text-zinc-200 group-hover:text-white transition-colors">
                                    {t.label}
                                </div>
                                <div className="text-[11px] text-zinc-500 truncate">
                                    {t.desc}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
