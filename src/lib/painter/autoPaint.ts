/**
 * autoPaint.ts — Auto-paint logic for Recall and Key Term paint types.
 * Extracts nouns, technical terms, and capitalised words from text using
 * regex + stop-word filtering. No external NLP, fully offline.
 */

/** Common stop words to exclude from auto-painting */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'must', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
  'your', 'his', 'our', 'their', 'mine', 'yours', 'hers', 'ours',
  'theirs', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'because', 'if', 'then', 'else',
  'about', 'up', 'out', 'down', 'off', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'also', 'still', 'already',
  'even', 'now', 'new', 'old', 'many', 'much', 'well', 'way',
  'use', 'used', 'using', 'make', 'made', 'like', 'time', 'one',
  'two', 'first', 'last', 'long', 'great', 'little', 'right', 'before',
  'after', 'between', 'while', 'during', 'without', 'through', 'into',
  'any', 'however', 'therefore', 'thus', 'hence', 'since', 'until',
  'although', 'though', 'yet', 'etc', 'eg', 'ie', 'vs', 'per',
  'e.g.', 'i.e.', 'etc.', 'vs.', 'note', 'notes', 'see', 'get',
  'set', 'put', 'let', 'say', 'said', 'know', 'known', 'take',
  'give', 'go', 'come', 'think', 'look', 'want', 'tell', 'ask',
  'work', 'seem', 'feel', 'try', 'leave', 'call', 'keep', 'begin',
  'show', 'hear', 'play', 'run', 'move', 'live', 'believe', 'hold',
  'bring', 'happen', 'write', 'provide', 'sit', 'stand', 'lose',
  'pay', 'meet', 'include', 'continue', 'learn', 'change', 'lead',
  'understand', 'watch', 'follow', 'stop', 'create', 'speak', 'read',
  'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win', 'offer',
  'remember', 'consider', 'appear', 'buy', 'wait', 'serve', 'die',
  'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach',
  'kill', 'remain', 'example', 'important', 'different', 'above',
  'below', 'next', 'following', 'given', 'within', 'among', 'across',
]);

export interface AutoPaintTerm {
  text: string;
  /** Start index in the source text */
  start: number;
  /** End index in the source text */
  end: number;
}

/**
 * Extract key terms from text for auto-painting.
 * Targets:
 * 1. Capitalised words that aren't sentence-starters
 * 2. Multi-word capitalised phrases (e.g. "Machine Learning")
 * 3. Technical terms with special characters (e.g. "O(n)", "TCP/IP")
 * 4. Words that are unusually long (likely technical)
 */
export function extractKeyTerms(text: string): AutoPaintTerm[] {
  const terms: AutoPaintTerm[] = [];
  const seen = new Set<string>();

  // Split into sentences to detect sentence starters
  const sentences = text.split(/[.!?]\s+/);
  const sentenceStarters = new Set<number>();
  let offset = 0;
  for (const sentence of sentences) {
    const trimmed = sentence.trimStart();
    const startOffset = offset + (sentence.length - trimmed.length);
    sentenceStarters.add(startOffset);
    offset += sentence.length + 2; // +2 for the delimiter consumed
  }

  // Pattern 1: Capitalised words and phrases (not at sentence start)
  const capsRegex = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = capsRegex.exec(text)) !== null) {
    const word = match[1];
    const start = match.index;
    const lower = word.toLowerCase();

    // Skip sentence starters
    if (sentenceStarters.has(start)) continue;
    // Skip stop words
    if (STOP_WORDS.has(lower)) continue;
    // Skip very short words
    if (word.length < 3) continue;

    if (!seen.has(lower)) {
      seen.add(lower);
      terms.push({ text: word, start, end: start + word.length });
    }
  }

  // Pattern 2: Technical terms (contains digits, slashes, parens, dots)
  const techRegex = /\b([A-Za-z][A-Za-z0-9]*(?:[./()_-][A-Za-z0-9]+)+)\b/g;
  while ((match = techRegex.exec(text)) !== null) {
    const word = match[1];
    const start = match.index;
    const lower = word.toLowerCase();

    if (!seen.has(lower) && word.length >= 3) {
      seen.add(lower);
      terms.push({ text: word, start, end: start + word.length });
    }
  }

  // Pattern 3: Long words (8+ chars, not stop words) - likely domain-specific
  const longWordRegex = /\b([a-z]{8,})\b/gi;
  while ((match = longWordRegex.exec(text)) !== null) {
    const word = match[1];
    const start = match.index;
    const lower = word.toLowerCase();

    if (!seen.has(lower) && !STOP_WORDS.has(lower)) {
      seen.add(lower);
      terms.push({ text: word, start, end: start + word.length });
    }
  }

  // Sort by position in text
  terms.sort((a, b) => a.start - b.start);

  return terms;
}
