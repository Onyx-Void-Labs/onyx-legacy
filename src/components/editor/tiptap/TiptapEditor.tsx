import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

// Tiptap
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import ImageExt from '@tiptap/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Youtube from '@tiptap/extension-youtube';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import TextAlign from '@tiptap/extension-text-align';
import UnderlineExt from '@tiptap/extension-underline';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Link from '@tiptap/extension-link';
import Typography from '@tiptap/extension-typography';
import Dropcursor from '@tiptap/extension-dropcursor';
import SubscriptExt from '@tiptap/extension-subscript';
import SuperscriptExt from '@tiptap/extension-superscript';

// Syntax highlighting
import { common, createLowlight } from 'lowlight';

// Yjs
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { invoke } from '@tauri-apps/api/core';

// Custom extensions
import { CalloutNode } from './extensions/CalloutNode';
import { MathBlockNode } from './extensions/MathBlockNode';
import { MarkdownShortcuts } from './extensions/MarkdownShortcuts';
import { DragHandle } from './extensions/DragHandle';
import { SlashCommands } from './extensions/SlashCommands';
import { SearchReplace } from './extensions/SearchReplace';
import { NoteLink } from './extensions/NoteLink';
import { QueryBlock } from './extensions/QueryBlock';
import { FontSize } from './extensions/FontSize';
import { BlockId } from './extensions/BlockId';
import { RecallMark } from './extensions/RecallMark';
import { SmartMathExtension } from './extensions/SmartMathExtension';

// Painter
import PainterPalette from './PainterPalette';
import SmartMathPopup from './SmartMathPopup';
import SlidesView from '../SlidesView';
import RecallBar from '../RecallBar';
import TeachBackView from '../TeachBackView';
import SessionBar from '../SessionBar';
import TranscriptionPanel from '../TranscriptionPanel';
import { usePainterStore } from '@/store/painterStore';
import { useFeature } from '@/hooks/useFeature';
import { extractKeyTerms } from '@/lib/painter/autoPaint';
import type { PaintAnnotation } from '@/lib/painter/paintTypes';

// UI Components
import { Toolbar } from './Toolbar';
import { BubbleMenuComponent } from './BubbleMenu';
import { SlashMenu } from './SlashMenu';
import { TiptapFindWidget } from './TiptapFindWidget';
import { NoteLinkSuggestion } from './NoteLinkSuggestion';
import BacklinksPanel from '../BacklinksPanel';
import VersionHistoryPanel from '../VersionHistoryPanel';
import PropertyPills from '../PropertyPills';
import { getTemplate, TEMPLATE_LIST } from '../../../lib/templates';
import type { FileMeta, TemplateType } from '../../../types/sync';

// Contexts
import { useSync } from '../../../contexts/SyncContext';
import { useSettings } from '../../../contexts/SettingsContext';

const lowlight = createLowlight(common);

interface TiptapEditorProps {
    activeNoteId: string | null;
    meta?: FileMeta;
    onOpenProperties?: () => void;
}

/**
 * Serialises a Yjs doc's XML Fragment into a JSON string compatible with
 * the existing Rust E2EE save_note/load_note pipeline.
 * We store Tiptap JSON as { version: 2, tiptap: <editorJSON> }.
 */
function serialiseTiptapDoc(ydoc: Y.Doc): string {
    // We can't easily get Tiptap JSON from the raw Yjs doc without an editor instance.
    // Instead, we store a marker that the content is in Yjs format.
    // The actual content lives in the Yjs XmlFragment synced via Collaboration.
    // For E2EE backup compatibility, we serialize the Yjs state as base64.
    const state = Y.encodeStateAsUpdate(ydoc);
    const base64 = btoa(String.fromCharCode(...state));
    return JSON.stringify({ version: 2, yjs: base64 });
}

/**
 * Loads content into a Yjs doc from the saved JSON string.
 */
function loadIntoYjsDoc(ydoc: Y.Doc, json: string): boolean {
    try {
        const parsed = JSON.parse(json);

        if (parsed.version === 2 && parsed.yjs) {
            // Tiptap Yjs format — apply the state update
            const binary = Uint8Array.from(atob(parsed.yjs), (c) => c.charCodeAt(0));
            Y.applyUpdate(ydoc, binary);
            return true;
        }

        if (parsed.version === 1 && parsed.blocks) {
            // Legacy BlockDocument format — convert blocks to Tiptap content
            const fragment = ydoc.getXmlFragment('default');
            if (fragment.length === 0) {
                // Convert old blocks to basic paragraphs in the Yjs XML Fragment
                // This is a one-way migration: old block content becomes Tiptap paragraphs
                const xmlEl = new Y.XmlElement('paragraph');
                const text = new Y.XmlText();
                const allText = parsed.blocks
                    .map((b: { content: string }) => b.content || '')
                    .join('\n\n');
                text.insert(0, allText);
                xmlEl.insert(0, [text]);
                fragment.insert(0, [xmlEl]);
            }
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

/* ─── Table Context Menu ──────────────────────────────────── */

interface TableCtxProps {
    x: number;
    y: number;
    editor: any;
    onClose: () => void;
}

function TableContextMenu({ x, y, editor, onClose }: TableCtxProps) {
    useEffect(() => {
        const handler = () => onClose();
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [onClose]);

    const run = (cmd: string) => {
        (editor.chain().focus() as any)[cmd]().run();
        onClose();
    };

    const items: { label: string; action: () => void; danger?: boolean; divider?: boolean }[] = [
        { label: 'Insert row above', action: () => run('addRowBefore') },
        { label: 'Insert row below', action: () => run('addRowAfter') },
        { label: 'Insert column left', action: () => run('addColumnBefore') },
        { label: 'Insert column right', action: () => run('addColumnAfter') },
        { label: '', action: () => {}, divider: true },
        { label: 'Toggle header row', action: () => run('toggleHeaderRow') },
        { label: 'Toggle header column', action: () => run('toggleHeaderColumn') },
        { label: '', action: () => {}, divider: true },
        { label: 'Merge cells', action: () => run('mergeCells') },
        { label: 'Split cell', action: () => run('splitCell') },
        { label: '', action: () => {}, divider: true },
        { label: 'Delete row', action: () => run('deleteRow'), danger: true },
        { label: 'Delete column', action: () => run('deleteColumn'), danger: true },
        { label: 'Delete table', action: () => run('deleteTable'), danger: true },
    ];

    return createPortal(
        <div
            style={{ position: 'fixed', left: x, top: y, zIndex: 99999 }}
            className="min-w-44 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1"
        >
            {items.map((it, i) =>
                it.divider ? (
                    <div key={i} className="h-px bg-zinc-800 my-1" />
                ) : (
                    <button
                        key={it.label}
                        onClick={(e) => { e.stopPropagation(); it.action(); }}
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                            it.danger
                                ? 'text-red-400 hover:bg-red-500/10'
                                : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                    >
                        {it.label}
                    </button>
                )
            )}
        </div>,
        document.body
    );
}

/* ─── Image Insert Dialog ─────────────────────────────────── */

function ImageInsertDialog({ onInsert, onClose }: { onInsert: (url: string) => void; onClose: () => void }) {
    const [url, setUrl] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    const handleFileSelect = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const file = await open({
                multiple: false,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
            });
            if (file) {
                // Convert local file path to a Tauri asset URL
                const { convertFileSrc } = await import('@tauri-apps/api/core');
                const assetUrl = convertFileSrc(file as string);
                onInsert(assetUrl);
            }
        } catch {
            // Tauri dialog not available (web mode) — ignore
            console.warn('[ImageInsert] File dialog not available');
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.result) onInsert(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = () => {
        const trimmed = url.trim();
        if (trimmed) onInsert(trimmed);
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 99999, background: 'rgba(0,0,0,0.4)' }}>
            <div
                ref={dialogRef}
                className="bg-zinc-900 border border-zinc-700/50 rounded-2xl p-5 shadow-2xl shadow-black/60 animate-fade-in-up"
                style={{ width: 400 }}
            >
                <div className="text-sm font-medium text-zinc-200 mb-3">Insert Image</div>

                {/* URL input */}
                <div className="flex items-center gap-2 mb-3">
                    <input
                        ref={inputRef}
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubmit();
                        }}
                        placeholder="Paste image URL..."
                        className="flex-1 bg-zinc-800 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-zinc-700/60 focus:border-violet-500 font-mono placeholder-zinc-600"
                    />
                    <button
                        onMouseDown={(e) => { e.preventDefault(); handleSubmit(); }}
                        className="px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer"
                    >
                        Insert
                    </button>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 h-px bg-zinc-700/40" />
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">or</span>
                    <div className="flex-1 h-px bg-zinc-700/40" />
                </div>

                {/* Drop zone / File picker */}
                <div
                    onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={handleFileSelect}
                    className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-6 transition-all cursor-pointer ${
                        dragActive
                            ? 'border-violet-500 bg-violet-500/10'
                            : 'border-zinc-700/40 hover:border-zinc-600 bg-zinc-800/30'
                    }`}
                >
                    <svg className="w-8 h-8 text-zinc-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-xs text-zinc-400">Drop image here or <span className="text-violet-400 underline">browse files</span></span>
                </div>

                {/* Cancel */}
                <button
                    onMouseDown={(e) => { e.preventDefault(); onClose(); }}
                    className="w-full mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-center py-1 cursor-pointer"
                >
                    Cancel · Esc
                </button>
            </div>
        </div>
    );
}

/* ─── Video Insert Dialog ────────────────────────────────── */

function VideoInsertDialog({ onInsert, onClose }: { onInsert: (url: string) => void; onClose: () => void }) {
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [shake, setShake] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    const parseVideoUrl = (rawUrl: string): string | null => {
        const trimmed = rawUrl.trim();
        // YouTube
        const ytMatch = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
        if (ytMatch) return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`;
        // Vimeo
        const vimeoMatch = trimmed.match(/vimeo\.com\/(\d+)/);
        if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
        // Loom
        const loomMatch = trimmed.match(/loom\.com\/share\/([\w-]+)/);
        if (loomMatch) return `https://www.loom.com/embed/${loomMatch[1]}`;
        return null;
    };

    const handleSubmit = () => {
        const embedUrl = parseVideoUrl(url);
        if (embedUrl) {
            setError('');
            onInsert(embedUrl);
        } else {
            setError("Couldn't recognise that URL");
            setShake(true);
            setTimeout(() => setShake(false), 500);
        }
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 99999, background: 'rgba(0,0,0,0.4)' }}>
            <div
                ref={dialogRef}
                className={`bg-zinc-900 border border-zinc-700/50 rounded-2xl p-5 shadow-2xl shadow-black/60 animate-fade-in-up ${shake ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}
                style={{ width: 420 }}
            >
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🎬</span>
                    <span className="text-sm font-medium text-zinc-200">Embed Video</span>
                </div>
                <p className="text-[11px] text-zinc-500 mb-4">Supported: YouTube, Vimeo, Loom</p>

                <div className="flex items-center gap-2 mb-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={url}
                        onChange={(e) => { setUrl(e.target.value); setError(''); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubmit();
                        }}
                        placeholder="Paste video URL..."
                        className="flex-1 bg-zinc-800 text-sm text-zinc-200 rounded-lg px-3 py-2 outline-none border border-zinc-700/60 focus:border-violet-500 font-mono placeholder-zinc-600"
                    />
                    <button
                        onMouseDown={(e) => { e.preventDefault(); handleSubmit(); }}
                        className="px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-500 text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                        Embed →
                    </button>
                </div>

                {error && (
                    <p className="text-xs text-red-400 mt-1">{error}</p>
                )}

                <button
                    onMouseDown={(e) => { e.preventDefault(); onClose(); }}
                    className="w-full mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-center py-1 cursor-pointer"
                >
                    Cancel · Esc
                </button>
            </div>
        </div>
    );
}

export default function TiptapEditor({ activeNoteId, meta, onOpenProperties }: TiptapEditorProps) {
    const { updateFile } = useSync();
    const settings = useSettings();

    // Demo mode
    const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
    const finalFontFamily = isDemo
        ? "'DM Sans', Inter, system-ui, sans-serif"
        : settings.editorFontFamily === 'System'
            ? 'system-ui'
            : settings.editorFontFamily;

    // UI state
    const [title, setTitle] = useState('');
    const [zoom, setZoom] = useState(1);
    const [ready, setReady] = useState(false);
    const [showFind, setShowFind] = useState(false);
    const [showImageInsert, setShowImageInsert] = useState(false);
    const [showVideoInsert, setShowVideoInsert] = useState(false);
    const [tableCtx, setTableCtx] = useState<{ x: number; y: number } | null>(null);
    const [showTemplates, setShowTemplates] = useState(true);

    // Yjs refs
    const yDocRef = useRef<Y.Doc | null>(null);
    const providerRef = useRef<HocuspocusProvider | null>(null);
    const persistenceRef = useRef<IndexeddbPersistence | null>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const titleRef = useRef<HTMLInputElement>(null);

    // Create Yjs doc and persistence for the active note
    const yDoc = useMemo(() => {
        if (!activeNoteId) return null;
        const doc = new Y.Doc();
        return doc;
    }, [activeNoteId]);

    // Tiptap editor instance
    const editor = useEditor(
        {
            extensions: [
                StarterKit.configure({
                    undoRedo: false, // Yjs handles undo/redo
                    codeBlock: false, // Use lowlight version instead
                    dropcursor: false, // Use custom dropcursor
                    link: false, // Use custom link config
                    underline: false, // We use the separate UnderlineExt import
                    heading: {
                        levels: [1, 2, 3, 4, 5, 6],
                    },
                    // BUG 7 + 8: Set bold mark with lower priority so it doesn't
                    // conflict with TextStyle / Color marks, and works inside headings
                    bold: {
                        HTMLAttributes: {},
                    },
                    italic: {
                        HTMLAttributes: {},
                    },
                }),
                Placeholder.configure({
                    placeholder: ({ node }) => {
                        if (node.type.name === 'heading') {
                            return `Heading ${node.attrs.level}`;
                        }
                        return "Type '/' for commands...";
                    },
                    showOnlyWhenEditable: true,
                    showOnlyCurrent: true,
                }),
                // Collaboration via Yjs
                ...(yDoc
                    ? [
                        Collaboration.configure({
                            document: yDoc,
                        }),
                    ]
                    : []),
                // Formatting
                Highlight.configure({ multicolor: true }),
                UnderlineExt,
                SubscriptExt,
                SuperscriptExt,
                // BUG 8: TextStyle must have lower priority than bold (default 1000)
                // so bold toggles work even when a color/font is applied
                TextStyle.configure({
                    mergeNestedSpanStyles: true,
                }),
                FontFamily,
                FontSize,
                Color,
                Link.configure({
                    openOnClick: false,
                    linkOnPaste: true,
                    HTMLAttributes: {
                        class: 'text-violet-400 underline decoration-violet-400/30 hover:decoration-violet-400 cursor-pointer',
                    },
                }),
                TextAlign.configure({
                    types: ['heading', 'paragraph'],
                }),
                Typography,
                Dropcursor.configure({
                    color: '#7c6ef7',
                    width: 2,
                }),
                // Lists
                TaskList.configure({
                    HTMLAttributes: {
                        class: 'onyx-task-list',
                    },
                }),
                TaskItem.configure({
                    nested: true,
                }),
                // Code
                CodeBlockLowlight.configure({
                    lowlight,
                    HTMLAttributes: {
                        class: 'onyx-code-block',
                    },
                }),
                // Tables
                Table.configure({
                    resizable: true,
                    HTMLAttributes: {
                        class: 'onyx-table',
                    },
                }),
                TableRow,
                TableHeader,
                TableCell,
                // Media
                ImageExt.configure({
                    allowBase64: true,
                    inline: false,
                    HTMLAttributes: {
                        class: 'onyx-image',
                    },
                }),
                Youtube.configure({
                    HTMLAttributes: {
                        class: 'onyx-youtube',
                    },
                    inline: false,
                }),
                // Custom nodes
                CalloutNode,
                MathBlockNode,
                NoteLink,
                QueryBlock,
                // Custom extensions
                MarkdownShortcuts,
                DragHandle,
                SlashCommands,
                SearchReplace,
                // Phase 9 extensions
                BlockId,
                RecallMark,
                SmartMathExtension,
            ],
            editorProps: {
                attributes: {
                    class: 'onyx-tiptap-content outline-none',
                    spellcheck: settings.spellcheck ? 'true' : 'false',
                },
            },
            // Autofocus at end
            autofocus: 'end',
        },
        [activeNoteId, yDoc, ready]
    );

    // Painter mode state
    const painterActive = usePainterStore((s) => s.isActive);
    const painterEnabled = useFeature('painter');
    const transcriptionEnabled = useFeature('transcription');
    const [showTranscription, setShowTranscription] = useState(false);

    // Listen for transcription toggle event from Toolbar
    useEffect(() => {
        const handler = () => setShowTranscription((v) => !v);
        window.addEventListener('onyx:toggle-transcription', handler);
        return () => window.removeEventListener('onyx:toggle-transcription', handler);
    }, []);

    // Painter: auto-paint callback
    const handleAutoPaint = useCallback(() => {
        if (!editor || !yDocRef.current) return;
        const text = editor.getText();
        const terms = extractKeyTerms(text);
        if (terms.length === 0) return;

        const paintMap = yDocRef.current.getMap<PaintAnnotation>('paint_annotations');
        const activePaintType = usePainterStore.getState().activePaintType;

        terms.forEach((term) => {
            const id = `auto-${term.text.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
            paintMap.set(id, {
                type: activePaintType,
                groupId: id,
            });
        });
    }, [editor]);

    // All hooks must be called before any conditional return
    const handleTitleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newTitle = e.target.value;
            setTitle(newTitle);

            if (activeNoteId && yDocRef.current) {
                yDocRef.current.getMap('meta').set('title', newTitle);
                updateFile(activeNoteId, { title: newTitle });
            }
        },
        [activeNoteId, updateFile]
    );

    const handleTitleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                editor?.commands.focus('start');
            }
        },
        [editor]
    );

    const handleInsertTemplate = useCallback(
        (type: TemplateType) => {
            if (!editor) return;
            const content = getTemplate(type);
            editor.commands.setContent(content);
            setShowTemplates(false);
        },
        [editor]
    );

    // Setup Yjs infrastructure
    useEffect(() => {
        if (!activeNoteId || !yDoc) {
            setTitle('');
            setReady(false);
            return;
        }

        yDocRef.current = yDoc;

        // IndexedDB persistence
        const persistence = new IndexeddbPersistence(`onyx-note-${activeNoteId}`, yDoc);
        persistenceRef.current = persistence;

        persistence.on('synced', async () => {
            // Try to load from Rust E2EE storage if Yjs doc is empty
            const fragment = yDoc.getXmlFragment('default');
            if (fragment.length === 0) {
                try {
                    const result = await invoke<{ content: string }>('load_note', { id: activeNoteId });
                    const content = result?.content ?? '';
                    if (content.trim().length > 0) {
                        loadIntoYjsDoc(yDoc, content);
                    }
                } catch {
                    // Rust E2EE not active — that's fine, offline mode
                    console.warn('[TiptapEditor] load_note unavailable, offline mode');
                }
            }
            setReady(true);
        });

        // Title binding via Yjs meta map
        const metaMap = yDoc.getMap('meta');
        const updateTitleFromMap = () => {
            const newTitle = metaMap.get('title') as string;
            if (newTitle !== undefined) {
                setTitle(newTitle || '');
            }
        };
        metaMap.observe(updateTitleFromMap);
        updateTitleFromMap();

        // WebSocket provider for real-time sync
        const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:1234';

        import('../../../lib/pocketbase').then(async ({ pb }) => {
            if (!pb.authStore.isValid) return;

            const token = pb.authStore.token;
            const userId = pb.authStore.model?.id;
            if (!token || !userId) return;

            const roomName = `user-${userId}-note-${activeNoteId}`;
            const provider = new HocuspocusProvider({
                url: wsUrl,
                name: roomName,
                document: yDoc,
                token: token,
                onStatus: ({ status }) => {
                    console.log('[TiptapEditor] Provider Status:', status);
                },
            });
            providerRef.current = provider;

            // Set awareness for collaboration cursors
            const userColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
            const userName = pb.authStore.model?.email?.split('@')[0] || 'User';
            if (provider.awareness) {
                provider.awareness.setLocalStateField('user', {
                    name: userName,
                    color: userColor,
                });
            }
        });

        // Debounced save to Rust E2EE
        const saveObserver = () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(async () => {
                try {
                    const json = serialiseTiptapDoc(yDoc);
                    await invoke('save_note', { id: activeNoteId, content: json });
                } catch {
                    // Rust not available
                }
            }, 500);
        };

        yDoc.on('update', saveObserver);

        return () => {
            console.log('[TiptapEditor] Cleaning up for note:', activeNoteId);
            yDoc.off('update', saveObserver);
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            if (providerRef.current) {
                providerRef.current.destroy();
                providerRef.current = null;
            }
            persistence.destroy();
            persistenceRef.current = null;
            yDoc.destroy();
            yDocRef.current = null;
        };
    }, [activeNoteId, yDoc]);

    // Zoom handler
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                setZoom((prev) => Math.max(0.5, Math.min(2, prev + (e.deltaY > 0 ? -0.1 : 0.1))));
            }
        };
        window.addEventListener('wheel', handleWheel, { passive: false });
        return () => window.removeEventListener('wheel', handleWheel);
    }, []);

    // Global find (Ctrl+F)
    useEffect(() => {
        const handleFind = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setShowFind(true);
            }
        };
        window.addEventListener('keydown', handleFind);
        return () => window.removeEventListener('keydown', handleFind);
    }, []);

    // Image insert event (from toolbar / slash command)
    useEffect(() => {
        const handleInsertImage = () => setShowImageInsert(true);
        window.addEventListener('onyx:insert-image', handleInsertImage);
        return () => window.removeEventListener('onyx:insert-image', handleInsertImage);
    }, []);

    // Video insert event (from toolbar / slash command)
    useEffect(() => {
        const handleInsertVideo = () => setShowVideoInsert(true);
        window.addEventListener('onyx:insert-video', handleInsertVideo);
        return () => window.removeEventListener('onyx:insert-video', handleInsertVideo);
    }, []);

    // ─── Empty State ─────────────────────────────────────────────
    if (!activeNoteId) {
        return (
            <div className="flex-1 flex items-center justify-center text-zinc-500 select-none" style={{ background: 'var(--onyx-editor)' }}>
                <div className="text-center space-y-3">
                    <div className="text-3xl font-bold tracking-tight text-zinc-100">
                        ONYX<span className="text-violet-400">.</span>
                    </div>
                    <p className="text-sm text-zinc-400">Select a page from the sidebar, or create a new one.</p>
                </div>
            </div>
        );
    }

    if (!ready || !editor) {
        return (
            <div className="flex-1 flex items-center justify-center text-zinc-500 select-none" style={{ background: 'var(--onyx-editor)' }}>
                <div className="animate-pulse">Loading...</div>
            </div>
        );
    }

    // Check if editor is empty for template display
    const isEditorEmpty = editor?.isEmpty ?? true;

    return (
        <div className="flex flex-col h-full relative tiptap-editor-wrapper" style={{ background: 'var(--onyx-editor)' }}>
            {/* Toolbar */}
            <Toolbar editor={editor} />

            {/* Session Timer Bar — below toolbar */}
            <SessionBar />

            {/* Painter Palette — floating overlay when painter mode active */}
            {painterEnabled && painterActive && (
                <PainterPalette onAutoPaint={handleAutoPaint} />
            )}

            {/* Find/Replace Widget */}
            {showFind && (
                <TiptapFindWidget
                    editor={editor}
                    onClose={() => setShowFind(false)}
                />
            )}

            {/* Image Insert Dialog (portal) */}
            {showImageInsert && createPortal(
                <ImageInsertDialog
                    onInsert={(url) => {
                        editor.chain().focus().setImage({ src: url }).run();
                        setShowImageInsert(false);
                    }}
                    onClose={() => setShowImageInsert(false)}
                />,
                document.body,
            )}

            {/* Video Insert Dialog (portal) */}
            {showVideoInsert && createPortal(
                <VideoInsertDialog
                    onInsert={(embedUrl) => {
                        editor.chain().focus().setYoutubeVideo({ src: embedUrl }).run();
                        setShowVideoInsert(false);
                    }}
                    onClose={() => setShowVideoInsert(false)}
                />,
                document.body,
            )}

            {/* Title Input */}
            <div className="px-12 pt-8 pb-4 shrink-0 w-full" style={{ zoom }}>
                <input
                    ref={titleRef}
                    type="text"
                    value={title}
                    onChange={handleTitleChange}
                    onKeyDown={handleTitleKeyDown}
                    placeholder="Untitled"
                    className="w-full bg-transparent font-bold text-zinc-100 placeholder-zinc-700 outline-none border-none p-0 pb-2 leading-normal"
                    style={{
                        fontFamily: finalFontFamily,
                        fontSize: '2.5rem',
                        fontWeight: 700,
                    }}
                />

                {/* Property Pills — below title, subtle grey pills */}
                {meta && (
                    <div className="mt-1">
                        <PropertyPills meta={meta} onClick={onOpenProperties} />
                    </div>
                )}
            </div>

            {/* Editor Content */}
            <div
                className="flex-1 overflow-auto focus:outline-none scroll-smooth pb-32"
                onContextMenu={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest('td') || target.closest('th')) {
                        e.preventDefault();
                        setTableCtx({ x: e.clientX, y: e.clientY });
                    }
                }}
            >
                <div
                    className="w-full px-12 relative"
                    style={{
                        zoom,
                        fontFamily: finalFontFamily,
                        fontSize: `${settings.fontSize}px`,
                        lineHeight: settings.lineHeight,
                    }}
                >
                    <EditorContent editor={editor} />

                    {/* Template chooser — shown when note is empty */}
                    {isEditorEmpty && showTemplates && (
                        <div className="mt-6 pt-4 border-t border-zinc-800/40">
                            <p className="text-xs text-zinc-600 mb-3 text-center">
                                — or start from a template —
                            </p>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {TEMPLATE_LIST.map((t) => (
                                    <button
                                        key={t.type}
                                        onClick={() => handleInsertTemplate(t.type)}
                                        className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-300 rounded-lg border border-zinc-700/40 hover:border-violet-500/30 hover:bg-violet-500/8 transition-all cursor-pointer"
                                    >
                                        <span>{t.icon}</span>
                                        <span>{t.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Bubble Menu */}
                    <BubbleMenuComponent editor={editor} />

                    {/* Slash Command Menu */}
                    <SlashMenu editor={editor} />

                    {/* Smart Math Popup — backslash autocomplete inside math blocks */}
                    <SmartMathPopup editor={editor} />

                    {/* Note Link Suggestion Menu */}
                    <NoteLinkSuggestion editor={editor} />
                </div>

                {/* Backlinks Panel — below editor, outside TipTap content */}
                {activeNoteId && (
                    <BacklinksPanel
                        currentNoteId={activeNoteId}
                        onOpenNote={(id) => {
                            window.dispatchEvent(new CustomEvent('onyx:open-note', { detail: { noteId: id } }));
                        }}
                    />
                )}

                {/* Version History Panel — below backlinks */}
                {activeNoteId && (
                    <VersionHistoryPanel
                        noteId={activeNoteId}
                        getDocState={() => {
                            if (!yDocRef.current) return null;
                            return Y.encodeStateAsUpdate(yDocRef.current);
                        }}
                        getDocPreview={() => {
                            if (!editor) return '';
                            return editor.getText().slice(0, 200);
                        }}
                        getWordCount={() => {
                            if (!editor) return 0;
                            const text = editor.getText();
                            return text.trim() ? text.trim().split(/\s+/).length : 0;
                        }}
                        onRestore={(state) => {
                            if (!yDocRef.current) return;
                            const doc = yDocRef.current;
                            doc.transact(() => {
                                const fragment = doc.getXmlFragment('default');
                                fragment.delete(0, fragment.length);
                            });
                            Y.applyUpdate(doc, state);
                        }}
                    />
                )}
            </div>

            {/* Table context menu */}
            {tableCtx && editor && (
                <TableContextMenu
                    x={tableCtx.x}
                    y={tableCtx.y}
                    editor={editor}
                    onClose={() => setTableCtx(null)}
                />
            )}

            {/* Slides presentation overlay */}
            <SlidesView />

            {/* Recall Mode bar */}
            <RecallBar />

            {/* Teach-Back Mode overlay */}
            <TeachBackView />

            {/* Transcription Side Panel */}
            {transcriptionEnabled && showTranscription && (
                <div className="absolute right-0 top-0 bottom-0 w-80 z-30 border-l border-zinc-800/60 bg-(--onyx-bg)">
                    <TranscriptionPanel
                        onInsertText={(text) => {
                            if (editor) {
                                editor.chain().focus().insertContent(text).run();
                                setShowTranscription(false);
                            }
                        }}
                    />
                </div>
            )}
        </div>
    );
}
