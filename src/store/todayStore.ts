/**
 * todayStore.ts — Zustand store for Today Page enhancements:
 * - Study heatmap (daily study time tracking)
 * - Brain dump quick-capture
 * - Daily intention
 * - Daily question digest
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ─── Types ──────────────────────────────────────────────────── */

export interface StudyDay {
  date: string;       // ISO date 'YYYY-MM-DD'
  minutes: number;    // total study minutes
  sessions: number;   // number of sessions
}

export interface BrainDumpItem {
  id: string;
  text: string;
  createdAt: number;
  processed: boolean; // has the user turned it into a note or task
}

export interface DailyIntention {
  date: string;
  text: string;
}

/* ─── Store ──────────────────────────────────────────────────── */

interface TodayState {
  // Study Heatmap
  studyDays: StudyDay[];
  logStudyMinutes: (minutes: number) => void;
  getHeatmapData: () => StudyDay[];
  getTodayMinutes: () => number;
  getStreak: () => number;

  // Brain Dump
  brainDumpItems: BrainDumpItem[];
  addBrainDump: (text: string) => void;
  removeBrainDump: (id: string) => void;
  markBrainDumpProcessed: (id: string) => void;
  clearProcessedDumps: () => void;

  // Daily Intention
  intentions: DailyIntention[];
  setIntention: (text: string) => void;
  getTodayIntention: () => string;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export const useTodayStore = create<TodayState>()(
  persist(
    (set, get) => ({
      /* ── Study Heatmap ─────────────────────────────── */
      studyDays: [],

      logStudyMinutes: (minutes: number) => {
        const today = todayStr();
        set((s) => {
          const existing = s.studyDays.find((d) => d.date === today);
          if (existing) {
            return {
              studyDays: s.studyDays.map((d) =>
                d.date === today
                  ? { ...d, minutes: d.minutes + minutes, sessions: d.sessions + 1 }
                  : d
              ),
            };
          }
          return {
            studyDays: [...s.studyDays, { date: today, minutes, sessions: 1 }],
          };
        });
      },

      getHeatmapData: () => {
        // Return last 90 days of study data, filling gaps with 0
        const days: StudyDay[] = [];
        const now = new Date();
        const studyMap = new Map(get().studyDays.map((d) => [d.date, d]));

        for (let i = 89; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          days.push(studyMap.get(dateStr) ?? { date: dateStr, minutes: 0, sessions: 0 });
        }
        return days;
      },

      getTodayMinutes: () => {
        const today = todayStr();
        return get().studyDays.find((d) => d.date === today)?.minutes ?? 0;
      },

      getStreak: () => {
        const studyMap = new Map(get().studyDays.map((d) => [d.date, d]));
        let streak = 0;
        const now = new Date();

        for (let i = 0; i < 365; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          const day = studyMap.get(dateStr);
          if (day && day.minutes > 0) {
            streak++;
          } else if (i > 0) {
            // Skip today if no study yet, but break on any other gap
            break;
          }
        }
        return streak;
      },

      /* ── Brain Dump ────────────────────────────────── */
      brainDumpItems: [],

      addBrainDump: (text: string) => {
        set((s) => ({
          brainDumpItems: [
            { id: generateId(), text, createdAt: Date.now(), processed: false },
            ...s.brainDumpItems,
          ],
        }));
      },

      removeBrainDump: (id: string) => {
        set((s) => ({
          brainDumpItems: s.brainDumpItems.filter((b) => b.id !== id),
        }));
      },

      markBrainDumpProcessed: (id: string) => {
        set((s) => ({
          brainDumpItems: s.brainDumpItems.map((b) =>
            b.id === id ? { ...b, processed: true } : b
          ),
        }));
      },

      clearProcessedDumps: () => {
        set((s) => ({
          brainDumpItems: s.brainDumpItems.filter((b) => !b.processed),
        }));
      },

      /* ── Daily Intention ───────────────────────────── */
      intentions: [],

      setIntention: (text: string) => {
        const today = todayStr();
        set((s) => {
          const existing = s.intentions.find((i) => i.date === today);
          if (existing) {
            return {
              intentions: s.intentions.map((i) =>
                i.date === today ? { ...i, text } : i
              ),
            };
          }
          // Keep only last 30 days of intentions
          const recent = s.intentions.filter((i) => {
            const diff = Date.now() - new Date(i.date).getTime();
            return diff < 30 * 86400000;
          });
          return { intentions: [...recent, { date: today, text }] };
        });
      },

      getTodayIntention: () => {
        const today = todayStr();
        return get().intentions.find((i) => i.date === today)?.text ?? '';
      },
    }),
    {
      name: 'onyx_today',
    }
  )
);
