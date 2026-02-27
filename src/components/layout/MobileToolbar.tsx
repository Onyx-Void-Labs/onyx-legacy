// src/components/layout/MobileToolbar.tsx
// ─── Mobile formatting / action toolbar ─────────────────────────────────────
//
// Replaces keyboard shortcuts with touch-friendly buttons.
// Shows contextual actions based on the current screen.

import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Undo,
  Redo,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MobileToolbarProps {
  /** TipTap editor instance (when in editor mode) */
  editor?: Editor | null;
  /** Whether toolbar is visible */
  visible?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MobileToolbar({ editor, visible = true }: MobileToolbarProps) {
  if (!visible || !editor) return null;

  const actions = [
    {
      icon: Undo,
      label: 'Undo',
      action: () => editor.chain().focus().undo().run(),
      active: false,
      disabled: !editor.can().undo(),
    },
    {
      icon: Redo,
      label: 'Redo',
      action: () => editor.chain().focus().redo().run(),
      active: false,
      disabled: !editor.can().redo(),
    },
    { separator: true },
    {
      icon: Bold,
      label: 'Bold',
      action: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive('bold'),
    },
    {
      icon: Italic,
      label: 'Italic',
      action: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive('italic'),
    },
    {
      icon: Underline,
      label: 'Underline',
      action: () => editor.chain().focus().toggleUnderline().run(),
      active: editor.isActive('underline'),
    },
    {
      icon: Code,
      label: 'Code',
      action: () => editor.chain().focus().toggleCode().run(),
      active: editor.isActive('code'),
    },
    { separator: true },
    {
      icon: Heading1,
      label: 'H1',
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      active: editor.isActive('heading', { level: 1 }),
    },
    {
      icon: Heading2,
      label: 'H2',
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive('heading', { level: 2 }),
    },
    {
      icon: Heading3,
      label: 'H3',
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive('heading', { level: 3 }),
    },
    { separator: true },
    {
      icon: List,
      label: 'Bullet List',
      action: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive('bulletList'),
    },
    {
      icon: ListOrdered,
      label: 'Numbered List',
      action: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive('orderedList'),
    },
    {
      icon: CheckSquare,
      label: 'Task List',
      action: () => editor.chain().focus().toggleTaskList().run(),
      active: editor.isActive('taskList'),
    },
    {
      icon: Quote,
      label: 'Blockquote',
      action: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive('blockquote'),
    },
  ];

  return (
    <div
      className="shrink-0 bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800/50 z-30 overflow-x-auto no-scrollbar"
    >
      <div className="flex items-center gap-0.5 px-2 py-1.5 min-w-max">
        {actions.map((item, i) => {
          if ('separator' in item && item.separator) {
            return (
              <div key={`sep-${i}`} className="w-px h-5 bg-zinc-800/60 mx-1" />
            );
          }

          const action = item as {
            icon: React.ComponentType<{ size?: number; className?: string }>;
            label: string;
            action: () => void;
            active?: boolean;
            disabled?: boolean;
          };
          const Icon = action.icon;

          return (
            <button
              key={action.label}
              onClick={action.action}
              disabled={action.disabled}
              className={`
                p-2 rounded-lg transition-colors
                ${action.active
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'text-zinc-400 active:bg-zinc-800'
                }
                ${action.disabled ? 'opacity-30' : ''}
              `}
              title={action.label}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
