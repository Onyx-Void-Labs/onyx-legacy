/**
 * TeachBackView.tsx — Full-screen teach-back overlay.
 * Users explain concepts from their notes as if teaching someone else.
 * They type their explanation, then self-grade their understanding.
 *
 * Gated by useFeature('teach_back').
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  Star,
  MessageCircle,
  Award,
} from 'lucide-react';
import { useTeachBackStore } from '@/store/teachBackStore';

const TEACH_BACK_PROMPTS = [
  'Explain this concept as if you were teaching it to a classmate who missed the lecture.',
  'How would you explain this to a 12-year-old?',
  'What analogies or real-world examples would you use to illustrate this?',
  'Walk through the key steps or components — what happens first, then next?',
  'Why is this concept important? What problems does it solve?',
];

export default function TeachBackView() {
  const {
    isActive,
    activeSession,
    currentPromptIndex,
    setExplanation,
    gradePrompt,
    nextPrompt,
    prevPrompt,
    endSession,
  } = useTeachBackStore();

  const [showResults, setShowResults] = useState(false);

  // Reset results view when session changes
  useEffect(() => {
    setShowResults(false);
  }, [isActive]);

  if (!isActive || !activeSession) return null;

  const prompt = activeSession.prompts[currentPromptIndex];
  if (!prompt) return null;

  const allGraded = activeSession.prompts.every((p) => p.grade !== null);
  const progress = ((currentPromptIndex + 1) / activeSession.prompts.length) * 100;

  // Teaching prompt for the current concept
  const teachPrompt =
    TEACH_BACK_PROMPTS[currentPromptIndex % TEACH_BACK_PROMPTS.length];

  // Results view
  if (showResults) {
    const graded = activeSession.prompts.filter((p) => p.grade !== null);
    const avg =
      graded.length > 0
        ? (graded.reduce((s, p) => s + (p.grade || 0), 0) / graded.length).toFixed(1)
        : '—';

    return createPortal(
      <div className="fixed inset-0 z-99998 bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-6 max-w-lg">
          <div className="w-20 h-20 mx-auto rounded-full bg-violet-500/15 flex items-center justify-center">
            <Award size={36} className="text-violet-400" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-100">Teach-Back Complete!</h2>
          <div className="text-5xl font-bold text-violet-400">{avg}/5</div>
          <p className="text-sm text-zinc-400">
            Average self-assessment across {activeSession.prompts.length} concepts
          </p>

          <div className="space-y-2 mt-6 text-left">
            {activeSession.prompts.map((p, idx) => (
              <div
                key={p.id}
                className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/50 rounded-xl px-4 py-2.5"
              >
                <span className="text-xs text-zinc-500 font-mono w-6">
                  {idx + 1}.
                </span>
                <span className="flex-1 text-sm text-zinc-300 truncate">
                  {p.concept}
                </span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={12}
                      className={
                        (p.grade || 0) >= s
                          ? 'text-yellow-400 fill-yellow-400'
                          : 'text-zinc-700'
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              endSession();
              setShowResults(false);
            }}
            className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer mt-4"
          >
            Done
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-99998 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <GraduationCap size={18} className="text-violet-400" />
          <span className="text-sm font-semibold text-zinc-200">Teach-Back Mode</span>
          <span className="text-xs text-zinc-500 font-mono">
            {currentPromptIndex + 1}/{activeSession.prompts.length}
          </span>
        </div>
        <button
          onClick={endSession}
          className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress */}
      <div className="h-0.5 bg-zinc-800">
        <div
          className="h-full bg-violet-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center overflow-auto p-8">
        <div className="w-full max-w-2xl space-y-6">
          {/* Concept card */}
          <div className="bg-zinc-900/80 border border-zinc-800/50 rounded-2xl p-8">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">
                From: {prompt.noteTitle}
              </span>
            </div>
            <h2 className="text-xl font-bold text-zinc-100 mb-4">
              {prompt.concept}
            </h2>
            <div className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/20">
              <div className="flex items-start gap-2">
                <MessageCircle size={14} className="text-violet-400 mt-0.5 shrink-0" />
                <p className="text-sm text-zinc-400 italic">{teachPrompt}</p>
              </div>
            </div>
          </div>

          {/* Explanation textarea */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 block font-medium">
              Your Explanation
            </label>
            <textarea
              value={prompt.explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={6}
              placeholder="Type your explanation here... Explain it in your own words."
              className="w-full bg-zinc-900/60 border border-zinc-800/50 rounded-2xl px-5 py-4 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/30 resize-none leading-relaxed"
            />
          </div>

          {/* Self-grade */}
          {prompt.explanation.trim().length > 20 && (
            <div className="space-y-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                How well did you explain it?
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((grade) => (
                  <button
                    key={grade}
                    onClick={() => gradePrompt(grade)}
                    className={`flex items-center justify-center w-12 h-12 rounded-xl border transition-all cursor-pointer ${
                      prompt.grade === grade
                        ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400'
                        : 'border-zinc-700/30 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Star
                      size={18}
                      className={
                        prompt.grade !== null && prompt.grade >= grade
                          ? 'fill-yellow-400 text-yellow-400'
                          : ''
                      }
                    />
                  </button>
                ))}
                <span className="text-xs text-zinc-600 ml-2">
                  {prompt.grade === 1
                    ? 'Could not explain'
                    : prompt.grade === 2
                    ? 'Struggled'
                    : prompt.grade === 3
                    ? 'Decent'
                    : prompt.grade === 4
                    ? 'Good explanation'
                    : prompt.grade === 5
                    ? 'Crystal clear!'
                    : ''}
                </span>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4">
            <button
              onClick={prevPrompt}
              disabled={currentPromptIndex === 0}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/30 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
              Previous
            </button>

            {currentPromptIndex === activeSession.prompts.length - 1 ? (
              <button
                onClick={() => {
                  if (allGraded) {
                    setShowResults(true);
                  }
                }}
                disabled={!allGraded}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                View Results
              </button>
            ) : (
              <button
                onClick={nextPrompt}
                disabled={prompt.grade === null}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
