import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    BookOpen,
    RotateCcw,
    ChevronRight,
    ChevronDown,
    Sparkles,
    Plus,
    Trash2,
    CheckCircle2,
    Lightbulb,
    Layers,
    BarChart3,
    Shuffle,
    Pencil,
    X,
    Save,
    Info,
    ArrowLeft,
    Clock,
    Zap,
    Target,
    Trophy,
    FolderOpen,
} from 'lucide-react';
import {
    getDueCards,
    getAllCards,
    reviewCard,
    newCard,
    upsertCard,
    deleteCard,
    getSessionStats,
    getRetentionForecast,
    getAllCollections,
    getAllSets,
    createCollection,
    createSet,
    type Flashcard,
    type FlashcardCollection,
    type FlashcardSet,
    type Rating,
    type CardType,
} from '../../lib/flashcards';

/* ─── Interfaces ──────────────────────────────────────────── */

interface FlashcardViewProps {
    onOpenNote: (id: string) => void;
}

/* ─── Constants ───────────────────────────────────────────── */

const RATING_BUTTONS: { rating: Rating; label: string; color: string; shortcut: string }[] = [
    { rating: 'again', label: 'Again', color: 'bg-red-900/60 hover:bg-red-900/80 text-red-300', shortcut: '1' },
    { rating: 'hard', label: 'Hard', color: 'bg-amber-900/60 hover:bg-amber-900/80 text-amber-300', shortcut: '2' },
    { rating: 'good', label: 'Good', color: 'bg-emerald-900/60 hover:bg-emerald-900/80 text-emerald-300', shortcut: '3' },
    { rating: 'easy', label: 'Easy', color: 'bg-sky-900/60 hover:bg-sky-900/80 text-sky-300', shortcut: '4' },
];

const CARD_TYPE_OPTIONS: { value: CardType; label: string }[] = [
    { value: 'basic', label: 'Basic Q/A' },
    { value: 'fill-blank', label: 'Fill in Blank' },
    { value: 'mcq', label: 'Multiple Choice' },
    { value: 'matching', label: 'Matching' },
    { value: 'cloze', label: 'Cloze' },
];

const TYPE_TAG_COLORS: Record<CardType, string> = {
    basic: 'bg-zinc-700/50 text-zinc-300',
    'fill-blank': 'bg-orange-900/40 text-orange-300',
    mcq: 'bg-blue-900/40 text-blue-300',
    matching: 'bg-green-900/40 text-green-300',
    cloze: 'bg-violet-900/40 text-violet-300',
};

const SCIENCE_FACTS: Record<CardType, string> = {
    basic:
        'Active recall \u2014 the act of retrieving information from memory \u2014 strengthens neural pathways up to 50% more effectively than re-reading. (Roediger & Karpicke, 2006)',
    'fill-blank':
        'Generating answers (production effect) activates the prefrontal cortex more deeply than recognition tasks, leading to stronger long-term encoding. (MacLeod et al., 2010)',
    mcq:
        'Errorful generation \u2014 choosing wrong answers before seeing the correct one \u2014 paradoxically improves memory for the right answer. (Kornell et al., 2009)',
    matching:
        'Associative learning pairs concepts in the hippocampus. Matching exercises strengthen relational memory 40% more than isolated recall. (Eichenbaum, 2004)',
    cloze:
        'Cloze deletion forces contextual processing \u2014 the surrounding sentence acts as a semantic scaffold, reducing cognitive load while maintaining retrieval strength. (Taylor, 1953; modified by Anki researchers)',
};

/* ─── Utilities ───────────────────────────────────────────── */

function shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function formatElapsed(ms: number): string {
    const secs = Math.floor(ms / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Build front text from sentence + blank indices */
function buildFrontFromBlanks(sentence: string, blanks: number[]): string {
    const words = sentence.split(/\s+/);
    return words
        .map((w, i) => {
            const bi = blanks.indexOf(i);
            if (bi >= 0) {
                const numLabel = String.fromCharCode(0x2460 + bi); // circled numbers
                return `___${numLabel}___`;
            }
            return w;
        })
        .join(' ');
}

/** Build back text from sentence + blank indices */
function buildBackFromBlanks(sentence: string, blanks: number[]): string {
    const words = sentence.split(/\s+/);
    return blanks.map((i) => words[i] ?? '').join(', ');
}

/* ─── Science Fact Callout ────────────────────────────────── */

function ScienceFact({ cardType }: { cardType: CardType }) {
    return (
        <div className="flex gap-2 mt-4 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
            <Info size={14} className="text-violet-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-zinc-400 leading-relaxed italic">
                {SCIENCE_FACTS[cardType]}
            </p>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   CREATION FORMS — One per card type
   ═══════════════════════════════════════════════════════════ */

/* ─── Basic Creation ──────────────────────────────────────── */

function BasicCreationForm({
    front,
    setFront,
    back,
    setBack,
}: {
    front: string;
    setFront: (v: string) => void;
    back: string;
    setBack: (v: string) => void;
}) {
    return (
        <>
            <input
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Front (question)..."
                className="w-full bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
            />
            <input
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder="Back (answer)..."
                className="w-full bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
            />
        </>
    );
}

/* ─── Fill-in-Blank Sentence Builder ──────────────────────── */

function FillBlankCreationForm({
    sentence,
    setSentence,
    blanks,
    setBlanks,
}: {
    sentence: string;
    setSentence: (v: string) => void;
    blanks: number[];
    setBlanks: (v: number[]) => void;
}) {
    const words = useMemo(() => sentence.split(/\s+/).filter(Boolean), [sentence]);

    const toggleBlank = useCallback(
        (idx: number) => {
            setBlanks(
                blanks.includes(idx) ? blanks.filter((b) => b !== idx) : [...blanks, idx].sort((a, b) => a - b),
            );
        },
        [blanks, setBlanks],
    );

    const preview = useMemo(() => {
        if (!sentence.trim() || blanks.length === 0) return '';
        return buildFrontFromBlanks(sentence, blanks);
    }, [sentence, blanks]);

    return (
        <>
            <textarea
                value={sentence}
                onChange={(e) => {
                    setSentence(e.target.value);
                    setBlanks([]);
                }}
                placeholder="Type your full sentence here..."
                rows={2}
                className="w-full bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600 resize-none"
            />

            {words.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {words.map((word, i) => {
                        const isBlank = blanks.includes(i);
                        return (
                            <button
                                key={`${word}-${i}`}
                                type="button"
                                onClick={() => toggleBlank(i)}
                                className={`px-2 py-1 text-xs rounded-md cursor-pointer transition-all select-none ${
                                    isBlank
                                        ? 'bg-violet-500/20 text-violet-400 underline underline-offset-2 border border-violet-500/40'
                                        : 'bg-zinc-800/40 text-zinc-300 border border-zinc-700/30 hover:border-zinc-600'
                                }`}
                            >
                                {word}
                            </button>
                        );
                    })}
                </div>
            )}

            {preview && (
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-700/20">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Preview</p>
                    <p className="text-sm text-zinc-300 leading-relaxed">{preview}</p>
                    <p className="text-[11px] text-zinc-500 mt-1">
                        Answer: {buildBackFromBlanks(sentence, blanks)}
                    </p>
                </div>
            )}
        </>
    );
}

/* ─── MCQ Creation ────────────────────────────────────────── */

function MCQCreationForm({
    question,
    setQuestion,
    options,
    setOptions,
    correctIndex,
    setCorrectIndex,
}: {
    question: string;
    setQuestion: (v: string) => void;
    options: string[];
    setOptions: (v: string[]) => void;
    correctIndex: number;
    setCorrectIndex: (v: number) => void;
}) {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];

    const updateOption = useCallback(
        (idx: number, val: string) => {
            const next = [...options];
            next[idx] = val;
            setOptions(next);
        },
        [options, setOptions],
    );

    const addOption = useCallback(() => {
        if (options.length < 6) setOptions([...options, '']);
    }, [options, setOptions]);

    const removeOption = useCallback(
        (idx: number) => {
            if (options.length <= 2) return;
            const next = options.filter((_, i) => i !== idx);
            setOptions(next);
            if (correctIndex >= next.length) setCorrectIndex(next.length - 1);
            else if (correctIndex > idx) setCorrectIndex(correctIndex - 1);
        },
        [options, setOptions, correctIndex, setCorrectIndex],
    );

    return (
        <>
            <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Question..."
                className="w-full bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
            />
            <div className="space-y-2">
                {options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCorrectIndex(i)}
                            className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold cursor-pointer transition-all shrink-0 ${
                                correctIndex === i
                                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                                    : 'border-zinc-600 text-zinc-500 hover:border-zinc-400'
                            }`}
                        >
                            {labels[i]}
                        </button>
                        <input
                            value={opt}
                            onChange={(e) => updateOption(i, e.target.value)}
                            placeholder={`Option ${labels[i]}...`}
                            className="flex-1 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                        />
                        {options.length > 2 && (
                            <button
                                type="button"
                                onClick={() => removeOption(i)}
                                className="text-zinc-600 hover:text-red-400 cursor-pointer transition-colors"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            {options.length < 6 && (
                <button
                    type="button"
                    onClick={addOption}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-violet-400 transition-colors cursor-pointer"
                >
                    <Plus size={12} /> Add option
                </button>
            )}
        </>
    );
}

/* ─── Matching Pairs Creation ─────────────────────────────── */

function MatchingCreationForm({
    pairs,
    setPairs,
}: {
    pairs: [string, string][];
    setPairs: (v: [string, string][]) => void;
}) {
    const updatePair = useCallback(
        (idx: number, side: 0 | 1, val: string) => {
            const next: [string, string][] = pairs.map((p) => [...p] as [string, string]);
            next[idx][side] = val;
            setPairs(next);
        },
        [pairs, setPairs],
    );

    const addPair = useCallback(() => {
        if (pairs.length < 8) setPairs([...pairs, ['', '']]);
    }, [pairs, setPairs]);

    const removePair = useCallback(
        (idx: number) => {
            if (pairs.length <= 3) return;
            setPairs(pairs.filter((_, i) => i !== idx));
        },
        [pairs, setPairs],
    );

    return (
        <>
            <p className="text-[11px] text-zinc-500">Add term = definition pairs (min 3, max 8)</p>
            <div className="space-y-2">
                {pairs.map((pair, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <input
                            value={pair[0]}
                            onChange={(e) => updatePair(i, 0, e.target.value)}
                            placeholder="Term..."
                            className="flex-1 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                        />
                        <span className="text-zinc-600 text-xs">=</span>
                        <input
                            value={pair[1]}
                            onChange={(e) => updatePair(i, 1, e.target.value)}
                            placeholder="Definition..."
                            className="flex-1 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                        />
                        {pairs.length > 3 && (
                            <button
                                type="button"
                                onClick={() => removePair(i)}
                                className="text-zinc-600 hover:text-red-400 cursor-pointer transition-colors"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
            {pairs.length < 8 && (
                <button
                    type="button"
                    onClick={addPair}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-violet-400 transition-colors cursor-pointer"
                >
                    <Plus size={12} /> Add pair
                </button>
            )}
        </>
    );
}

/* ─── Cloze Creation ──────────────────────────────────────── */

function ClozeCreationForm({
    sentence,
    setSentence,
    blanks,
    setBlanks,
    syntaxMode,
    setSyntaxMode,
    rawSyntax,
    setRawSyntax,
}: {
    sentence: string;
    setSentence: (v: string) => void;
    blanks: number[];
    setBlanks: (v: number[]) => void;
    syntaxMode: boolean;
    setSyntaxMode: (v: boolean) => void;
    rawSyntax: string;
    setRawSyntax: (v: string) => void;
}) {
    const words = useMemo(() => sentence.split(/\s+/).filter(Boolean), [sentence]);

    const toggleBlank = useCallback(
        (idx: number) => {
            setBlanks(
                blanks.includes(idx) ? blanks.filter((b) => b !== idx) : [...blanks, idx].sort((a, b) => a - b),
            );
        },
        [blanks, setBlanks],
    );

    const preview = useMemo(() => {
        if (syntaxMode) {
            // Parse {{c1::word}} syntax for preview
            return rawSyntax.replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '[...]');
        }
        if (!sentence.trim() || blanks.length === 0) return '';
        return buildFrontFromBlanks(sentence, blanks);
    }, [sentence, blanks, syntaxMode, rawSyntax]);

    return (
        <>
            <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-500">
                    {syntaxMode ? 'Raw cloze syntax' : 'Click words to blank'}
                </p>
                <button
                    type="button"
                    onClick={() => setSyntaxMode(!syntaxMode)}
                    className="text-[10px] text-violet-400 hover:text-violet-300 cursor-pointer transition-colors"
                >
                    {syntaxMode ? 'Switch to builder' : 'Switch to syntax mode'}
                </button>
            </div>

            {syntaxMode ? (
                <textarea
                    value={rawSyntax}
                    onChange={(e) => setRawSyntax(e.target.value)}
                    placeholder="The {{c1::mitochondria}} is the {{c2::powerhouse}} of the cell"
                    rows={3}
                    className="w-full bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600 resize-none font-mono"
                />
            ) : (
                <>
                    <textarea
                        value={sentence}
                        onChange={(e) => {
                            setSentence(e.target.value);
                            setBlanks([]);
                        }}
                        placeholder="Type your full sentence here..."
                        rows={2}
                        className="w-full bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600 resize-none"
                    />
                    {words.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {words.map((word, i) => {
                                const isBlank = blanks.includes(i);
                                return (
                                    <button
                                        key={`${word}-${i}`}
                                        type="button"
                                        onClick={() => toggleBlank(i)}
                                        className={`px-2 py-1 text-xs rounded-md cursor-pointer transition-all select-none ${
                                            isBlank
                                                ? 'bg-violet-500/20 text-violet-400 underline underline-offset-2 border border-violet-500/40'
                                                : 'bg-zinc-800/40 text-zinc-300 border border-zinc-700/30 hover:border-zinc-600'
                                        }`}
                                    >
                                        {word}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {preview && (
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-700/20">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Preview</p>
                    <p className="text-sm text-zinc-300 leading-relaxed">{preview}</p>
                </div>
            )}
        </>
    );
}

/* ═══════════════════════════════════════════════════════════
   REVIEW RENDERERS — One per card type
   ═══════════════════════════════════════════════════════════ */

/* ─── Basic Review ────────────────────────────────────────── */

function BasicReview({
    card,
    flipped,
    onFlip,
    showHint,
}: {
    card: Flashcard;
    flipped: boolean;
    onFlip: () => void;
    showHint: boolean;
}) {
    return (
        <div
            className="relative min-h-56 rounded-2xl border border-zinc-800/60 bg-zinc-800/20 flex flex-col items-center justify-center px-8 py-8 cursor-pointer select-none"
            onClick={onFlip}
        >
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-4">
                {flipped ? 'Answer' : 'Question'}
            </p>
            <p className="text-lg text-zinc-100 text-center leading-relaxed whitespace-pre-wrap">
                {flipped ? card.back : card.front}
            </p>
            {showHint && card.hint && !flipped && (
                <p className="mt-3 text-xs text-amber-400/80 italic">
                    <Lightbulb size={10} className="inline mr-1" />
                    {card.hint}
                </p>
            )}
            {!flipped && (
                <p className="absolute bottom-4 text-[10px] text-zinc-700">
                    Click or press Space to reveal
                </p>
            )}
        </div>
    );
}

/* ─── Fill-in-Blank Review ────────────────────────────────── */

function FillBlankReview({
    card,
    flipped: _flipped,
    onFlip,
    showHint,
    hintUsed,
    onHint,
}: {
    card: Flashcard;
    flipped: boolean;
    onFlip: () => void;
    showHint: boolean;
    hintUsed: boolean;
    onHint: () => void;
}) {
    const blankedWords = useMemo(() => {
        if (card.sentence && card.blanks && card.blanks.length > 0) {
            const words = card.sentence.split(/\s+/);
            return card.blanks.map((i) => words[i] ?? '');
        }
        return [card.back];
    }, [card]);

    const blankCount = blankedWords.length;
    const [answers, setAnswers] = useState<string[]>(() => Array(blankCount).fill(''));
    const [submitted, setSubmitted] = useState(false);
    const [results, setResults] = useState<boolean[]>([]);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // Reset on card change
    useEffect(() => {
        setAnswers(Array(blankCount).fill(''));
        setSubmitted(false);
        setResults([]);
    }, [card.id, blankCount]);

    const displaySentence = useMemo(() => {
        if (card.sentence && card.blanks && card.blanks.length > 0) {
            return buildFrontFromBlanks(card.sentence, card.blanks);
        }
        return card.front;
    }, [card]);

    const handleSubmit = useCallback(() => {
        const res = blankedWords.map((word, i) =>
            answers[i].trim().toLowerCase() === word.trim().toLowerCase(),
        );
        setResults(res);
        setSubmitted(true);
        onFlip();
    }, [answers, blankedWords, onFlip]);

    const updateAnswer = useCallback(
        (idx: number, val: string) => {
            const next = [...answers];
            next[idx] = val;
            setAnswers(next);
        },
        [answers],
    );

    const hintText = useMemo(() => {
        if (!hintUsed) return null;
        return blankedWords.map((w) => w.slice(0, 2) + '...').join(', ');
    }, [blankedWords, hintUsed]);

    return (
        <div className="relative min-h-56 rounded-2xl border border-zinc-800/60 bg-zinc-800/20 flex flex-col items-center justify-center px-8 py-8">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-4">Fill in the blank</p>
            <p className="text-lg text-zinc-100 text-center leading-relaxed whitespace-pre-wrap mb-6">
                {displaySentence}
            </p>

            {!submitted ? (
                <div className="w-full max-w-sm space-y-2">
                    {blankedWords.map((_, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span className="text-[11px] text-zinc-500 shrink-0 w-5 text-right">
                                {String.fromCharCode(0x2460 + i)}
                            </span>
                            <input
                                ref={(el) => { inputRefs.current[i] = el; }}
                                value={answers[i]}
                                onChange={(e) => updateAnswer(i, e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        if (i < blankCount - 1) {
                                            inputRefs.current[i + 1]?.focus();
                                        } else {
                                            handleSubmit();
                                        }
                                    }
                                }}
                                placeholder={`Blank ${i + 1}...`}
                                className="flex-1 bg-zinc-900 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-zinc-700/40 focus:border-violet-500 text-center"
                                autoFocus={i === 0}
                            />
                        </div>
                    ))}
                    <button
                        onClick={handleSubmit}
                        className="w-full mt-2 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium cursor-pointer transition-colors"
                    >
                        Submit
                    </button>
                    {showHint && !hintUsed && (
                        <button
                            onClick={onHint}
                            className="flex items-center gap-1.5 mx-auto mt-2 text-xs text-zinc-500 hover:text-amber-400 transition-colors cursor-pointer"
                        >
                            <Lightbulb size={12} /> Hint (H)
                        </button>
                    )}
                    {hintText && (
                        <p className="text-xs text-amber-400/80 text-center italic mt-1">
                            <Lightbulb size={10} className="inline mr-1" />
                            First letters: {hintText}
                        </p>
                    )}
                </div>
            ) : (
                <div className="w-full max-w-sm space-y-2">
                    {blankedWords.map((word, i) => (
                        <div
                            key={i}
                            className={`text-center text-sm font-medium px-3 py-2 rounded-lg transition-all ${
                                results[i]
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                            }`}
                        >
                            {results[i] ? (
                                <span>&#10003; Correct! {word}</span>
                            ) : (
                                <span>&#10007; Answer: {word} {answers[i] && <span className="text-zinc-500 text-xs ml-1">(you: {answers[i]})</span>}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── MCQ Review ──────────────────────────────────────────── */

function MCQReview({
    card,
    flipped,
    onSelect,
    selectedIdx,
    showHint,
}: {
    card: Flashcard;
    flipped: boolean;
    onSelect: (i: number) => void;
    selectedIdx: number | null;
    showHint: boolean;
}) {
    const options = card.options ?? [];
    const correctIdx = card.correctIndex ?? options.indexOf(card.back);
    const is2x2 = options.length <= 4;

    return (
        <div className="relative min-h-56 rounded-2xl border border-zinc-800/60 bg-zinc-800/20 flex flex-col items-center justify-center px-8 py-8">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-4">Multiple Choice</p>
            <p className="text-lg text-zinc-100 text-center leading-relaxed mb-6">{card.front}</p>

            <div className={`w-full max-w-md ${is2x2 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-2'}`}>
                {options.map((opt, i) => {
                    const isSelected = selectedIdx === i;
                    const isCorrectOpt = i === correctIdx;
                    let optClass = 'border-zinc-700/40 hover:border-zinc-500 bg-zinc-900/40 text-zinc-200';
                    if (flipped) {
                        if (isCorrectOpt)
                            optClass = 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 animate-pulse';
                        else if (isSelected)
                            optClass = 'border-red-500/60 bg-red-500/15 text-red-300 animate-[shake_0.3s_ease-in-out]';
                        else optClass = 'border-zinc-700/20 bg-zinc-900/20 text-zinc-500';
                    } else if (isSelected) {
                        optClass = 'border-violet-500/50 bg-violet-500/10 text-violet-300';
                    }
                    const label = String.fromCharCode(65 + i); // A, B, C...
                    return (
                        <button
                            key={i}
                            onClick={() => !flipped && onSelect(i)}
                            disabled={flipped}
                            className={`text-left px-4 py-3 rounded-xl border text-sm transition-all cursor-pointer ${optClass}`}
                        >
                            <span className="text-zinc-500 mr-2 font-mono text-xs">{label}</span>
                            {opt}
                        </button>
                    );
                })}
            </div>

            {showHint && card.hint && !flipped && (
                <p className="mt-3 text-xs text-amber-400/80 italic">
                    <Lightbulb size={10} className="inline mr-1" />
                    {card.hint}
                </p>
            )}

            {!flipped && (
                <p className="mt-4 text-[10px] text-zinc-700">
                    Press 1-{options.length} to select
                </p>
            )}
        </div>
    );
}

/* ─── Matching Review ─────────────────────────────────────── */

function MatchingReview({
    card,
    flipped,
    onComplete,
}: {
    card: Flashcard;
    flipped: boolean;
    onComplete: () => void;
}) {
    const pairs = card.matchPairs ?? [];
    const shuffledDefs = useMemo(() => shuffleArray(pairs.map((p) => p[1])), [card.id]);
    const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
    const [matched, setMatched] = useState<Map<string, string>>(new Map());
    const [incorrectFlash, setIncorrectFlash] = useState<{ term: string; def: string } | null>(null);
    const allMatched = matched.size >= pairs.length;

    // When all matched, tell parent
    useEffect(() => {
        if (allMatched && !flipped) onComplete();
    }, [allMatched, flipped, onComplete]);

    const handleTermClick = useCallback(
        (term: string) => {
            if (matched.has(term)) return;
            setSelectedTerm((prev) => (prev === term ? null : term));
        },
        [matched],
    );

    const handleDefClick = useCallback(
        (def: string) => {
            if (!selectedTerm) return;
            // Check if def is already matched
            const matchedDefs = new Set(matched.values());
            if (matchedDefs.has(def)) return;

            const correctDef = pairs.find((p) => p[0] === selectedTerm)?.[1];
            if (correctDef === def) {
                const next = new Map(matched);
                next.set(selectedTerm, def);
                setMatched(next);
                setSelectedTerm(null);
            } else {
                setIncorrectFlash({ term: selectedTerm, def });
                setTimeout(() => setIncorrectFlash(null), 600);
                setSelectedTerm(null);
            }
        },
        [selectedTerm, matched, pairs],
    );

    const matchedDefs = useMemo(() => new Set(matched.values()), [matched]);

    return (
        <div className="relative min-h-56 rounded-2xl border border-zinc-800/60 bg-zinc-800/20 flex flex-col items-center justify-center px-6 py-8">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-4">Match the pairs</p>

            {allMatched && (
                <div className="mb-4 text-center">
                    <p className="text-emerald-400 font-medium text-sm">
                        <CheckCircle2 size={14} className="inline mr-1" />
                        All pairs matched!
                    </p>
                </div>
            )}

            <div className="w-full grid grid-cols-2 gap-4 max-w-md">
                {/* Terms column */}
                <div className="space-y-2">
                    <p className="text-[10px] text-zinc-500 uppercase text-center mb-1">Terms</p>
                    {pairs.map(([term]) => {
                        const isMatched = matched.has(term);
                        const isSelected = selectedTerm === term;
                        const isIncorrect = incorrectFlash?.term === term;
                        let cls =
                            'border-zinc-700/40 text-zinc-300 hover:border-zinc-500 cursor-pointer';
                        if (isMatched)
                            cls = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 cursor-default';
                        else if (isIncorrect)
                            cls = 'border-red-500/50 bg-red-500/10 text-red-300 animate-[shake_0.3s_ease-in-out]';
                        else if (isSelected)
                            cls = 'border-violet-500/50 bg-violet-500/10 text-violet-300';

                        return (
                            <button
                                key={term}
                                onClick={() => !isMatched && handleTermClick(term)}
                                className={`w-full px-3 py-2.5 rounded-lg text-xs text-center border transition-all ${cls}`}
                            >
                                {term}
                            </button>
                        );
                    })}
                </div>

                {/* Definitions column */}
                <div className="space-y-2">
                    <p className="text-[10px] text-zinc-500 uppercase text-center mb-1">Definitions</p>
                    {shuffledDefs.map((def) => {
                        const isMatched = matchedDefs.has(def);
                        const isIncorrect = incorrectFlash?.def === def;
                        let cls =
                            'border-zinc-700/40 text-zinc-300 hover:border-zinc-500 cursor-pointer';
                        if (isMatched)
                            cls = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 cursor-default';
                        else if (isIncorrect)
                            cls = 'border-red-500/50 bg-red-500/10 text-red-300 animate-[shake_0.3s_ease-in-out]';

                        return (
                            <button
                                key={def}
                                onClick={() => !isMatched && handleDefClick(def)}
                                className={`w-full px-3 py-2.5 rounded-lg text-xs text-center border transition-all ${cls}`}
                            >
                                {def}
                            </button>
                        );
                    })}
                </div>
            </div>

            {!allMatched && (
                <p className="mt-4 text-[10px] text-zinc-700">
                    Click a term, then click its definition
                </p>
            )}
        </div>
    );
}

/* ─── Cloze Review ────────────────────────────────────────── */

function ClozeReview({
    card,
    flipped,
    onFlip,
    showHint,
    hintUsed,
    onHint,
}: {
    card: Flashcard;
    flipped: boolean;
    onFlip: () => void;
    showHint: boolean;
    hintUsed: boolean;
    onHint: () => void;
}) {
    const blankedWords = useMemo(() => {
        if (card.sentence && card.blanks && card.blanks.length > 0) {
            const words = card.sentence.split(/\s+/);
            return card.blanks.map((i) => words[i] ?? '');
        }
        return [card.back];
    }, [card]);

    const blankCount = blankedWords.length;
    const [currentBlank, setCurrentBlank] = useState(0);
    const [answers, setAnswers] = useState<string[]>(() => Array(blankCount).fill(''));
    const [states, setStates] = useState<('pending' | 'correct' | 'incorrect')[]>(() =>
        Array(blankCount).fill('pending'),
    );
    const allDone = states.every((s) => s !== 'pending');

    // Reset on card change
    useEffect(() => {
        setCurrentBlank(0);
        setAnswers(Array(blankCount).fill(''));
        setStates(Array(blankCount).fill('pending'));
    }, [card.id, blankCount]);

    useEffect(() => {
        if (allDone && !flipped) onFlip();
    }, [allDone, flipped, onFlip]);

    const displaySentence = useMemo(() => {
        if (card.sentence && card.blanks && card.blanks.length > 0) {
            const words = card.sentence.split(/\s+/);
            return words
                .map((w, i) => {
                    const bi = card.blanks!.indexOf(i);
                    if (bi >= 0) {
                        if (states[bi] === 'correct') return `[${blankedWords[bi]}]`;
                        if (states[bi] === 'incorrect') return `[${blankedWords[bi]}]`;
                        if (bi === currentBlank) return '________';
                        return '________';
                    }
                    return w;
                })
                .join(' ');
        }
        return card.front;
    }, [card, currentBlank, states, blankedWords]);

    const handleSubmitBlank = useCallback(() => {
        const isCorrect =
            answers[currentBlank].trim().toLowerCase() === blankedWords[currentBlank].trim().toLowerCase();
        const nextStates = [...states];
        nextStates[currentBlank] = isCorrect ? 'correct' : 'incorrect';
        setStates(nextStates);
        if (currentBlank < blankCount - 1) {
            setCurrentBlank(currentBlank + 1);
        }
    }, [answers, currentBlank, blankedWords, blankCount, states]);

    const hintText = useMemo(() => {
        if (!hintUsed || currentBlank >= blankedWords.length) return null;
        return blankedWords[currentBlank].slice(0, 2) + '...';
    }, [blankedWords, hintUsed, currentBlank]);

    // Progress dots
    const dots = blankedWords.map((_, i) => {
        const num = String.fromCharCode(0x2460 + i);
        if (states[i] === 'correct') return { num, cls: 'text-emerald-400' };
        if (states[i] === 'incorrect') return { num, cls: 'text-red-400' };
        if (i === currentBlank) return { num, cls: 'text-violet-400 font-bold' };
        return { num, cls: 'text-zinc-600' };
    });

    return (
        <div className="relative min-h-56 rounded-2xl border border-zinc-800/60 bg-zinc-800/20 flex flex-col items-center justify-center px-8 py-8">
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Cloze Deletion</p>

            {/* Progress dots */}
            <div className="flex items-center gap-2 mb-4">
                {dots.map((d, i) => (
                    <span key={i} className={`text-sm ${d.cls}`}>
                        {d.num}
                    </span>
                ))}
            </div>

            {!allDone && (
                <p className="text-[11px] text-zinc-500 mb-2">
                    Blank {currentBlank + 1} of {blankCount}
                </p>
            )}

            <p className="text-lg text-zinc-100 text-center leading-relaxed whitespace-pre-wrap mb-6">
                {displaySentence}
            </p>

            {!allDone ? (
                <div className="w-full max-w-xs space-y-2">
                    <div className="flex items-center gap-2">
                        <input
                            value={answers[currentBlank]}
                            onChange={(e) => {
                                const next = [...answers];
                                next[currentBlank] = e.target.value;
                                setAnswers(next);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSubmitBlank();
                            }}
                            placeholder={`Answer for blank ${currentBlank + 1}...`}
                            className="flex-1 bg-zinc-900 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-zinc-700/40 focus:border-violet-500 text-center"
                            autoFocus
                        />
                        <button
                            onClick={handleSubmitBlank}
                            className="px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm cursor-pointer transition-colors"
                        >
                            Submit
                        </button>
                    </div>
                    {showHint && !hintUsed && (
                        <button
                            onClick={onHint}
                            className="flex items-center gap-1.5 mx-auto text-xs text-zinc-500 hover:text-amber-400 transition-colors cursor-pointer"
                        >
                            <Lightbulb size={12} /> Hint (H)
                        </button>
                    )}
                    {hintText && (
                        <p className="text-xs text-amber-400/80 text-center italic">
                            <Lightbulb size={10} className="inline mr-1" />
                            First letters: {hintText}
                        </p>
                    )}
                </div>
            ) : (
                <div className="w-full max-w-sm space-y-2">
                    {blankedWords.map((word, i) => (
                        <div
                            key={i}
                            className={`text-center text-sm font-medium px-3 py-2 rounded-lg ${
                                states[i] === 'correct'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-red-500/10 text-red-400 border border-red-500/30'
                            }`}
                        >
                            {states[i] === 'correct' ? (
                                <span>&#10003; Correct! {word}</span>
                            ) : (
                                <span>
                                    &#10007; Answer: {word}
                                    {answers[i] && (
                                        <span className="text-zinc-500 text-xs ml-1">
                                            (you: {answers[i]})
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   RETENTION FORECAST — inline SVG bar chart
   ═══════════════════════════════════════════════════════════ */

function RetentionForecastChart({ forecast }: { forecast: number[] }) {
    const maxVal = Math.max(...forecast, 1);
    const barWidth = 40;
    const gap = 8;
    const chartHeight = 100;
    const chartWidth = forecast.length * (barWidth + gap);
    const dayLabels = ['Today', '+1d', '+2d', '+3d', '+4d', '+5d', '+6d'];

    return (
        <div className="mt-6">
            <p className="text-[11px] text-zinc-500 mb-3 flex items-center gap-1.5">
                <BarChart3 size={12} className="text-violet-400" />
                7-Day Retention Forecast
            </p>
            <div className="flex justify-center overflow-x-auto">
                <svg width={chartWidth} height={chartHeight + 30} viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}>
                    {forecast.map((val, i) => {
                        const barH = maxVal > 0 ? (val / maxVal) * (chartHeight - 20) : 0;
                        const x = i * (barWidth + gap);
                        const y = chartHeight - barH;
                        return (
                            <g key={i}>
                                <rect
                                    x={x}
                                    y={y}
                                    width={barWidth}
                                    height={barH}
                                    rx={4}
                                    fill={i === 0 ? '#8b5cf6' : '#3f3f46'}
                                    opacity={0.8}
                                />
                                <text
                                    x={x + barWidth / 2}
                                    y={y - 4}
                                    textAnchor="middle"
                                    fill="#a1a1aa"
                                    fontSize={10}
                                >
                                    {val}
                                </text>
                                <text
                                    x={x + barWidth / 2}
                                    y={chartHeight + 16}
                                    textAnchor="middle"
                                    fill="#52525b"
                                    fontSize={9}
                                >
                                    {dayLabels[i] ?? `+${i}d`}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   INLINE CARD EDITOR (for manage mode)
   ═══════════════════════════════════════════════════════════ */

function InlineCardEditor({
    card,
    onSave,
    onCancel,
}: {
    card: Flashcard;
    onSave: (updated: Flashcard) => void;
    onCancel: () => void;
}) {
    const [front, setFront] = useState(card.front);
    const [back, setBack] = useState(card.back);
    const [hint, setHint] = useState(card.hint ?? '');
    const [deck, setDeck] = useState(card.deck ?? '');

    // Fill-blank / cloze
    const [sentence, setSentence] = useState(card.sentence ?? '');
    const [blanks, setBlanks] = useState<number[]>(card.blanks ?? []);

    // MCQ
    const [mcqQuestion, setMcqQuestion] = useState(card.front);
    const [mcqOptions, setMcqOptions] = useState<string[]>(card.options ?? ['', '']);
    const [mcqCorrect, setMcqCorrect] = useState(card.correctIndex ?? 0);

    // Matching
    const [matchPairs, setMatchPairs] = useState<[string, string][]>(
        card.matchPairs ?? [['', ''], ['', ''], ['', '']],
    );

    // Cloze syntax mode
    const [clozeSyntax, setClozeSyntax] = useState(false);
    const [rawSyntax, setRawSyntax] = useState('');

    const handleSave = useCallback(() => {
        const updated = { ...card };
        updated.hint = hint.trim() || undefined;
        updated.deck = deck.trim() || undefined;

        if (card.cardType === 'basic' || !card.cardType) {
            updated.front = front;
            updated.back = back;
        } else if (card.cardType === 'fill-blank') {
            if (sentence.trim() && blanks.length > 0) {
                updated.sentence = sentence;
                updated.blanks = blanks;
                updated.front = buildFrontFromBlanks(sentence, blanks);
                updated.back = buildBackFromBlanks(sentence, blanks);
            }
        } else if (card.cardType === 'mcq') {
            updated.front = mcqQuestion;
            updated.options = mcqOptions.filter(Boolean);
            updated.correctIndex = mcqCorrect;
            updated.back = mcqOptions[mcqCorrect] ?? '';
        } else if (card.cardType === 'matching') {
            const validPairs = matchPairs.filter((p) => p[0].trim() && p[1].trim()) as [string, string][];
            updated.matchPairs = validPairs;
            updated.front = `Match ${validPairs.length} pairs`;
            updated.back = '';
        } else if (card.cardType === 'cloze') {
            if (sentence.trim() && blanks.length > 0) {
                updated.sentence = sentence;
                updated.blanks = blanks;
                updated.front = buildFrontFromBlanks(sentence, blanks);
                updated.back = buildBackFromBlanks(sentence, blanks);
            }
        }

        onSave(updated);
    }, [card, front, back, hint, deck, sentence, blanks, mcqQuestion, mcqOptions, mcqCorrect, matchPairs, onSave]);

    return (
        <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-lg p-4 mt-1 mb-2 space-y-3">
            {(card.cardType === 'basic' || !card.cardType) && (
                <BasicCreationForm front={front} setFront={setFront} back={back} setBack={setBack} />
            )}

            {card.cardType === 'fill-blank' && (
                <FillBlankCreationForm
                    sentence={sentence}
                    setSentence={setSentence}
                    blanks={blanks}
                    setBlanks={setBlanks}
                />
            )}

            {card.cardType === 'mcq' && (
                <MCQCreationForm
                    question={mcqQuestion}
                    setQuestion={setMcqQuestion}
                    options={mcqOptions}
                    setOptions={setMcqOptions}
                    correctIndex={mcqCorrect}
                    setCorrectIndex={setMcqCorrect}
                />
            )}

            {card.cardType === 'matching' && (
                <MatchingCreationForm pairs={matchPairs} setPairs={setMatchPairs} />
            )}

            {card.cardType === 'cloze' && (
                <ClozeCreationForm
                    sentence={sentence}
                    setSentence={setSentence}
                    blanks={blanks}
                    setBlanks={setBlanks}
                    syntaxMode={clozeSyntax}
                    setSyntaxMode={setClozeSyntax}
                    rawSyntax={rawSyntax}
                    setRawSyntax={setRawSyntax}
                />
            )}

            <div className="flex gap-2">
                <input
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="Hint (optional)..."
                    className="flex-1 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                />
                <input
                    value={deck}
                    onChange={(e) => setDeck(e.target.value)}
                    placeholder="Deck..."
                    className="w-32 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                />
            </div>

            <div className="flex items-center gap-2 pt-1">
                <button
                    onClick={handleSave}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                    <Save size={12} /> Save
                </button>
                <button
                    onClick={onCancel}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700/50 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
                >
                    <X size={12} /> Cancel
                </button>
            </div>

            <ScienceFact cardType={card.cardType || 'basic'} />
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   CARD EDITOR MODAL — portal overlay (BUG 4)
   ═══════════════════════════════════════════════════════════ */

function CardEditorModal({
    card,
    onSave,
    onCancel,
}: {
    card: Flashcard;
    onSave: (updated: Flashcard) => void;
    onCancel: () => void;
}) {
    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onCancel]);

    return createPortal(
        <div
            className="fixed inset-0 z-99999 flex items-center justify-center"
            onClick={onCancel}
        >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto rounded-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <InlineCardEditor card={card} onSave={onSave} onCancel={onCancel} />
            </div>
        </div>,
        document.body,
    );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function FlashcardView({ onOpenNote: _onOpenNote }: FlashcardViewProps) {
    const [mode, setMode] = useState<'menu' | 'review' | 'manage' | 'results'>('menu');
    const [dueCards, setDueCards] = useState<Flashcard[]>([]);
    const [allCards, setAllCards] = useState<Flashcard[]>([]);
    const [currentIdx, setCurrentIdx] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [hintUsed, setHintUsed] = useState(false);
    const [sessionHistory, setSessionHistory] = useState<{ card: Flashcard; rating: Rating }[]>([]);
    const [deckFilter, setDeckFilter] = useState<string>('all');
    const [interleave, setInterleave] = useState(true);

    // MCQ state
    const [mcqSelected, setMcqSelected] = useState<number | null>(null);

    // Manage mode
    const [editingCardId, setEditingCardId] = useState<string | null>(null);

    // New card creation state
    const [newType, setNewType] = useState<CardType>('basic');
    const [newFront, setNewFront] = useState('');
    const [newBack, setNewBack] = useState('');
    const [newHint, setNewHint] = useState('');
    const [newDeck, setNewDeck] = useState('');
    // Fill-blank / cloze state
    const [newSentence, setNewSentence] = useState('');
    const [newBlanks, setNewBlanks] = useState<number[]>([]);
    // MCQ state
    const [newMcqOptions, setNewMcqOptions] = useState<string[]>(['', '', '', '']);
    const [newMcqCorrect, setNewMcqCorrect] = useState(0);
    // Matching state
    const [newMatchPairs, setNewMatchPairs] = useState<[string, string][]>([
        ['', ''],
        ['', ''],
        ['', ''],
    ]);
    // Cloze creation options
    const [newClozeSyntax, setNewClozeSyntax] = useState(false);
    const [newRawSyntax, setNewRawSyntax] = useState('');

    // Session timer
    const sessionStartRef = useRef<number>(0);

    // Retention forecast
    const [forecast, setForecast] = useState<number[]>([]);

    // Collection/Set state (BUG 2)
    const [collections, setCollections] = useState<FlashcardCollection[]>([]);
    const [sets, setSets] = useState<FlashcardSet[]>([]);
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
    const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
    const [showCollections, setShowCollections] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState('');
    const [newSetName, setNewSetName] = useState('');
    const [addingSetForCollection, setAddingSetForCollection] = useState<string | null>(null);

    // Quick-add open in menu (BUG 1)
    const [menuQuickAdd, setMenuQuickAdd] = useState(false);

    const refresh = useCallback(async () => {
        const due = await getDueCards();
        const all = await getAllCards();
        const cols = await getAllCollections();
        const allSets = await getAllSets();
        setDueCards(due);
        setAllCards(all);
        setCollections(cols);
        setSets(allSets);
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Get unique decks
    const decks = useMemo(() => {
        const set = new Set(allCards.map((c) => c.deck || 'Uncategorized'));
        return ['all', ...Array.from(set).sort()];
    }, [allCards]);

    // Filtered due cards
    const filteredDue = useMemo(() => {
        let cards = dueCards;
        if (deckFilter !== 'all') {
            cards = cards.filter((c) => (c.deck || 'Uncategorized') === deckFilter);
        }
        if (selectedCollectionId) {
            cards = cards.filter((c) => c.collectionId === selectedCollectionId);
        }
        if (selectedSetId) {
            cards = cards.filter((c) => c.setId === selectedSetId);
        }
        if (interleave) {
            cards = shuffleArray(cards);
        }
        return cards;
    }, [dueCards, deckFilter, selectedCollectionId, selectedSetId, interleave]);

    const currentCard = filteredDue[currentIdx];

    // Keyboard shortcuts
    useEffect(() => {
        if (mode !== 'review' || !currentCard) return;
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

            // H for hint (allow even in inputs)
            if (e.key === 'h' || e.key === 'H') {
                if (!isInput) {
                    setShowHint(true);
                    setHintUsed(true);
                }
            }

            // Space/Enter to flip (basic/cloze-fallback only)
            if ((e.key === ' ' || e.key === 'Enter') && !isInput) {
                e.preventDefault();
                if (!flipped) setFlipped(true);
            }

            // 1-4 for ratings when flipped
            if (flipped) {
                if (e.key === '1') handleRate('again');
                if (e.key === '2') handleRate('hard');
                if (e.key === '3') handleRate('good');
                if (e.key === '4') handleRate('easy');
            }

            // 1-6 for MCQ selection when not flipped
            if (!flipped && currentCard.cardType === 'mcq' && currentCard.options && !isInput) {
                const num = parseInt(e.key);
                if (num >= 1 && num <= currentCard.options.length) {
                    setMcqSelected(num - 1);
                    setFlipped(true);
                }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, flipped, currentIdx, filteredDue, currentCard]);

    const startReview = useCallback(() => {
        setCurrentIdx(0);
        setFlipped(false);
        setShowHint(false);
        setHintUsed(false);
        setSessionHistory([]);
        setMcqSelected(null);
        sessionStartRef.current = Date.now();
        setMode('review');
    }, []);

    const handleRate = useCallback(
        async (rating: Rating) => {
            const card = filteredDue[currentIdx];
            if (!card) return;
            const updated = await reviewCard(card, rating);
            setSessionHistory((h) => [...h, { card: updated, rating }]);
            setFlipped(false);
            setShowHint(false);
            setHintUsed(false);
            setMcqSelected(null);

            if (currentIdx + 1 < filteredDue.length) {
                setCurrentIdx((i) => i + 1);
            } else {
                // Session finished — load forecast
                const fc = await getRetentionForecast(7);
                setForecast(fc);
                setMode('results');
                refresh();
            }
        },
        [filteredDue, currentIdx, refresh],
    );

    const resetCreationForm = useCallback(() => {
        setNewFront('');
        setNewBack('');
        setNewHint('');
        setNewDeck('');
        setNewSentence('');
        setNewBlanks([]);
        setNewMcqOptions(['', '', '', '']);
        setNewMcqCorrect(0);
        setNewMatchPairs([['', ''], ['', ''], ['', '']]);
        setNewClozeSyntax(false);
        setNewRawSyntax('');
    }, []);

    const handleAddCard = useCallback(async () => {
        let front = '';
        let back = '';
        const opts: Partial<
            Pick<
                Flashcard,
                'cardType' | 'hint' | 'options' | 'correctIndex' | 'matchPairs' | 'clozeIndex' | 'deck' | 'tags' | 'sentence' | 'blanks' | 'collectionId' | 'setId'
            >
        > = {
            cardType: newType,
        };

        if (newHint.trim()) opts.hint = newHint.trim();
        if (newDeck.trim()) opts.deck = newDeck.trim();
        if (selectedCollectionId) opts.collectionId = selectedCollectionId;
        if (selectedSetId) opts.setId = selectedSetId;

        if (newType === 'basic') {
            if (!newFront.trim() || !newBack.trim()) return;
            front = newFront;
            back = newBack;
        } else if (newType === 'fill-blank') {
            if (!newSentence.trim() || newBlanks.length === 0) return;
            opts.sentence = newSentence;
            opts.blanks = newBlanks;
            front = buildFrontFromBlanks(newSentence, newBlanks);
            back = buildBackFromBlanks(newSentence, newBlanks);
        } else if (newType === 'mcq') {
            const validOpts = newMcqOptions.filter((o) => o.trim());
            if (!newFront.trim() || validOpts.length < 2) return;
            front = newFront;
            opts.options = validOpts;
            opts.correctIndex = newMcqCorrect;
            back = validOpts[newMcqCorrect] ?? '';
        } else if (newType === 'matching') {
            const validPairs = newMatchPairs.filter((p) => p[0].trim() && p[1].trim()) as [string, string][];
            if (validPairs.length < 3) return;
            opts.matchPairs = validPairs;
            front = `Match ${validPairs.length} pairs`;
            back = '';
        } else if (newType === 'cloze') {
            if (newClozeSyntax) {
                // Parse raw cloze syntax
                if (!newRawSyntax.trim()) return;
                const clozeRegex = /\{\{c(\d+)::([^}:]+)(?:::([^}]+))?\}\}/g;
                const matches = [...newRawSyntax.matchAll(clozeRegex)];
                if (matches.length === 0) return;
                front = newRawSyntax.replace(clozeRegex, '[...]');
                back = matches.map((m) => m[2].trim()).join(', ');
                // Store as sentence and blanks equivalent
                opts.sentence = newRawSyntax.replace(clozeRegex, '$2');
                const plainWords = opts.sentence.split(/\s+/);
                const blankIndices: number[] = [];
                for (const m of matches) {
                    const word = m[2].trim();
                    const idx = plainWords.indexOf(word);
                    if (idx >= 0 && !blankIndices.includes(idx)) blankIndices.push(idx);
                }
                opts.blanks = blankIndices.sort((a, b) => a - b);
            } else {
                if (!newSentence.trim() || newBlanks.length === 0) return;
                opts.sentence = newSentence;
                opts.blanks = newBlanks;
                front = buildFrontFromBlanks(newSentence, newBlanks);
                back = buildBackFromBlanks(newSentence, newBlanks);
            }
        }

        const card = newCard('manual', front, back, opts);
        await upsertCard(card);
        resetCreationForm();
        refresh();
    }, [
        newType, newFront, newBack, newHint, newDeck,
        newSentence, newBlanks,
        newMcqOptions, newMcqCorrect,
        newMatchPairs,
        newClozeSyntax, newRawSyntax,
        resetCreationForm, refresh,
    ]);

    const handleDeleteCard = useCallback(
        async (id: string) => {
            await deleteCard(id);
            if (editingCardId === id) setEditingCardId(null);
            refresh();
        },
        [refresh, editingCardId],
    );

    const handleEditSave = useCallback(
        async (updated: Flashcard) => {
            await upsertCard(updated);
            setEditingCardId(null);
            refresh();
        },
        [refresh],
    );

    // Collection/Set handlers (BUG 2)
    const handleCreateCollection = useCallback(
        async () => {
            if (!newCollectionName.trim()) return;
            await createCollection(newCollectionName.trim());
            setNewCollectionName('');
            refresh();
        },
        [newCollectionName, refresh],
    );

    const handleCreateSet = useCallback(
        async (collectionId: string) => {
            if (!newSetName.trim()) return;
            await createSet(collectionId, newSetName.trim());
            setNewSetName('');
            setAddingSetForCollection(null);
            refresh();
        },
        [newSetName, refresh],
    );



    /* ═══════════════════════════════════════════════════════
       RENDER: Results Mode
       ═══════════════════════════════════════════════════════ */

    if (mode === 'results') {
        const stats = getSessionStats(sessionHistory);
        const elapsed = Date.now() - sessionStartRef.current;
        const dueTomorrow = forecast[1] ?? 0;
        const missedCards = sessionHistory.filter((r) => r.rating === 'again');

        return (
            <div className="flex-1 overflow-auto pb-24" style={{ background: 'var(--onyx-editor)' }}>
                <div className="max-w-xl mx-auto px-8 pt-10">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <Trophy size={36} className="text-violet-400 mx-auto mb-3" />
                        <h1 className="text-xl font-bold text-zinc-100 mb-1">Session Complete</h1>
                        <p className="text-sm text-zinc-500">Great work! Here is your summary.</p>
                    </div>

                    {/* Accuracy progress bar */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] text-zinc-500">Accuracy</span>
                            <span
                                className={`text-sm font-bold ${
                                    stats.accuracy >= 80
                                        ? 'text-emerald-400'
                                        : stats.accuracy >= 60
                                          ? 'text-amber-400'
                                          : 'text-red-400'
                                }`}
                            >
                                {stats.accuracy}%
                            </span>
                        </div>
                        <div className="w-full h-2 bg-zinc-800/40 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                    stats.accuracy >= 80
                                        ? 'bg-emerald-500'
                                        : stats.accuracy >= 60
                                          ? 'bg-amber-500'
                                          : 'bg-red-500'
                                }`}
                                style={{ width: `${stats.accuracy}%` }}
                            />
                        </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-4 gap-2 mb-6">
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-violet-400">{stats.total}</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Reviewed</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-emerald-400">{stats.correct}</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Correct</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-amber-400">{stats.hard}</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Hard</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-red-400">{stats.again}</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Again</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 mb-6">
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-zinc-300">
                                <Clock size={14} className="inline mr-1" />
                                {formatElapsed(elapsed)}
                            </p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Time</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-orange-400">
                                <Zap size={14} className="inline mr-1" />
                                {stats.streak}
                            </p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Streak</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-sky-400">{stats.newCards}</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">New cards</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-3 py-3 text-center">
                            <p className="text-lg font-bold text-violet-400">{dueTomorrow}</p>
                            <p className="text-[10px] text-zinc-500 mt-0.5">Due tomorrow</p>
                        </div>
                    </div>

                    {/* By card type breakdown */}
                    {stats.byType.size > 0 && (
                        <div className="mb-6">
                            <p className="text-[11px] text-zinc-500 mb-3 flex items-center gap-1.5">
                                <Layers size={12} className="text-violet-400" />
                                By Card Type
                            </p>
                            <div className="space-y-2">
                                {Array.from(stats.byType.entries()).map(([type, data]) => {
                                    const pct = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;
                                    return (
                                        <div key={type}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span
                                                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                                                        TYPE_TAG_COLORS[type] ?? TYPE_TAG_COLORS.basic
                                                    }`}
                                                >
                                                    {type}
                                                </span>
                                                <span className="text-[11px] text-zinc-400">
                                                    {data.correct}/{data.total} ({pct}%)
                                                </span>
                                            </div>
                                            <div className="w-full h-1.5 bg-zinc-800/40 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-violet-500/70 rounded-full transition-all"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Retention forecast chart */}
                    {forecast.length > 0 && <RetentionForecastChart forecast={forecast} />}

                    {/* Card-by-card review (BUG 5) */}
                    {sessionHistory.length > 0 && (
                        <div className="mb-6 mt-6">
                            <p className="text-[11px] text-zinc-500 mb-3 flex items-center gap-1.5">
                                <Target size={12} className="text-violet-400" />
                                Card-by-Card Review
                            </p>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                                {sessionHistory.map((entry, i) => {
                                    const ratingColors: Record<Rating, string> = {
                                        again: 'text-red-400 bg-red-900/30',
                                        hard: 'text-amber-400 bg-amber-900/30',
                                        good: 'text-emerald-400 bg-emerald-900/30',
                                        easy: 'text-sky-400 bg-sky-900/30',
                                    };
                                    return (
                                        <div
                                            key={`${entry.card.id}-${i}`}
                                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-800/30"
                                        >
                                            <span className="text-[10px] text-zinc-600 font-mono w-5 shrink-0 text-right">
                                                {i + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[12px] text-zinc-300 truncate">
                                                    {entry.card.front}
                                                </p>
                                                {entry.card.back && (
                                                    <p className="text-[10px] text-zinc-600 truncate">
                                                        {entry.card.back}
                                                    </p>
                                                )}
                                            </div>
                                            <span
                                                className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
                                                    TYPE_TAG_COLORS[entry.card.cardType] ??
                                                    TYPE_TAG_COLORS.basic
                                                }`}
                                            >
                                                {entry.card.cardType || 'basic'}
                                            </span>
                                            <span
                                                className={`text-[10px] px-2 py-0.5 rounded-md font-medium shrink-0 ${
                                                    ratingColors[entry.rating]
                                                }`}
                                            >
                                                {entry.rating}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-3 mt-8">
                        {missedCards.length > 0 && (
                            <button
                                onClick={() => {
                                    // Re-review missed cards
                                    const missedFlashcards = missedCards.map((r) => r.card);
                                    setDueCards(missedFlashcards);
                                    setCurrentIdx(0);
                                    setFlipped(false);
                                    setShowHint(false);
                                    setHintUsed(false);
                                    setSessionHistory([]);
                                    setMcqSelected(null);
                                    sessionStartRef.current = Date.now();
                                    setMode('review');
                                }}
                                className="flex-1 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-sm font-medium transition-colors cursor-pointer"
                            >
                                <RotateCcw size={14} className="inline mr-1.5" />
                                Review missed cards ({missedCards.length})
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setMode('menu');
                                refresh();
                            }}
                            className="flex-1 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors cursor-pointer"
                        >
                            Back to deck
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    /* ═══════════════════════════════════════════════════════
       RENDER: Menu Mode
       ═══════════════════════════════════════════════════════ */

    if (mode === 'menu') {
        return (
            <div className="flex-1 overflow-auto pb-24" style={{ background: 'var(--onyx-editor)' }}>
                <div className="max-w-xl mx-auto px-8 pt-10">
                    <div className="flex items-center gap-3 mb-1">
                        <BookOpen size={22} className="text-violet-400" />
                        <h1 className="text-2xl font-bold text-zinc-100">Flashcards</h1>
                    </div>
                    <p className="text-sm text-zinc-500 mb-8 ml-8.5">
                        FSRS-powered spaced repetition -- 5 card types
                    </p>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-3 mb-6">
                        <div className="bg-zinc-800/40 rounded-xl px-4 py-3 text-center">
                            <p className="text-2xl font-bold text-violet-400">{dueCards.length}</p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">Due Now</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-4 py-3 text-center">
                            <p className="text-2xl font-bold text-zinc-300">{allCards.length}</p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">Total Cards</p>
                        </div>
                        <div className="bg-zinc-800/40 rounded-xl px-4 py-3 text-center">
                            <p className="text-2xl font-bold text-emerald-400">{sessionHistory.length}</p>
                            <p className="text-[11px] text-zinc-500 mt-0.5">This Session</p>
                        </div>
                    </div>

                    {/* Deck filter */}
                    {decks.length > 2 && (
                        <div className="flex items-center gap-2 mb-4 overflow-x-auto">
                            <Layers size={12} className="text-zinc-500 shrink-0" />
                            {decks.map((d) => (
                                <button
                                    key={d}
                                    onClick={() => setDeckFilter(d)}
                                    className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                                        deckFilter === d
                                            ? 'bg-violet-500/20 text-violet-300'
                                            : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/30'
                                    }`}
                                >
                                    {d === 'all' ? 'All Decks' : d}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Collection/Set Hierarchy (BUG 2) */}
                    <div className="mb-4">
                        <button
                            onClick={() => setShowCollections(!showCollections)}
                            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer mb-2"
                        >
                            <FolderOpen size={12} />
                            <span>Collections & Sets</span>
                            {showCollections ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        </button>

                        {showCollections && (
                            <div className="space-y-2 ml-5">
                                {/* All cards option */}
                                <button
                                    onClick={() => {
                                        setSelectedCollectionId(null);
                                        setSelectedSetId(null);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-[11px] rounded-lg transition-colors cursor-pointer ${
                                        !selectedCollectionId
                                            ? 'bg-violet-500/20 text-violet-300'
                                            : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/30'
                                    }`}
                                >
                                    All Cards
                                </button>

                                {/* Collections */}
                                {collections.map((col) => {
                                    const colSets = sets.filter((s) => s.collectionId === col.id);
                                    const colCards = allCards.filter((c) => c.collectionId === col.id);
                                    const colDue = dueCards.filter((c) => c.collectionId === col.id);
                                    const isSelected = selectedCollectionId === col.id && !selectedSetId;

                                    return (
                                        <div key={col.id}>
                                            <button
                                                onClick={() => {
                                                    setSelectedCollectionId(col.id);
                                                    setSelectedSetId(null);
                                                }}
                                                className={`w-full text-left px-3 py-1.5 text-[11px] rounded-lg transition-colors cursor-pointer flex items-center justify-between ${
                                                    isSelected
                                                        ? 'bg-violet-500/20 text-violet-300'
                                                        : 'text-zinc-400 hover:text-zinc-300 bg-zinc-800/30'
                                                }`}
                                            >
                                                <span className="flex items-center gap-1.5">
                                                    <FolderOpen size={10} />
                                                    {col.name}
                                                </span>
                                                <span className="text-[9px] text-zinc-600">
                                                    {colDue.length}/{colCards.length}
                                                </span>
                                            </button>

                                            {/* Sets within collection */}
                                            {colSets.length > 0 && (
                                                <div className="ml-4 mt-1 space-y-1">
                                                    {colSets.map((s) => {
                                                        const setCards = allCards.filter((c) => c.setId === s.id);
                                                        const setDue = dueCards.filter((c) => c.setId === s.id);
                                                        const isSetSelected = selectedSetId === s.id;

                                                        return (
                                                            <button
                                                                key={s.id}
                                                                onClick={() => {
                                                                    setSelectedCollectionId(col.id);
                                                                    setSelectedSetId(s.id);
                                                                }}
                                                                className={`w-full text-left px-2.5 py-1 text-[10px] rounded-md transition-colors cursor-pointer flex items-center justify-between ${
                                                                    isSetSelected
                                                                        ? 'bg-violet-500/15 text-violet-300'
                                                                        : 'text-zinc-500 hover:text-zinc-400 bg-zinc-800/20'
                                                                }`}
                                                            >
                                                                <span className="flex items-center gap-1.5">
                                                                    <Layers size={9} />
                                                                    {s.name}
                                                                </span>
                                                                <span className="text-[9px] text-zinc-600">
                                                                    {setDue.length}/{setCards.length}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Add set button */}
                                            {addingSetForCollection === col.id ? (
                                                <div className="ml-4 mt-1 flex items-center gap-1">
                                                    <input
                                                        value={newSetName}
                                                        onChange={(e) => setNewSetName(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleCreateSet(col.id);
                                                            if (e.key === 'Escape') setAddingSetForCollection(null);
                                                        }}
                                                        placeholder="Set name..."
                                                        className="flex-1 bg-zinc-800/60 text-[10px] text-zinc-200 rounded-md px-2 py-1 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={() => handleCreateSet(col.id)}
                                                        className="text-violet-400 hover:text-violet-300 cursor-pointer"
                                                    >
                                                        <Plus size={10} />
                                                    </button>
                                                    <button
                                                        onClick={() => setAddingSetForCollection(null)}
                                                        className="text-zinc-600 hover:text-zinc-400 cursor-pointer"
                                                    >
                                                        <X size={10} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setAddingSetForCollection(col.id)}
                                                    className="ml-4 mt-1 flex items-center gap-1 text-[9px] text-zinc-600 hover:text-violet-400 transition-colors cursor-pointer"
                                                >
                                                    <Plus size={8} /> Add set
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Create new collection */}
                                <div className="flex items-center gap-1 mt-2">
                                    <input
                                        value={newCollectionName}
                                        onChange={(e) => setNewCollectionName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateCollection();
                                        }}
                                        placeholder="New collection..."
                                        className="flex-1 bg-zinc-800/60 text-[10px] text-zinc-200 rounded-md px-2 py-1.5 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                                    />
                                    <button
                                        onClick={handleCreateCollection}
                                        disabled={!newCollectionName.trim()}
                                        className="text-violet-400 hover:text-violet-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                                    >
                                        <Plus size={12} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Interleave toggle */}
                    <div className="flex items-center gap-4 mb-6">
                        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={interleave}
                                onChange={(e) => setInterleave(e.target.checked)}
                                className="accent-violet-500"
                            />
                            <Shuffle size={12} /> Interleave
                        </label>
                    </div>

                    {/* Start review button */}
                    <button
                        onClick={startReview}
                        disabled={filteredDue.length === 0}
                        className="w-full flex items-center gap-3 px-4 py-3 mb-4 rounded-xl border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 transition-colors cursor-pointer group disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Sparkles size={16} className="text-violet-400" />
                        <span className="text-sm font-medium text-violet-300 group-hover:text-violet-200 transition-colors">
                            {filteredDue.length > 0
                                ? `Review ${filteredDue.length} cards`
                                : 'No cards due'}
                        </span>
                        <ChevronRight size={14} className="text-violet-400/50 ml-auto" />
                    </button>

                    {/* Quick-add card (BUG 1) */}
                    <button
                        onClick={() => setMenuQuickAdd(!menuQuickAdd)}
                        className="w-full flex items-center gap-3 px-4 py-3 mb-2 rounded-xl border border-zinc-800 hover:bg-zinc-800/40 transition-colors cursor-pointer group"
                    >
                        <Plus size={16} className="text-zinc-400" />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                            Quick add card
                        </span>
                        {menuQuickAdd ? (
                            <ChevronDown size={14} className="text-zinc-600 ml-auto" />
                        ) : (
                            <ChevronRight size={14} className="text-zinc-600 ml-auto" />
                        )}
                    </button>

                    {menuQuickAdd && (
                        <div className="bg-zinc-800/40 rounded-xl p-4 mb-4 space-y-3">
                            {/* Card type selector with tooltips */}
                            <div className="flex items-center gap-1 flex-wrap">
                                {CARD_TYPE_OPTIONS.map((opt) => (
                                    <div key={opt.value} className="relative group/tip">
                                        <button
                                            onClick={() => {
                                                setNewType(opt.value);
                                                resetCreationForm();
                                            }}
                                            className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors cursor-pointer ${
                                                newType === opt.value
                                                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                                    : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/30 border border-transparent'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 rounded-lg bg-zinc-900 border border-zinc-700/50 shadow-xl text-[10px] text-zinc-400 leading-relaxed opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity duration-200 z-50">
                                            <Info size={10} className="inline mr-1 text-violet-400 shrink-0" />
                                            {SCIENCE_FACTS[opt.value]}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Type-specific forms */}
                            {newType === 'basic' && (
                                <BasicCreationForm
                                    front={newFront}
                                    setFront={setNewFront}
                                    back={newBack}
                                    setBack={setNewBack}
                                />
                            )}
                            {newType === 'fill-blank' && (
                                <FillBlankCreationForm
                                    sentence={newSentence}
                                    setSentence={setNewSentence}
                                    blanks={newBlanks}
                                    setBlanks={setNewBlanks}
                                />
                            )}
                            {newType === 'mcq' && (
                                <MCQCreationForm
                                    question={newFront}
                                    setQuestion={setNewFront}
                                    options={newMcqOptions}
                                    setOptions={setNewMcqOptions}
                                    correctIndex={newMcqCorrect}
                                    setCorrectIndex={setNewMcqCorrect}
                                />
                            )}
                            {newType === 'matching' && (
                                <MatchingCreationForm pairs={newMatchPairs} setPairs={setNewMatchPairs} />
                            )}
                            {newType === 'cloze' && (
                                <ClozeCreationForm
                                    sentence={newSentence}
                                    setSentence={setNewSentence}
                                    blanks={newBlanks}
                                    setBlanks={setNewBlanks}
                                    syntaxMode={newClozeSyntax}
                                    setSyntaxMode={setNewClozeSyntax}
                                    rawSyntax={newRawSyntax}
                                    setRawSyntax={setNewRawSyntax}
                                />
                            )}

                            {/* Common fields: hint + deck */}
                            <div className="flex gap-2">
                                <input
                                    value={newHint}
                                    onChange={(e) => setNewHint(e.target.value)}
                                    placeholder="Hint (optional)..."
                                    className="flex-1 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                                />
                                <input
                                    value={newDeck}
                                    onChange={(e) => setNewDeck(e.target.value)}
                                    placeholder="Deck..."
                                    className="w-32 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                                />
                            </div>

                            <button
                                onClick={handleAddCard}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer"
                            >
                                <Plus size={12} />
                                Add Card
                            </button>
                        </div>
                    )}

                    {/* Manage cards button */}
                    <button
                        onClick={() => setMode('manage')}
                        className="w-full flex items-center gap-3 px-4 py-3 mb-4 rounded-xl border border-zinc-800 hover:bg-zinc-800/40 transition-colors cursor-pointer group"
                    >
                        <Pencil size={16} className="text-zinc-400" />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                            Manage all cards
                        </span>
                        <ChevronRight size={14} className="text-zinc-600 ml-auto" />
                    </button>

                    {/* Card type syntax help (collapsible) */}
                    <details className="text-[11px] text-zinc-600 leading-relaxed">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-400 mb-2 select-none">
                            Card syntax reference
                        </summary>
                        <div className="space-y-1 ml-2">
                            <p>
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">Q:</code>/
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">A:</code> or{' '}
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">
                                    front :: back
                                </code>{' '}
                                — Basic
                            </p>
                            <p>
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">
                                    {'The {{answer}} is correct'}
                                </code>{' '}
                                — Fill-in-Blank
                            </p>
                            <p>
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">
                                    {'{{c1::word}}'}
                                </code>{' '}
                                — Cloze
                            </p>
                            <p>
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">
                                    MCQ: question
                                </code>{' '}
                                +{' '}
                                <code className="px-1 py-0.5 bg-zinc-800/60 rounded text-violet-400">
                                    a) b) c) Answer: a
                                </code>{' '}
                                — MCQ
                            </p>
                        </div>
                    </details>
                </div>
            </div>
        );
    }

    /* ═══════════════════════════════════════════════════════
       RENDER: Review Mode
       ═══════════════════════════════════════════════════════ */

    if (mode === 'review' && currentCard) {
        return (
            <div className="flex-1 overflow-auto pb-24" style={{ background: 'var(--onyx-editor)' }}>
                <div className="max-w-xl mx-auto px-8 pt-10">
                    {/* Session stats bar */}
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={() => {
                                getRetentionForecast(7).then(setForecast);
                                setMode('results');
                                refresh();
                            }}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1"
                        >
                            <ArrowLeft size={12} /> End Session
                        </button>
                        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                            <BarChart3 size={10} />
                            <span>
                                {currentIdx + 1}/{filteredDue.length}
                            </span>
                            {currentCard.deck && (
                                <span className="text-violet-400/60">{currentCard.deck}</span>
                            )}
                            <span
                                className={`text-[9px] px-1.5 py-0.5 rounded ${
                                    TYPE_TAG_COLORS[currentCard.cardType] ?? TYPE_TAG_COLORS.basic
                                }`}
                            >
                                {currentCard.cardType || 'basic'}
                            </span>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1 bg-zinc-800/40 rounded-full mb-6 overflow-hidden">
                        <div
                            className="h-full bg-violet-500 rounded-full transition-all duration-300"
                            style={{
                                width: `${((currentIdx + 1) / filteredDue.length) * 100}%`,
                            }}
                        />
                    </div>

                    {/* Card renderer by type */}
                    {(currentCard.cardType === 'basic' || !currentCard.cardType) && (
                        <BasicReview
                            card={currentCard}
                            flipped={flipped}
                            onFlip={() => setFlipped(true)}
                            showHint={showHint}
                        />
                    )}

                    {currentCard.cardType === 'fill-blank' && (
                        <FillBlankReview
                            card={currentCard}
                            flipped={flipped}
                            onFlip={() => setFlipped(true)}
                            showHint={showHint}
                            hintUsed={hintUsed}
                            onHint={() => setHintUsed(true)}
                        />
                    )}

                    {currentCard.cardType === 'mcq' && (
                        <MCQReview
                            card={currentCard}
                            flipped={flipped}
                            onSelect={(i) => {
                                setMcqSelected(i);
                                setFlipped(true);
                            }}
                            selectedIdx={mcqSelected}
                            showHint={showHint}
                        />
                    )}

                    {currentCard.cardType === 'matching' && (
                        <MatchingReview
                            card={currentCard}
                            flipped={flipped}
                            onComplete={() => setFlipped(true)}
                        />
                    )}

                    {currentCard.cardType === 'cloze' && (
                        <ClozeReview
                            card={currentCard}
                            flipped={flipped}
                            onFlip={() => setFlipped(true)}
                            showHint={showHint}
                            hintUsed={hintUsed}
                            onHint={() => setHintUsed(true)}
                        />
                    )}

                    {/* Hint button for basic card */}
                    {(currentCard.cardType === 'basic' || !currentCard.cardType) &&
                        currentCard.hint &&
                        !showHint &&
                        !flipped && (
                            <button
                                onClick={() => setShowHint(true)}
                                className="flex items-center gap-1.5 mx-auto mt-3 text-xs text-zinc-500 hover:text-amber-400 transition-colors cursor-pointer"
                            >
                                <Lightbulb size={12} /> Show hint (H)
                            </button>
                        )}

                    {/* Rating buttons */}
                    {flipped && (
                        <div className="grid grid-cols-4 gap-2 mt-4">
                            {RATING_BUTTONS.map(({ rating, label, color, shortcut }) => (
                                <button
                                    key={rating}
                                    onClick={() => handleRate(rating)}
                                    className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${color}`}
                                >
                                    <span>{label}</span>
                                    <span className="block text-[10px] opacity-50 mt-0.5">{shortcut}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Card info line */}
                    <div className="flex items-center justify-center gap-4 mt-4 text-[10px] text-zinc-600">
                        <span>Interval: {currentCard.interval}d</span>
                        <span>Stability: {currentCard.stability?.toFixed(1) ?? 0}d</span>
                        <span>Lapses: {currentCard.lapses ?? 0}</span>
                    </div>
                </div>
            </div>
        );
    }

    /* ═══════════════════════════════════════════════════════
       RENDER: Manage Mode
       ═══════════════════════════════════════════════════════ */

    return (
        <div className="flex-1 overflow-auto pb-24" style={{ background: 'var(--onyx-editor)' }}>
            <div className="max-w-xl mx-auto px-8 pt-10">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <button
                        onClick={() => {
                            setMode('menu');
                            refresh();
                        }}
                        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer flex items-center gap-1"
                    >
                        <ArrowLeft size={12} /> Back
                    </button>
                    <h2 className="text-sm font-semibold text-zinc-300">Manage Cards</h2>
                    <span className="text-xs text-zinc-600 font-mono">{allCards.length}</span>
                </div>

                {/* ── Add card form ── */}
                <div className="bg-zinc-800/40 rounded-xl p-4 mb-6 space-y-3">
                    {/* Card type selector with tooltips (BUG 3) */}
                    <div className="flex items-center gap-1 flex-wrap">
                        {CARD_TYPE_OPTIONS.map((opt) => (
                            <div key={opt.value} className="relative group/tip">
                                <button
                                    onClick={() => {
                                        setNewType(opt.value);
                                        resetCreationForm();
                                    }}
                                    className={`px-2.5 py-1 text-[11px] rounded-lg transition-colors cursor-pointer ${
                                        newType === opt.value
                                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                                            : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/30 border border-transparent'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2.5 rounded-lg bg-zinc-900 border border-zinc-700/50 shadow-xl text-[10px] text-zinc-400 leading-relaxed opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity duration-200 z-50">
                                    <Info size={10} className="inline mr-1 text-violet-400 shrink-0" />
                                    {SCIENCE_FACTS[opt.value]}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Type-specific forms */}
                    {newType === 'basic' && (
                        <BasicCreationForm
                            front={newFront}
                            setFront={setNewFront}
                            back={newBack}
                            setBack={setNewBack}
                        />
                    )}

                    {newType === 'fill-blank' && (
                        <FillBlankCreationForm
                            sentence={newSentence}
                            setSentence={setNewSentence}
                            blanks={newBlanks}
                            setBlanks={setNewBlanks}
                        />
                    )}

                    {newType === 'mcq' && (
                        <MCQCreationForm
                            question={newFront}
                            setQuestion={setNewFront}
                            options={newMcqOptions}
                            setOptions={setNewMcqOptions}
                            correctIndex={newMcqCorrect}
                            setCorrectIndex={setNewMcqCorrect}
                        />
                    )}

                    {newType === 'matching' && (
                        <MatchingCreationForm pairs={newMatchPairs} setPairs={setNewMatchPairs} />
                    )}

                    {newType === 'cloze' && (
                        <ClozeCreationForm
                            sentence={newSentence}
                            setSentence={setNewSentence}
                            blanks={newBlanks}
                            setBlanks={setNewBlanks}
                            syntaxMode={newClozeSyntax}
                            setSyntaxMode={setNewClozeSyntax}
                            rawSyntax={newRawSyntax}
                            setRawSyntax={setNewRawSyntax}
                        />
                    )}

                    {/* Common fields: hint + deck */}
                    <div className="flex gap-2">
                        <input
                            value={newHint}
                            onChange={(e) => setNewHint(e.target.value)}
                            placeholder="Hint (optional)..."
                            className="flex-1 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                        />
                        <input
                            value={newDeck}
                            onChange={(e) => setNewDeck(e.target.value)}
                            placeholder="Deck..."
                            className="w-32 bg-zinc-800/60 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-transparent focus:border-violet-500/30 placeholder:text-zinc-600"
                        />
                    </div>

                    {/* Add button */}
                    <button
                        onClick={handleAddCard}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer"
                    >
                        <Plus size={12} />
                        Add Card
                    </button>

                    {/* Science fact */}
                    <ScienceFact cardType={newType} />
                </div>

                {/* ── Card list ── */}
                <div className="space-y-1">
                    {allCards.length === 0 && (
                        <p className="text-sm text-zinc-600 text-center py-8">
                            No cards yet. Add one above or use card syntax in study notes.
                        </p>
                    )}

                    {allCards.map((card) => (
                        <div key={card.id}>
                            {/* Card row */}
                            <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/40 group">
                                {card.dueAt <= Date.now() ? (
                                    <RotateCcw size={12} className="text-amber-400 shrink-0" />
                                ) : (
                                    <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                                )}

                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] text-zinc-300 truncate">{card.front}</p>
                                    <p className="text-[11px] text-zinc-600 truncate">
                                        {card.back || (card.matchPairs ? `${card.matchPairs.length} pairs` : '')}
                                    </p>
                                </div>

                                {/* Card type tag */}
                                <span
                                    className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${
                                        TYPE_TAG_COLORS[card.cardType] ?? TYPE_TAG_COLORS.basic
                                    }`}
                                >
                                    {card.cardType || 'basic'}
                                </span>

                                <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                                    {card.interval}d
                                </span>

                                {card.deck && (
                                    <span className="text-[9px] text-zinc-600 bg-zinc-800/40 px-1.5 py-0.5 rounded shrink-0">
                                        {card.deck}
                                    </span>
                                )}

                                {/* Edit button */}
                                <button
                                    onClick={() =>
                                        setEditingCardId(editingCardId === card.id ? null : card.id)
                                    }
                                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-violet-400 transition-all cursor-pointer"
                                >
                                    <Pencil size={12} />
                                </button>

                                {/* Delete button */}
                                <button
                                    onClick={() => handleDeleteCard(card.id)}
                                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all cursor-pointer"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Edit card modal (BUG 4) */}
            {editingCardId && (() => {
                const editCard = allCards.find((c) => c.id === editingCardId);
                if (!editCard) return null;
                return (
                    <CardEditorModal
                        card={editCard}
                        onSave={handleEditSave}
                        onCancel={() => setEditingCardId(null)}
                    />
                );
            })()}
        </div>
    );
}
