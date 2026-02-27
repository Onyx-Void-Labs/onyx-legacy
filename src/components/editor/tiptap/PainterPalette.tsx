/**
 * PainterPalette.tsx — Floating palette for Painter Mode.
 * Shows 5 paint type buttons, an eraser, marker toggle, and exit button.
 * Anchored top-right of the editor when Painter Mode is active.
 */

import {
  Paintbrush,
  Eraser,
  X,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { usePainterStore } from '@/store/painterStore';
import { PAINT_TYPES, PAINT_META, type PaintType } from '@/lib/painter/paintTypes';

interface PainterPaletteProps {
  onAutoPaint?: () => void;
}

export default function PainterPalette({ onAutoPaint }: PainterPaletteProps) {
  const {
    activePaintType,
    setActivePaintType,
    showMarkers,
    toggleMarkers,
    eraserActive,
    toggleEraser,
    exitPainterMode,
  } = usePainterStore();

  return (
    <div className="absolute top-2 right-4 z-50 animate-fade-in-up">
      <div className="bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/50 rounded-2xl shadow-2xl shadow-black/40 p-3 space-y-3 min-w-50">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Paintbrush size={14} className="text-violet-400" />
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              Painter
            </span>
          </div>
          <button
            onClick={exitPainterMode}
            className="p-1 text-zinc-500 hover:text-white hover:bg-zinc-700/50 rounded-lg transition-all cursor-pointer"
            title="Exit Painter Mode"
          >
            <X size={14} />
          </button>
        </div>

        {/* Paint type buttons */}
        <div className="space-y-1">
          {PAINT_TYPES.map((type) => {
            const meta = PAINT_META[type];
            const isActive = activePaintType === type && !eraserActive;
            return (
              <button
                key={type}
                onClick={() => {
                  setActivePaintType(type);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                }`}
              >
                <PaintDot type={type} active={isActive} />
                <span>{meta.label}</span>
                {isActive && (
                  <span className="ml-auto text-[9px] text-zinc-500 font-mono">active</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-zinc-700/40" />

        {/* Tools row */}
        <div className="flex items-center gap-1">
          {/* Eraser */}
          <button
            onClick={toggleEraser}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              eraserActive
                ? 'bg-red-500/15 text-red-300 border border-red-500/20'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
            title="Eraser — click painted blocks to remove paint"
          >
            <Eraser size={13} />
            <span>Eraser</span>
          </button>

          {/* Show/Hide markers */}
          <button
            onClick={toggleMarkers}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              showMarkers
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
            title={showMarkers ? 'Hide markers' : 'Show markers'}
          >
            {showMarkers ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{showMarkers ? 'Hide' : 'Show'}</span>
          </button>
        </div>

        {/* Auto-paint button for Recall / Key Term */}
        {(activePaintType === 'recall' || activePaintType === 'key_term') && onAutoPaint && (
          <button
            onClick={onAutoPaint}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 transition-all cursor-pointer border border-violet-500/20"
          >
            <Sparkles size={13} />
            <span>Auto-paint this section</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Small coloured dot indicator for paint types */
function PaintDot({ type, active }: { type: PaintType; active: boolean }) {
  const meta = PAINT_META[type];
  return (
    <div
      className={`w-3 h-3 rounded-full border-2 transition-all ${
        active ? 'scale-110' : 'scale-100'
      }`}
      style={{
        borderColor: meta.borderColor,
        backgroundColor: active ? meta.borderColor : 'transparent',
      }}
    />
  );
}
