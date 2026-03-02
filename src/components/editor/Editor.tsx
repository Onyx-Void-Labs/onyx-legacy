/**
 * Editor.tsx — Thin wrapper that delegates to the new Tiptap editor.
 * The old CodeMirror-based block editor is preserved in the `extensions/` and
 * sibling files for reference but is no longer rendered.
 */
import TiptapEditor from './tiptap/TiptapEditor';
import './tiptap/tiptap.css';
import type { FileMeta } from '../../types/sync';

interface EditorProps {
    activeNoteId: string | null;
    meta?: FileMeta;
    onOpenProperties?: () => void;
}

export default function Editor({ activeNoteId, meta, onOpenProperties }: EditorProps) {
    return <TiptapEditor activeNoteId={activeNoteId} meta={meta} onOpenProperties={onOpenProperties} />;
}
