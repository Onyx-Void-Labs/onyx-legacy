import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import {
    Bold, Italic, Underline, Strikethrough, Code,
    Heading1, Heading2, Heading3,
    List, ListOrdered, CheckSquare,
    Quote, Minus, AlignLeft, AlignCenter, AlignRight, AlignJustify,
    Link2, Highlighter, Subscript, Superscript,
    Undo2, Redo2,
    Type, Table, Image, Youtube, Sigma, MessageSquareWarning, Code2,
    Eye, Hash, PanelLeftClose, ChevronDown,
    Paintbrush, Mic,
} from 'lucide-react';

import { usePainterStore } from '@/store/painterStore';
import { useFeature } from '@/hooks/useFeature';

type RibbonTab = 'format' | 'insert' | 'view';

interface ToolbarProps {
    editor: Editor | null;
}

interface ToolbarButtonProps {
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    title: string;
    children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
    onClick,
    isActive = false,
    disabled = false,
    title,
    children,
}) => (
    <button
        onMouseDown={(e) => {
            e.preventDefault();
            onClick();
        }}
        disabled={disabled}
        title={title}
        className={`
            p-1.5 rounded-md transition-all duration-150 flex items-center justify-center
            ${isActive
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30'
            }
            ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
        `}
    >
        {children}
    </button>
);

const ToolbarDivider = () => (
    <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
);

/* ─── Font Family Dropdown ────────────────────────────────── */

const FONT_FAMILIES = [
    { label: 'Inter', value: 'Inter' },
    { label: 'DM Sans', value: 'DM Sans' },
    { label: 'Georgia', value: 'Georgia' },
    { label: 'JetBrains Mono', value: 'JetBrains Mono' },
    { label: 'Lora', value: 'Lora' },
    { label: 'Merriweather', value: 'Merriweather' },
    { label: 'Roboto', value: 'Roboto' },
    { label: 'Roboto Mono', value: 'Roboto Mono' },
    { label: 'Times New Roman', value: 'Times New Roman' },
    { label: 'Arial', value: 'Arial' },
    { label: 'Verdana', value: 'Verdana' },
    { label: 'Comic Sans MS', value: 'Comic Sans MS, Indie Flower' },
];

const FONT_FAMILY_STORAGE_KEY = 'onyx-last-font-family';

interface FontFamilyDropdownProps {
    editor: Editor;
}

const FontFamilyDropdown: React.FC<FontFamilyDropdownProps> = ({ editor }) => {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [search, setSearch] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

    const currentFamily = editor.getAttributes('textStyle')?.fontFamily || 'Inter';
    const displayName = FONT_FAMILIES.find(
        (f) => f.value === currentFamily || currentFamily.includes(f.label)
    )?.label || currentFamily.split(',')[0].trim();

    // Filter fonts by search query
    const filteredFonts = FONT_FAMILIES.filter((f) =>
        f.label.toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => {
        if (!open && !editing) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
                setEditing(false);
                setSearch('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, editing]);

    // Update dropdown position when opening
    useEffect(() => {
        if (open && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setDropdownPos({ top: rect.bottom + 4, left: rect.left });
        }
    }, [open]);

    const selectFont = (value: string) => {
        editor.chain().focus().setFontFamily(value).run();
        localStorage.setItem(FONT_FAMILY_STORAGE_KEY, value);
        setOpen(false);
        setEditing(false);
        setSearch('');
    };

    const handleClick = () => {
        // Single click: make it editable to type a font name
        setEditing(true);
        setSearch(displayName);
        setOpen(true);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            // If there's exactly one match, select it
            if (filteredFonts.length === 1) {
                selectFont(filteredFonts[0].value);
            } else if (filteredFonts.length > 0) {
                selectFont(filteredFonts[0].value);
            }
        } else if (e.key === 'Escape') {
            setEditing(false);
            setOpen(false);
            setSearch('');
        }
    };

    return (
        <div ref={ref} className="relative">
            {editing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                        setTimeout(() => {
                            setEditing(false);
                            setSearch('');
                        }, 200);
                    }}
                    className="px-2 py-1 rounded-md text-xs text-zinc-200 bg-zinc-800 border border-violet-500/50 outline-none min-w-24"
                    autoFocus
                />
            ) : (
                <button
                    onMouseDown={(e) => {
                        e.preventDefault();
                        handleClick();
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-300 hover:bg-zinc-700/30 transition-colors cursor-pointer min-w-20"
                    title="Font Family (click to search)"
                >
                    <span className="truncate" style={{ fontFamily: currentFamily }}>
                        {displayName}
                    </span>
                    <ChevronDown size={10} className="text-zinc-500 shrink-0" />
                </button>
            )}
            {open && createPortal(
                <div
                    className="w-52 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1 max-h-72 overflow-y-auto custom-scrollbar animate-fade-in-up"
                    style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 99999 }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    {filteredFonts.length === 0 && (
                        <div className="px-3 py-2 text-xs text-zinc-500">No fonts match "{search}"</div>
                    )}
                    {filteredFonts.map((f) => (
                        <button
                            key={f.value}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                selectFont(f.value);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                                currentFamily === f.value || currentFamily.includes(f.label)
                                    ? 'text-violet-300 bg-violet-500/10'
                                    : 'text-zinc-300 hover:bg-zinc-800'
                            }`}
                            style={{ fontFamily: f.value }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
};

/* ─── Font Size Input ─────────────────────────────────────── */

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '60', '72'];

interface FontSizeInputProps {
    editor: Editor;
}

const FontSizeInput: React.FC<FontSizeInputProps> = ({ editor }) => {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

    const currentSize = editor.getAttributes('textStyle')?.fontSize || '16';

    useEffect(() => {
        if (!open && !editing) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
                setEditing(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, editing]);

    // Update dropdown position when opening
    useEffect(() => {
        if (open && ref.current) {
            const rect = ref.current.getBoundingClientRect();
            setDropdownPos({ top: rect.bottom + 4, left: rect.left });
        }
    }, [open]);

    const applySize = (size: string) => {
        const num = parseInt(size, 10);
        if (num >= 6 && num <= 200) {
            editor.chain().focus().setFontSize(String(num)).run();
        }
        setOpen(false);
        setEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            applySize(value);
        } else if (e.key === 'Escape') {
            setEditing(false);
            setOpen(false);
        }
    };

    const handleClick = () => {
        // Single click starts editing mode
        setEditing(true);
        setValue(currentSize);
        setTimeout(() => inputRef.current?.select(), 0);
    };

    const handleDropdownToggle = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(!open);
    };

    return (
        <div ref={ref} className="relative flex items-center">
            {editing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={handleKeyDown}
                    onBlur={() => { applySize(value); }}
                    className="w-10 px-1 py-1 bg-zinc-800 text-xs text-zinc-200 outline-none text-center font-mono rounded-md border border-violet-500/50"
                    autoFocus
                />
            ) : (
                <button
                    onMouseDown={(e) => {
                        e.preventDefault();
                        handleClick();
                    }}
                    className="flex items-center gap-0.5 px-1.5 py-1 rounded-md text-xs text-zinc-300 hover:bg-zinc-700/30 transition-colors cursor-pointer min-w-9 justify-center"
                    title="Font Size (click to type)"
                >
                    <span className="font-mono">{currentSize}</span>
                </button>
            )}
            <button
                onMouseDown={handleDropdownToggle}
                className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/30 transition-colors cursor-pointer"
                title="Font size presets"
            >
                <ChevronDown size={10} />
            </button>
            {open && createPortal(
                <div
                    className="w-20 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto custom-scrollbar animate-fade-in-up"
                    style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 99999 }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    {FONT_SIZES.map((s) => (
                        <button
                            key={s}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                applySize(s);
                            }}
                            className={`w-full text-center px-2 py-1 text-xs transition-colors cursor-pointer ${
                                currentSize === s
                                    ? 'text-violet-300 bg-violet-500/10'
                                    : 'text-zinc-300 hover:bg-zinc-800'
                            }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>,
                document.body,
            )}
        </div>
    );
};

/* ─── Colour Swatch Grid ─────────────────────────────────── */

const COLOR_GRID = [
    { name: 'Default', value: '' },
    { name: 'Black', value: '#18181b' },
    { name: 'Gray', value: '#a1a1aa' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Pink', value: '#ec4899' },
];

const HIGHLIGHT_COLORS = [
    { name: 'None', value: '' },
    { name: 'Red', value: 'rgba(239,68,68,0.20)' },
    { name: 'Orange', value: 'rgba(249,115,22,0.20)' },
    { name: 'Yellow', value: 'rgba(234,179,8,0.25)' },
    { name: 'Green', value: 'rgba(34,197,94,0.20)' },
    { name: 'Blue', value: 'rgba(59,130,246,0.20)' },
    { name: 'Purple', value: 'rgba(168,85,247,0.20)' },
    { name: 'Pink', value: 'rgba(236,72,153,0.20)' },
    { name: 'Teal', value: 'rgba(20,184,166,0.20)' },
    { name: 'Gray', value: 'rgba(161,161,170,0.20)' },
];

interface ColorPopoverProps {
    colors: typeof COLOR_GRID;
    onSelect: (color: string) => void;
    onClose: () => void;
    label: string;
    anchorRef: React.RefObject<HTMLElement | null>;
}

const ColorPopover: React.FC<ColorPopoverProps> = ({ colors, onSelect, onClose, label, anchorRef }) => {
    const ref = useRef<HTMLDivElement>(null);
    const hexRef = useRef<HTMLInputElement>(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setPos({
                top: rect.bottom + 6,
                left: Math.max(8, rect.left + rect.width / 2 - 90),
            });
        }
    }, [anchorRef]);

    useEffect(() => {
        const handle = (e: MouseEvent) => {
            if (
                ref.current && !ref.current.contains(e.target as Node) &&
                anchorRef.current && !anchorRef.current.contains(e.target as Node)
            ) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [onClose, anchorRef]);

    const handleHexSubmit = () => {
        const val = hexRef.current?.value.trim();
        if (val && /^#?[0-9a-fA-F]{3,8}$/.test(val)) {
            onSelect(val.startsWith('#') ? val : `#${val}`);
        }
    };

    return createPortal(
        <div
            ref={ref}
            className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-2.5 shadow-2xl shadow-black/50 backdrop-blur-sm animate-fade-in-up"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999, width: 180 }}
        >
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 px-0.5">
                {label}
            </div>
            <div className="grid grid-cols-5 gap-1.5">
                {colors.map((c) => (
                    <button
                        key={c.name}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelect(c.value);
                        }}
                        title={c.name}
                        className="w-6 h-6 rounded-full border border-zinc-600/60 hover:scale-125 hover:border-zinc-400 transition-all duration-100 relative cursor-pointer"
                        style={{
                            backgroundColor: c.value || '#d4d4d8',
                        }}
                    >
                        {c.value === '' && (
                            <span className="absolute inset-0 flex items-center justify-center text-zinc-800 text-[10px] font-bold">
                                ×
                            </span>
                        )}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-zinc-700/40">
                <span className="text-zinc-500 text-xs">#</span>
                <input
                    ref={hexRef}
                    type="text"
                    placeholder="hex"
                    maxLength={7}
                    className="flex-1 bg-zinc-800 text-xs text-zinc-200 rounded-md px-2 py-1 outline-none border border-zinc-700/60 focus:border-violet-500 font-mono"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleHexSubmit();
                    }}
                />
                <button
                    onMouseDown={(e) => {
                        e.preventDefault();
                        handleHexSubmit();
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 px-1.5 cursor-pointer"
                >
                    Set
                </button>
            </div>
        </div>,
        document.body,
    );
};

/* ─── Insert Tab Card Button ──────────────────────────────── */

interface InsertCardProps {
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    isActive?: boolean;
}

const InsertCard: React.FC<InsertCardProps> = ({ onClick, icon, label, isActive = false }) => (
    <button
        onMouseDown={(e) => {
            e.preventDefault();
            onClick();
        }}
        className={`flex flex-col items-center justify-center rounded-lg transition-all duration-150 cursor-pointer ${
            isActive
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-violet-500/10 hover:-translate-y-px border border-transparent'
        }`}
        style={{ width: 48, height: 44 }}
    >
        <div className="flex items-center justify-center">{icon}</div>
        <span className="text-[10px] mt-0.5 leading-tight">{label}</span>
    </button>
);

/* ─── View Tab Toggle Button ──────────────────────────────── */

interface ViewToggleProps {
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    isActive?: boolean;
}

const ViewToggle: React.FC<ViewToggleProps> = ({ onClick, icon, label, isActive = false }) => (
    <button
        onMouseDown={(e) => {
            e.preventDefault();
            onClick();
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer text-xs ${
            isActive
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30 border border-transparent'
        }`}
    >
        {icon}
        <span>{label}</span>
    </button>
);

/* ─── Main Toolbar Component ──────────────────────────────── */

export const Toolbar: React.FC<ToolbarProps> = ({ editor }) => {
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [showHighlightPicker, setShowHighlightPicker] = useState(false);
    const [activeTab, setActiveTab] = useState<RibbonTab>('format');
    const [, setTick] = useState(0);

    const colorBtnRef = useRef<HTMLButtonElement>(null);
    const highlightBtnRef = useRef<HTMLButtonElement>(null);

    // Painter mode
    const painterEnabled = useFeature('painter');
    const painterActive = usePainterStore((s) => s.isActive);
    const enterPainterMode = usePainterStore((s) => s.enterPainterMode);
    const transcriptionEnabled = useFeature('transcription');

    useEffect(() => {
        if (!editor) return;
        const forceUpdate = () => setTick((t) => t + 1);
        editor.on('transaction', forceUpdate);
        editor.on('selectionUpdate', forceUpdate);
        return () => {
            editor.off('transaction', forceUpdate);
            editor.off('selectionUpdate', forceUpdate);
        };
    }, [editor]);

    const setTextColor = useCallback((color: string) => {
        if (!editor) return;
        if (color === '') {
            editor.chain().focus().unsetColor().run();
        } else {
            editor.chain().focus().setColor(color).run();
        }
        setShowColorPicker(false);
    }, [editor]);

    const setHighlightColor = useCallback((color: string) => {
        if (!editor) return;
        if (color === '') {
            editor.chain().focus().unsetHighlight().run();
        } else {
            editor.chain().focus().toggleHighlight({ color }).run();
        }
        setShowHighlightPicker(false);
    }, [editor]);

    const setLink = useCallback(() => {
        if (!editor) return;
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL', previousUrl);

        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }, [editor]);

    if (!editor) return null;

    const currentColor = editor.getAttributes('textStyle')?.color || '';
    const currentHighlight = editor.getAttributes('highlight')?.color || '';

    const tabs: { id: RibbonTab; label: string }[] = [
        { id: 'format', label: 'Format' },
        { id: 'insert', label: 'Insert' },
        { id: 'view', label: 'View' },
    ];

    const renderFormatTab = () => (
        <>
            {/* Group 1 — History */}
            <ToolbarButton
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
                title="Undo (Ctrl+Z)"
            >
                <Undo2 size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
                title="Redo (Ctrl+Y)"
            >
                <Redo2 size={15} />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Group 2 — Block type + Font controls */}
            <ToolbarButton
                onClick={() => editor.chain().focus().setParagraph().run()}
                isActive={editor.isActive('paragraph') && !editor.isActive('heading')}
                title="Normal text"
            >
                <Type size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                isActive={editor.isActive('heading', { level: 1 })}
                title="Heading 1"
            >
                <Heading1 size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                isActive={editor.isActive('heading', { level: 2 })}
                title="Heading 2"
            >
                <Heading2 size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                isActive={editor.isActive('heading', { level: 3 })}
                title="Heading 3"
            >
                <Heading3 size={15} />
            </ToolbarButton>

            <FontFamilyDropdown editor={editor} />
            <FontSizeInput editor={editor} />

            <ToolbarDivider />

            {/* Group 3 — Inline formatting */}
            <ToolbarButton
                onClick={() => {
                    // BUG 7+8: Use toggleMark directly to ensure bold works
                    // inside headings and alongside color/TextStyle marks
                    if (editor.isActive('heading')) {
                        editor.chain().focus().toggleMark('bold').run();
                    } else {
                        editor.chain().focus().toggleBold().run();
                    }
                }}
                isActive={editor.isActive('bold')}
                title="Bold (Ctrl+B)"
            >
                <Bold size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleItalic().run()}
                isActive={editor.isActive('italic')}
                title="Italic (Ctrl+I)"
            >
                <Italic size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                isActive={editor.isActive('underline')}
                title="Underline (Ctrl+U)"
            >
                <Underline size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleStrike().run()}
                isActive={editor.isActive('strike')}
                title="Strikethrough"
            >
                <Strikethrough size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleCode().run()}
                isActive={editor.isActive('code')}
                title="Inline Code"
            >
                <Code size={15} />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Group 4 — Script */}
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleSubscript().run()}
                isActive={editor.isActive('subscript')}
                title="Subscript"
            >
                <Subscript size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleSuperscript().run()}
                isActive={editor.isActive('superscript')}
                title="Superscript"
            >
                <Superscript size={15} />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Group 5 — Lists */}
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                isActive={editor.isActive('bulletList')}
                title="Bullet List"
            >
                <List size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                isActive={editor.isActive('orderedList')}
                title="Numbered List"
            >
                <ListOrdered size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().toggleTaskList().run()}
                isActive={editor.isActive('taskList')}
                title="Task List"
            >
                <CheckSquare size={15} />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Group 6 — Alignment */}
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('left').run()}
                isActive={editor.isActive({ textAlign: 'left' })}
                title="Align Left"
            >
                <AlignLeft size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('center').run()}
                isActive={editor.isActive({ textAlign: 'center' })}
                title="Align Center"
            >
                <AlignCenter size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('right').run()}
                isActive={editor.isActive({ textAlign: 'right' })}
                title="Align Right"
            >
                <AlignRight size={15} />
            </ToolbarButton>
            <ToolbarButton
                onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                isActive={editor.isActive({ textAlign: 'justify' })}
                title="Justify"
            >
                <AlignJustify size={15} />
            </ToolbarButton>

            <ToolbarDivider />

            {/* Group 7 — Insert (Link, Color, Highlight) */}
            <ToolbarButton
                onClick={setLink}
                isActive={editor.isActive('link')}
                title="Link"
            >
                <Link2 size={15} />
            </ToolbarButton>

            {/* Text Color */}
            <div className="relative">
                <button
                    ref={colorBtnRef}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setShowColorPicker(!showColorPicker);
                        setShowHighlightPicker(false);
                    }}
                    title="Text Color"
                    className="p-1.5 rounded-md transition-all duration-150 flex flex-col items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30 cursor-pointer"
                >
                    <Type size={14} />
                    <div
                        className="w-3.5 h-0.75 rounded-full mt-0.5"
                        style={{ backgroundColor: currentColor || '#f4f4f5' }}
                    />
                </button>
                {showColorPicker && (
                    <ColorPopover
                        colors={COLOR_GRID}
                        onSelect={setTextColor}
                        onClose={() => setShowColorPicker(false)}
                        label="Text Color"
                        anchorRef={colorBtnRef}
                    />
                )}
            </div>

            {/* Highlight Color */}
            <div className="relative">
                <button
                    ref={highlightBtnRef}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setShowHighlightPicker(!showHighlightPicker);
                        setShowColorPicker(false);
                    }}
                    title="Highlight Color"
                    className={`p-1.5 rounded-md transition-all duration-150 flex flex-col items-center justify-center cursor-pointer ${
                        editor.isActive('highlight')
                            ? 'bg-violet-500/20 text-violet-300'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30'
                    }`}
                >
                    <Highlighter size={14} />
                    <div
                        className="w-3.5 h-0.75 rounded-full mt-0.5"
                        style={{ backgroundColor: currentHighlight || 'transparent' }}
                    />
                </button>
                {showHighlightPicker && (
                    <ColorPopover
                        colors={HIGHLIGHT_COLORS}
                        onSelect={setHighlightColor}
                        onClose={() => setShowHighlightPicker(false)}
                        label="Highlight"
                        anchorRef={highlightBtnRef}
                    />
                )}
            </div>
        </>
    );

    const renderInsertTab = () => (
        <div className="flex items-center gap-1.5 py-0.5">
            <InsertCard
                onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                icon={<Table size={18} />}
                label="Table"
            />
            <InsertCard
                onClick={() => window.dispatchEvent(new CustomEvent('onyx:insert-image'))}
                icon={<Image size={18} />}
                label="Image"
            />
            <InsertCard
                onClick={() => window.dispatchEvent(new CustomEvent('onyx:insert-video'))}
                icon={<Youtube size={18} />}
                label="Video"
            />
            <InsertCard
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
                icon={<Minus size={18} />}
                label="Divider"
            />
            <InsertCard
                onClick={() => editor.chain().focus().setMathBlock().run()}
                icon={<Sigma size={18} />}
                label="Math"
            />
            <InsertCard
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                icon={<Code2 size={18} />}
                label="Code"
                isActive={editor.isActive('codeBlock')}
            />
            <InsertCard
                onClick={() => editor.chain().focus().setCallout({ type: 'info' }).run()}
                icon={<MessageSquareWarning size={18} />}
                label="Callout"
            />
            <InsertCard
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                icon={<Quote size={18} />}
                label="Quote"
                isActive={editor.isActive('blockquote')}
            />
        </div>
    );

    const renderViewTab = () => (
        <div className="flex items-center gap-2 py-0.5">
            {/* Painter Mode toggle — gated by feature flag */}
            {painterEnabled && (
                <ViewToggle
                    onClick={() => {
                        if (!painterActive) enterPainterMode();
                    }}
                    icon={<Paintbrush size={14} />}
                    label="Painter"
                    isActive={painterActive}
                />
            )}
            <ViewToggle
                onClick={() => window.dispatchEvent(new CustomEvent('onyx:toggle-focus-mode'))}
                icon={<Eye size={14} />}
                label="Focus Mode"
            />
            <ViewToggle
                onClick={() => window.dispatchEvent(new CustomEvent('onyx:toggle-word-count'))}
                icon={<Hash size={14} />}
                label="Word Count"
            />
            <ViewToggle
                onClick={() => window.dispatchEvent(new CustomEvent('onyx:toggle-outline'))}
                icon={<PanelLeftClose size={14} />}
                label="Properties"
            />
            {/* Transcription toggle — gated by feature flag */}
            {transcriptionEnabled && (
                <ViewToggle
                    onClick={() => window.dispatchEvent(new CustomEvent('onyx:toggle-transcription'))}
                    icon={<Mic size={14} />}
                    label="Transcribe"
                />
            )}
        </div>
    );

    return (
        <div className="w-full shrink-0">
            {/* Tab Bar — plain text tabs, left-aligned */}
            <div className="flex items-center gap-0 px-3 border-b border-zinc-700" style={{ height: 28 }}>
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setActiveTab(tab.id);
                        }}
                        className={`px-3 py-1 text-[11px] font-medium tracking-wide transition-all duration-100 cursor-pointer relative ${
                            activeTab === tab.id
                                ? 'text-zinc-200'
                                : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                    >
                        {tab.label}
                        {activeTab === tab.id && (
                            <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-violet-500 rounded-full" />
                        )}
                    </button>
                ))}
            </div>

            {/* Icon Row — flat strip, border-bottom only */}
            <div className="flex items-center gap-0.5 px-3 py-1 border-b border-zinc-800 overflow-x-auto scrollbar-hide">
                {activeTab === 'format' && renderFormatTab()}
                {activeTab === 'insert' && renderInsertTab()}
                {activeTab === 'view' && renderViewTab()}
            </div>
        </div>
    );
};
