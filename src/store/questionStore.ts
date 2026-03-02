/**
 * questionStore.ts — Zustand store for the Question Library.
 * Persisted to localStorage. Supports CRUD, practice sessions, filtering.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Question,
  QuestionDifficulty,
  QuestionStatus,
  PracticeSession,
} from '@/lib/questions/questionTypes';

interface QuestionFilters {
  noteId?: string;
  difficulty?: QuestionDifficulty;
  status?: QuestionStatus;
  tags?: string[];
  search?: string;
}

interface QuestionStore {
  // ─── Data ──────────────────────────────────────────────────
  questions: Question[];
  sessions: PracticeSession[];
  activeSessionId: string | null;

  // ─── CRUD ──────────────────────────────────────────────────
  addQuestion: (q: Omit<Question, 'id'>) => string;
  addQuestions: (qs: Omit<Question, 'id'>[]) => string[];
  updateQuestion: (id: string, patch: Partial<Question>) => void;
  removeQuestion: (id: string) => void;
  removeQuestionsForNote: (noteId: string) => void;

  // ─── Query ─────────────────────────────────────────────────
  getQuestion: (id: string) => Question | undefined;
  getFilteredQuestions: (filters: QuestionFilters) => Question[];
  getQuestionsForNote: (noteId: string) => Question[];
  getQuestionStats: () => {
    total: number;
    correct: number;
    incorrect: number;
    unanswered: number;
    skipped: number;
  };

  // ─── Practice Session ──────────────────────────────────────
  startPracticeSession: (questionIds: string[]) => string;
  recordAnswer: (questionId: string, status: QuestionStatus) => void;
  endPracticeSession: () => PracticeSession | null;
  getActiveSession: () => PracticeSession | null;

  // ─── Due Questions (spaced repetition-style) ───────────────
  getDueQuestions: (limit?: number) => Question[];
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export const useQuestionStore = create<QuestionStore>()(
  persist(
    (set, get) => ({
      questions: [],
      sessions: [],
      activeSessionId: null,

      // ─── CRUD ────────────────────────────────────────────────
      addQuestion: (q) => {
        const id = generateId();
        const question: Question = { ...q, id };
        set((s) => ({ questions: [...s.questions, question] }));
        return id;
      },

      addQuestions: (qs) => {
        const ids: string[] = [];
        const newQuestions: Question[] = qs.map((q) => {
          const id = generateId();
          ids.push(id);
          return { ...q, id };
        });
        set((s) => ({ questions: [...s.questions, ...newQuestions] }));
        return ids;
      },

      updateQuestion: (id, patch) => {
        set((s) => ({
          questions: s.questions.map((q) =>
            q.id === id ? { ...q, ...patch } : q
          ),
        }));
      },

      removeQuestion: (id) => {
        set((s) => ({
          questions: s.questions.filter((q) => q.id !== id),
        }));
      },

      removeQuestionsForNote: (noteId) => {
        set((s) => ({
          questions: s.questions.filter((q) => q.noteId !== noteId),
        }));
      },

      // ─── Query ───────────────────────────────────────────────
      getQuestion: (id) => {
        return get().questions.find((q) => q.id === id);
      },

      getFilteredQuestions: (filters) => {
        let result = get().questions;

        if (filters.noteId) {
          result = result.filter((q) => q.noteId === filters.noteId);
        }
        if (filters.difficulty) {
          result = result.filter((q) => q.difficulty === filters.difficulty);
        }
        if (filters.status) {
          result = result.filter((q) => q.status === filters.status);
        }
        if (filters.tags && filters.tags.length > 0) {
          result = result.filter((q) =>
            filters.tags!.some((t) => q.tags.includes(t))
          );
        }
        if (filters.search) {
          const s = filters.search.toLowerCase();
          result = result.filter(
            (q) =>
              q.question.toLowerCase().includes(s) ||
              q.answer.toLowerCase().includes(s) ||
              q.noteTitle.toLowerCase().includes(s)
          );
        }

        return result;
      },

      getQuestionsForNote: (noteId) => {
        return get().questions.filter((q) => q.noteId === noteId);
      },

      getQuestionStats: () => {
        const qs = get().questions;
        return {
          total: qs.length,
          correct: qs.filter((q) => q.status === 'correct').length,
          incorrect: qs.filter((q) => q.status === 'incorrect').length,
          unanswered: qs.filter((q) => q.status === 'unanswered').length,
          skipped: qs.filter((q) => q.status === 'skipped').length,
        };
      },

      // ─── Practice Session ────────────────────────────────────
      startPracticeSession: (questionIds) => {
        const id = generateId();
        const session: PracticeSession = {
          id,
          startedAt: Date.now(),
          questionIds,
          results: {},
        };
        set((s) => ({
          sessions: [...s.sessions, session],
          activeSessionId: id,
        }));
        return id;
      },

      recordAnswer: (questionId, status) => {
        const state = get();
        const activeId = state.activeSessionId;
        if (!activeId) return;

        // Update session results
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === activeId
              ? { ...sess, results: { ...sess.results, [questionId]: status } }
              : sess
          ),
          // Update the question itself
          questions: s.questions.map((q) =>
            q.id === questionId
              ? {
                  ...q,
                  status,
                  lastPracticedAt: Date.now(),
                  practiceCount: q.practiceCount + 1,
                  streak: status === 'correct' ? q.streak + 1 : 0,
                }
              : q
          ),
        }));
      },

      endPracticeSession: () => {
        const state = get();
        const activeId = state.activeSessionId;
        if (!activeId) return null;

        const session = state.sessions.find((s) => s.id === activeId);
        if (!session) return null;

        const totalAnswered = Object.keys(session.results).length;
        const correctCount = Object.values(session.results).filter(
          (r) => r === 'correct'
        ).length;
        const score =
          totalAnswered > 0
            ? Math.round((correctCount / totalAnswered) * 100)
            : 0;

        const endedSession = { ...session, endedAt: Date.now(), score };

        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === activeId ? endedSession : sess
          ),
          activeSessionId: null,
        }));

        return endedSession;
      },

      getActiveSession: () => {
        const state = get();
        if (!state.activeSessionId) return null;
        return (
          state.sessions.find((s) => s.id === state.activeSessionId) || null
        );
      },

      // ─── Due Questions (simple spaced repetition) ─────────────
      getDueQuestions: (limit = 20) => {
        const now = Date.now();
        const qs = get().questions;

        // Simple interval calculation based on streak
        // streak 0 → due immediately
        // streak 1 → due after 1 day
        // streak 2 → due after 3 days
        // streak 3 → due after 7 days
        // streak 4+ → due after 14 days
        const intervalMs = (streak: number): number => {
          const days = [0, 1, 3, 7, 14];
          const d = days[Math.min(streak, days.length - 1)];
          return d * 24 * 60 * 60 * 1000;
        };

        const due = qs
          .filter((q) => {
            if (q.status === 'unanswered') return true;
            if (!q.lastPracticedAt) return true;
            const interval = intervalMs(q.streak);
            return now - q.lastPracticedAt >= interval;
          })
          .sort((a, b) => {
            // Unanswered first, then by last practiced (oldest first)
            if (a.status === 'unanswered' && b.status !== 'unanswered')
              return -1;
            if (b.status === 'unanswered' && a.status !== 'unanswered')
              return 1;
            return (a.lastPracticedAt || 0) - (b.lastPracticedAt || 0);
          });

        return due.slice(0, limit);
      },
    }),
    {
      name: 'onyx_question_library',
    }
  )
);
