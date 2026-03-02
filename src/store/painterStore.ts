/**
 * painterStore.ts — Zustand store for Painter Mode state.
 * Manages the active paint type, painter mode activation, and marker visibility.
 */

import { create } from 'zustand';
import type { PaintType } from '@/lib/painter/paintTypes';

interface PainterState {
  /** Whether Painter Mode is currently active */
  isActive: boolean;
  /** The currently selected paint type */
  activePaintType: PaintType;
  /** Whether paint markers (chips) are visible in normal editing mode */
  showMarkers: boolean;
  /** Eraser mode — clicking removes paint instead of applying */
  eraserActive: boolean;

  /** Enter Painter Mode */
  enterPainterMode: () => void;
  /** Exit Painter Mode */
  exitPainterMode: () => void;
  /** Set the active paint type */
  setActivePaintType: (type: PaintType) => void;
  /** Toggle marker visibility */
  toggleMarkers: () => void;
  /** Toggle eraser mode */
  toggleEraser: () => void;
  /** Set eraser mode */
  setEraserActive: (active: boolean) => void;
}

export const usePainterStore = create<PainterState>((set) => ({
  isActive: false,
  activePaintType: 'question',
  showMarkers: false,
  eraserActive: false,

  enterPainterMode: () => set({ isActive: true, eraserActive: false }),
  exitPainterMode: () => set({ isActive: false, eraserActive: false }),
  setActivePaintType: (type: PaintType) => set({ activePaintType: type, eraserActive: false }),
  toggleMarkers: () => set((s) => ({ showMarkers: !s.showMarkers })),
  toggleEraser: () => set((s) => ({ eraserActive: !s.eraserActive })),
  setEraserActive: (active: boolean) => set({ eraserActive: active }),
}));
