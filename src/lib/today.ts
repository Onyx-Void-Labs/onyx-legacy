/**
 * src/lib/today.ts — Today resolver functions for the Today Page engine.
 * Each function takes a list of FileMeta and returns the matching subset.
 */

import type { FileMeta } from '../types/sync';

function todayStr(): string {
    return new Date().toISOString().slice(0, 10);
}

function weekFromNow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
}

function sevenDaysAgo(): number {
    return Date.now() - 7 * 24 * 60 * 60 * 1000;
}

const PRIORITY_ORDER: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
};

function sortByPriority(a: FileMeta, b: FileMeta): number {
    return (PRIORITY_ORDER[a.priority ?? 'low'] ?? 3) - (PRIORITY_ORDER[b.priority ?? 'low'] ?? 3);
}

/**
 * Overdue tasks: dueDate < today, status ≠ done
 */
export function getCarriedOver(files: FileMeta[]): FileMeta[] {
    const today = todayStr();
    return files
        .filter(
            (f) =>
                f.type === 'task' &&
                (f.status ?? 'todo') !== 'done' &&
                f.dueDate !== undefined &&
                f.dueDate < today
        )
        .sort(sortByPriority);
}

/**
 * Tasks due today: dueDate === today, status ≠ done
 */
export function getDueToday(files: FileMeta[]): FileMeta[] {
    const today = todayStr();
    return files
        .filter(
            (f) =>
                f.type === 'task' &&
                (f.status ?? 'todo') !== 'done' &&
                f.dueDate === today
        )
        .sort(sortByPriority);
}

/**
 * Tasks scheduled for today: scheduledDate === today, status ≠ done
 */
export function getScheduledToday(files: FileMeta[]): FileMeta[] {
    const today = todayStr();
    return files
        .filter(
            (f) =>
                f.type === 'task' &&
                (f.status ?? 'todo') !== 'done' &&
                f.scheduledDate === today
        )
        .sort(sortByPriority);
}

/**
 * Someday / backlog tasks: isSomeday=true, status ≠ done
 */
export function getSomeday(files: FileMeta[]): FileMeta[] {
    return files
        .filter(
            (f) =>
                f.type === 'task' &&
                (f.status ?? 'todo') !== 'done' &&
                f.isSomeday === true
        )
        .sort(sortByPriority);
}

/**
 * Notes updated in the past 7 days (non-task, non-journal)
 */
export function getThisWeek(files: FileMeta[]): FileMeta[] {
    const cutoff = sevenDaysAgo();
    return files
        .filter(
            (f) =>
                f.type !== 'task' &&
                f.type !== 'journal' &&
                f.updatedAt > cutoff
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12);
}

/**
 * Tasks due this week (not today, not overdue): dueDate between tomorrow and +7 days
 */
export function getDueThisWeek(files: FileMeta[]): FileMeta[] {
    const today = todayStr();
    const weekEnd = weekFromNow();
    return files
        .filter(
            (f) =>
                f.type === 'task' &&
                (f.status ?? 'todo') !== 'done' &&
                f.dueDate !== undefined &&
                f.dueDate > today &&
                f.dueDate <= weekEnd
        )
        .sort(sortByPriority);
}

/**
 * Get today's journal note, or null if doesn't exist
 */
export function getTodayJournal(files: FileMeta[]): FileMeta | null {
    const today = todayStr();
    return (
        files.find(
            (f) =>
                f.type === 'journal' &&
                f.createdAt >= new Date(today).getTime() &&
                f.createdAt < new Date(today).getTime() + 86400000
        ) ?? null
    );
}
