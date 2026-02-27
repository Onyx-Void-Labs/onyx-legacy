/**
 * BlockId.ts — TipTap extension that assigns stable UUIDs to every block node.
 * Each block gets a `data-block-id` attribute (UUID), generated on node creation,
 * persisted in the document. This enables Painter Mode to associate paint annotations
 * with specific blocks via the Yjs paint_annotations map.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const BLOCK_ID_KEY = new PluginKey('blockId');

function generateBlockId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Block node types that should receive a block ID.
 */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'table',
  'horizontalRule',
  'image',
  'mathBlock',
  'callout',
  'queryBlock',
]);

export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: [
          'paragraph',
          'heading',
          'codeBlock',
          'blockquote',
          'bulletList',
          'orderedList',
          'taskList',
          'listItem',
          'taskItem',
          'table',
          'horizontalRule',
          'image',
          'mathBlock',
          'callout',
          'queryBlock',
        ],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              if (!attributes.blockId) return {};
              return { 'data-block-id': attributes.blockId };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: BLOCK_ID_KEY,
        appendTransaction: (_transactions, _oldState, newState) => {
          const { tr } = newState;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (BLOCK_TYPES.has(node.type.name) && !node.attrs.blockId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                blockId: generateBlockId(),
              });
              modified = true;
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

export default BlockId;
