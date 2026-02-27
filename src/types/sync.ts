
export type NoteType =
    | 'note'       // Default — plain document (📄)
    | 'topic'      // Topic / subject grouper (📖)
    | 'idea'       // Idea / brainstorm (💡)
    | 'task'       // Task-centric note (✅)
    | 'resource'   // Reference / link collection (🔗)
    | 'journal'    // Daily / dated entry (📅)
    | 'study'      // Study / revision note (📚)
    ;

export interface FileMeta {
    id: string;          // UUID
    title: string;
    type: NoteType;
    createdAt: number;
    updatedAt: number;
    // Soft-delete & archive
    deletedAt?: number;        // Timestamp when moved to trash (undefined = not deleted)
    isArchived?: boolean;      // true = archived, hidden from main sidebar
    // Auto-tags + manual tags
    tags?: string[];           // Computed auto-tags + optional manual entries
    // Task-specific metadata (only when type === 'task')
    dueDate?: string;          // ISO date string e.g. '2026-02-25'
    scheduledDate?: string;    // ISO date string
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    status?: 'todo' | 'in-progress' | 'done';
    isSomeday?: boolean;       // Mark task as someday/backlog
    subject?: string;          // Free-text subject for grouping (used by topic auto-query)
    module?: string;           // Free-text module identifier
    week?: number;             // Week number for academic grouping
    // Generic extensible properties
    properties?: Record<string, any>;
}

export type TemplateType = 'lecture-notes' | 'lab-report' | 'essay-outline' | 'meeting-notes' | 'study-guide' | 'project-plan' | 'cornell-notes' | 'weekly-planner' | 'research-paper' | 'daily-journal' | 'body-doubling' | 'brain-dump' | 'time-boxing';

export interface QueryConfig {
    filterSubject?: string;
    filterType?: NoteType | '';
    groupBy?: 'week' | 'module' | 'type' | 'none';
    view?: 'list' | 'card' | 'table' | 'kanban';
}

export type SyncStatus = 'connecting' | 'connected' | 'disconnected' | 'offline';
