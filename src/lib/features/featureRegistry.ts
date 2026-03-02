/**
 * featureRegistry.ts — Static registry of all optional modules in Onyx.
 * Each module is a self-contained feature that can be enabled/disabled from Settings → Features.
 */

export type FeatureCategory = 'study' | 'editor' | 'tools' | 'media';

export type FeatureModule = {
  id: string;
  name: string;
  description: string;
  icon: string; // Lucide icon name
  category: FeatureCategory;
  enabled: boolean;
  requiresDownload?: {
    label: string;      // e.g. "Whisper model (~150MB)"
    sizeBytes: number;
    downloadKey: string;
    downloaded: boolean;
  };
  dependsOn?: string[]; // other feature IDs
};

/**
 * The full list of registered feature modules.
 * Notes and Calendar are enabled by default; everything else is disabled.
 */
export const FEATURE_MODULES: FeatureModule[] = [
  {
    id: 'notes',
    name: 'Notes & Editor',
    description: 'The core rich-text editor with Loro CRDT collaboration, templates, and formatting.',
    icon: 'pen-line',
    category: 'editor',
    enabled: true,
  },
  {
    id: 'flashcards',
    name: 'Flashcards (FSRS)',
    description: 'Spaced repetition flashcards with FSRS-4.5 scheduling, collections, and review sessions.',
    icon: 'layers',
    category: 'study',
    enabled: false,
  },
  {
    id: 'question_library',
    name: 'Question Library',
    description: 'Collect and practice question-answer pairs painted from your notes.',
    icon: 'help-circle',
    category: 'study',
    enabled: false,
    dependsOn: ['painter'],
  },
  {
    id: 'painter',
    name: 'Painter Mode',
    description: 'Annotate note blocks with paint types (Question, Answer, Slide, Recall, Key Term) for use across study features.',
    icon: 'paintbrush',
    category: 'study',
    enabled: false,
  },
  {
    id: 'recall',
    name: 'Recall Mode',
    description: 'Fill-in-the-blank recall sessions from painted terms in your notes.',
    icon: 'brain',
    category: 'study',
    enabled: false,
    dependsOn: ['painter'],
  },
  {
    id: 'teach_back',
    name: 'Teach-Back',
    description: 'Explain a topic in your own words and get scored on key concept coverage.',
    icon: 'presentation',
    category: 'study',
    enabled: false,
    dependsOn: ['painter'],
  },
  {
    id: 'slides',
    name: 'Slides / Presentation',
    description: 'Build and present slides from painted blocks in your notes.',
    icon: 'monitor',
    category: 'study',
    enabled: false,
    dependsOn: ['painter'],
  },
  {
    id: 'session_mode',
    name: 'Study Sessions',
    description: 'Focused study sessions with timers, checkpoints, and break tracking.',
    icon: 'timer',
    category: 'study',
    enabled: false,
  },
  {
    id: 'smart_math',
    name: 'Smart Math Formatting',
    description: 'Auto-convert typed shortcuts (alpha, sqrt, 2/3) to LaTeX inside math blocks.',
    icon: 'sigma',
    category: 'editor',
    enabled: false,
  },
  {
    id: 'canvas',
    name: 'Visual Canvas',
    description: 'Infinite canvas with nodes, freehand drawing, mind maps, and diagram support.',
    icon: 'layout-dashboard',
    category: 'tools',
    enabled: false,
  },
  {
    id: 'transcription',
    name: 'Offline Transcription',
    description: 'Record audio and transcribe it locally using Whisper — fully offline, no cloud.',
    icon: 'mic',
    category: 'media',
    enabled: false,
    requiresDownload: {
      label: 'Whisper model (~150MB)',
      sizeBytes: 150_000_000,
      downloadKey: 'whisper-base-en',
      downloaded: false,
    },
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Schedule events and view your week at a glance.',
    icon: 'calendar-days',
    category: 'tools',
    enabled: true,
  },
  {
    id: 'inbox',
    name: 'Inbox & Brain Dump',
    description: 'Quick-capture thoughts and tasks from the Today page or sidebar.',
    icon: 'inbox',
    category: 'tools',
    enabled: false,
  },
  {
    id: 'templates',
    name: 'Note Templates',
    description: 'Start new notes from structured templates (lectures, lab reports, journals, etc.).',
    icon: 'file-text',
    category: 'editor',
    enabled: false,
  },
  {
    id: 'ambient_sound',
    name: 'Ambient Sound',
    description: 'Background ambient soundscapes for focused study sessions.',
    icon: 'headphones',
    category: 'media',
    enabled: false,
  },
];

/**
 * Category metadata for display in the Features settings page.
 */
export const CATEGORY_META: Record<FeatureCategory, { label: string; description: string }> = {
  study: { label: 'Study', description: 'Tools for active learning and revision' },
  editor: { label: 'Editor', description: 'Writing and formatting enhancements' },
  tools: { label: 'Tools', description: 'Productivity and organisation utilities' },
  media: { label: 'Media', description: 'Audio, video, and visual content' },
};

/**
 * Category display order.
 */
export const CATEGORY_ORDER: FeatureCategory[] = ['study', 'editor', 'tools', 'media'];

/**
 * Get a feature module by ID.
 */
export function getFeatureModule(id: string): FeatureModule | undefined {
  return FEATURE_MODULES.find((m) => m.id === id);
}
