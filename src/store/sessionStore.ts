/**
 * sessionStore.ts — Zustand store for Session Mode (Pomodoro-style study timer).
 * Tracks focus intervals, break periods, and session history.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SessionPhase = 'focus' | 'break' | 'idle';

export interface SessionConfig {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  /** Number of focus intervals before a long break */
  longBreakInterval: number;
}

export interface CompletedSession {
  id: string;
  startedAt: number;
  endedAt: number;
  focusIntervals: number;
  totalFocusMs: number;
  totalBreakMs: number;
  noteId?: string;
  noteTitle?: string;
}

interface SessionStore {
  // Current session state
  phase: SessionPhase;
  isRunning: boolean;
  /** Time remaining in current phase (milliseconds) */
  timeRemainingMs: number;
  /** Total focus intervals completed in current session */
  intervalsCompleted: number;
  /** When the current phase started */
  phaseStartedAt: number | null;
  /** When the session started */
  sessionStartedAt: number | null;
  /** Accumulated focus time this session */
  totalFocusMs: number;
  /** Accumulated break time this session */
  totalBreakMs: number;

  // Config
  config: SessionConfig;

  // History
  history: CompletedSession[];

  // Context
  activeNoteId: string | null;
  activeNoteTitle: string | null;

  // Actions
  setConfig: (config: Partial<SessionConfig>) => void;
  startSession: (noteId?: string, noteTitle?: string) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  endSession: () => void;
  tick: () => void;
  skipPhase: () => void;

  // Query
  getHistory: (limit?: number) => CompletedSession[];
  getTodayFocusMinutes: () => number;
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

const DEFAULT_CONFIG: SessionConfig = {
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      phase: 'idle',
      isRunning: false,
      timeRemainingMs: DEFAULT_CONFIG.focusMinutes * 60 * 1000,
      intervalsCompleted: 0,
      phaseStartedAt: null,
      sessionStartedAt: null,
      totalFocusMs: 0,
      totalBreakMs: 0,
      config: DEFAULT_CONFIG,
      history: [],
      activeNoteId: null,
      activeNoteTitle: null,

      setConfig: (partial) => {
        set((s) => ({
          config: { ...s.config, ...partial },
        }));
      },

      startSession: (noteId, noteTitle) => {
        const { config } = get();
        set({
          phase: 'focus',
          isRunning: true,
          timeRemainingMs: config.focusMinutes * 60 * 1000,
          intervalsCompleted: 0,
          phaseStartedAt: Date.now(),
          sessionStartedAt: Date.now(),
          totalFocusMs: 0,
          totalBreakMs: 0,
          activeNoteId: noteId || null,
          activeNoteTitle: noteTitle || null,
        });
      },

      pauseSession: () => {
        set({ isRunning: false });
      },

      resumeSession: () => {
        set({ isRunning: true, phaseStartedAt: Date.now() });
      },

      endSession: () => {
        const state = get();
        if (state.sessionStartedAt) {
          const completed: CompletedSession = {
            id: genId(),
            startedAt: state.sessionStartedAt,
            endedAt: Date.now(),
            focusIntervals: state.intervalsCompleted,
            totalFocusMs: state.totalFocusMs,
            totalBreakMs: state.totalBreakMs,
            noteId: state.activeNoteId || undefined,
            noteTitle: state.activeNoteTitle || undefined,
          };
          set((s) => ({
            phase: 'idle',
            isRunning: false,
            timeRemainingMs: s.config.focusMinutes * 60 * 1000,
            intervalsCompleted: 0,
            phaseStartedAt: null,
            sessionStartedAt: null,
            totalFocusMs: 0,
            totalBreakMs: 0,
            activeNoteId: null,
            activeNoteTitle: null,
            history: [...s.history, completed],
          }));
        } else {
          set({
            phase: 'idle',
            isRunning: false,
          });
        }
      },

      tick: () => {
        const state = get();
        if (!state.isRunning || state.phase === 'idle') return;

        const elapsed = 1000; // called every 1 second
        const newRemaining = state.timeRemainingMs - elapsed;

        if (newRemaining <= 0) {
          // Phase complete — transition
          if (state.phase === 'focus') {
            const newIntervals = state.intervalsCompleted + 1;
            const isLongBreak =
              newIntervals % state.config.longBreakInterval === 0;
            const breakMs = isLongBreak
              ? state.config.longBreakMinutes * 60 * 1000
              : state.config.breakMinutes * 60 * 1000;

            // Play notification sound
            try {
              const audio = new Audio('/notification.mp3');
              audio.volume = 0.3;
              audio.play().catch(() => {});
            } catch {}

            set({
              phase: 'break',
              timeRemainingMs: breakMs,
              intervalsCompleted: newIntervals,
              totalFocusMs: state.totalFocusMs + state.config.focusMinutes * 60 * 1000,
              phaseStartedAt: Date.now(),
            });
          } else if (state.phase === 'break') {
            // Break complete — back to focus
            try {
              const audio = new Audio('/notification.mp3');
              audio.volume = 0.3;
              audio.play().catch(() => {});
            } catch {}

            set({
              phase: 'focus',
              timeRemainingMs: state.config.focusMinutes * 60 * 1000,
              totalBreakMs: state.totalBreakMs + (state.config.breakMinutes * 60 * 1000),
              phaseStartedAt: Date.now(),
            });
          }
        } else {
          set({ timeRemainingMs: newRemaining });
        }
      },

      skipPhase: () => {
        const state = get();
        if (state.phase === 'focus') {
          // Skip to break
          const newIntervals = state.intervalsCompleted + 1;
          const isLongBreak =
            newIntervals % state.config.longBreakInterval === 0;
          const breakMs = isLongBreak
            ? state.config.longBreakMinutes * 60 * 1000
            : state.config.breakMinutes * 60 * 1000;
          set({
            phase: 'break',
            timeRemainingMs: breakMs,
            intervalsCompleted: newIntervals,
            phaseStartedAt: Date.now(),
          });
        } else if (state.phase === 'break') {
          // Skip to focus
          set({
            phase: 'focus',
            timeRemainingMs: state.config.focusMinutes * 60 * 1000,
            phaseStartedAt: Date.now(),
          });
        }
      },

      getHistory: (limit = 20) => {
        return get()
          .history.slice(-limit)
          .reverse();
      },

      getTodayFocusMinutes: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();

        return get()
          .history.filter((s) => s.startedAt >= todayMs)
          .reduce((sum, s) => sum + s.totalFocusMs, 0) / 60000;
      },
    }),
    {
      name: 'onyx_session_mode',
      partialize: (state) => ({
        config: state.config,
        history: state.history,
      }),
    }
  )
);
