import { describe, it, expect } from 'vitest';
import { newCard, extractCardsFromText, getSessionStats } from '../../lib/flashcards';
import type { Flashcard, Rating } from '../../lib/flashcards';

describe('newCard', () => {
    it('creates a basic card with default SRS state', () => {
        const card = newCard('note-1', 'Front', 'Back');
        expect(card.front).toBe('Front');
        expect(card.back).toBe('Back');
        expect(card.sourceNoteId).toBe('note-1');
        expect(card.cardType).toBe('basic');
        expect(card.interval).toBe(0);
        expect(card.easeFactor).toBe(2.5);
        expect(card.repetitions).toBe(0);
        expect(card.difficulty).toBe(0.3);
    });

    it('accepts optional cardType and hint', () => {
        const card = newCard('note-2', 'Q', 'A', { cardType: 'cloze', hint: 'think about it' });
        expect(card.cardType).toBe('cloze');
        expect(card.hint).toBe('think about it');
    });

    it('trims whitespace from front and back', () => {
        const card = newCard('n', '  hello  ', '  world  ');
        expect(card.front).toBe('hello');
        expect(card.back).toBe('world');
    });

    it('sets collectionId and setId when provided', () => {
        const card = newCard('n', 'F', 'B', { collectionId: 'c1', setId: 's1' });
        expect(card.collectionId).toBe('c1');
        expect(card.setId).toBe('s1');
    });
});

describe('extractCardsFromText', () => {
    it('extracts Q:/A: format', () => {
        const text = 'Q: What is 2+2?\nA: 4';
        const cards = extractCardsFromText('n1', text);
        expect(cards).toHaveLength(1);
        expect(cards[0].front).toBe('What is 2+2?');
        expect(cards[0].back).toBe('4');
    });

    it('extracts :: separator format', () => {
        const text = 'Capital of France :: Paris\nCapital of Japan :: Tokyo';
        const cards = extractCardsFromText('n1', text);
        expect(cards).toHaveLength(2);
        expect(cards[0].front).toBe('Capital of France');
        expect(cards[0].back).toBe('Paris');
        expect(cards[1].front).toBe('Capital of Japan');
        expect(cards[1].back).toBe('Tokyo');
    });

    it('extracts fill-in-the-blank format', () => {
        const text = 'The {{answer}} is correct';
        const cards = extractCardsFromText('n1', text);
        expect(cards).toHaveLength(1);
        expect(cards[0].cardType).toBe('fill-blank');
        expect(cards[0].front).toContain('______');
        expect(cards[0].back).toBe('answer');
    });

    it('extracts cloze format', () => {
        const text = 'The {{c1::capital}} of France is beautiful';
        const cards = extractCardsFromText('n1', text);
        expect(cards).toHaveLength(1);
        expect(cards[0].cardType).toBe('cloze');
        expect(cards[0].back).toBe('capital');
        expect(cards[0].front).toContain('[...]');
    });

    it('extracts MCQ format', () => {
        const text = `MCQ: What color is the sky?
a) Red
b) Blue
c) Green
d) Yellow
Answer: b`;
        const cards = extractCardsFromText('n1', text);
        expect(cards).toHaveLength(1);
        expect(cards[0].cardType).toBe('mcq');
        expect(cards[0].options).toHaveLength(4);
        expect(cards[0].correctIndex).toBe(1);
    });

    it('extracts MATCH format', () => {
        const text = `MATCH:
dog :: canine
cat :: feline`;
        const cards = extractCardsFromText('n1', text);
        expect(cards).toHaveLength(1);
        expect(cards[0].cardType).toBe('matching');
        expect(cards[0].matchPairs).toHaveLength(2);
    });

    it('returns empty array for no matches', () => {
        expect(extractCardsFromText('n1', 'just some text')).toHaveLength(0);
    });
});

describe('getSessionStats', () => {
    function makeReviewedCard(rating: Rating, cardType: string = 'basic'): { card: Flashcard; rating: Rating } {
        return {
            card: newCard('n1', 'F', 'B', { cardType: cardType as Flashcard['cardType'] }),
            rating,
        };
    }

    it('computes accuracy correctly', () => {
        const reviewed = [
            makeReviewedCard('good'),
            makeReviewedCard('easy'),
            makeReviewedCard('again'),
            makeReviewedCard('hard'),
        ];
        const stats = getSessionStats(reviewed);
        expect(stats.total).toBe(4);
        expect(stats.correct).toBe(3); // good, easy, hard = correct; again = incorrect
        expect(stats.again).toBe(1);
        expect(stats.accuracy).toBe(75);
    });

    it('computes longest streak', () => {
        const reviewed = [
            makeReviewedCard('good'),
            makeReviewedCard('good'),
            makeReviewedCard('again'),
            makeReviewedCard('good'),
        ];
        const stats = getSessionStats(reviewed);
        expect(stats.streak).toBe(2);
    });

    it('handles empty sessions', () => {
        const stats = getSessionStats([]);
        expect(stats.total).toBe(0);
        expect(stats.accuracy).toBe(0);
    });

    it('groups by card type', () => {
        const reviewed = [
            makeReviewedCard('good', 'basic'),
            makeReviewedCard('again', 'cloze'),
            makeReviewedCard('easy', 'basic'),
        ];
        const stats = getSessionStats(reviewed);
        expect(stats.byType.get('basic')?.total).toBe(2);
        expect(stats.byType.get('cloze')?.total).toBe(1);
    });
});
