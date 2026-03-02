import { describe, it, expect } from 'vitest';
import { EVENT_COLORS } from '../../services/CalendarService';

describe('CalendarService', () => {
    describe('EVENT_COLORS', () => {
        it('has 7 color options', () => {
            expect(EVENT_COLORS).toHaveLength(7);
        });

        it('each color has required fields', () => {
            for (const color of EVENT_COLORS) {
                expect(color.value).toBeTruthy();
                expect(color.label).toBeTruthy();
                expect(color.bg).toBeTruthy();
                expect(color.border).toBeTruthy();
                expect(color.text).toBeTruthy();
                expect(color.dot).toBeTruthy();
            }
        });

        it('colors include emerald, blue, and red', () => {
            const values = EVENT_COLORS.map((c) => c.value);
            expect(values).toContain('emerald');
            expect(values).toContain('blue');
            expect(values).toContain('red');
        });
    });
});
