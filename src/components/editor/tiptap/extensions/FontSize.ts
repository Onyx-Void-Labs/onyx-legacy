import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fontSize: {
            setFontSize: (size: string) => ReturnType;
            unsetFontSize: () => ReturnType;
            increaseFontSize: (step?: number) => ReturnType;
            decreaseFontSize: (step?: number) => ReturnType;
        };
    }
}

export const FontSize = Extension.create({
    name: 'fontSize',

    addGlobalAttributes() {
        return [
            {
                types: ['textStyle'],
                attributes: {
                    fontSize: {
                        default: null,
                        parseHTML: (element: HTMLElement) =>
                            element.style.fontSize?.replace('px', '') || null,
                        renderHTML: (attributes: Record<string, unknown>) => {
                            if (!attributes.fontSize) return {};
                            return { style: `font-size: ${attributes.fontSize}px` };
                        },
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            setFontSize:
                (size: string) =>
                ({ chain }: { chain: () => any }) => {
                    return chain().setMark('textStyle', { fontSize: size }).run();
                },
            unsetFontSize:
                () =>
                ({ chain }: { chain: () => any }) => {
                    return chain()
                        .setMark('textStyle', { fontSize: null })
                        .removeEmptyTextStyle()
                        .run();
                },
            increaseFontSize:
                (step = 1) =>
                ({ chain, editor }: { chain: () => any; editor: any }) => {
                    const current =
                        editor.getAttributes('textStyle')?.fontSize || '16';
                    const newSize = Math.min(
                        parseInt(current, 10) + step,
                        200
                    );
                    return chain()
                        .setMark('textStyle', { fontSize: String(newSize) })
                        .run();
                },
            decreaseFontSize:
                (step = 1) =>
                ({ chain, editor }: { chain: () => any; editor: any }) => {
                    const current =
                        editor.getAttributes('textStyle')?.fontSize || '16';
                    const newSize = Math.max(
                        parseInt(current, 10) - step,
                        6
                    );
                    return chain()
                        .setMark('textStyle', { fontSize: String(newSize) })
                        .run();
                },
        };
    },

    addKeyboardShortcuts() {
        return {
            'Mod-]': () => this.editor.commands.increaseFontSize(1),
            'Mod-[': () => this.editor.commands.decreaseFontSize(1),
            'Mod-Shift-]': () => this.editor.commands.increaseFontSize(4),
            'Mod-Shift-[': () => this.editor.commands.decreaseFontSize(4),
        };
    },
});
