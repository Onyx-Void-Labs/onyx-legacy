/**
 * RecallBar.tsx — Floating bar shown when Recall Mode is active.
 * Displays progress, reveal-all / hide-all toggle, and exit button.
 * Also manages adding/removing CSS classes on recall marks in the DOM.
 */

import { useEffect } from 'react';
import {
  Eye,
  EyeOff,
  X,
  Brain,
  RotateCcw,
} from 'lucide-react';
import { useRecallStore } from '@/store/recallStore';

export default function RecallBar() {
  const {
    isActive,
    revealedIds,
    revealMark,
    revealAll,
    hideAll,
    exitRecallMode,
    getProgress,
  } = useRecallStore();

  const { revealed, total, percentage } = getProgress();
  const allRevealed = revealedIds.has('__ALL__') || revealed >= total;

  // Apply/remove CSS classes on recall marks in the editor DOM
  useEffect(() => {
    if (!isActive) {
      // Remove all recall mode classes
      document.querySelectorAll('span[data-recall-mark]').forEach((el) => {
        el.classList.remove('recall-hidden', 'recall-revealed');
      });
      return;
    }

    // Apply hidden/revealed classes
    document.querySelectorAll('span[data-recall-mark]').forEach((el) => {
      const recallId = el.getAttribute('data-recall-id') || '';
      const isRevealed = revealedIds.has('__ALL__') || revealedIds.has(recallId);

      if (isRevealed) {
        el.classList.remove('recall-hidden');
        el.classList.add('recall-revealed');
      } else {
        el.classList.remove('recall-revealed');
        el.classList.add('recall-hidden');
      }
    });
  }, [isActive, revealedIds]);

  // Click handler for recall marks — reveal on click
  useEffect(() => {
    if (!isActive) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const recallEl = target.closest('span[data-recall-mark]');
      if (!recallEl) return;

      const recallId = recallEl.getAttribute('data-recall-id');
      if (recallId && !revealedIds.has(recallId)) {
        e.preventDefault();
        e.stopPropagation();
        revealMark(recallId);
      }
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [isActive, revealedIds, revealMark]);

  if (!isActive) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-fade-in-up">
      <div className="bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/40 px-5 py-3 flex items-center gap-4">
        {/* Brain icon */}
        <div className="w-8 h-8 rounded-xl bg-yellow-500/15 flex items-center justify-center shrink-0">
          <Brain size={16} className="text-yellow-400" />
        </div>

        {/* Label & progress */}
        <div className="space-y-1 min-w-30">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">Recall Mode</span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {revealed}/{total}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden w-32">
            <div
              className="h-full bg-yellow-500 rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 ml-2">
          {allRevealed ? (
            <button
              onClick={hideAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 transition-all cursor-pointer"
              title="Hide all answers"
            >
              <EyeOff size={13} />
              Hide All
            </button>
          ) : (
            <button
              onClick={revealAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/30 transition-all cursor-pointer"
              title="Reveal all answers"
            >
              <Eye size={13} />
              Reveal All
            </button>
          )}

          <button
            onClick={() => {
              hideAll();
            }}
            className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
            title="Reset progress"
          >
            <RotateCcw size={13} />
          </button>

          <button
            onClick={exitRecallMode}
            className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all cursor-pointer"
            title="Exit Recall Mode"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
