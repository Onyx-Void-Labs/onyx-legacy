/**
 * SessionBar.tsx — Floating session timer bar that appears below the toolbar.
 * Shows phase (Focus/Break), countdown timer, interval count, controls.
 *
 * Gated by useFeature('session').
 */

import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  Timer,
  Coffee,
  Settings2,
} from 'lucide-react';
import { useSessionStore, type SessionConfig } from '@/store/sessionStore';

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function SessionBar() {
  const {
    phase,
    isRunning,
    timeRemainingMs,
    intervalsCompleted,
    config,
    setConfig,
    startSession,
    pauseSession,
    resumeSession,
    endSession,
    tick,
    skipPhase,
  } = useSessionStore();

  const [showConfig, setShowConfig] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick every second when running
  useEffect(() => {
    if (isRunning) {
      tickRef.current = setInterval(() => {
        tick();
      }, 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [isRunning, tick]);

  if (phase === 'idle') {
    // Show compact start button
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/40">
        <button
          onClick={() => startSession()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all cursor-pointer"
        >
          <Timer size={13} />
          Start Session
        </button>

        <button
          onClick={() => setShowConfig(!showConfig)}
          className="p-1.5 text-zinc-600 hover:text-zinc-400 rounded-lg hover:bg-zinc-800 transition-all cursor-pointer"
          title="Session settings"
        >
          <Settings2 size={12} />
        </button>

        {showConfig && (
          <ConfigPopup
            config={config}
            onUpdate={setConfig}
            onClose={() => setShowConfig(false)}
          />
        )}
      </div>
    );
  }

  const isFocus = phase === 'focus';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 border-b transition-colors ${
        isFocus
          ? 'border-violet-500/20 bg-violet-500/3'
          : 'border-green-500/20 bg-green-500/3'
      }`}
    >
      {/* Phase indicator */}
      <div className="flex items-center gap-2">
        {isFocus ? (
          <Timer size={14} className="text-violet-400" />
        ) : (
          <Coffee size={14} className="text-green-400" />
        )}
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${
            isFocus ? 'text-violet-300' : 'text-green-300'
          }`}
        >
          {isFocus ? 'Focus' : 'Break'}
        </span>
      </div>

      {/* Timer */}
      <span
        className={`text-lg font-mono font-bold tabular-nums ${
          isFocus ? 'text-violet-200' : 'text-green-200'
        }`}
      >
        {formatTime(timeRemainingMs)}
      </span>

      {/* Interval dots */}
      <div className="flex items-center gap-1 ml-1">
        {Array.from({ length: config.longBreakInterval }).map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all ${
              i < intervalsCompleted
                ? 'bg-violet-400'
                : 'bg-zinc-700'
            }`}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 ml-auto">
        {isRunning ? (
          <button
            onClick={pauseSession}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
            title="Pause"
          >
            <Pause size={14} />
          </button>
        ) : (
          <button
            onClick={resumeSession}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
            title="Resume"
          >
            <Play size={14} />
          </button>
        )}

        <button
          onClick={skipPhase}
          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all cursor-pointer"
          title="Skip to next phase"
        >
          <SkipForward size={13} />
        </button>

        <button
          onClick={endSession}
          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer"
          title="End session"
        >
          <Square size={13} />
        </button>
      </div>
    </div>
  );
}

/* ─── Config Popup ────────────────────────────────────────── */

function ConfigPopup({
  config,
  onUpdate,
  onClose,
}: {
  config: SessionConfig;
  onUpdate: (c: Partial<SessionConfig>) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-10 left-4 z-50 bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/50 rounded-xl shadow-2xl p-4 w-56 animate-fade-in-up">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3 font-medium">
        Session Settings
      </div>
      <div className="space-y-3">
        <ConfigRow
          label="Focus"
          value={config.focusMinutes}
          suffix="min"
          onChange={(v) => onUpdate({ focusMinutes: v })}
        />
        <ConfigRow
          label="Break"
          value={config.breakMinutes}
          suffix="min"
          onChange={(v) => onUpdate({ breakMinutes: v })}
        />
        <ConfigRow
          label="Long Break"
          value={config.longBreakMinutes}
          suffix="min"
          onChange={(v) => onUpdate({ longBreakMinutes: v })}
        />
        <ConfigRow
          label="Until Long"
          value={config.longBreakInterval}
          suffix="×"
          onChange={(v) => onUpdate({ longBreakInterval: v })}
        />
      </div>
      <button
        onClick={onClose}
        className="w-full mt-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-center cursor-pointer"
      >
        Done
      </button>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(1, value - 5))}
          className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-200 bg-zinc-800 rounded text-xs cursor-pointer"
        >
          −
        </button>
        <span className="w-8 text-center text-xs text-zinc-200 font-mono">
          {value}
        </span>
        <button
          onClick={() => onChange(Math.min(120, value + 5))}
          className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-200 bg-zinc-800 rounded text-xs cursor-pointer"
        >
          +
        </button>
        <span className="text-[10px] text-zinc-600 w-6">{suffix}</span>
      </div>
    </div>
  );
}
