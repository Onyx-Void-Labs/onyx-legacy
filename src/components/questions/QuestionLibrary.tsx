/**
 * QuestionLibrary.tsx — Full-page Question Library view accessible from the sidebar.
 * Shows all questions, supports filtering, search, and practice mode.
 * Gated by useFeature('question_library').
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  HelpCircle,
  Search,
  Play,
  Trash2,
  Plus,
  ChevronRight,
  Check,
  X,
  SkipForward,
  RotateCcw,
  BookOpen,
  Award,
  Clock,
} from 'lucide-react';
import { useQuestionStore } from '@/store/questionStore';
import type {
  Question,
  QuestionDifficulty,
  QuestionStatus,
  PracticeSession,
} from '@/lib/questions/questionTypes';

/* ─── Practice Mode Component ────────────────────────────── */

function PracticeMode({ onEnd }: { onEnd: () => void }) {
  const {
    getActiveSession,
    recordAnswer,
    endPracticeSession,
    getQuestion,
  } = useQuestionStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [sessionComplete, setSessionComplete] = useState(false);
  const [completedSession, setCompletedSession] = useState<PracticeSession | null>(null);

  const session = getActiveSession();
  const questionIds = session?.questionIds || [];
  const currentQuestion = questionIds[currentIndex]
    ? getQuestion(questionIds[currentIndex])
    : null;

  const progress = questionIds.length > 0
    ? Math.round(((session?.results ? Object.keys(session.results).length : 0) / questionIds.length) * 100)
    : 0;

  const handleAnswer = useCallback(
    (status: QuestionStatus) => {
      if (!currentQuestion) return;
      recordAnswer(currentQuestion.id, status);

      if (currentIndex < questionIds.length - 1) {
        setCurrentIndex((i) => i + 1);
        setShowAnswer(false);
        setUserAnswer('');
      } else {
        const result = endPracticeSession();
        setCompletedSession(result);
        setSessionComplete(true);
      }
    },
    [currentQuestion, currentIndex, questionIds.length, recordAnswer, endPracticeSession]
  );

  // Session complete screen
  if (sessionComplete && completedSession) {
    const correct = Object.values(completedSession.results).filter(
      (r) => r === 'correct'
    ).length;
    const total = Object.keys(completedSession.results).length;

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-6 max-w-md">
          <div className="w-20 h-20 mx-auto rounded-full bg-violet-500/15 flex items-center justify-center">
            <Award size={36} className="text-violet-400" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-100">Session Complete!</h2>
          <div className="text-5xl font-bold text-violet-400">
            {completedSession.score ?? 0}%
          </div>
          <p className="text-sm text-zinc-400">
            You got <span className="text-green-400 font-semibold">{correct}</span> out
            of <span className="text-zinc-200 font-semibold">{total}</span> questions
            correct.
          </p>
          <button
            onClick={onEnd}
            className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">No questions to practice.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => {
            endPracticeSession();
            onEnd();
          }}
          className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
          title="Exit practice"
        >
          <X size={16} />
        </button>
        <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500 font-mono">
          {currentIndex + 1}/{questionIds.length}
        </span>
      </div>

      {/* Question card */}
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-xl space-y-6">
          {/* Difficulty badge */}
          <div className="flex items-center gap-2">
            <DifficultyBadge difficulty={currentQuestion.difficulty} />
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
              from {currentQuestion.noteTitle}
            </span>
          </div>

          {/* Question */}
          <div className="bg-zinc-900/80 border border-zinc-700/40 rounded-2xl p-8">
            <p className="text-lg text-zinc-100 font-medium leading-relaxed">
              {currentQuestion.question}
            </p>
          </div>

          {/* Answer input or revealed answer */}
          {!showAnswer ? (
            <div className="space-y-3">
              <textarea
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="Type your answer..."
                rows={3}
                className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/50 resize-none"
              />
              <button
                onClick={() => setShowAnswer(true)}
                className="w-full py-3 rounded-xl bg-violet-600/80 hover:bg-violet-500 text-white text-sm font-medium transition-all cursor-pointer"
              >
                Reveal Answer
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-zinc-800/50 border border-green-500/20 rounded-2xl p-6">
                <p className="text-xs text-green-400/70 uppercase tracking-wider mb-2 font-medium">
                  Expected Answer
                </p>
                <p className="text-sm text-zinc-200 leading-relaxed">
                  {currentQuestion.answer}
                </p>
                {currentQuestion.explanation && (
                  <p className="text-xs text-zinc-500 mt-3 pt-3 border-t border-zinc-700/30">
                    {currentQuestion.explanation}
                  </p>
                )}
              </div>

              {/* Self-grade buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleAnswer('correct')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600/15 hover:bg-green-600/25 text-green-400 text-sm font-medium border border-green-500/20 transition-all cursor-pointer"
                >
                  <Check size={16} />
                  Got it
                </button>
                <button
                  onClick={() => handleAnswer('incorrect')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600/15 hover:bg-red-600/25 text-red-400 text-sm font-medium border border-red-500/20 transition-all cursor-pointer"
                >
                  <X size={16} />
                  Missed
                </button>
                <button
                  onClick={() => handleAnswer('skipped')}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm border border-zinc-700/30 transition-all cursor-pointer"
                >
                  <SkipForward size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Helper: Difficulty Badge ───────────────────────────── */

function DifficultyBadge({ difficulty }: { difficulty: QuestionDifficulty }) {
  const config: Record<QuestionDifficulty, { label: string; color: string }> = {
    easy: { label: 'Easy', color: 'text-green-400 bg-green-500/10 border-green-500/20' },
    medium: { label: 'Medium', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
    hard: { label: 'Hard', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
  };
  const c = config[difficulty];
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${c.color}`}>
      {c.label}
    </span>
  );
}

/* ─── Helper: Status icon ────────────────────────────────── */

function StatusIcon({ status }: { status: QuestionStatus }) {
  const map: Record<QuestionStatus, React.ReactNode> = {
    unanswered: <HelpCircle size={12} className="text-zinc-500" />,
    correct: <Check size={12} className="text-green-400" />,
    incorrect: <X size={12} className="text-red-400" />,
    skipped: <SkipForward size={12} className="text-zinc-500" />,
  };
  return <>{map[status]}</>;
}

/* ─── Add Question Modal ─────────────────────────────────── */

function AddQuestionModal({
  onAdd,
  onClose,
}: {
  onAdd: (q: Omit<Question, 'id'>) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>('medium');

  const handleSubmit = () => {
    if (!question.trim() || !answer.trim()) return;
    onAdd({
      noteId: '__manual__',
      noteTitle: 'Manual',
      question: question.trim(),
      answer: answer.trim(),
      explanation: explanation.trim() || undefined,
      difficulty,
      tags: [],
      createdAt: Date.now(),
      practiceCount: 0,
      status: 'unanswered',
      streak: 0,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-99999 flex items-center justify-center bg-black/50">
      <div className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-6 shadow-2xl shadow-black/60 w-110 animate-fade-in-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-200">New Question</h3>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-all cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">
              Question
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/50 resize-none"
              placeholder="Enter the question..."
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">
              Answer
            </label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={2}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/50 resize-none"
              placeholder="Enter the expected answer..."
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">
              Explanation (optional)
            </label>
            <input
              type="text"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/50"
              placeholder="Why is this the answer?"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">
              Difficulty
            </label>
            <div className="flex gap-2">
              {(['easy', 'medium', 'hard'] as QuestionDifficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-all cursor-pointer capitalize ${
                    difficulty === d
                      ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 border-zinc-700/30 hover:bg-zinc-800'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/30 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!question.trim() || !answer.trim()}
            className="flex-1 py-2.5 rounded-xl text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Add Question
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main QuestionLibrary Component ──────────────────────── */

export default function QuestionLibrary() {
  const {
    questions,
    addQuestion,
    removeQuestion,
    getFilteredQuestions,
    getQuestionStats,
    getDueQuestions,
    startPracticeSession,
  } = useQuestionStore();

  const [search, setSearch] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState<QuestionDifficulty | ''>('');
  const [filterStatus, setFilterStatus] = useState<QuestionStatus | ''>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stats = getQuestionStats();
  const due = getDueQuestions();

  const filteredQuestions = useMemo(() => {
    return getFilteredQuestions({
      search: search || undefined,
      difficulty: filterDifficulty || undefined,
      status: filterStatus || undefined,
    });
  }, [questions, search, filterDifficulty, filterStatus, getFilteredQuestions]);

  const handleStartPractice = useCallback(
    (questionIds?: string[]) => {
      const ids = questionIds || due.map((q) => q.id);
      if (ids.length === 0) return;
      startPracticeSession(ids);
      setPracticeMode(true);
    },
    [due, startPracticeSession]
  );

  // Practice Mode view
  if (practiceMode) {
    return (
      <div
        className="flex-1 flex flex-col h-full"
        style={{ background: 'var(--onyx-editor)' }}
      >
        <PracticeMode onEnd={() => setPracticeMode(false)} />
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--onyx-editor)' }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <BookOpen size={18} className="text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-zinc-100">Question Library</h1>
              <p className="text-xs text-zinc-500">
                {stats.total} questions · {due.length} due for review
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/30 transition-all cursor-pointer"
            >
              <Plus size={14} />
              Add
            </button>
            {due.length > 0 && (
              <button
                onClick={() => handleStartPractice()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer"
              >
                <Play size={14} />
                Practice ({due.length})
              </button>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <StatCard
            label="Total"
            value={stats.total}
            icon={<BookOpen size={14} />}
            accent="text-zinc-300"
          />
          <StatCard
            label="Correct"
            value={stats.correct}
            icon={<Check size={14} />}
            accent="text-green-400"
          />
          <StatCard
            label="Incorrect"
            value={stats.incorrect}
            icon={<X size={14} />}
            accent="text-red-400"
          />
          <StatCard
            label="Due"
            value={due.length}
            icon={<Clock size={14} />}
            accent="text-yellow-400"
          />
        </div>

        {/* Search & Filters */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions..."
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-violet-500/50"
            />
          </div>
          <select
            value={filterDifficulty}
            onChange={(e) =>
              setFilterDifficulty(e.target.value as QuestionDifficulty | '')
            }
            className="bg-zinc-800/50 border border-zinc-700/40 rounded-xl px-3 py-2 text-xs text-zinc-300 outline-none cursor-pointer"
          >
            <option value="">All Difficulty</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as QuestionStatus | '')
            }
            className="bg-zinc-800/50 border border-zinc-700/40 rounded-xl px-3 py-2 text-xs text-zinc-300 outline-none cursor-pointer"
          >
            <option value="">All Status</option>
            <option value="unanswered">Unanswered</option>
            <option value="correct">Correct</option>
            <option value="incorrect">Incorrect</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {filteredQuestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HelpCircle size={32} className="text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-500">No questions yet.</p>
            <p className="text-xs text-zinc-600 mt-1">
              Add questions manually or paint Q&A blocks in your notes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredQuestions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                expanded={expandedId === q.id}
                onToggle={() =>
                  setExpandedId(expandedId === q.id ? null : q.id)
                }
                onDelete={() => removeQuestion(q.id)}
                onPractice={() => handleStartPractice([q.id])}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add modal */}
      {showAddModal && (
        <AddQuestionModal
          onAdd={addQuestion}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

/* ─── Stat Card ──────────────────────────────────────────── */

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl px-3 py-2.5">
      <div className={`flex items-center gap-1.5 mb-1 ${accent}`}>
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium opacity-70">
          {label}
        </span>
      </div>
      <span className={`text-xl font-bold ${accent}`}>{value}</span>
    </div>
  );
}

/* ─── Question Card ──────────────────────────────────────── */

function QuestionCard({
  question,
  expanded,
  onToggle,
  onDelete,
  onPractice,
}: {
  question: Question;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onPractice: () => void;
}) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl overflow-hidden transition-all">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/2 transition-colors cursor-pointer"
      >
        <ChevronRight
          size={14}
          className={`text-zinc-500 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <StatusIcon status={question.status} />
        <span className="flex-1 text-sm text-zinc-200 truncate">
          {question.question}
        </span>
        <DifficultyBadge difficulty={question.difficulty} />
        {question.practiceCount > 0 && (
          <span className="text-[10px] text-zinc-600 font-mono">
            ×{question.practiceCount}
          </span>
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-zinc-800/40 animate-fade-in-up">
          <div className="space-y-2 mb-3">
            <div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Answer
              </span>
              <p className="text-sm text-zinc-300 mt-0.5">
                {question.answer || '—'}
              </p>
            </div>
            {question.explanation && (
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                  Explanation
                </span>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {question.explanation}
                </p>
              </div>
            )}
            <div className="flex items-center gap-4 text-[10px] text-zinc-600">
              <span>
                From: {question.noteTitle}
              </span>
              {question.lastPracticedAt && (
                <span>
                  Last: {new Date(question.lastPracticedAt).toLocaleDateString()}
                </span>
              )}
              <span>Streak: {question.streak}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onPractice}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-violet-600/15 text-violet-300 hover:bg-violet-600/25 border border-violet-500/20 transition-all cursor-pointer"
            >
              <RotateCcw size={11} />
              Practice
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
            >
              <Trash2 size={11} />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
