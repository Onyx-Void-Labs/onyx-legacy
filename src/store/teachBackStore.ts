/**
 * teachBackStore.ts — Zustand store for Teach-Back Mode.
 * The user "teaches" concepts from their notes to a virtual student,
 * typing or speaking their explanation, then self-grades.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TeachBackPrompt {
  id: string;
  /** The concept/topic to explain */
  concept: string;
  /** Source note */
  noteId: string;
  noteTitle: string;
  /** User's explanation */
  explanation: string;
  /** Self-grade: 1-5 */
  grade: number | null;
  /** Timestamp */
  completedAt?: number;
}

export interface TeachBackSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  prompts: TeachBackPrompt[];
  averageGrade?: number;
}

interface TeachBackStore {
  isActive: boolean;
  activeSession: TeachBackSession | null;
  currentPromptIndex: number;
  sessions: TeachBackSession[];

  startSession: (prompts: Omit<TeachBackPrompt, 'id' | 'explanation' | 'grade'>[]) => void;
  endSession: () => void;
  setExplanation: (text: string) => void;
  gradePrompt: (grade: number) => void;
  nextPrompt: () => void;
  prevPrompt: () => void;
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export const useTeachBackStore = create<TeachBackStore>()(
  persist(
    (set, get) => ({
      isActive: false,
      activeSession: null,
      currentPromptIndex: 0,
      sessions: [],

      startSession: (promptDefs) => {
        const prompts: TeachBackPrompt[] = promptDefs.map((p) => ({
          ...p,
          id: genId(),
          explanation: '',
          grade: null,
        }));
        const session: TeachBackSession = {
          id: genId(),
          startedAt: Date.now(),
          prompts,
        };
        set({
          isActive: true,
          activeSession: session,
          currentPromptIndex: 0,
        });
      },

      endSession: () => {
        const { activeSession, sessions } = get();
        if (!activeSession) {
          set({ isActive: false });
          return;
        }

        const graded = activeSession.prompts.filter((p) => p.grade !== null);
        const avgGrade =
          graded.length > 0
            ? Math.round(
                (graded.reduce((sum, p) => sum + (p.grade || 0), 0) / graded.length) * 10
              ) / 10
            : undefined;

        const completed: TeachBackSession = {
          ...activeSession,
          endedAt: Date.now(),
          averageGrade: avgGrade,
        };

        set({
          isActive: false,
          activeSession: null,
          currentPromptIndex: 0,
          sessions: [...sessions, completed],
        });
      },

      setExplanation: (text) => {
        const { activeSession, currentPromptIndex } = get();
        if (!activeSession) return;

        const prompts = [...activeSession.prompts];
        prompts[currentPromptIndex] = {
          ...prompts[currentPromptIndex],
          explanation: text,
        };
        set({
          activeSession: { ...activeSession, prompts },
        });
      },

      gradePrompt: (grade) => {
        const { activeSession, currentPromptIndex } = get();
        if (!activeSession) return;

        const prompts = [...activeSession.prompts];
        prompts[currentPromptIndex] = {
          ...prompts[currentPromptIndex],
          grade,
          completedAt: Date.now(),
        };
        set({
          activeSession: { ...activeSession, prompts },
        });
      },

      nextPrompt: () => {
        const { activeSession, currentPromptIndex } = get();
        if (!activeSession) return;
        if (currentPromptIndex < activeSession.prompts.length - 1) {
          set({ currentPromptIndex: currentPromptIndex + 1 });
        }
      },

      prevPrompt: () => {
        const { currentPromptIndex } = get();
        if (currentPromptIndex > 0) {
          set({ currentPromptIndex: currentPromptIndex - 1 });
        }
      },
    }),
    {
      name: 'onyx_teach_back',
      partialize: (state) => ({ sessions: state.sessions }),
    }
  )
);
