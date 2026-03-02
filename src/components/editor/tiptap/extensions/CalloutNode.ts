import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutType = 'info' | 'warning' | 'error' | 'success' | 'note' | 'tip' | 'question';

const CALLOUT_DEFAULTS: Record<CalloutType, string> = {
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    success: 'Success',
    note: 'Note',
    tip: 'Tip',
    question: 'Question',
};

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        callout: {
            setCallout: (attrs?: { type?: CalloutType; title?: string }) => ReturnType;
            toggleCallout: (attrs?: { type?: CalloutType; title?: string }) => ReturnType;
            unsetCallout: () => ReturnType;
        };
    }
}

export const CalloutNode = Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes() {
        return {
            type: {
                default: 'info',
                parseHTML: (element) => element.getAttribute('data-callout-type') || 'info',
                renderHTML: (attributes) => ({
                    'data-callout-type': attributes.type,
                }),
            },
            title: {
                default: '',
                parseHTML: (element) => element.getAttribute('data-callout-title') || '',
                renderHTML: (attributes) => {
                    const t = attributes.title || CALLOUT_DEFAULTS[attributes.type as CalloutType] || '';
                    return { 'data-callout-title': t };
                },
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-callout]' }];
    },

    renderHTML({ HTMLAttributes }) {
        const type = HTMLAttributes['data-callout-type'] || 'info';
        const title = HTMLAttributes['data-callout-title'] || CALLOUT_DEFAULTS[type as CalloutType] || '';
        return [
            'div',
            mergeAttributes(HTMLAttributes, {
                'data-callout': '',
                'data-callout-title': title,
                class: `callout callout-${type}`,
            }),
            0,
        ];
    },

    addCommands() {
        return {
            setCallout:
                (attrs) =>
                    ({ commands }) => {
                        return commands.wrapIn(this.name, attrs);
                    },
            toggleCallout:
                (attrs) =>
                    ({ commands }) => {
                        return commands.toggleWrap(this.name, attrs);
                    },
            unsetCallout:
                () =>
                    ({ commands }) => {
                        return commands.lift(this.name);
                    },
        };
    },
});
