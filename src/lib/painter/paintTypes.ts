/**
 * paintTypes.ts — Paint type definitions and metadata for the Painter system.
 * Paint annotations power Question Library, Recall Mode, Slides, and Teach-Back.
 */

export type PaintType = 'question' | 'answer' | 'slide' | 'recall' | 'key_term';

export interface PaintMeta {
  label: string;
  shortLabel: string;
  color: string;
  border: string;
  borderColor: string;
  bgHex: string;
}

export const PAINT_META: Record<PaintType, PaintMeta> = {
  question: {
    label: 'Question',
    shortLabel: 'Q',
    color: 'bg-yellow-500/10',
    border: 'border-l-yellow-400',
    borderColor: '#facc15',
    bgHex: 'rgba(234, 179, 8, 0.08)',
  },
  answer: {
    label: 'Answer',
    shortLabel: 'A',
    color: 'bg-green-500/10',
    border: 'border-l-green-400',
    borderColor: '#4ade80',
    bgHex: 'rgba(34, 197, 94, 0.08)',
  },
  slide: {
    label: 'Slide',
    shortLabel: 'S',
    color: 'bg-blue-500/10',
    border: 'border-l-blue-400',
    borderColor: '#60a5fa',
    bgHex: 'rgba(59, 130, 246, 0.08)',
  },
  recall: {
    label: 'Recall',
    shortLabel: 'R',
    color: 'bg-red-500/10',
    border: 'border-l-red-400',
    borderColor: '#f87171',
    bgHex: 'rgba(239, 68, 68, 0.08)',
  },
  key_term: {
    label: 'Key Term',
    shortLabel: 'K',
    color: 'bg-purple-500/10',
    border: 'border-l-purple-500',
    borderColor: '#a855f7',
    bgHex: 'rgba(168, 85, 247, 0.08)',
  },
};

export const PAINT_TYPES: PaintType[] = ['question', 'answer', 'slide', 'recall', 'key_term'];

/**
 * Annotation stored in the Yjs paint_annotations map.
 */
export interface PaintAnnotation {
  type: PaintType;
  groupId?: string;
}
