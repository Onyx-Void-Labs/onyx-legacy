import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import { FileText, Plus } from 'lucide-react';
import { useSync } from '../../../contexts/SyncContext';

interface NoteLinkSuggestionProps {
    editor: Editor;
}

export const NoteLinkSuggestion: React.FC<NoteLinkSuggestionProps> = ({ editor }) => {
    const { files, createFile } = useSync();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const plusPosRef = useRef<number>(0);

    const filteredNotes = useMemo(() => {
        if (!query) return files.slice(0, 10);
        const q = query.toLowerCase();
        return files.filter(
            (f) =>
                f.title.toLowerCase().includes(q) ||
                (f.subject ?? '').toLowerCase().includes(q)
        ).slice(0, 10);
    }, [files, query]);

    // Total items = filtered notes + "Create new" item
    const totalItems = filteredNotes.length + 1;

    const executeSelection = useCallback(
        (index: number) => {
            const { state } = editor;
            // Delete the +query text
            const from = plusPosRef.current - 1; // position of the + character
            const to = state.selection.from;

            editor.chain().focus().deleteRange({ from, to }).run();

            if (index < filteredNotes.length) {
                // Insert link to existing note
                const note = filteredNotes[index];
                editor.chain().focus().insertNoteLink({ noteId: note.id }).run();
            } else {
                // Create new note and insert link
                const title = query.trim() || 'Untitled';
                const newId = createFile(title, 'note');
                editor.chain().focus().insertNoteLink({ noteId: newId }).run();
            }

            setIsOpen(false);
        },
        [editor, filteredNotes, query, createFile]
    );

    // Listen for editor updates to detect + trigger
    useEffect(() => {
        const handleUpdate = () => {
            const { state } = editor;
            const { selection } = state;
            const { $from } = selection;

            const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
            const plusIndex = textBefore.lastIndexOf('+');

            if (plusIndex !== -1) {
                const charBefore = plusIndex > 0 ? textBefore[plusIndex - 1] : '';
                // Only trigger at start of line or after whitespace
                if (plusIndex === 0 || charBefore === ' ' || charBefore === '\n') {
                    const queryText = textBefore.slice(plusIndex + 1);

                    // Cancel on second + character or if query is too long
                    if (queryText.includes('+') || queryText.length > 80) {
                        setIsOpen(false);
                        return;
                    }

                    // Allow spaces in the query — only cancel on second +, escape, or newline
                    if (queryText.length > 0) {
                        const coords = editor.view.coordsAtPos(selection.from);
                        const editorRect = editor.view.dom
                            .closest('.tiptap-editor-wrapper')
                            ?.getBoundingClientRect();

                        if (editorRect) {
                            setPosition({
                                top: coords.bottom - editorRect.top + 4,
                                left: coords.left - editorRect.left,
                            });
                        }

                        const absolutePlusPos = $from.start() + plusIndex;
                        plusPosRef.current = absolutePlusPos + 1;

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
                setSelectedIndex((prev) => (prev + 1) % totalItems);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                executeSelection(selectedIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, selectedIndex, totalItems, executeSelection]);

    // Scroll selected item into view
    useEffect(() => {
        if (!menuRef.current) return;
        const selected = menuRef.current.querySelector('[data-selected="true"]');
        selected?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (!isOpen || !position) return null;

    return (
        <div
            ref={menuRef}
            className="absolute z-50 w-72 max-h-72 overflow-y-auto bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/60 rounded-xl shadow-2xl py-1.5"
            style={{ top: position.top, left: position.left }}
        >
            {filteredNotes.length > 0 && (
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Notes
                </div>
            )}

            {filteredNotes.map((note, index) => {
                const isSelected = index === selectedIndex;
                const typeEmoji =
                    note.type === 'topic' ? '🗂' :
                    note.type === 'idea' ? '💡' :
                    note.type === 'task' ? '✅' :
                    note.type === 'resource' ? '🔗' :
                    note.type === 'journal' ? '📅' : '';

                return (
                    <button
                        key={note.id}
                        data-selected={isSelected}
                        onClick={() => executeSelection(index)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75 cursor-pointer ${
                            isSelected
                                ? 'bg-purple-500/10 text-zinc-100'
                                : 'text-zinc-300 hover:bg-white/5'
                        }`}
                    >
                        <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                isSelected ? 'bg-purple-500/20 text-purple-400' : 'bg-zinc-800 text-zinc-400'
                            }`}
                        >
                            {typeEmoji ? (
                                <span className="text-xs">{typeEmoji}</span>
                            ) : (
                                <FileText size={14} />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                                {note.title || 'Untitled'}
                            </div>
                            {note.subject && (
                                <div className="text-[10px] text-zinc-500 truncate">
                                    {note.subject}
                                </div>
                            )}
                        </div>
                    </button>
                );
            })}

            {/* Create new note option — always last */}
            <div className="border-t border-zinc-800/50 mt-1 pt-1">
                <button
                    data-selected={selectedIndex === filteredNotes.length}
                    onClick={() => executeSelection(filteredNotes.length)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75 cursor-pointer ${
                        selectedIndex === filteredNotes.length
                            ? 'bg-purple-500/10 text-zinc-100'
                            : 'text-zinc-400 hover:bg-white/5'
                    }`}
                >
                    <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            selectedIndex === filteredNotes.length
                                ? 'bg-purple-500/20 text-purple-400'
                                : 'bg-zinc-800 text-zinc-500'
                        }`}
                    >
                        <Plus size={14} />
                    </div>
                    <div className="text-sm">
                        Create new note{' '}
                        {query && (
                            <span className="text-purple-400 font-medium">
                                &ldquo;{query}&rdquo;
                            </span>
                        )}
                    </div>
                </button>
            </div>
        </div>
    );
};

export default NoteLinkSuggestion;
