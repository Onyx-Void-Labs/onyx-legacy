import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import NoteLinkChip from '../NoteLinkChip';

export interface NoteLinkAttributes {
    noteId: string;
    showsAs: string | null;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        noteLink: {
            insertNoteLink: (attrs: { noteId: string; showsAs?: string }) => ReturnType;
            removeNoteLink: (pos: number) => ReturnType;
            updateNoteLinkShowsAs: (pos: number, showsAs: string | null) => ReturnType;
        };
    }
}

export const NoteLink = Node.create({
    name: 'noteLink',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            noteId: {
                default: null,
                parseHTML: (element) => element.getAttribute('data-note-id'),
                renderHTML: (attributes) => ({
                    'data-note-id': attributes.noteId,
                }),
            },
            showsAs: {
                default: null,
                parseHTML: (element) => element.getAttribute('data-shows-as') || null,
                renderHTML: (attributes) => {
                    if (!attributes.showsAs) return {};
                    return { 'data-shows-as': attributes.showsAs };
                },
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-note-link]',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                'data-note-link': '',
                class: 'note-link-chip',
            }),
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(NoteLinkChip);
    },

    addCommands() {
        return {
            insertNoteLink:
                (attrs) =>
                ({ commands }) => {
                    return commands.insertContent({
                        type: this.name,
                        attrs: {
                            noteId: attrs.noteId,
                            showsAs: attrs.showsAs || null,
                        },
                    });
                },
            removeNoteLink:
                (pos: number) =>
                ({ tr, dispatch }) => {
                    if (dispatch) {
                        const node = tr.doc.nodeAt(pos);
                        if (node && node.type.name === 'noteLink') {
                            tr.delete(pos, pos + node.nodeSize);
                        }
                    }
                    return true;
                },
            updateNoteLinkShowsAs:
                (pos: number, showsAs: string | null) =>
                ({ tr, dispatch }) => {
                    if (dispatch) {
                        const node = tr.doc.nodeAt(pos);
                        if (node && node.type.name === 'noteLink') {
                            tr.setNodeMarkup(pos, undefined, {
                                ...node.attrs,
                                showsAs: showsAs || null,
                            });
                        }
                    }
                    return true;
                },
        };
    },
});

export default NoteLink;
