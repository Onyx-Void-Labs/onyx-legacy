/**
 * transcriptionStore.ts — Zustand store for offline audio transcription.
 * Manages recording state, transcription results, and model download status.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ─── Types ──────────────────────────────────────────────────── */

export type TranscriptionStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface TranscriptionSegment {
  start: number;  // seconds
  end: number;
  text: string;
}

export interface TranscriptionResult {
  id: string;
  noteId?: string;        // if linked to a note
  filename: string;
  duration: number;        // seconds
  segments: TranscriptionSegment[];
  fullText: string;
  createdAt: number;
  language: string;
}

export interface ModelInfo {
  key: string;             // e.g. 'whisper-base-en'
  label: string;
  sizeBytes: number;
  downloaded: boolean;
  downloadProgress: number; // 0-100
  path?: string;           // local path once downloaded
}

/* ─── Store ──────────────────────────────────────────────────── */

interface TranscriptionState {
  // Recording
  status: TranscriptionStatus;
  recordingStartedAt: number | null;
  audioBlob: Blob | null;

  // Results
  results: TranscriptionResult[];
  activeResultId: string | null;

  // Model
  model: ModelInfo;

  // Actions
  startRecording: () => void;
  stopRecording: (blob: Blob) => void;
  setStatus: (status: TranscriptionStatus) => void;
  addResult: (result: TranscriptionResult) => void;
  deleteResult: (id: string) => void;
  setActiveResult: (id: string | null) => void;
  getActiveResult: () => TranscriptionResult | null;

  // Model management
  setModelDownloaded: (downloaded: boolean, path?: string) => void;
  setModelProgress: (progress: number) => void;
}

// ID generation is done in the component layer
// export for external use if needed
export function generateTranscriptionId(): string {
  return 'tr_' + Math.random().toString(36).slice(2, 11);
}

export const useTranscriptionStore = create<TranscriptionState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      recordingStartedAt: null,
      audioBlob: null,

      results: [],
      activeResultId: null,

      model: {
        key: 'whisper-base-en',
        label: 'Whisper Base (English)',
        sizeBytes: 150_000_000,
        downloaded: false,
        downloadProgress: 0,
      },

      startRecording: () => {
        set({ status: 'recording', recordingStartedAt: Date.now(), audioBlob: null });
      },

      stopRecording: (blob: Blob) => {
        set({ status: 'processing', audioBlob: blob });
      },

      setStatus: (status) => set({ status }),

      addResult: (result) => {
        set((s) => ({
          results: [result, ...s.results],
          activeResultId: result.id,
          status: 'done',
          audioBlob: null,
        }));
      },

      deleteResult: (id) => {
        set((s) => ({
          results: s.results.filter((r) => r.id !== id),
          activeResultId: s.activeResultId === id ? null : s.activeResultId,
        }));
      },

      setActiveResult: (id) => set({ activeResultId: id }),

      getActiveResult: () => {
        const { results, activeResultId } = get();
        return results.find((r) => r.id === activeResultId) ?? null;
      },

      setModelDownloaded: (downloaded, path) => {
        set((s) => ({
          model: { ...s.model, downloaded, path, downloadProgress: downloaded ? 100 : 0 },
        }));
      },

      setModelProgress: (progress) => {
        set((s) => ({
          model: { ...s.model, downloadProgress: progress },
        }));
      },
    }),
    {
      name: 'onyx_transcription',
      partialize: (state) => ({
        results: state.results,
        model: state.model,
      }),
    }
  )
);
