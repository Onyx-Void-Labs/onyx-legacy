/**
 * questionTypes.ts — Type definitions for the Question Library system.
 * Questions can be painted from note content or manually created.
 */

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'unanswered' | 'correct' | 'incorrect' | 'skipped';

export interface Question {
  id: string;
  /** The note this question was derived from */
  noteId: string;
  noteTitle: string;
  /** The block ID (from BlockId extension) this came from, if any */
  blockId?: string;
  /** The actual question text */
  question: string;
  /** The expected answer (may be freeform) */
  answer: string;
  /** Optional explanation or context */
  explanation?: string;
  /** Difficulty rating */
  difficulty: QuestionDifficulty;
  /** Tags for filtering */
  tags: string[];
  /** When was this question created */
  createdAt: number;
  /** When was this question last practiced */
  lastPracticedAt?: number;
  /** How many times practiced */
  practiceCount: number;
  /** Current status after last practice */
  status: QuestionStatus;
  /** Consecutive correct streak (for spaced repetition scheduling) */
  streak: number;
}

/**
 * A practice session snapshot
 */
export interface PracticeSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  questionIds: string[];
  results: Record<string, QuestionStatus>;
  /** Percentage of correct answers */
  score?: number;
}

/**
 * Auto-generate basic questions from painted Q&A blocks.
 * Returns question/answer pairs extracted from note content.
 */
export function generateQuestionsFromPaint(
  noteId: string,
  noteTitle: string,
  paintedBlocks: Array<{
    blockId: string;
    paintType: 'question' | 'answer';
    content: string;
  }>
): Omit<Question, 'id'>[] {
  const questions: Omit<Question, 'id'>[] = [];
  const qBlocks = paintedBlocks.filter((b) => b.paintType === 'question');
  const aBlocks = paintedBlocks.filter((b) => b.paintType === 'answer');

  // Pair questions with the nearest following answer block
  for (let i = 0; i < qBlocks.length; i++) {
    const q = qBlocks[i];
    // Find the first answer block that comes after this question
    const a = aBlocks.find((ab) => {
      const qIdx = paintedBlocks.indexOf(q);
      const aIdx = paintedBlocks.indexOf(ab);
      return aIdx > qIdx;
    });

    questions.push({
      noteId,
      noteTitle,
      blockId: q.blockId,
      question: q.content.trim(),
      answer: a?.content.trim() || '',
      difficulty: 'medium',
      tags: [],
      createdAt: Date.now(),
      practiceCount: 0,
      status: 'unanswered',
      streak: 0,
    });
  }

  return questions;
}
