import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { ArrowUp, ArrowDown, X, ChevronDown, CaseSensitive } from 'lucide-react';

interface TiptapFindWidgetProps {
    editor: Editor;
    onClose: () => void;
}

export const TiptapFindWidget: React.FC<TiptapFindWidgetProps> = ({ editor, onClose }) => {
    const [searchText, setSearchText] = useState('');
    const [replaceText, setReplaceText] = useState('');
    const [showReplace, setShowReplace] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus on mount
    useEffect(() => {
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 50);
    }, []);

    // Search as you type
    useEffect(() => {
        (editor.commands as any).setSearchTerm(searchText);
    }, [searchText, editor]);

    useEffect(() => {
        (editor.commands as any).setReplaceTerm(replaceText);
    }, [replaceText, editor]);

    useEffect(() => {
        (editor.commands as any).setCaseSensitive(caseSensitive);
    }, [caseSensitive, editor]);

    // Cleanup search on unmount
    useEffect(() => {
        return () => {
            (editor.commands as any).clearSearch();
        };
    }, [editor]);

    const storage = (editor.storage as any).searchReplace;
    const total = storage?.results?.length ?? 0;
    const currentIndex = storage?.currentIndex ?? 0;

    const handleNext = useCallback(() => {
        (editor.commands as any).nextSearchResult();
    }, [editor]);

    const handlePrev = useCallback(() => {
        (editor.commands as any).previousSearchResult();
    }, [editor]);

    const handleReplace = useCallback(() => {
        (editor.commands as any).replaceCurrentResult();
    }, [editor]);

    const handleReplaceAll = useCallback(() => {
        (editor.commands as any).replaceAllResults();
    }, [editor]);

    const handleClose = useCallback(() => {
        (editor.commands as any).clearSearch();
        onClose();
        editor.commands.focus();
    }, [editor, onClose]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) handlePrev();
            else handleNext();
        } else if (e.key === 'Escape') {
            handleClose();
        }
    };

    return (
        <div className="absolute top-2 right-3 z-50 w-80">
            <div className="bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl shadow-black/40 overflow-hidden">
                {/* Search row */}
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                    {/* Expand/collapse replace chevron */}
                    <button
                        onClick={() => setShowReplace(!showReplace)}
                        className={`p-1 rounded transition-all duration-150 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 ${showReplace ? 'rotate-0' : '-rotate-90'}`}
                    >
                        <ChevronDown size={12} />
                    </button>

                    {/* Search input */}
                    <input
                        ref={inputRef}
                        type="text"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Find..."
                        className="flex-1 bg-zinc-800/60 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none rounded px-2 py-1 border border-zinc-700/50 focus:border-purple-500/50 transition-colors min-w-0"
                    />

                    {/* Match count */}
                    <span className={`text-[11px] font-mono text-zinc-500 min-w-12 text-center whitespace-nowrap transition-opacity duration-150 ${searchText ? 'opacity-100' : 'opacity-0'}`}>
                        {total > 0 ? `${currentIndex + 1} of ${total}` : 'No results'}
                    </span>

                    {/* Nav arrows */}
                    <button onClick={handlePrev} disabled={total === 0} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-30" title="Previous (Shift+Enter)">
                        <ArrowUp size={14} />
                    </button>
                    <button onClick={handleNext} disabled={total === 0} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-30" title="Next (Enter)">
                        <ArrowDown size={14} />
                    </button>

                    {/* Case sensitive toggle */}
                    <button
                        onClick={() => setCaseSensitive(!caseSensitive)}
                        title="Match Case"
                        className={`p-1 rounded transition-all duration-150 ${caseSensitive ? 'bg-purple-500/20 text-purple-300' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                    >
                        <CaseSensitive size={14} />
                    </button>

                    {/* Close */}
                    <button onClick={handleClose} className="p-1 hover:bg-red-500/10 hover:text-red-400 rounded text-zinc-500 transition-colors" title="Close (Escape)">
                        <X size={14} />
                    </button>
                </div>

                {/* Replace row — toggleable */}
                {showReplace && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-zinc-800/50">
                        {/* Spacer to align with search input */}
                        <div className="w-6 shrink-0" />

                        <input
                            type="text"
                            value={replaceText}
                            onChange={(e) => setReplaceText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Replace..."
                            className="flex-1 bg-zinc-800/60 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none rounded px-2 py-1 border border-zinc-700/50 focus:border-purple-500/50 transition-colors min-w-0"
                        />

                        <button
                            onClick={handleReplace}
                            disabled={total === 0}
                            className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30"
                        >
                            Replace
                        </button>
                        <button
                            onClick={handleReplaceAll}
                            disabled={total === 0}
                            className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 rounded transition-colors disabled:opacity-30"
                        >
                            All
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
