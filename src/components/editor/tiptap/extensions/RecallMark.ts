/**
 * RecallMark.ts — TipTap Mark extension for inline recall annotations.
 * When Painter Mode is active with the Recall paint type, users can select
 * specific words/phrases and mark them for fill-in-the-blank in Recall Mode.
 * These marks are stored directly in the TipTap document (as marks, like bold/highlight).
 */

import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    recallMark: {
      /** Toggle recall mark on the current selection. */
      setRecallMark: () => ReturnType;
      /** Remove recall mark from the current selection. */
      unsetRecallMark: () => ReturnType;
      /** Toggle recall mark on the current selection. */
      toggleRecallMark: () => ReturnType;
    };
  }
}

export const RecallMark = Mark.create({
  name: 'recallMark',

  addAttributes() {
    return {
      recallId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-recall-id'),
        renderHTML: (attributes) => {
          if (!attributes.recallId) return {};
          return { 'data-recall-id': attributes.recallId };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-recall-mark]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-recall-mark': '',
        class: 'recall-mark',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setRecallMark:
        () =>
        ({ commands }) => {
          const recallId =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : Math.random().toString(36).substring(2, 15);
          return commands.setMark(this.name, { recallId });
        },
      unsetRecallMark:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      toggleRecallMark:
        () =>
        ({ commands }) => {
          return commands.toggleMark(this.name);
        },
    };
  },
});

export default RecallMark;
