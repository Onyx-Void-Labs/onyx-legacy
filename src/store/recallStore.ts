/**
 * recallStore.ts — Zustand store for Recall Mode state.
 * Tracks which recall marks are hidden, revealed, and overall progress.
 */

import { create } from 'zustand';

interface RecallStore {
  /** Whether Recall Mode is active */
  isActive: boolean;
  /** Set of recall IDs that have been revealed */
  revealedIds: Set<string>;
  /** Total number of recall marks in the current document */
  totalMarks: number;

  // Actions
  enterRecallMode: (totalMarks: number) => void;
  exitRecallMode: () => void;
  revealMark: (recallId: string) => void;
  revealAll: () => void;
  hideAll: () => void;

  // Computed
  getProgress: () => { revealed: number; total: number; percentage: number };
}

export const useRecallStore = create<RecallStore>((set, get) => ({
  isActive: false,
  revealedIds: new Set<string>(),
  totalMarks: 0,

  enterRecallMode: (totalMarks) => {
    set({
      isActive: true,
      revealedIds: new Set<string>(),
      totalMarks,
    });
  },

  exitRecallMode: () => {
    set({
      isActive: false,
      revealedIds: new Set<string>(),
      totalMarks: 0,
    });
  },

  revealMark: (recallId) => {
    set((s) => {
      const newSet = new Set(s.revealedIds);
      newSet.add(recallId);
      return { revealedIds: newSet };
    });
  },

  revealAll: () => {
    // We can't enumerate all IDs here without editor access,
    // so we use a sentinel
    set({ revealedIds: new Set(['__ALL__']) });
  },

  hideAll: () => {
    set({ revealedIds: new Set<string>() });
  },

  getProgress: () => {
    const { revealedIds, totalMarks } = get();
    const isAll = revealedIds.has('__ALL__');
    const revealed = isAll ? totalMarks : revealedIds.size;
    const percentage = totalMarks > 0 ? Math.round((revealed / totalMarks) * 100) : 0;
    return { revealed, total: totalMarks, percentage };
  },
}));
