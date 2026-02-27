/**
 * SmartMathExtension.ts — TipTap extension for live math auto-formatting.
 *
 * Behaviour:
 *  - Fires only inside `mathBlock` nodes.
 *  - On every keystroke inside a math block, runs processSmartInput to
 *    auto-replace fractions and Greek letters.
 *  - When user types `\`, dispatches a CustomEvent so the SmartMathPopup
 *    React component can show the symbol autocomplete palette.
 *
 * This is registered as a standalone extension (not part of MathBlockNode)
 * so it can be independently feature-gated.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { processSmartInput } from '@/utils/smartMath';

const smartMathPluginKey = new PluginKey('smartMath');

export const SmartMathExtension = Extension.create({
  name: 'smartMath',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: smartMathPluginKey,

        props: {
          handleTextInput(view, from, _to, text) {
            const { state } = view;
            const $from = state.doc.resolve(from);

            // Only fire inside mathBlock nodes
            const parentNode = $from.parent;
            if (parentNode.type.name !== 'mathBlock') {
              return false;
            }

            // If user typed backslash, emit popup event
            if (text === '\\') {
              // Let the character be inserted first, then emit
              setTimeout(() => {
                const coords = view.coordsAtPos(from + 1);
                window.dispatchEvent(
                  new CustomEvent('onyx:smart-math-trigger', {
                    detail: {
                      x: coords.left,
                      y: coords.bottom + 4,
                      from: from,
                    },
                  })
                );
              }, 0);
              return false; // Let ProseMirror insert the char normally
            }

            // After inserting text, try auto-format
            // We need to run asynchronously so the character is already in the doc
            setTimeout(() => {
              const currentState = view.state;
              const $pos = currentState.doc.resolve(
                Math.min(from + text.length, currentState.doc.content.size)
              );
              const block = $pos.parent;
              if (block.type.name !== 'mathBlock') return;

              const blockText = block.textContent;
              const transformed = processSmartInput(blockText);

              if (transformed !== blockText) {
                // Find the block's position range in the document
                const blockStart = $pos.start();
                const blockEnd = blockStart + block.content.size;

                // Replace the entire math block text content
                const tr = view.state.tr;
                tr.replaceWith(
                  blockStart,
                  blockEnd,
                  transformed
                    ? currentState.schema.text(transformed)
                    : currentState.schema.text('')
                );

                // Move cursor to end of the new content
                const newEnd = blockStart + transformed.length;
                tr.setSelection(
                  Selection.near(
                    tr.doc.resolve(Math.min(newEnd, tr.doc.content.size))
                  )
                );

                view.dispatch(tr);
              }
            }, 10);

            return false;
          },
        },
      }),
    ];
  },
});
