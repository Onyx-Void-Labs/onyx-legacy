/**
 * SlidesView.tsx — Fullscreen presentation mode for slide-painted blocks.
 * Renders slides as a horizontal deck with keyboard navigation,
 * progress bar, and slide counter.
 *
 * Gated by useFeature('slides').
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Presentation,
} from 'lucide-react';
import { useSlidesStore } from '@/store/slidesStore';

export default function SlidesView() {
  const {
    isPresenting,
    slides,
    currentSlideIndex,
    nextSlide,
    prevSlide,
    goToSlide,
    endPresentation,
  } = useSlidesStore();

  // Keyboard navigation
  useEffect(() => {
    if (!isPresenting) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          nextSlide();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          prevSlide();
          break;
        case 'Home':
          e.preventDefault();
          goToSlide(0);
          break;
        case 'End':
          e.preventDefault();
          goToSlide(slides.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          endPresentation();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPresenting, nextSlide, prevSlide, goToSlide, endPresentation, slides.length]);

  if (!isPresenting || slides.length === 0) return null;

  const currentSlide = slides[currentSlideIndex];
  const progress = ((currentSlideIndex + 1) / slides.length) * 100;

  return createPortal(
    <div className="fixed inset-0 z-99999 bg-zinc-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <Presentation size={16} className="text-violet-400" />
          <span className="text-xs text-zinc-400 font-medium">
            Slide {currentSlideIndex + 1} of {slides.length}
          </span>
        </div>
        <button
          onClick={endPresentation}
          className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
          title="Exit Presentation (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-zinc-800">
        <div
          className="h-full bg-violet-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Slide content area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        {/* Previous button */}
        <button
          onClick={prevSlide}
          disabled={currentSlideIndex === 0}
          className="absolute left-6 z-10 p-3 rounded-full bg-zinc-800/60 backdrop-blur-sm text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Slide */}
        <div className="w-full max-w-4xl mx-auto px-20">
          <div
            className="bg-zinc-900/80 border border-zinc-800/50 rounded-3xl p-12 shadow-2xl shadow-black/30 min-h-100 flex items-center"
          >
            <div
              className="tiptap onyx-tiptap-content w-full text-lg leading-relaxed"
              dangerouslySetInnerHTML={{ __html: currentSlide.html }}
            />
          </div>
        </div>

        {/* Next button */}
        <button
          onClick={nextSlide}
          disabled={currentSlideIndex === slides.length - 1}
          className="absolute right-6 z-10 p-3 rounded-full bg-zinc-800/60 backdrop-blur-sm text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-all cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Slide thumbnails strip */}
      <div className="bg-zinc-900/90 border-t border-zinc-800/50 px-6 py-3">
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar">
          {slides.map((slide, idx) => (
            <button
              key={idx}
              onClick={() => goToSlide(idx)}
              className={`shrink-0 w-24 h-16 rounded-lg border-2 transition-all cursor-pointer overflow-hidden ${
                idx === currentSlideIndex
                  ? 'border-violet-500 shadow-lg shadow-violet-500/20'
                  : 'border-zinc-700/30 hover:border-zinc-600 opacity-60 hover:opacity-100'
              }`}
            >
              <div className="w-full h-full bg-zinc-800/50 flex items-center justify-center p-2">
                <span className="text-[8px] text-zinc-400 line-clamp-3 text-center leading-tight">
                  {slide.preview.slice(0, 60)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Utility: Extract slides from a TipTap editor by finding consecutive
 * blocks painted with 'slide' type.
 */
export function extractSlidesFromEditor(
  editorElement: HTMLElement
): { html: string; preview: string; blockIds: string[] }[] {
  const blocks = editorElement.querySelectorAll('[data-block-id][data-paint-type="slide"]');
  if (blocks.length === 0) return [];

  const slides: { html: string; preview: string; blockIds: string[] }[] = [];
  let currentSlide: { html: string; preview: string; blockIds: string[] } = {
    html: '',
    preview: '',
    blockIds: [],
  };

  blocks.forEach((block, idx) => {
    const blockId = block.getAttribute('data-block-id') || '';
    const html = block.innerHTML;
    const text = block.textContent || '';

    currentSlide.html += html;
    currentSlide.preview += text + ' ';
    currentSlide.blockIds.push(blockId);

    // Check if next block is a different slide group
    // (non-consecutive block or last block)
    const nextBlock = blocks[idx + 1];
    const isLastBlock = idx === blocks.length - 1;
    const nextIsNotAdjacent = nextBlock &&
      block.nextElementSibling !== nextBlock;

    if (isLastBlock || nextIsNotAdjacent) {
      slides.push({
        ...currentSlide,
        preview: currentSlide.preview.trim(),
      });
      currentSlide = { html: '', preview: '', blockIds: [] };
    }
  });

  return slides;
}
