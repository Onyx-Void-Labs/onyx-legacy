import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';

/**
 * DragHandle extension — adds a visible drag handle on the left side when hovering blocks.
 * Uses programmatic transaction-based reordering (no HTML5 drag) for reliability.
 */
export const DragHandle = Extension.create({
    name: 'dragHandle',

    addProseMirrorPlugins() {
        let handle: HTMLDivElement | null = null;
        let indicator: HTMLDivElement | null = null;
        let currentBlockPos: number | null = null;
        let isDragging = false;
        let targetBlockPos: number | null = null;
        let dropBefore = true;

        const resolveBlockStart = (doc: any, pos: number): number | null => {
            try {
                const resolved = doc.resolve(pos);
                if (resolved.depth >= 1) return resolved.before(1);
                return null;
            } catch {
                return null;
            }
        };

        return [
            new Plugin({
                key: new PluginKey('dragHandle'),
                view(editorView) {
                    // ─── Create handle element ───
                    handle = document.createElement('div');
                    handle.className = 'tiptap-drag-handle';
                    handle.innerHTML = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                        <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
                        <circle cx="2" cy="7" r="1.5"/><circle cx="8" cy="7" r="1.5"/>
                        <circle cx="2" cy="12" r="1.5"/><circle cx="8" cy="12" r="1.5"/>
                    </svg>`;
                    handle.style.cssText = `
                        position: absolute; left: -24px; cursor: grab; opacity: 0;
                        transition: opacity 0.15s; color: #52525b; padding: 2px 4px;
                        border-radius: 4px; display: flex; align-items: center;
                        z-index: 50; user-select: none; -webkit-user-select: none;
                    `;

                    // ─── Create drop indicator line ───
                    indicator = document.createElement('div');
                    indicator.style.cssText = `
                        position: absolute; left: 0; right: 0; height: 2px;
                        background: #a855f7; border-radius: 1px; pointer-events: none;
                        z-index: 100; opacity: 0; transition: opacity 0.1s;
                        box-shadow: 0 0 6px rgba(168,85,247,0.4);
                    `;

                    const wrapper = editorView.dom.parentElement;
                    if (wrapper) {
                        wrapper.style.position = 'relative';
                        wrapper.appendChild(handle);
                        wrapper.appendChild(indicator);
                    }

                    // ─── Handle hover effects ───
                    handle.addEventListener('mouseenter', () => {
                        if (handle) {
                            handle.style.color = '#a1a1aa';
                            handle.style.background = 'rgba(255,255,255,0.06)';
                        }
                    });
                    handle.addEventListener('mouseleave', () => {
                        if (handle && !isDragging) {
                            handle.style.color = '#52525b';
                            handle.style.background = 'transparent';
                        }
                    });

                    // ─── Programmatic drag via mousedown/move/up ───
                    const onHandleMousedown = (e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (currentBlockPos === null) return;

                        isDragging = true;
                        if (handle) handle.style.cursor = 'grabbing';

                        // Select the block visually
                        try {
                            const sel = NodeSelection.create(editorView.state.doc, currentBlockPos);
                            editorView.dispatch(editorView.state.tr.setSelection(sel));
                        } catch {
                            isDragging = false;
                            return;
                        }

                        const onMove = (me: MouseEvent) => {
                            if (!wrapper || !indicator) return;
                            const coords = { left: me.clientX, top: me.clientY };
                            const posInfo = editorView.posAtCoords(coords);
                            if (!posInfo) { indicator.style.opacity = '0'; targetBlockPos = null; return; }

                            const hoveredBlock = resolveBlockStart(editorView.state.doc, posInfo.pos);
                            if (hoveredBlock === null) { indicator.style.opacity = '0'; targetBlockPos = null; return; }

                            const dom = editorView.nodeDOM(hoveredBlock);
                            if (dom instanceof HTMLElement) {
                                const rect = dom.getBoundingClientRect();
                                const wrapperRect = wrapper.getBoundingClientRect();
                                const midY = rect.top + rect.height / 2;

                                if (me.clientY < midY) {
                                    indicator.style.top = `${rect.top - wrapperRect.top - 1}px`;
                                    dropBefore = true;
                                } else {
                                    indicator.style.top = `${rect.bottom - wrapperRect.top - 1}px`;
                                    dropBefore = false;
                                }
                                targetBlockPos = hoveredBlock;
                                indicator.style.opacity = '1';
                            } else {
                                indicator.style.opacity = '0';
                                targetBlockPos = null;
                            }
                        };

                        const onUp = () => {
                            isDragging = false;
                            if (handle) handle.style.cursor = 'grab';
                            if (indicator) indicator.style.opacity = '0';

                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);

                            if (targetBlockPos === null || currentBlockPos === null) return;

                            // Execute the move
                            try {
                                const { state } = editorView;
                                const sourceNode = state.doc.nodeAt(currentBlockPos);
                                if (!sourceNode) return;

                                const sourceFrom = currentBlockPos;
                                const sourceTo = sourceFrom + sourceNode.nodeSize;

                                // Compute insert position
                                const targetNode = state.doc.nodeAt(targetBlockPos);
                                if (!targetNode) return;

                                let insertPos: number;
                                if (dropBefore) {
                                    insertPos = targetBlockPos;
                                } else {
                                    insertPos = targetBlockPos + targetNode.nodeSize;
                                }

                                // Skip if dropping in place (no-op)
                                if (insertPos >= sourceFrom && insertPos <= sourceTo) return;

                                const tr = state.tr;
                                const nodeToMove = sourceNode.copy(sourceNode.content);

                                // Delete source first, then insert at mapped position
                                tr.delete(sourceFrom, sourceTo);
                                const mappedPos = tr.mapping.map(insertPos);
                                tr.insert(mappedPos, nodeToMove);

                                editorView.dispatch(tr);
                            } catch (err) {
                                console.warn('[DragHandle] Move failed:', err);
                            }

                            targetBlockPos = null;
                        };

                        window.addEventListener('mousemove', onMove);
                        window.addEventListener('mouseup', onUp);
                    };

                    handle.addEventListener('mousedown', onHandleMousedown);

                    // ─── Show/hide handle on editor mousemove ───
                    const onEditorMove = (event: MouseEvent) => {
                        if (!handle || isDragging) return;
                        const coords = { left: event.clientX, top: event.clientY };
                        const posInfo = editorView.posAtCoords(coords);
                        if (!posInfo) { handle.style.opacity = '0'; return; }

                        const blockStart = resolveBlockStart(editorView.state.doc, posInfo.pos);
                        if (blockStart === null) { handle.style.opacity = '0'; return; }

                        currentBlockPos = blockStart;
                        const dom = editorView.nodeDOM(blockStart);
                        if (dom instanceof HTMLElement && wrapper) {
                            const rect = dom.getBoundingClientRect();
                            const wrapperRect = wrapper.getBoundingClientRect();
                            handle.style.top = `${rect.top - wrapperRect.top + 4}px`;
                            handle.style.opacity = '1';
                        } else {
                            handle.style.opacity = '0';
                        }
                    };

                    const onEditorLeave = () => {
                        if (handle && !isDragging) handle.style.opacity = '0';
                    };

                    editorView.dom.addEventListener('mousemove', onEditorMove);
                    editorView.dom.addEventListener('mouseleave', onEditorLeave);

                    return {
                        destroy() {
                            handle?.remove();
                            indicator?.remove();
                            editorView.dom.removeEventListener('mousemove', onEditorMove);
                            editorView.dom.removeEventListener('mouseleave', onEditorLeave);
                        },
                    };
                },
            }),
        ];
    },
});
