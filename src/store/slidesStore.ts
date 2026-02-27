/**
 * slidesStore.ts — Zustand store for Slides Mode.
 * Tracks active slide index, presentation state, and navigation.
 */

import { create } from 'zustand';

export interface Slide {
  /** The block IDs that make up this slide (consecutive slide-painted blocks) */
  blockIds: string[];
  /** The HTML content of the slide (rendered from TipTap blocks) */
  html: string;
  /** Plain text preview for thumbnail */
  preview: string;
}

interface SlidesStore {
  isPresenting: boolean;
  slides: Slide[];
  currentSlideIndex: number;

  // Actions
  startPresentation: (slides: Slide[]) => void;
  endPresentation: () => void;
  goToSlide: (index: number) => void;
  nextSlide: () => void;
  prevSlide: () => void;
}

export const useSlidesStore = create<SlidesStore>((set, get) => ({
  isPresenting: false,
  slides: [],
  currentSlideIndex: 0,

  startPresentation: (slides) => {
    if (slides.length === 0) return;
    set({ isPresenting: true, slides, currentSlideIndex: 0 });
  },

  endPresentation: () => {
    set({ isPresenting: false, slides: [], currentSlideIndex: 0 });
  },

  goToSlide: (index) => {
    const { slides } = get();
    if (index >= 0 && index < slides.length) {
      set({ currentSlideIndex: index });
    }
  },

  nextSlide: () => {
    const { currentSlideIndex, slides } = get();
    if (currentSlideIndex < slides.length - 1) {
      set({ currentSlideIndex: currentSlideIndex + 1 });
    }
  },

  prevSlide: () => {
    const { currentSlideIndex } = get();
    if (currentSlideIndex > 0) {
      set({ currentSlideIndex: currentSlideIndex - 1 });
    }
  },
}));
