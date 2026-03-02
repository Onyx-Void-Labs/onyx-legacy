import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        mathBlock: {
            setMathBlock: () => ReturnType;
        };
    }
}

export const MathBlockNode = Node.create({
    name: 'mathBlock',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    isolating: true,

    addAttributes() {
        return {
            latex: {
                default: '',
            },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-math-block]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'div',
            mergeAttributes(HTMLAttributes, {
                'data-math-block': '',
                class: 'math-block',
            }),
            0,
        ];
    },

    addCommands() {
        return {
            setMathBlock:
                () =>
                    ({ commands }) => {
                        return commands.insertContent({
                            type: this.name,
                            content: [{ type: 'text', text: 'E = mc^2' }],
                        });
                    },
        };
    },
});
