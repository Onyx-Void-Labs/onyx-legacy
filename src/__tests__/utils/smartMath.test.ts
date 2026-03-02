import { describe, it, expect } from 'vitest';
import { processSmartInput } from '../../utils/smartMath';

describe('processSmartInput', () => {
    describe('auto-fractions', () => {
        it('converts simple fraction a/b to \\frac{a}{b}', () => {
            expect(processSmartInput('a/b')).toBe('\\frac{a}{b}');
        });

        it('converts numeric fraction 1/2', () => {
            expect(processSmartInput('1/2')).toBe('\\frac{1}{2}');
        });

        it('converts parenthesized numerator (x+1)/y', () => {
            expect(processSmartInput('(x+1)/y')).toBe('\\frac{(x+1)}{y}');
        });

        it('does not double-convert existing \\frac', () => {
            const input = '\\frac{a}{b}';
            expect(processSmartInput(input)).toBe(input);
        });
    });

    describe('auto-symbols', () => {
        it('converts alpha to \\alpha command', () => {
            expect(processSmartInput('alpha')).toBe('\\alpha ');
        });

        it('does not double-convert \\alpha', () => {
            expect(processSmartInput('\\alpha')).toBe('\\alpha');
        });
    });

    it('returns unchanged content if no transformations apply', () => {
        expect(processSmartInput('hello world')).toBe('hello world');
    });
});
