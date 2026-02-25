/**
 * Editor.tsx — Thin wrapper that delegates to the new Tiptap editor.
 * The old CodeMirror-based block editor is preserved in the `extensions/` and
 * sibling files for reference but is no longer rendered.
 */
import TiptapEditor from './tiptap/TiptapEditor';
import './tiptap/tiptap.css';

interface EditorProps {
    activeNoteId: string | null;
}

export default function Editor({ activeNoteId }: EditorProps) {
    return <TiptapEditor activeNoteId={activeNoteId} />;
}
