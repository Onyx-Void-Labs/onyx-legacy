import { BookOpen } from 'lucide-react';
import type { NoteType } from '../types/sync';

/**
 * Emoji icons for note types — used in contexts that need plain string output.
 * For the Topic type, use NoteTypeIcon component instead for the Lucide icon.
 */
export const TYPE_EMOJI: Record<NoteType, string> = {
    note: '📄',
    topic: '📖',
    idea: '💡',
    task: '✅',
    resource: '🔗',
    journal: '📅',
    study: '📚',
};

/**
 * Renders the correct icon for a note type.
 * Topic uses Lucide BookOpen icon; all others use emojis.
 */
export function NoteTypeIcon({ type, size = 14, className = '' }: { type: NoteType; size?: number; className?: string }) {
    if (type === 'topic') {
        return <BookOpen size={size} className={`text-violet-400 ${className}`} />;
    }
    return <span className={className} style={{ fontSize: size }}>{TYPE_EMOJI[type]}</span>;
}
