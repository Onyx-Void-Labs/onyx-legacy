import { Editor, Extension, Range } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'

export interface FontSizeOptions {
  sizes: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType
      unsetFontSize: () => ReturnType
      increaseFontSize: (step?: number) => ReturnType
      decreaseFontSize: (step?: number) => ReturnType
    }
  }
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',
  addOptions() {
    return {
      sizes: ['12px', '14px', '16px', '18px', '24px', '32px', '48px']
    }
  },
  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain()
            .focus()
            .command(({ tr, state }) => {
              const { from, to } = state.selection
              tr.doc.nodesBetween(from, to, (node, pos) => {
                if (node.type.name === 'text') {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontSize: size })
                }
              })
              return true
            })
            .run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain()
            .focus()
            .command(({ tr, state }) => {
              const { from, to } = state.selection
              tr.doc.nodesBetween(from, to, (node, pos) => {
                if (node.type.name === 'text' && node.attrs.fontSize) {
                  tr.setNodeMarkup(pos, undefined, { ...node.attrs, fontSize: null })
                }
              })
              return true
            })
            .run(),
      increaseFontSize:
        (step = 1) =>
        ({ chain }) =>
          chain()
            .focus()
            .command(({ editor }) => {
              const { state } = editor
              const { from, to } = state.selection
              const currentSize = state.selection.$anchor.nodeBefore?.attrs.fontSize || '16px'
              const sizes = this.options.sizes
              const currentIndex = sizes.indexOf(currentSize)
              const newSize = sizes[Math.min(currentIndex + step, sizes.length - 1)]
              editor.chain().setFontSize(newSize).run()
              return true
            })
            .run(),
      decreaseFontSize:
        (step = 1) =>
        ({ chain }) =>
          chain()
            .focus()
            .command(({ editor }) => {
              const { state } = editor
              const currentSize = state.selection.$anchor.nodeBefore?.attrs.fontSize || '16px'
              const sizes = this.options.sizes
              const currentIndex = sizes.indexOf(currentSize)
              const newSize = sizes[Math.max(currentIndex - step, 0)]
              editor.chain().setFontSize(newSize).run()
              return true
            })
            .run(),
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-.': () => this.editor.commands.increaseFontSize(),
      'Mod-Shift-,': () => this.editor.commands.decreaseFontSize(),
    }
  },
})
