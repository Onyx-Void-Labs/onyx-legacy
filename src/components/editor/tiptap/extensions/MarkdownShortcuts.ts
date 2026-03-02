import { Extension, InputRule } from '@tiptap/core';

/**
 * Live Markdown input rules — Obsidian-style.
 * Symbols are consumed immediately, only triggered from keyboard input.
 * Toolbar formatting never shows markdown syntax.
 */
export const MarkdownShortcuts = Extension.create({
    name: 'markdownShortcuts',

    addInputRules() {
        return [
            // # → Heading 1 (at start of line)
            new InputRule({
                find: /^#\s$/,
                handler: ({ range, chain }) => {
                    chain()
                        .deleteRange(range)
                        .setNode('heading', { level: 1 })
                        .run();
                },
            }),
            // ## → Heading 2
            new InputRule({
                find: /^##\s$/,
                handler: ({ range, chain }) => {
                    chain()
                        .deleteRange(range)
                        .setNode('heading', { level: 2 })
                        .run();
                },
            }),
            // ### → Heading 3
            new InputRule({
                find: /^###\s$/,
                handler: ({ range, chain }) => {
                    chain()
                        .deleteRange(range)
                        .setNode('heading', { level: 3 })
                        .run();
                },
            }),
            // > → Blockquote
            new InputRule({
                find: /^>\s$/,
                handler: ({ range, chain }) => {
                    chain()
                        .deleteRange(range)
                        .toggleWrap('blockquote')
                        .run();
                },
            }),
            // --- or *** → Horizontal Rule
            new InputRule({
                find: /^(?:---|___|\*\*\*)\s$/,
                handler: ({ range, chain }) => {
                    chain()
                        .deleteRange(range)
                        .setHorizontalRule()
                        .run();
                },
            }),
            // - [ ] → Task list item
            new InputRule({
                find: /^\[( |x)\]\s$/,
                handler: ({ range, chain }) => {
                    chain()
                        .deleteRange(range)
                        .toggleTaskList()
                        .run();
                },
            }),
        ];
    },
});
