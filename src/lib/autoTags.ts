import type { FileMeta, NoteType } from '../types/sync';

const TYPE_LABEL: Record<NoteType, string> = {
    note: 'Note',
    topic: 'Topic',
    idea: 'Idea',
    task: 'Task',
    resource: 'Resource',
    journal: 'Journal',
    study: 'Study',
};

export function resolveAutoTags(meta: FileMeta, firstHeading?: string): string[] {
    const tags: string[] = [];

    // Auto-tag from note type
    if (meta.type) {
        tags.push(TYPE_LABEL[meta.type] || meta.type);
    }

    // Auto-tag from subject
    if (meta.subject?.trim()) {
        tags.push(meta.subject.trim());
    }

    // Auto-tag from status (tasks)
    if (meta.status) {
        tags.push(meta.status);
    }

    // Auto-tag from first H1 heading content
    if (firstHeading?.trim()) {
        const heading = firstHeading.trim();
        if (heading.length <= 40 && !tags.includes(heading)) {
            tags.push(heading);
        }
    }

    // Merge in any manual tags stored in meta.tags
    // Manual tags are the ones not matching any auto-tags
    if (meta.tags) {
        for (const t of meta.tags) {
            if (!tags.includes(t)) {
                tags.push(t);
            }
        }
    }

    return tags;
}
