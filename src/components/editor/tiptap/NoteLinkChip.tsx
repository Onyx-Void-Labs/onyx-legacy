import { useState, useRef, useCallback, useEffect } from 'react';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { X, ExternalLink, Type, Trash2 } from 'lucide-react';
import {
    useFloating,
    autoUpdate,
    offset,
    flip,
    shift,
    useDismiss,
    useInteractions,
    FloatingPortal,
} from '@floating-ui/react';
import { useSync } from '../../../contexts/SyncContext';

export default function NoteLinkChip({
    node,
    updateAttributes,
    deleteNode,
}: ReactNodeViewProps) {
    const { files } = useSync();
    const { noteId, showsAs } = node.attrs;

    const targetNote = files.find((f) => f.id === noteId);
    const noteTitle = targetNote?.title || 'Untitled';
    const isDeleted = !targetNote;
    const displayLabel = showsAs?.trim() ? showsAs : noteTitle;

    const [contextOpen, setContextOpen] = useState(false);
    const [showShowsAs, setShowShowsAs] = useState(false);
    const [showsAsInput, setShowsAsInput] = useState(showsAs ?? '');
    const [isHovered, setIsHovered] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const { refs, floatingStyles, context } = useFloating({
        open: contextOpen,
        onOpenChange: setContextOpen,
        middleware: [offset(6), flip(), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        placement: 'bottom-start',
    });

    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    // Focus input when "Shows as" is expanded
    useEffect(() => {
        if (showShowsAs) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [showShowsAs]);

    // Reset state when context menu closes
    useEffect(() => {
        if (!contextOpen) {
            setShowShowsAs(false);
            const newVal = showsAsInput.trim() || null;
            if (newVal !== (showsAs ?? null)) {
                updateAttributes({ showsAs: newVal });
            }
        } else {
            setShowsAsInput(showsAs ?? '');
        }
    }, [contextOpen]);

    // Single click → open the linked note
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (isDeleted) return;
            window.dispatchEvent(
                new CustomEvent('onyx:open-note', { detail: { noteId } })
            );
        },
        [noteId, isDeleted]
    );

    // Right-click → show context menu
    const handleContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setContextOpen(true);
        },
        []
    );

    const handleOpenNote = useCallback(() => {
        if (isDeleted) return;
        window.dispatchEvent(
            new CustomEvent('onyx:open-note', { detail: { noteId } })
        );
        setContextOpen(false);
    }, [noteId, isDeleted]);

    const handleRemoveLink = useCallback(() => {
        deleteNode();
        setContextOpen(false);
    }, [deleteNode]);

    const handleRemoveChip = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            deleteNode();
        },
        [deleteNode]
    );

    return (
        <NodeViewWrapper as="span" className="inline">
            <span
                ref={refs.setReference}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={`inline-flex items-center gap-0.5 cursor-pointer transition-all duration-150 select-none align-baseline font-medium ${
                    isDeleted
                        ? 'text-zinc-500 line-through opacity-60'
                        : 'text-violet-400 underline decoration-dotted underline-offset-2 hover:text-violet-300 hover:bg-violet-500/10 rounded px-0.5 -mx-0.5'
                }`}
                contentEditable={false}
            >
                <span className="text-[13px] shrink-0">📄</span>
                <span className="truncate max-w-50">{displayLabel}</span>
                {isHovered && !isDeleted && (
                    <button
                        onMouseDown={handleRemoveChip}
                        className="shrink-0 p-0 ml-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                        tabIndex={-1}
                    >
                        <X size={10} />
                    </button>
                )}
            </span>

            {contextOpen && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={floatingStyles}
                        {...getFloatingProps()}
                        className="z-9999 w-64 bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header with note title */}
                        <div className="px-3.5 py-2.5 border-b border-zinc-800/60 flex items-center gap-2">
                            <span className="text-[13px]">📄</span>
                            <span className="text-sm font-medium text-zinc-300 truncate">
                                {isDeleted ? 'Note not found' : noteTitle}
                            </span>
                        </div>

                        {/* Menu items */}
                        <div className="py-1">
                            {!isDeleted && (
                                <button
                                    onClick={handleOpenNote}
                                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-zinc-300 hover:text-white hover:bg-violet-500/10 transition-colors cursor-pointer"
                                >
                                    <ExternalLink size={14} className="text-zinc-400" />
                                    Open note
                                </button>
                            )}
                            {!isDeleted && (
                                <button
                                    onClick={() => setShowShowsAs(!showShowsAs)}
                                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-zinc-300 hover:text-white hover:bg-violet-500/10 transition-colors cursor-pointer"
                                >
                                    <Type size={14} className="text-zinc-400" />
                                    Shows as…
                                </button>
                            )}
                            {showShowsAs && (
                                <div className="px-3.5 py-2">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={showsAsInput}
                                        onChange={(e) => setShowsAsInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                setContextOpen(false);
                                            }
                                            e.stopPropagation();
                                        }}
                                        placeholder={noteTitle}
                                        className="w-full bg-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700/60 focus:border-violet-500/60 rounded-lg px-2.5 py-1.5 transition-colors"
                                    />
                                </div>
                            )}
                            <button
                                onClick={handleRemoveLink}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-400/80 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                                <Trash2 size={14} />
                                Remove link
                            </button>
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </NodeViewWrapper>
    );
}
