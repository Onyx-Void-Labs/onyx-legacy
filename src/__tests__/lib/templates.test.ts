import { describe, it, expect } from 'vitest';
import { TEMPLATE_LIST, getTemplate } from '../../lib/templates';

describe('templates', () => {
    it('has at least 10 templates defined', () => {
        expect(TEMPLATE_LIST.length).toBeGreaterThanOrEqual(10);
    });

    it('each template has required fields', () => {
        for (const tpl of TEMPLATE_LIST) {
            expect(tpl.type).toBeTruthy();
            expect(tpl.label).toBeTruthy();
            expect(tpl.icon).toBeTruthy();
        }
    });

    it('returns JSONContent for each template type', () => {
        for (const tpl of TEMPLATE_LIST) {
            const content = getTemplate(tpl.type);
            expect(content).toBeTruthy();
            expect(content.type).toBe('doc');
            expect(content.content).toBeDefined();
            expect(Array.isArray(content.content)).toBe(true);
        }
    });

    it('cornell-notes template contains key sections', () => {
        const content = getTemplate('cornell-notes');
        const texts = JSON.stringify(content);
        expect(texts).toContain('Cue');
        expect(texts).toContain('Notes');
        expect(texts).toContain('Summary');
    });

    it('weekly-planner template contains days of the week', () => {
        const content = getTemplate('weekly-planner');
        const texts = JSON.stringify(content);
        expect(texts).toContain('Monday');
        expect(texts).toContain('Friday');
    });
});
