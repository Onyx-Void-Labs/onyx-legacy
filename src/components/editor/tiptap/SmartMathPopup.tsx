/**
 * SmartMathPopup.tsx — Backslash autocomplete popup for math symbols.
 * Listens for 'onyx:smart-math-trigger' event emitted by SmartMathExtension.
 * Shows a searchable list of math symbols; selecting one inserts the LaTeX command.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { MATH_SYMBOLS, type MathSymbol } from '@/data/mathSymbols';
import type { Editor } from '@tiptap/core';

interface SmartMathPopupProps {
  editor: Editor | null;
}

export default function SmartMathPopup({ editor }: SmartMathPopupProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerFrom, setTriggerFrom] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Listen for the backslash trigger
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPosition({ x: detail.x, y: detail.y });
      setTriggerFrom(detail.from);
      setSearch('');
      setSelectedIndex(0);
      setVisible(true);
      setTimeout(() => inputRef.current?.focus(), 20);
    };
    window.addEventListener('onyx:smart-math-trigger', handler);
    return () => window.removeEventListener('onyx:smart-math-trigger', handler);
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setVisible(false);
      }
    };
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.smart-math-popup')) {
        setVisible(false);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    document.addEventListener('mousedown', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [visible]);

  // Filtered symbols
  const filtered = useMemo(() => {
    if (!search) return MATH_SYMBOLS.slice(0, 20);
    const s = search.toLowerCase();
    return MATH_SYMBOLS.filter(
      (sym) =>
        sym.name.toLowerCase().includes(s) ||
        sym.cmd.toLowerCase().includes(s) ||
        sym.keywords.toLowerCase().includes(s) ||
        (sym.trigger && sym.trigger.toLowerCase().includes(s))
    ).slice(0, 20);
  }, [search]);

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Scroll item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const insertSymbol = useCallback(
    (sym: MathSymbol) => {
      if (!editor) return;
      // Delete the `\` that was typed, and insert the command + space
      const state = editor.state;
      const tr = state.tr;

      // Find and remove the backslash + any typed search chars
      // The backslash was typed at triggerFrom, the cursor now follows
      const cursorPos = state.selection.from;
      const deleteFrom = triggerFrom; // position where `\` was typed
      const deleteTo = cursorPos; // everything typed after

      if (deleteFrom < deleteTo && deleteFrom >= 0) {
        tr.delete(deleteFrom, deleteTo);
        tr.insertText(sym.cmd + ' ', deleteFrom);
      } else {
        // Fallback: just insert at cursor
        editor.commands.insertContent(sym.cmd + ' ');
      }

      editor.view.dispatch(tr);
      editor.view.focus();
      setVisible(false);
    },
    [editor, triggerFrom]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          insertSymbol(filtered[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setVisible(false);
      }
    },
    [filtered, selectedIndex, insertSymbol]
  );

  if (!visible) return null;

  return createPortal(
    <div
      className="smart-math-popup bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden animate-fade-in-up"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 99999,
        width: 280,
      }}
    >
      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-800/60">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search symbol..."
          className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
        />
      </div>

      {/* Symbol list */}
      <div ref={listRef} className="max-h-52 overflow-y-auto custom-scrollbar py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-zinc-500 text-center">
            No matching symbols
          </div>
        ) : (
          filtered.map((sym, idx) => (
            <button
              key={sym.cmd}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSymbol(sym);
              }}
              className={`w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                idx === selectedIndex
                  ? 'bg-violet-500/15 text-violet-200'
                  : 'text-zinc-300 hover:bg-white/5'
              }`}
            >
              <span className="w-12 text-xs font-mono text-violet-400 truncate">
                {sym.cmd}
              </span>
              <span className="flex-1 text-xs truncate">{sym.name}</span>
              {sym.trigger && (
                <span className="text-[9px] text-zinc-600 font-mono">
                  {sym.trigger}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body
  );
}
