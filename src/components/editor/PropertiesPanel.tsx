import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Tag, Calendar, Hash, BookOpen, Flag, CircleCheck, Plus, Loader2,
    ChevronDown, Type, AlignLeft, ToggleLeft, Clock, List,
    Link as LinkIcon, Mail, Phone, Star, BarChart3, CircleDot,
    Link2, Calculator, GripVertical, Trash2, Pencil, ExternalLink,
    Copy, Check,
} from 'lucide-react';
import { useSync } from '../../contexts/SyncContext';
import type { FileMeta } from '../../types/sync';

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

interface PropertiesPanelProps {
    noteId: string;
    meta: FileMeta;
    onClose: () => void;
}

type PropType =
    | 'text' | 'longtext' | 'number' | 'boolean'
    | 'date' | 'datetime' | 'select' | 'multiselect'
    | 'url' | 'email' | 'phone' | 'rating'
    | 'progress' | 'status' | 'relation' | 'formula'
    | 'created_at' | 'updated_at';

const PROP_DEFS: { value: PropType; label: string; icon: any; readonly?: boolean }[] = [
    { value: 'text', label: 'Text', icon: Type },
    { value: 'longtext', label: 'Long Text', icon: AlignLeft },
    { value: 'number', label: 'Number', icon: Hash },
    { value: 'boolean', label: 'Checkbox', icon: ToggleLeft },
    { value: 'date', label: 'Date', icon: Calendar },
    { value: 'datetime', label: 'Date & Time', icon: Clock },
    { value: 'select', label: 'Select', icon: ChevronDown },
    { value: 'multiselect', label: 'Multi Select', icon: List },
    { value: 'url', label: 'URL', icon: LinkIcon },
    { value: 'email', label: 'Email', icon: Mail },
    { value: 'phone', label: 'Phone', icon: Phone },
    { value: 'rating', label: 'Rating', icon: Star },
    { value: 'progress', label: 'Progress', icon: BarChart3 },
    { value: 'status', label: 'Status', icon: CircleDot },
    { value: 'relation', label: 'Relation', icon: Link2 },
    { value: 'formula', label: 'Formula', icon: Calculator },
    { value: 'created_at', label: 'Created At', icon: Clock, readonly: true },
    { value: 'updated_at', label: 'Updated At', icon: Clock, readonly: true },
];

const PRIORITIES: { value: string; label: string; class: string }[] = [
    { value: 'low', label: 'Low', class: 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600' },
    { value: 'medium', label: 'Med', class: 'bg-blue-900/60 text-blue-300 hover:bg-blue-800/60' },
    { value: 'high', label: 'High', class: 'bg-amber-900/60 text-amber-300 hover:bg-amber-800/60' },
    { value: 'urgent', label: 'Urgent', class: 'bg-red-900/60 text-red-300 hover:bg-red-800/60' },
];

const STATUSES: { value: string; label: string; class: string }[] = [
    { value: 'todo', label: 'To Do', class: 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600' },
    { value: 'in-progress', label: 'In Progress', class: 'bg-amber-900/60 text-amber-300 hover:bg-amber-800/60' },
    { value: 'done', label: 'Done', class: 'bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800/60' },
];

const STATUS_PRESETS = ['Not Started', 'In Progress', 'Done', 'Blocked', 'Cancelled'];

const INPUT_CLS =
    'w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500 transition-colors placeholder-zinc-600';
const INPUT_MONO = INPUT_CLS + ' font-mono';

function defaultForType(t: PropType): any {
    switch (t) {
        case 'number': case 'rating': case 'progress': return 0;
        case 'boolean': return false;
        case 'multiselect': return '[]';
        case 'created_at': case 'updated_at': return '__auto__';
        default: return '';
    }
}

/* ------------------------------------------------------------------ */
/*  Star Rating                                                        */
/* ------------------------------------------------------------------ */

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [hover, setHover] = useState(0);
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
                <button
                    key={i}
                    onClick={() => onChange(value === i ? 0 : i)}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(0)}
                    className="p-0.5 cursor-pointer transition-colors"
                >
                    <Star
                        size={16}
                        className={
                            i <= (hover || value)
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-zinc-600'
                        }
                    />
                </button>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Property Field Renderer                                            */
/* ------------------------------------------------------------------ */

interface FieldProps {
    propKey: string;
    value: any;
    type: PropType;
    options?: string[];
    onChange: (v: any) => void;
    onOptionsChange?: (opts: string[]) => void;
    files?: FileMeta[];
    allProps?: Record<string, any>;
    meta?: FileMeta;
}

function PropertyField({
    propKey: _key,
    value,
    type,
    options = [],
    onChange,
    onOptionsChange,
    files = [],
    allProps = {},
    meta,
}: FieldProps) {
    const [editing, setEditing] = useState(false);
    const [newOpt, setNewOpt] = useState('');
    const [relSearch, setRelSearch] = useState('');

    switch (type) {
        /* ---- Text ---- */
        case 'text':
            return (
                <input
                    type="text"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={INPUT_CLS}
                />
            );

        /* ---- Long Text ---- */
        case 'longtext':
            return (
                <textarea
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    rows={3}
                    className={INPUT_CLS + ' resize-y min-h-15'}
                />
            );

        /* ---- Number ---- */
        case 'number':
            return (
                <input
                    type="number"
                    value={value ?? 0}
                    onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                    className={INPUT_MONO}
                />
            );

        /* ---- Boolean (toggle) ---- */
        case 'boolean':
            return (
                <button
                    onClick={() => onChange(!value)}
                    className="flex items-center gap-2 cursor-pointer group"
                >
                    <div
                        className={`w-8 h-4.5 rounded-full transition-colors ${
                            value ? 'bg-violet-500' : 'bg-zinc-700'
                        }`}
                    >
                        <div
                            className={`w-3.5 h-3.5 mt-0.5 rounded-full bg-white transition-transform ${
                                value ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                        />
                    </div>
                    <span className="text-xs text-zinc-400">
                        {value ? 'Yes' : 'No'}
                    </span>
                </button>
            );

        /* ---- Date ---- */
        case 'date':
            return (
                <input
                    type="date"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={INPUT_MONO}
                />
            );

        /* ---- DateTime ---- */
        case 'datetime':
            return (
                <input
                    type="datetime-local"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={INPUT_MONO}
                />
            );

        /* ---- Select ---- */
        case 'select': {
            return (
                <div className="space-y-1">
                    <div className="relative">
                        <select
                            value={value ?? ''}
                            onChange={(e) => onChange(e.target.value)}
                            className={INPUT_CLS + ' appearance-none cursor-pointer pr-7'}
                        >
                            <option value="">—</option>
                            {options.map((o) => (
                                <option key={o} value={o}>
                                    {o}
                                </option>
                            ))}
                        </select>
                        <ChevronDown
                            size={12}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                        />
                    </div>
                    {editing ? (
                        <div className="flex gap-1">
                            <input
                                value={newOpt}
                                onChange={(e) => setNewOpt(e.target.value)}
                                placeholder="New option"
                                className={INPUT_CLS + ' text-xs py-1'}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newOpt.trim()) {
                                        onOptionsChange?.([...options, newOpt.trim()]);
                                        setNewOpt('');
                                    }
                                    if (e.key === 'Escape') setEditing(false);
                                }}
                            />
                            <button
                                onClick={() => {
                                    if (newOpt.trim()) {
                                        onOptionsChange?.([...options, newOpt.trim()]);
                                        setNewOpt('');
                                    }
                                    setEditing(false);
                                }}
                                className="text-[10px] text-violet-400 hover:text-violet-300 px-1 cursor-pointer"
                            >
                                <Check size={12} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setEditing(true)}
                            className="text-[10px] text-zinc-500 hover:text-violet-400 cursor-pointer"
                        >
                            + option
                        </button>
                    )}
                </div>
            );
        }

        /* ---- Multi Select ---- */
        case 'multiselect': {
            let selected: string[] = [];
            try {
                selected = JSON.parse(value || '[]');
            } catch {
                selected = [];
            }
            return (
                <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                        {selected.map((s) => (
                            <span
                                key={s}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-violet-500/15 text-violet-300 border border-violet-500/20"
                            >
                                {s}
                                <button
                                    onClick={() =>
                                        onChange(
                                            JSON.stringify(
                                                selected.filter((x) => x !== s)
                                            )
                                        )
                                    }
                                    className="hover:text-red-400 cursor-pointer"
                                >
                                    <X size={8} />
                                </button>
                            </span>
                        ))}
                    </div>
                    <div className="relative">
                        <select
                            value=""
                            onChange={(e) => {
                                if (
                                    e.target.value &&
                                    !selected.includes(e.target.value)
                                )
                                    onChange(
                                        JSON.stringify([
                                            ...selected,
                                            e.target.value,
                                        ])
                                    );
                            }}
                            className={
                                INPUT_CLS +
                                ' appearance-none cursor-pointer text-xs py-1 pr-7'
                            }
                        >
                            <option value="">Add…</option>
                            {options
                                .filter((o) => !selected.includes(o))
                                .map((o) => (
                                    <option key={o} value={o}>
                                        {o}
                                    </option>
                                ))}
                        </select>
                        <ChevronDown
                            size={10}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                        />
                    </div>
                    {editing ? (
                        <div className="flex gap-1">
                            <input
                                value={newOpt}
                                onChange={(e) => setNewOpt(e.target.value)}
                                placeholder="New option"
                                className={INPUT_CLS + ' text-xs py-1'}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newOpt.trim()) {
                                        onOptionsChange?.([
                                            ...options,
                                            newOpt.trim(),
                                        ]);
                                        setNewOpt('');
                                    }
                                    if (e.key === 'Escape') setEditing(false);
                                }}
                            />
                            <button
                                onClick={() => {
                                    if (newOpt.trim()) {
                                        onOptionsChange?.([
                                            ...options,
                                            newOpt.trim(),
                                        ]);
                                        setNewOpt('');
                                    }
                                    setEditing(false);
                                }}
                                className="text-[10px] text-violet-400 hover:text-violet-300 px-1 cursor-pointer"
                            >
                                <Check size={12} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setEditing(true)}
                            className="text-[10px] text-zinc-500 hover:text-violet-400 cursor-pointer"
                        >
                            + option
                        </button>
                    )}
                </div>
            );
        }

        /* ---- URL ---- */
        case 'url':
            return (
                <div className="flex gap-1">
                    <input
                        type="url"
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="https://…"
                        className={INPUT_CLS + ' flex-1'}
                    />
                    {value && (
                        <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-violet-300 transition-colors shrink-0"
                        >
                            <ExternalLink size={13} />
                        </a>
                    )}
                </div>
            );

        /* ---- Email ---- */
        case 'email':
            return (
                <div className="flex gap-1">
                    <input
                        type="email"
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="name@email.com"
                        className={INPUT_CLS + ' flex-1'}
                    />
                    {value && (
                        <a
                            href={`mailto:${value}`}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-violet-300 transition-colors shrink-0"
                        >
                            <Mail size={13} />
                        </a>
                    )}
                </div>
            );

        /* ---- Phone ---- */
        case 'phone':
            return (
                <input
                    type="tel"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className={INPUT_CLS}
                />
            );

        /* ---- Rating (1-5 stars) ---- */
        case 'rating':
            return (
                <StarRating
                    value={typeof value === 'number' ? value : 0}
                    onChange={onChange}
                />
            );

        /* ---- Progress (0-100%) ---- */
        case 'progress':
            return (
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-violet-500 transition-all"
                                style={{
                                    width: `${Math.min(100, Math.max(0, value || 0))}%`,
                                }}
                            />
                        </div>
                        <span className="text-[11px] font-mono text-zinc-400 w-8 text-right">
                            {value || 0}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={value || 0}
                        onChange={(e) => onChange(parseInt(e.target.value))}
                        className="w-full h-1 accent-violet-500 cursor-pointer"
                    />
                </div>
            );

        /* ---- Status (pill picker) ---- */
        case 'status': {
            const opts = options.length ? options : STATUS_PRESETS;
            const colors: Record<string, string> = {
                'Not Started': 'bg-zinc-700 text-zinc-300',
                'In Progress': 'bg-amber-900/60 text-amber-300',
                Done: 'bg-emerald-900/60 text-emerald-300',
                Blocked: 'bg-red-900/60 text-red-300',
                Cancelled: 'bg-zinc-800 text-zinc-500',
            };
            return (
                <div className="flex flex-wrap gap-1.5">
                    {opts.map((s) => (
                        <button
                            key={s}
                            onClick={() => onChange(s)}
                            className={`text-[11px] px-2 py-1 rounded-full font-medium transition-all duration-150 cursor-pointer ${
                                value === s
                                    ? `${colors[s] ?? 'bg-violet-900/60 text-violet-300'} ring-1 ring-white/20 scale-105`
                                    : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            );
        }

        /* ---- Relation (link to another note) ---- */
        case 'relation': {
            const linked = files.find((f) => f.id === value);
            return (
                <div className="space-y-1">
                    {linked && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/15 text-xs text-violet-300">
                            <Link2 size={11} />
                            <span className="truncate flex-1">
                                {linked.title || 'Untitled'}
                            </span>
                            <button
                                onClick={() => onChange('')}
                                className="hover:text-red-400 cursor-pointer"
                            >
                                <X size={10} />
                            </button>
                        </div>
                    )}
                    <div className="relative">
                        <input
                            value={relSearch}
                            onChange={(e) => setRelSearch(e.target.value)}
                            placeholder="Search notes…"
                            className={INPUT_CLS + ' text-xs py-1'}
                        />
                        {relSearch && (
                            <div className="absolute z-30 mt-1 w-full bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl max-h-28 overflow-auto">
                                {files
                                    .filter((f) =>
                                        f.title
                                            ?.toLowerCase()
                                            .includes(relSearch.toLowerCase())
                                    )
                                    .slice(0, 8)
                                    .map((f) => (
                                        <button
                                            key={f.id}
                                            onClick={() => {
                                                onChange(f.id);
                                                setRelSearch('');
                                            }}
                                            className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-violet-500/10 transition-colors cursor-pointer truncate"
                                        >
                                            {f.title || 'Untitled'}
                                        </button>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        /* ---- Formula ---- */
        case 'formula': {
            let result = '';
            try {
                const expr = String(value || '');
                const resolved = expr.replace(/\{([^}]+)\}/g, (_, k: string) => {
                    const v = allProps[k.trim()];
                    return typeof v === 'number'
                        ? String(v)
                        : (parseFloat(v) || 0).toString();
                });
                // Safe eval — only allow numbers, operators, parens, decimals
                if (/^[\d\s+\-*/().%]+$/.test(resolved)) {
                    result = String(
                        Function(`"use strict"; return (${resolved})`)()
                    );
                } else {
                    result = resolved;
                }
            } catch {
                result = 'Error';
            }
            return (
                <div className="space-y-1">
                    <input
                        type="text"
                        value={value ?? ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="{week} * 2 + {score}"
                        className={INPUT_CLS + ' text-xs font-mono'}
                    />
                    <div className="text-[10px] text-zinc-500">
                        ={' '}
                        <span className="text-violet-300 font-mono">
                            {result}
                        </span>
                    </div>
                </div>
            );
        }

        /* ---- Created At (read-only) ---- */
        case 'created_at':
            return (
                <div className="text-xs text-zinc-400 font-mono py-1">
                    {meta ? new Date(meta.createdAt).toLocaleString() : '—'}
                </div>
            );

        /* ---- Updated At (read-only) ---- */
        case 'updated_at':
            return (
                <div className="text-xs text-zinc-400 font-mono py-1">
                    {meta ? new Date(meta.updatedAt).toLocaleString() : '—'}
                </div>
            );

        default:
            return (
                <input
                    type="text"
                    value={value ?? ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={INPUT_CLS}
                />
            );
    }
}

/* ------------------------------------------------------------------ */
/*  Context Menu (portal)                                              */
/* ------------------------------------------------------------------ */

interface CtxMenuProps {
    x: number;
    y: number;
    onRename: () => void;
    onChangeType: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onClose: () => void;
}

function PropertyContextMenu({
    x,
    y,
    onRename,
    onChangeType,
    onDuplicate,
    onDelete,
    onClose,
}: CtxMenuProps) {
    useEffect(() => {
        const handler = () => onClose();
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [onClose]);

    const items: {
        label: string;
        icon: any;
        action: () => void;
        danger?: boolean;
    }[] = [
        { label: 'Rename', icon: Pencil, action: onRename },
        { label: 'Change type', icon: Type, action: onChangeType },
        { label: 'Duplicate', icon: Copy, action: onDuplicate },
        { label: 'Delete', icon: Trash2, action: onDelete, danger: true },
    ];

    return createPortal(
        <div
            style={{ position: 'fixed', left: x, top: y, zIndex: 99999 }}
            className="min-w-35 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1"
        >
            {items.map((it) => (
                <button
                    key={it.label}
                    onClick={(e) => {
                        e.stopPropagation();
                        it.action();
                    }}
                    className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                        it.danger
                            ? 'text-red-400 hover:bg-red-500/10'
                            : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                    <it.icon size={12} />
                    {it.label}
                </button>
            ))}
        </div>,
        document.body
    );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function PropertiesPanel({
    noteId,
    meta,
    onClose,
}: PropertiesPanelProps) {
    const { updateFile, files } = useSync();
    const [saving, setSaving] = useState(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [showAddProp, setShowAddProp] = useState(false);
    const [newPropName, setNewPropName] = useState('');
    const [newPropType, setNewPropType] = useState<PropType>('text');
    const [subjectQuery, setSubjectQuery] = useState(meta.subject ?? '');
    const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);
    const [tagInput, setTagInput] = useState('');
    const [showTagDropdown, setShowTagDropdown] = useState(false);

    // Context menu
    const [ctxMenu, setCtxMenu] = useState<{
        x: number;
        y: number;
        key: string;
    } | null>(null);
    const [renamingKey, setRenamingKey] = useState<string | null>(null);
    const [renameVal, setRenameVal] = useState('');
    const [changingTypeKey, setChangingTypeKey] = useState<string | null>(null);

    // Drag reorder
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);

    /* Ctrl+Shift+P to toggle panel */
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    /* Subject autocomplete */
    const allSubjects = useMemo(() => {
        const subjects = new Set<string>();
        files.forEach((f) => {
            if (f.subject?.trim()) subjects.add(f.subject.trim());
        });
        return Array.from(subjects).sort();
    }, [files]);

    const filteredSubjects = useMemo(() => {
        if (!subjectQuery.trim()) return allSubjects;
        const q = subjectQuery.toLowerCase();
        return allSubjects.filter((s) => s.toLowerCase().includes(q));
    }, [allSubjects, subjectQuery]);

    /* Tag autocomplete */
    const allTags = useMemo(() => {
        const tags = new Set<string>();
        files.forEach((f) => {
            f.tags?.forEach((t) => {
                if (t.trim()) tags.add(t.trim());
            });
        });
        return Array.from(tags).sort();
    }, [files]);

    const filteredTagSuggestions = useMemo(() => {
        const currentTags = meta.tags ?? [];
        if (!tagInput.trim()) return allTags.filter((t) => !currentTags.includes(t));
        const q = tagInput.toLowerCase();
        return allTags.filter(
            (t) => t.toLowerCase().includes(q) && !currentTags.includes(t)
        );
    }, [allTags, tagInput, meta.tags]);

    /* Property key ordering */
    const propOrder: string[] = useMemo(() => {
        if (!meta.properties) return [];
        try {
            const order = JSON.parse(meta.properties['__order'] || '[]');
            if (Array.isArray(order)) {
                const allKeys = Object.keys(meta.properties).filter(
                    (k) => !k.startsWith('__')
                );
                const ordered = order.filter((k: string) =>
                    allKeys.includes(k)
                );
                const rest = allKeys.filter((k) => !ordered.includes(k));
                return [...ordered, ...rest];
            }
        } catch {
            /* ignore */
        }
        return Object.keys(meta.properties).filter(
            (k) => !k.startsWith('__')
        );
    }, [meta.properties]);

    /* ---- Helpers ---- */
    const update = useCallback(
        (patch: Partial<FileMeta>) => {
            setSaving(true);
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => setSaving(false), 800);
            updateFile(noteId, patch);
        },
        [noteId, updateFile]
    );

    const addTag = useCallback(
        (tag: string) => {
            const trimmed = tag.trim();
            if (!trimmed) return;
            const current = meta.tags ?? [];
            if (current.includes(trimmed)) return;
            update({ tags: [...current, trimmed] });
            setTagInput('');
            setShowTagDropdown(false);
        },
        [meta.tags, update]
    );

    const removeTag = useCallback(
        (tag: string) => {
            const current = meta.tags ?? [];
            update({ tags: current.filter((t) => t !== tag) });
        },
        [meta.tags, update]
    );

    const updateProperty = useCallback(
        (key: string, value: any) => {
            const props = { ...(meta.properties ?? {}), [key]: value };
            update({ properties: props });
        },
        [meta.properties, update]
    );

    const removeProperty = useCallback(
        (key: string) => {
            const props = { ...(meta.properties ?? {}) };
            delete props[key];
            delete props[`__type_${key}`];
            delete props[`__opts_${key}`];
            try {
                const order: string[] = JSON.parse(
                    props['__order'] || '[]'
                );
                props['__order'] = JSON.stringify(
                    order.filter((k) => k !== key)
                );
            } catch {
                /* ignore */
            }
            update({ properties: props });
        },
        [meta.properties, update]
    );

    const updatePropertyOptions = useCallback(
        (key: string, opts: string[]) => {
            const props = {
                ...(meta.properties ?? {}),
                [`__opts_${key}`]: JSON.stringify(opts),
            };
            update({ properties: props });
        },
        [meta.properties, update]
    );

    const handleAddProperty = () => {
        if (!newPropName.trim()) return;
        const name = newPropName.trim();
        const props = { ...(meta.properties ?? {}) };
        props[`__type_${name}`] = newPropType;
        props[name] = defaultForType(newPropType);
        if (['select', 'multiselect'].includes(newPropType)) {
            props[`__opts_${name}`] = JSON.stringify([
                'Option 1',
                'Option 2',
            ]);
        }
        if (newPropType === 'status') {
            props[`__opts_${name}`] = JSON.stringify(STATUS_PRESETS);
        }
        try {
            const order: string[] = JSON.parse(props['__order'] || '[]');
            order.push(name);
            props['__order'] = JSON.stringify(order);
        } catch {
            props['__order'] = JSON.stringify([name]);
        }
        update({ properties: props });
        setNewPropName('');
        setNewPropType('text');
        setShowAddProp(false);
    };

    const handleRename = (oldKey: string, newKey: string) => {
        if (!newKey.trim() || newKey === oldKey) {
            setRenamingKey(null);
            return;
        }
        const props = { ...(meta.properties ?? {}) };
        props[newKey] = props[oldKey];
        if (props[`__type_${oldKey}`]) {
            props[`__type_${newKey}`] = props[`__type_${oldKey}`];
            delete props[`__type_${oldKey}`];
        }
        if (props[`__opts_${oldKey}`]) {
            props[`__opts_${newKey}`] = props[`__opts_${oldKey}`];
            delete props[`__opts_${oldKey}`];
        }
        delete props[oldKey];
        try {
            const order: string[] = JSON.parse(props['__order'] || '[]');
            props['__order'] = JSON.stringify(
                order.map((k) => (k === oldKey ? newKey : k))
            );
        } catch {
            /* ignore */
        }
        update({ properties: props });
        setRenamingKey(null);
    };

    const handleDuplicate = (key: string) => {
        const props = { ...(meta.properties ?? {}) };
        const newName = `${key} copy`;
        props[newName] = props[key];
        if (props[`__type_${key}`])
            props[`__type_${newName}`] = props[`__type_${key}`];
        if (props[`__opts_${key}`])
            props[`__opts_${newName}`] = props[`__opts_${key}`];
        try {
            const order: string[] = JSON.parse(props['__order'] || '[]');
            const idx = order.indexOf(key);
            if (idx !== -1) order.splice(idx + 1, 0, newName);
            else order.push(newName);
            props['__order'] = JSON.stringify(order);
        } catch {
            /* ignore */
        }
        update({ properties: props });
    };

    const handleChangeType = (key: string, newType: PropType) => {
        const props = { ...(meta.properties ?? {}) };
        props[`__type_${key}`] = newType;
        props[key] = defaultForType(newType);
        if (['select', 'multiselect'].includes(newType)) {
            props[`__opts_${key}`] =
                props[`__opts_${key}`] ||
                JSON.stringify(['Option 1', 'Option 2']);
        }
        if (newType === 'status') {
            props[`__opts_${key}`] =
                props[`__opts_${key}`] || JSON.stringify(STATUS_PRESETS);
        }
        update({ properties: props });
        setChangingTypeKey(null);
    };

    const handleDragEnd = () => {
        if (dragKey && dragOverKey && dragKey !== dragOverKey) {
            const props = { ...(meta.properties ?? {}) };
            const order = [...propOrder];
            const fromIdx = order.indexOf(dragKey);
            const toIdx = order.indexOf(dragOverKey);
            if (fromIdx !== -1 && toIdx !== -1) {
                order.splice(fromIdx, 1);
                order.splice(toIdx, 0, dragKey);
                props['__order'] = JSON.stringify(order);
                update({ properties: props });
            }
        }
        setDragKey(null);
        setDragOverKey(null);
    };

    const getOptions = (key: string): string[] => {
        try {
            return JSON.parse(meta.properties?.[`__opts_${key}`] || '[]');
        } catch {
            return [];
        }
    };

    const isTask = meta.type === 'task';

    /* ---- Render ---- */
    return (
        <div className="w-64 h-full border-l border-zinc-700/50 bg-violet-950/20 flex flex-col shrink-0 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        Properties
                    </span>
                    {saving && (
                        <Loader2
                            size={11}
                            className="text-violet-400 animate-spin"
                        />
                    )}
                </div>
                <button
                    onClick={onClose}
                    className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                >
                    <X size={13} />
                </button>
            </div>

            <div className="p-4 space-y-5 flex-1">
                {/* ---- Subject (autocomplete) ---- */}
                <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                        <Tag size={12} />
                        Subject
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={subjectQuery}
                            onChange={(e) => {
                                setSubjectQuery(e.target.value);
                                setShowSubjectDropdown(true);
                            }}
                            onFocus={() => setShowSubjectDropdown(true)}
                            onBlur={() => {
                                setTimeout(() => {
                                    setShowSubjectDropdown(false);
                                    update({
                                        subject:
                                            subjectQuery.trim() || undefined,
                                    });
                                }, 200);
                            }}
                            placeholder="e.g. Math2411"
                            className={INPUT_CLS}
                        />
                        {showSubjectDropdown &&
                            filteredSubjects.length > 0 && (
                                <div className="absolute z-50 mt-1 w-full bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl max-h-32 overflow-auto">
                                    {filteredSubjects.map((s) => (
                                        <button
                                            key={s}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                setSubjectQuery(s);
                                                update({ subject: s });
                                                setShowSubjectDropdown(false);
                                            }}
                                            className="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-violet-500/10 transition-colors cursor-pointer"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            )}
                    </div>
                </div>

                {/* ---- Tags (freeform autocomplete) ---- */}
                <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                        <Tag size={12} />
                        Tags
                    </label>
                    {(meta.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                            {(meta.tags ?? []).map((tag) => (
                                <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-violet-500/15 text-violet-300 border border-violet-500/20"
                                >
                                    {tag}
                                    <button
                                        onClick={() => removeTag(tag)}
                                        className="hover:text-red-400 transition-colors cursor-pointer"
                                    >
                                        <X size={10} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="relative">
                        <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => {
                                setTagInput(e.target.value);
                                setShowTagDropdown(true);
                            }}
                            onFocus={() => setShowTagDropdown(true)}
                            onBlur={() => {
                                setTimeout(() => setShowTagDropdown(false), 200);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && tagInput.trim()) {
                                    e.preventDefault();
                                    addTag(tagInput);
                                }
                            }}
                            placeholder="Add tag…"
                            className={INPUT_CLS}
                        />
                        {showTagDropdown &&
                            filteredTagSuggestions.length > 0 && (
                                <div className="absolute z-50 mt-1 w-full bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl max-h-32 overflow-auto">
                                    {filteredTagSuggestions.map((t) => (
                                        <button
                                            key={t}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                addTag(t);
                                            }}
                                            className="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-violet-500/10 transition-colors cursor-pointer"
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            )}
                    </div>
                </div>

                {/* ---- Week ---- */}
                <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                        <Hash size={12} />
                        Week
                    </label>
                    <input
                        type="number"
                        min={0}
                        max={52}
                        value={meta.week ?? ''}
                        onChange={(e) =>
                            update({
                                week: e.target.value
                                    ? parseInt(e.target.value)
                                    : undefined,
                            })
                        }
                        placeholder="Week number"
                        className={INPUT_MONO}
                    />
                </div>

                {/* ---- Module ---- */}
                <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                        <BookOpen size={12} />
                        Module
                    </label>
                    <input
                        type="text"
                        value={meta.module ?? ''}
                        onChange={(e) =>
                            update({ module: e.target.value || undefined })
                        }
                        placeholder="e.g. Module 3"
                        className={INPUT_CLS}
                    />
                </div>

                {/* ---- Task-specific fields ---- */}
                {isTask && (
                    <>
                        <div className="pt-2 border-t border-zinc-800/40">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-400/70 mb-3">
                                Task Properties
                            </div>
                        </div>

                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                                <Calendar size={12} />
                                Due Date
                            </label>
                            <input
                                type="date"
                                value={meta.dueDate ?? ''}
                                onChange={(e) =>
                                    update({
                                        dueDate:
                                            e.target.value || undefined,
                                    })
                                }
                                className={INPUT_MONO}
                            />
                        </div>

                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                                <Calendar size={12} />
                                Scheduled
                            </label>
                            <input
                                type="date"
                                value={meta.scheduledDate ?? ''}
                                onChange={(e) =>
                                    update({
                                        scheduledDate:
                                            e.target.value || undefined,
                                    })
                                }
                                className={INPUT_MONO}
                            />
                        </div>

                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                                <Flag size={12} />
                                Priority
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {PRIORITIES.map((p) => (
                                    <button
                                        key={p.value}
                                        onClick={() =>
                                            update({
                                                priority:
                                                    p.value as FileMeta['priority'],
                                            })
                                        }
                                        className={`text-[11px] px-2 py-1 rounded-full font-medium transition-all duration-150 cursor-pointer ${
                                            meta.priority === p.value
                                                ? `${p.class} ring-1 ring-white/20 scale-105`
                                                : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                                <CircleCheck size={12} />
                                Status
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {STATUSES.map((s) => (
                                    <button
                                        key={s.value}
                                        onClick={() =>
                                            update({
                                                status: s.value as FileMeta['status'],
                                            })
                                        }
                                        className={`text-[11px] px-2 py-1 rounded-full font-medium transition-all duration-150 cursor-pointer ${
                                            (meta.status ?? 'todo') ===
                                            s.value
                                                ? `${s.class} ring-1 ring-white/20 scale-105`
                                                : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'
                                        }`}
                                    >
                                        {s.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Someday */}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={meta.isSomeday ?? false}
                                onChange={(e) =>
                                    update({
                                        isSomeday:
                                            e.target.checked || undefined,
                                    })
                                }
                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-violet-500/30"
                            />
                            <span className="text-xs text-zinc-400">
                                Someday / Backlog
                            </span>
                        </label>
                    </>
                )}

                {/* ---- Custom Properties ---- */}
                {propOrder.length > 0 && (
                    <div className="pt-2 border-t border-zinc-800/40">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                            Custom Properties
                        </div>
                        {propOrder.map((key) => {
                            const propType = (meta.properties?.[
                                `__type_${key}`
                            ] ?? 'text') as PropType;
                            const value = meta.properties?.[key];
                            const def = PROP_DEFS.find(
                                (d) => d.value === propType
                            );
                            const Icon = def?.icon ?? Type;

                            return (
                                <div
                                    key={key}
                                    className={`mb-3 rounded-md transition-colors ${
                                        dragOverKey === key
                                            ? 'border-t-2 border-violet-500'
                                            : ''
                                    }`}
                                    draggable
                                    onDragStart={() => setDragKey(key)}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setDragOverKey(key);
                                    }}
                                    onDragEnd={handleDragEnd}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setCtxMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            key,
                                        });
                                    }}
                                >
                                    <div className="flex items-center justify-between mb-1 group">
                                        <div className="flex items-center gap-1.5">
                                            <GripVertical
                                                size={10}
                                                className="text-zinc-700 opacity-0 group-hover:opacity-100 cursor-grab transition-opacity"
                                            />
                                            <Icon
                                                size={11}
                                                className="text-zinc-600"
                                            />
                                            {renamingKey === key ? (
                                                <input
                                                    value={renameVal}
                                                    onChange={(e) =>
                                                        setRenameVal(
                                                            e.target.value
                                                        )
                                                    }
                                                    onBlur={() =>
                                                        handleRename(
                                                            key,
                                                            renameVal
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter')
                                                            handleRename(
                                                                key,
                                                                renameVal
                                                            );
                                                        if (
                                                            e.key === 'Escape'
                                                        )
                                                            setRenamingKey(
                                                                null
                                                            );
                                                    }}
                                                    className="text-[11px] font-semibold uppercase tracking-wider bg-transparent border-b border-violet-500 outline-none text-zinc-300 w-20"
                                                    autoFocus
                                                />
                                            ) : (
                                                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                                                    {key}
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() =>
                                                removeProperty(key)
                                            }
                                            className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>

                                    {changingTypeKey === key ? (
                                        <div className="grid grid-cols-2 gap-1 p-2 bg-zinc-900/50 rounded-lg border border-zinc-800/40 mb-2">
                                            {PROP_DEFS.filter(
                                                (d) => !d.readonly
                                            ).map((d) => (
                                                <button
                                                    key={d.value}
                                                    onClick={() =>
                                                        handleChangeType(
                                                            key,
                                                            d.value
                                                        )
                                                    }
                                                    className={`text-[10px] px-2 py-1 rounded text-left flex items-center gap-1.5 cursor-pointer transition-colors ${
                                                        propType ===
                                                        d.value
                                                            ? 'bg-violet-500/20 text-violet-300'
                                                            : 'text-zinc-400 hover:bg-zinc-800'
                                                    }`}
                                                >
                                                    <d.icon size={10} />{' '}
                                                    {d.label}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <PropertyField
                                            propKey={key}
                                            value={value}
                                            type={propType}
                                            options={getOptions(key)}
                                            onChange={(v) =>
                                                updateProperty(key, v)
                                            }
                                            onOptionsChange={(opts) =>
                                                updatePropertyOptions(
                                                    key,
                                                    opts
                                                )
                                            }
                                            files={files}
                                            allProps={
                                                meta.properties ?? {}
                                            }
                                            meta={meta}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ---- Add Property ---- */}
                {!showAddProp ? (
                    <button
                        onClick={() => setShowAddProp(true)}
                        className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-violet-400 transition-colors cursor-pointer"
                    >
                        <Plus size={12} />
                        Add property
                    </button>
                ) : (
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800/40 space-y-2">
                        <input
                            type="text"
                            value={newPropName}
                            onChange={(e) => setNewPropName(e.target.value)}
                            placeholder="Property name"
                            className={INPUT_CLS + ' text-xs py-1'}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddProperty();
                                if (e.key === 'Escape')
                                    setShowAddProp(false);
                            }}
                        />
                        <div className="grid grid-cols-2 gap-1 max-h-44 overflow-auto">
                            {PROP_DEFS.map((d) => (
                                <button
                                    key={d.value}
                                    onClick={() => setNewPropType(d.value)}
                                    className={`text-[10px] px-2 py-1.5 rounded text-left flex items-center gap-1.5 cursor-pointer transition-colors ${
                                        newPropType === d.value
                                            ? 'bg-violet-500/20 text-violet-300'
                                            : 'text-zinc-400 hover:bg-zinc-800'
                                    }`}
                                >
                                    <d.icon size={10} />
                                    {d.label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5">
                            <button
                                onClick={handleAddProperty}
                                className="flex-1 text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg py-1 transition-colors cursor-pointer"
                            >
                                Add
                            </button>
                            <button
                                onClick={() => setShowAddProp(false)}
                                className="flex-1 text-[11px] font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-lg py-1 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Context menu */}
            {ctxMenu && (
                <PropertyContextMenu
                    x={ctxMenu.x}
                    y={ctxMenu.y}
                    onRename={() => {
                        setRenamingKey(ctxMenu.key);
                        setRenameVal(ctxMenu.key);
                        setCtxMenu(null);
                    }}
                    onChangeType={() => {
                        setChangingTypeKey(ctxMenu.key);
                        setCtxMenu(null);
                    }}
                    onDuplicate={() => {
                        handleDuplicate(ctxMenu.key);
                        setCtxMenu(null);
                    }}
                    onDelete={() => {
                        removeProperty(ctxMenu.key);
                        setCtxMenu(null);
                    }}
                    onClose={() => setCtxMenu(null)}
                />
            )}
        </div>
    );
}
