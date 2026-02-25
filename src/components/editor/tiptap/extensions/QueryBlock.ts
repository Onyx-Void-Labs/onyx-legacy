import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import QueryBlockView from '../QueryBlockView';

export interface QueryBlockAttrs {
    filterSubject: string;
    filterType: string;
    groupBy: string;
    view: string;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        queryBlock: {
            insertQueryBlock: (attrs?: Partial<QueryBlockAttrs>) => ReturnType;
        };
    }
}

export const QueryBlock = Node.create({
    name: 'queryBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            filterSubject: {
                default: '',
                parseHTML: (el) => el.getAttribute('data-filter-subject') || '',
                renderHTML: (attrs) => ({ 'data-filter-subject': attrs.filterSubject }),
            },
            filterType: {
                default: '',
                parseHTML: (el) => el.getAttribute('data-filter-type') || '',
                renderHTML: (attrs) => ({ 'data-filter-type': attrs.filterType }),
            },
            groupBy: {
                default: 'none',
                parseHTML: (el) => el.getAttribute('data-group-by') || 'none',
                renderHTML: (attrs) => ({ 'data-group-by': attrs.groupBy }),
            },
            view: {
                default: 'list',
                parseHTML: (el) => el.getAttribute('data-view') || 'list',
                renderHTML: (attrs) => ({ 'data-view': attrs.view }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-query-block]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'div',
            mergeAttributes(HTMLAttributes, {
                'data-query-block': '',
                class: 'query-block',
            }),
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(QueryBlockView);
    },

    addCommands() {
        return {
            insertQueryBlock:
                (attrs) =>
                ({ commands }) => {
                    return commands.insertContent({
                        type: this.name,
                        attrs: {
                            filterSubject: attrs?.filterSubject || '',
                            filterType: attrs?.filterType || '',
                            groupBy: attrs?.groupBy || 'none',
                            view: attrs?.view || 'list',
                        },
                    });
                },
        };
    },
});

export default QueryBlock;
