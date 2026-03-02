import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import {
    Type, Heading1, Heading2, Heading3,
    List, ListOrdered, CheckSquare,
    Quote, MessageSquareWarning, Code2, Sigma,
    Minus, Image, Youtube, Table, Search, Link,
} from 'lucide-react';
import { SLASH_MENU_ITEMS } from './extensions/SlashCommands';

const ICON_MAP: Record<string, React.FC<{ size?: number }>> = {
    'type': Type,
    'heading-1': Heading1,
    'heading-2': Heading2,
    'heading-3': Heading3,
    'list': List,
    'list-ordered': ListOrdered,
    'check-square': CheckSquare,
    'quote': Quote,
    'message-square-warning': MessageSquareWarning,
    'code-2': Code2,
    'sigma': Sigma,
    'minus': Minus,
    'image': Image,
    'youtube': Youtube,
    'table': Table,
    'search': Search,
    'link': Link,
};

interface SlashMenuProps {
    editor: Editor;
}

export const SlashMenu: React.FC<SlashMenuProps> = ({ editor }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const slashPosRef = useRef<number>(0);

    const filteredItems = useMemo(() => {
        if (!query) return SLASH_MENU_ITEMS;
        const q = query.toLowerCase();
        return SLASH_MENU_ITEMS.filter(
            (item) =>
                item.title.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q)
        );
    }, [query]);

    const groupedItems = useMemo(() => {
        const groups: Record<string, typeof SLASH_MENU_ITEMS> = {};
        for (const item of filteredItems) {
            if (!groups[item.category]) groups[item.category] = [];
            groups[item.category].push(item);
        }
        return groups;
    }, [filteredItems]);

    // Flatten for keyboard navigation
    const flatItems = useMemo(() => filteredItems, [filteredItems]);

    const executeCommand = useCallback(
        (index: number) => {
            const item = flatItems[index];
            if (!item) return;

            // Delete the slash and query text
            const { state } = editor;
            const from = slashPosRef.current - 1; // Position of the /
            const to = state.selection.from;

            editor
                .chain()
                .focus()
                .deleteRange({ from, to })
                .run();

            // Execute the command
            item.command(editor);
            setIsOpen(false);
        },
        [editor, flatItems]
    );

    // Listen to editor updates to detect slash command state
    useEffect(() => {
        const handleUpdate = () => {
            const { state } = editor;
            const { selection } = state;
            const { $from } = selection;

            // Get text before cursor on current line
            const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);

            // Find the last / in the text
            const slashIndex = textBefore.lastIndexOf('/');

            if (slashIndex !== -1) {
                // Check if the / is at the start or preceded by a space
                const charBefore = slashIndex > 0 ? textBefore[slashIndex - 1] : '';
                if (slashIndex === 0 || charBefore === ' ' || charBefore === '\n') {
                    const queryText = textBefore.slice(slashIndex + 1);

                    // Make sure there's no space in the query (that would close the menu)
                    if (!queryText.includes(' ')) {
                        // Calculate position from cursor
                        const coords = editor.view.coordsAtPos(selection.from);
                        const editorRect = editor.view.dom.closest('.tiptap-editor-wrapper')?.getBoundingClientRect();

                        if (editorRect) {
                            setPosition({
                                top: coords.bottom - editorRect.top + 4,
                                left: coords.left - editorRect.left,
                            });
                        }

                        const absoluteSlashPos = $from.start() + slashIndex;
                        slashPosRef.current = absoluteSlashPos + 1;

                        setQuery(queryText);
                        setIsOpen(true);
                        setSelectedIndex(0);
                        return;
                    }
                }
            }

            setIsOpen(false);
        };

        editor.on('update', handleUpdate);
        editor.on('selectionUpdate', handleUpdate);

        return () => {
            editor.off('update', handleUpdate);
            editor.off('selectionUpdate', handleUpdate);
        };
    }, [editor]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % flatItems.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeCommand(selectedIndex);
            } else if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, selectedIndex, flatItems.length, executeCommand]);

    // Scroll selected item into view
    useEffect(() => {
        if (!menuRef.current) return;
        const selected = menuRef.current.querySelector('[data-selected="true"]');
        selected?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (!isOpen || flatItems.length === 0 || !position) return null;

    let flatIndex = 0;

    return (
        <div
            ref={menuRef}
            className="absolute z-50 w-72 max-h-80 overflow-y-auto bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/60 rounded-xl shadow-2xl py-1.5"
            style={{ top: position.top, left: position.left }}
        >
            {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {category}
                    </div>
                    {items.map((item) => {
                        const currentIndex = flatIndex++;
                        const Icon = ICON_MAP[item.icon] || Type;
                        const isSelected = currentIndex === selectedIndex;

                        return (
                            <button
                                key={item.title}
                                data-selected={isSelected}
                                onClick={() => executeCommand(currentIndex)}
                                className={`
                                    w-full flex items-center gap-3 px-3 py-2 text-left transition-colors duration-75
                                    ${isSelected
                                        ? 'bg-violet-500/10 text-zinc-100'
                                        : 'text-zinc-300 hover:bg-white/5'
                                    }
                                `}
                            >
                                <div
                                    className={`
                                        w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                                        ${isSelected ? 'bg-violet-500/20 text-violet-400' : 'bg-zinc-800 text-zinc-400'}
                                    `}
                                >
                                    <Icon size={16} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">{item.title}</div>
                                    <div className="text-xs text-zinc-500 truncate">{item.description}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
};
