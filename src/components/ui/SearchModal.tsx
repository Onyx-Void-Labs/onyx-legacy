import { useEffect, useRef, useState, useMemo, useDeferredValue } from 'react';
import { Search, FileText, Plus, Tag } from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta } from '../../types/sync';

type Note = {
    id: string;
    title: string;
};

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    notes: Note[];
    onSelectNote: (id: string) => void;
}

export default function SearchModal({ isOpen, onClose, notes, onSelectNote }: SearchModalProps) {
    const { createFile, updateFile, files } = useSync();

    const [query, setQuery] = useState('');
    const deferredQuery = useDeferredValue(query);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    /* Gather all unique tags across files for filter chips */
    const allTags = useMemo(() => {
        const tags = new Set<string>();
        files.forEach((f: FileMeta) => {
            f.tags?.forEach((t: string) => {
                if (t.trim()) tags.add(t.trim());
            });
        });
        return Array.from(tags).sort();
    }, [files]);

    /* Build a map of noteId → tags for quick lookup */
    const noteTagMap = useMemo(() => {
        const map = new Map<string, string[]>();
        files.forEach((f: FileMeta) => {
            if (f.tags && f.tags.length > 0) map.set(f.id, f.tags);
        });
        return map;
    }, [files]);

    const filtered = notes.filter(n => {
        const matchesQuery = (n.title || 'Untitled').toLowerCase().includes(deferredQuery.toLowerCase());
        const matchesTag = activeTag ? (noteTagMap.get(n.id) ?? []).includes(activeTag) : true;
        return matchesQuery && matchesTag;
    });

    // Add "Create new" option when query exists but no exact match
    const hasExactMatch = notes.some(n => (n.title || '').toLowerCase() === deferredQuery.toLowerCase());
    const showCreateOption = deferredQuery.trim().length > 0 && !hasExactMatch;
    const totalItems = filtered.length + (showCreateOption ? 1 : 0);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            setActiveTag(null);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const handleCreateNew = () => {
        try {
            const newId = createFile();
            if (query.trim()) {
                updateFile(newId, { title: query.trim() });
            }
            onSelectNote(newId);
            onClose();
        } catch (error) {
            console.error("Failed to create note:", error);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % totalItems);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + totalItems) % totalItems);
        } else if (e.key === 'Enter') {
            if (showCreateOption && selectedIndex === filtered.length) {
                handleCreateNew();
            } else if (filtered[selectedIndex]) {
                onSelectNote(filtered[selectedIndex].id);
                onClose();
            }
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-100 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-125 bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Search Input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
                    <Search size={18} className="text-zinc-500" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search or create note..."
                        className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-600 outline-none text-sm"
                    />
                </div>

                {/* Tag filter chips */}
                {allTags.length > 0 && (
                    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-zinc-800 overflow-x-auto">
                        <Tag size={13} className="text-zinc-600 shrink-0" />
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                                className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] border transition-colors cursor-pointer ${
                                    activeTag === tag
                                        ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                                        : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/40 hover:text-zinc-300 hover:border-zinc-600/50'
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                )}

                {/* Results */}
                <div className="max-h-80 overflow-y-auto">
                    {filtered.map((note, i) => (
                        <div
                            key={note.id}
                            onClick={() => {
                                onSelectNote(note.id);
                                onClose();
                            }}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${i === selectedIndex
                                ? 'bg-purple-500/10 text-zinc-100'
                                : 'text-zinc-400 hover:bg-white/5'
                                }`}
                        >
                            <FileText size={16} className={i === selectedIndex ? 'text-purple-400' : 'text-zinc-600'} />
                            <span className="text-sm truncate">{note.title || 'Untitled'}</span>
                        </div>
                    ))}

                    {/* Create New Option */}
                    {showCreateOption && (
                        <div
                            onClick={handleCreateNew}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-t border-zinc-800/50 ${selectedIndex === filtered.length
                                ? 'bg-purple-500/10 text-zinc-100'
                                : 'text-zinc-400 hover:bg-white/5'
                                }`}
                        >
                            <Plus size={16} className={selectedIndex === filtered.length ? 'text-purple-400' : 'text-zinc-600'} />
                            <span className="text-sm">Create "<span className="text-purple-400 font-medium">{query}</span>"</span>
                        </div>
                    )}

                    {/* No Results */}
                    {filtered.length === 0 && !showCreateOption && (
                        <div className="px-4 py-8 text-center text-zinc-600 text-sm">
                            No notes found
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
