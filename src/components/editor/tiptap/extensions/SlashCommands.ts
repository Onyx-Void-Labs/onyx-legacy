import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import type { Editor } from '@tiptap/core';

export interface SlashMenuItem {
    title: string;
    description: string;
    icon: string;
    command: (editor: Editor) => void;
    category: string;
}

export const SLASH_MENU_ITEMS: SlashMenuItem[] = [
    // Text
    {
        title: 'Text',
        description: 'Plain text block',
        icon: 'type',
        category: 'Basic',
        command: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
        title: 'Heading 1',
        description: 'Large section heading',
        icon: 'heading-1',
        category: 'Basic',
        command: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
        title: 'Heading 2',
        description: 'Medium section heading',
        icon: 'heading-2',
        category: 'Basic',
        command: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
        title: 'Heading 3',
        description: 'Small section heading',
        icon: 'heading-3',
        category: 'Basic',
        command: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },

    // Lists
    {
        title: 'Bullet List',
        description: 'Unordered list with bullets',
        icon: 'list',
        category: 'Lists',
        command: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
        title: 'Numbered List',
        description: 'Ordered list with numbers',
        icon: 'list-ordered',
        category: 'Lists',
        command: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
        title: 'Task List',
        description: 'Checklist with checkboxes',
        icon: 'check-square',
        category: 'Lists',
        command: (editor) => editor.chain().focus().toggleTaskList().run(),
    },

    // Rich blocks
    {
        title: 'Quote',
        description: 'Block quote',
        icon: 'quote',
        category: 'Blocks',
        command: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
        title: 'Callout',
        description: 'Highlighted callout block',
        icon: 'message-square-warning',
        category: 'Blocks',
        command: (editor) => editor.chain().focus().setCallout({ type: 'info' }).run(),
    },
    {
        title: 'Code Block',
        description: 'Syntax highlighted code',
        icon: 'code-2',
        category: 'Blocks',
        command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
        title: 'Math Block',
        description: 'LaTeX math equation',
        icon: 'sigma',
        category: 'Blocks',
        command: (editor) => editor.chain().focus().setMathBlock().run(),
    },
    {
        title: 'Divider',
        description: 'Horizontal line separator',
        icon: 'minus',
        category: 'Blocks',
        command: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },

    // Media
    {
        title: 'Image',
        description: 'Upload or embed an image',
        icon: 'image',
        category: 'Media',
        command: (_editor) => {
            window.dispatchEvent(new CustomEvent('onyx:insert-image'));
        },
    },
    {
        title: 'Video',
        description: 'Embed YouTube, Vimeo, or Loom video',
        icon: 'youtube',
        category: 'Media',
        command: (_editor) => {
            window.dispatchEvent(new CustomEvent('onyx:insert-video'));
        },
    },

    // Table
    {
        title: 'Table',
        description: 'Insert a table',
        icon: 'table',
        category: 'Advanced',
        command: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },

    // Query
    {
        title: 'Query',
        description: 'Dynamic note query block',
        icon: 'search',
        category: 'Advanced',
        command: (editor) => (editor.commands as any).insertQueryBlock(),
    },

    // Note linking
    {
        title: 'Link Note',
        description: 'Link to another note',
        icon: 'link',
        category: 'Advanced',
        command: (editor) => {
            // Insert a + character which triggers the note-link suggestion
            editor.chain().focus().insertContent('+').run();
        },
    },
];

/**
 * SlashCommands extension — shows a floating menu when user types /
 * The actual rendering is done by a React component that reads the plugin state.
 */
export const SlashCommands = Extension.create({
    name: 'slashCommands',

    addOptions() {
        return {
            suggestion: {
                char: '/',
                allowSpaces: false,
                startOfLine: false,
            },
        };
    },

    addProseMirrorPlugins() {
        const key = new PluginKey('slashCommands');

        return [
            new Plugin({
                key,
                state: {
                    init() {
                        return { active: false, query: '', from: 0, to: 0 };
                    },
                    apply(tr, prev) {
                        const meta = tr.getMeta(key);
                        if (meta) return meta;
                        // If document changed, check if slash menu should still be active
                        if (tr.docChanged && prev.active) {
                            const { from } = tr.selection;
                            const textBefore = tr.doc.textBetween(
                                Math.max(0, prev.from - 1),
                                from,
                                '\n'
                            );
                            if (!textBefore.startsWith('/')) {
                                return { active: false, query: '', from: 0, to: 0 };
                            }
                            return {
                                ...prev,
                                query: textBefore.slice(1),
                                to: from,
                            };
                        }
                        return prev;
                    },
                },
                props: {
                    handleKeyDown(view, event) {
                        const state = key.getState(view.state);
                        if (state?.active && event.key === 'Escape') {
                            view.dispatch(
                                view.state.tr.setMeta(key, {
                                    active: false,
                                    query: '',
                                    from: 0,
                                    to: 0,
                                })
                            );
                            return true;
                        }
                        return false;
                    },
                    handleTextInput(view, from, _to, text) {
                        if (text === '/') {
                            // Check if start of line or after whitespace
                            const before = view.state.doc.textBetween(
                                Math.max(0, from - 1),
                                from,
                                '\n'
                            );
                            if (from === 1 || before === '' || before === ' ' || before === '\n') {
                                // Delay to let the character be inserted first
                                setTimeout(() => {
                                    view.dispatch(
                                        view.state.tr.setMeta(key, {
                                            active: true,
                                            query: '',
                                            from: from + 1,
                                            to: from + 1,
                                        })
                                    );
                                }, 0);
                            }
                        }
                        return false;
                    },
                },
            }),
        ];
    },
});

export const SLASH_COMMANDS_KEY = new PluginKey('slashCommands');
