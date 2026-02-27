import type { JSONContent } from '@tiptap/core';
import type { TemplateType } from '../types/sync';

function heading(level: number, text: string): JSONContent {
    return {
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text }],
    };
}

function paragraph(text = ''): JSONContent {
    if (!text) return { type: 'paragraph' };
    return {
        type: 'paragraph',
        content: [{ type: 'text', text }],
    };
}

function boldParagraph(label: string, rest = ''): JSONContent {
    const content: JSONContent[] = [
        { type: 'text', marks: [{ type: 'bold' }], text: label },
    ];
    if (rest) content.push({ type: 'text', text: rest });
    return { type: 'paragraph', content };
}

function bulletList(items: string[]): JSONContent {
    return {
        type: 'bulletList',
        content: items.map((item) => ({
            type: 'listItem',
            content: [paragraph(item)],
        })),
    };
}

function taskList(items: string[]): JSONContent {
    return {
        type: 'taskList',
        content: items.map((item) => ({
            type: 'taskItem',
            attrs: { checked: false },
            content: [paragraph(item)],
        })),
    };
}

function orderedList(items: string[]): JSONContent {
    return {
        type: 'orderedList',
        content: items.map((item) => ({
            type: 'listItem',
            content: [paragraph(item)],
        })),
    };
}

function table(headers: string[], rows: string[][]): JSONContent {
    return {
        type: 'table',
        content: [
            {
                type: 'tableRow',
                content: headers.map((h) => ({
                    type: 'tableHeader',
                    content: [paragraph(h)],
                })),
            },
            ...rows.map((row) => ({
                type: 'tableRow',
                content: row.map((cell) => ({
                    type: 'tableCell',
                    content: [paragraph(cell)],
                })),
            })),
        ],
    };
}

const lectureNotes: JSONContent = {
    type: 'doc',
    content: [
        heading(1, '[Course Name] — Lecture [#]'),
        boldParagraph('Date: '),
        boldParagraph('Topic: '),
        paragraph(),
        heading(2, 'Key Concepts'),
        bulletList(['']),
        paragraph(),
        heading(2, 'Notes'),
        paragraph(),
        paragraph(),
        heading(2, 'Questions to Follow Up'),
        bulletList(['']),
        paragraph(),
        heading(2, 'Summary'),
        paragraph(),
    ],
};

const labReport: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Lab Report: [Title]'),
        boldParagraph('Date: ', ' | Partner:  | Subject: '),
        paragraph(),
        heading(2, 'Aim'),
        paragraph(),
        paragraph(),
        heading(2, 'Hypothesis'),
        paragraph(),
        paragraph(),
        heading(2, 'Materials'),
        bulletList(['']),
        paragraph(),
        heading(2, 'Method'),
        orderedList(['']),
        paragraph(),
        heading(2, 'Results'),
        paragraph(),
        paragraph(),
        heading(2, 'Discussion'),
        paragraph(),
        paragraph(),
        heading(2, 'Conclusion'),
        paragraph(),
    ],
};

const essayOutline: JSONContent = {
    type: 'doc',
    content: [
        heading(1, '[Essay Title]'),
        boldParagraph('Subject: ', ' | Due:  | Word Count: '),
        paragraph(),
        heading(2, 'Thesis Statement'),
        paragraph(),
        paragraph(),
        heading(2, 'Body Paragraph 1 — [Topic]'),
        bulletList(['Argument:', 'Evidence:', 'Analysis:']),
        paragraph(),
        heading(2, 'Body Paragraph 2 — [Topic]'),
        bulletList(['Argument:', 'Evidence:', 'Analysis:']),
        paragraph(),
        heading(2, 'Body Paragraph 3 — [Topic]'),
        bulletList(['Argument:', 'Evidence:', 'Analysis:']),
        paragraph(),
        heading(2, 'Conclusion'),
        paragraph(),
    ],
};

const meetingNotes: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Meeting — [Date]'),
        boldParagraph('Attendees: '),
        boldParagraph('Purpose: '),
        paragraph(),
        heading(2, 'Agenda'),
        orderedList(['']),
        paragraph(),
        heading(2, 'Discussion Notes'),
        paragraph(),
        paragraph(),
        heading(2, 'Action Items'),
        taskList(['', '']),
        paragraph(),
        heading(2, 'Next Meeting'),
        paragraph(),
    ],
};

const studyGuide: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Study Guide — [Topic]'),
        boldParagraph('Subject: ', ' | Exam Date: '),
        paragraph(),
        heading(2, 'Key Terms'),
        table(['Term', 'Definition'], [['', '']]),
        paragraph(),
        heading(2, 'Core Concepts'),
        paragraph(),
        paragraph(),
        heading(2, 'Practice Questions'),
        boldParagraph('Q: '),
        boldParagraph('A: '),
        paragraph(),
        boldParagraph('Q: '),
        boldParagraph('A: '),
        paragraph(),
        heading(2, 'Flashcards to Create'),
        paragraph(),
    ],
};

const projectPlan: JSONContent = {
    type: 'doc',
    content: [
        heading(1, '[Project Name]'),
        boldParagraph('Status: ', 'Not Started | Due:  | Subject: '),
        paragraph(),
        heading(2, 'Goal'),
        paragraph(),
        paragraph(),
        heading(2, 'Milestones'),
        taskList(['', '', '']),
        paragraph(),
        heading(2, 'Resources Needed'),
        paragraph(),
        paragraph(),
        heading(2, 'Notes'),
        paragraph(),
    ],
};

const cornellNotes: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Cornell Notes — [Topic]'),
        boldParagraph('Subject: ', ' | Date:  | Lecturer: '),
        paragraph(),
        heading(2, 'Cue Column'),
        bulletList(['Key question 1?', 'Key question 2?', 'Key question 3?']),
        paragraph(),
        heading(2, 'Notes'),
        paragraph('Write main lecture notes here. Focus on concepts, facts, and details.'),
        paragraph(),
        paragraph(),
        heading(2, 'Summary'),
        paragraph('Summarise the main points in 2–3 sentences from memory.'),
    ],
};

const weeklyPlanner: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Weekly Planner — Week of [Date]'),
        paragraph(),
        heading(2, 'Monday'),
        taskList(['', '']),
        heading(2, 'Tuesday'),
        taskList(['', '']),
        heading(2, 'Wednesday'),
        taskList(['', '']),
        heading(2, 'Thursday'),
        taskList(['', '']),
        heading(2, 'Friday'),
        taskList(['', '']),
        heading(2, 'Saturday'),
        taskList(['', '']),
        heading(2, 'Sunday'),
        taskList(['', '']),
        paragraph(),
        heading(2, 'Weekly Goals'),
        bulletList(['', '', '']),
        heading(2, 'Reflection'),
        paragraph(),
    ],
};

const researchPaper: JSONContent = {
    type: 'doc',
    content: [
        heading(1, '[Research Title]'),
        boldParagraph('Authors: '),
        boldParagraph('Keywords: '),
        boldParagraph('Date: '),
        paragraph(),
        heading(2, 'Abstract'),
        paragraph(),
        paragraph(),
        heading(2, 'Introduction'),
        paragraph(),
        paragraph(),
        heading(2, 'Literature Review'),
        paragraph(),
        paragraph(),
        heading(2, 'Methodology'),
        paragraph(),
        paragraph(),
        heading(2, 'Results'),
        paragraph(),
        paragraph(),
        heading(2, 'Discussion'),
        paragraph(),
        paragraph(),
        heading(2, 'Conclusion'),
        paragraph(),
        paragraph(),
        heading(2, 'References'),
        orderedList(['']),
    ],
};

const dailyJournal: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Journal — [Date]'),
        paragraph(),
        heading(2, 'Morning'),
        boldParagraph('Mood: '),
        boldParagraph('Intention for the day: '),
        paragraph(),
        heading(2, 'Gratitude'),
        bulletList(['', '', '']),
        paragraph(),
        heading(2, 'Reflections'),
        paragraph(),
        paragraph(),
        heading(2, 'Tomorrow'),
        taskList(['', '']),
    ],
};

/* ─── ADHD-Focused Templates ────────────────────────────────── */

const bodyDoubling: JSONContent = {
    type: 'doc',
    content: [
        heading(1, 'Body Doubling Session'),
        boldParagraph('Date: ', ' | Partner: '),
        boldParagraph('Session Length: ', ' 25 min'),
        paragraph(),
        heading(2, '🎯 What I\'m Working On'),
        paragraph('Describe your task in ONE sentence. Be specific.'),
        paragraph(),
        heading(2, '✅ Before We Start'),
        taskList([
            'Task is broken into small steps (below)',
            'Distractions removed (phone away, tabs closed)',
            'Water / snack ready',
            'Timer set',
        ]),
        paragraph(),
        heading(2, '📋 Micro-Steps'),
        paragraph('Break your task into the smallest possible actions:'),
        taskList([
            'Step 1: ',
            'Step 2: ',
            'Step 3: ',
            'Step 4: ',
            'Step 5: ',
        ]),
        paragraph(),
        heading(2, '🧠 Parking Lot'),
        paragraph('Stray thoughts? Park them here instead of acting on them:'),
        bulletList(['']),
        paragraph(),
        heading(2, '🏁 Session Debrief'),
        boldParagraph('What I accomplished: '),
        boldParagraph('What blocked me: '),
        boldParagraph('Energy level (1-5): '),
        boldParagraph('Next session focus: '),
    ],
};

const brainDump: JSONContent = {
    type: 'doc',
    content: [
        heading(1, '🧠 Brain Dump'),
        boldParagraph('Date: '),
        paragraph('Set a timer for 5-10 minutes. Write EVERYTHING on your mind — no filtering, no organising. Just dump it all out.'),
        paragraph(),
        heading(2, '💭 Everything On My Mind'),
        paragraph(),
        paragraph(),
        paragraph(),
        paragraph(),
        paragraph(),
        heading(2, '🏷️ Sort It Out'),
        paragraph('Now go through what you wrote and sort each item:'),
        paragraph(),
        heading(3, '🔴 Do Today'),
        taskList(['', '']),
        paragraph(),
        heading(3, '🟡 Do This Week'),
        taskList(['', '']),
        paragraph(),
        heading(3, '🟢 Someday / Maybe'),
        bulletList(['', '']),
        paragraph(),
        heading(3, '🗑️ Let Go'),
        paragraph('Things that don\'t actually need action — cross them off mentally:'),
        bulletList(['', '']),
        paragraph(),
        heading(2, '🌟 The ONE Thing'),
        paragraph('If I could only do one thing today, it would be:'),
        paragraph(),
    ],
};

const timeBoxing: JSONContent = {
    type: 'doc',
    content: [
        heading(1, '⏱️ Time-Boxing Plan'),
        boldParagraph('Date: '),
        boldParagraph('Total Available Time: ', ' hours'),
        paragraph(),
        heading(2, '📦 Time Blocks'),
        paragraph('Assign specific tasks to specific time slots. When the time is up, STOP and move on.'),
        paragraph(),
        table(
            ['Time', 'Task', 'Status'],
            [
                ['9:00 – 9:25', '', ''],
                ['9:30 – 9:55', '', ''],
                ['10:00 – 10:15', '☕ Break', ''],
                ['10:15 – 10:40', '', ''],
                ['10:45 – 11:10', '', ''],
                ['11:15 – 11:30', '☕ Break', ''],
                ['11:30 – 11:55', '', ''],
                ['12:00 – 12:25', '', ''],
            ]
        ),
        paragraph(),
        heading(2, '📐 Rules'),
        bulletList([
            '25-minute blocks (Pomodoro style)',
            'When the timer rings, STOP — even mid-sentence',
            '5-minute breaks between blocks, 15-minute break every 4 blocks',
            'If you finish early, use remaining time for review or rest',
            'Cross out completed blocks as you go',
        ]),
        paragraph(),
        heading(2, '🔄 Transitions'),
        paragraph('What to do between blocks to reset your focus:'),
        bulletList([
            'Stand up & stretch',
            'Get water',
            'Take 3 deep breaths',
            'Review what\'s next (don\'t start yet)',
        ]),
        paragraph(),
        heading(2, '🏁 End of Day'),
        boldParagraph('Blocks completed: ', ' / 8'),
        boldParagraph('Best block: '),
        boldParagraph('Hardest block: '),
        boldParagraph('Tomorrow\'s priority: '),
    ],
};

const TEMPLATES: Record<TemplateType, JSONContent> = {
    'lecture-notes': lectureNotes,
    'lab-report': labReport,
    'essay-outline': essayOutline,
    'meeting-notes': meetingNotes,
    'study-guide': studyGuide,
    'project-plan': projectPlan,
    'cornell-notes': cornellNotes,
    'weekly-planner': weeklyPlanner,
    'research-paper': researchPaper,
    'daily-journal': dailyJournal,
    'body-doubling': bodyDoubling,
    'brain-dump': brainDump,
    'time-boxing': timeBoxing,
};

export function getTemplate(type: TemplateType): JSONContent {
    return structuredClone(TEMPLATES[type]);
}

export const TEMPLATE_LIST: { type: TemplateType; label: string; icon: string }[] = [
    { type: 'lecture-notes', label: 'Lecture Notes', icon: '📚' },
    { type: 'lab-report', label: 'Lab Report', icon: '🔬' },
    { type: 'essay-outline', label: 'Essay Outline', icon: '📝' },
    { type: 'meeting-notes', label: 'Meeting Notes', icon: '📅' },
    { type: 'study-guide', label: 'Study Guide', icon: '🃏' },
    { type: 'project-plan', label: 'Project Plan', icon: '✅' },
    { type: 'cornell-notes', label: 'Cornell Notes', icon: '📋' },
    { type: 'weekly-planner', label: 'Weekly Planner', icon: '📆' },
    { type: 'research-paper', label: 'Research Paper', icon: '🔍' },
    { type: 'daily-journal', label: 'Daily Journal', icon: '📓' },
    { type: 'body-doubling', label: 'Body Doubling', icon: '🤝' },
    { type: 'brain-dump', label: 'Brain Dump', icon: '🧠' },
    { type: 'time-boxing', label: 'Time Boxing', icon: '⏱️' },
];
