import React from 'react';
import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import {
    Bold, Italic, Underline, Strikethrough, Code,
    Heading1, Heading2, Heading3,
    Link2, Highlighter, AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react';

interface BubbleMenuProps {
    editor: Editor;
}

const BubbleButton: React.FC<{
    onClick: () => void;
    isActive?: boolean;
    title: string;
    children: React.ReactNode;
}> = ({ onClick, isActive, title, children }) => (
    <button
        onMouseDown={(e) => {
            e.preventDefault();
            onClick();
        }}
        title={title}
        className={`
            p-1.5 rounded transition-all duration-100
            ${isActive
                ? 'text-purple-400 bg-purple-400/10'
                : 'text-zinc-300 hover:text-zinc-100 hover:bg-white/5'
            }
        `}
    >
        {children}
    </button>
);

export const BubbleMenuComponent: React.FC<BubbleMenuProps> = ({ editor }) => {
    const setLink = () => {
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL', previousUrl);

        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };

    return (
        <TiptapBubbleMenu
            editor={editor}
            className="flex items-center gap-0.5 px-1.5 py-1 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/60 rounded-lg shadow-2xl"
        >
            <BubbleButton
                onClick={() => editor.chain().focus().toggleBold().run()}
                isActive={editor.isActive('bold')}
                title="Bold"
            >
                <Bold size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={editor.isActive('italic')}
                title="Italic"
            >
                <Italic size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                isActive={editor.isActive('underline')}
                title="Underline"
            >
                <Underline size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={editor.isActive('strike')}
                title="Strikethrough"
            >
                <Strikethrough size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                isActive={editor.isActive('code')}
                title="Code"
            >
                <Code size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                isActive={editor.isActive('highlight')}
                title="Highlight"
            >
                <Highlighter size={14} />
            </BubbleButton>

            <div className="w-px h-4 bg-zinc-700/50 mx-0.5" />

            <BubbleButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                isActive={editor.isActive('heading', { level: 1 })}
                title="Heading 1"
            >
                <Heading1 size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                isActive={editor.isActive('heading', { level: 2 })}
                title="Heading 2"
            >
                <Heading2 size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                isActive={editor.isActive('heading', { level: 3 })}
                title="Heading 3"
            >
                <Heading3 size={14} />
            </BubbleButton>

            <div className="w-px h-4 bg-zinc-700/50 mx-0.5" />

            <BubbleButton onClick={setLink} isActive={editor.isActive('link')} title="Link">
                <Link2 size={14} />
            </BubbleButton>

            <div className="w-px h-4 bg-zinc-700/50 mx-0.5" />

            <BubbleButton
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                isActive={editor.isActive({ textAlign: 'left' })}
                title="Align Left"
            >
                <AlignLeft size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                isActive={editor.isActive({ textAlign: 'center' })}
                title="Align Center"
            >
                <AlignCenter size={14} />
            </BubbleButton>
            <BubbleButton
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                isActive={editor.isActive({ textAlign: 'right' })}
                title="Align Right"
            >
                <AlignRight size={14} />
            </BubbleButton>
        </TiptapBubbleMenu>
    );
};
