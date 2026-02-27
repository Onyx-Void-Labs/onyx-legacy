/**
 * FeaturesPage.tsx — Full settings panel for managing optional feature modules.
 * Reachable from Settings → Features tab. Replaces the placeholder FeaturesTab.
 */

import { useState, useCallback } from 'react';
import {
  Zap,
  PenLine,
  Layers,
  HelpCircle,
  Paintbrush,
  Brain,
  Presentation,
  Monitor,
  Timer,
  Sigma,
  LayoutDashboard,
  Mic,
  CalendarDays,
  Inbox,
  FileText,
  Headphones,
  Download,
  Check,
  X,
  Info,
} from 'lucide-react';
import { useFeatureStore } from '@/store/featureStore';
import {
  FEATURE_MODULES,
  CATEGORY_META,
  CATEGORY_ORDER,
  type FeatureModule,
  type FeatureCategory,
} from '@/lib/features/featureRegistry';

/** Map Lucide icon name strings to components */
const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  'pen-line': PenLine,
  layers: Layers,
  'help-circle': HelpCircle,
  paintbrush: Paintbrush,
  brain: Brain,
  presentation: Presentation,
  monitor: Monitor,
  timer: Timer,
  sigma: Sigma,
  'layout-dashboard': LayoutDashboard,
  mic: Mic,
  'calendar-days': CalendarDays,
  inbox: Inbox,
  'file-text': FileText,
  headphones: Headphones,
};

function getIcon(name: string): React.FC<{ size?: number; className?: string }> {
  return ICON_MAP[name] ?? Zap;
}

/** Category accent colours */
const CATEGORY_COLORS: Record<FeatureCategory, string> = {
  study: 'text-amber-400',
  editor: 'text-violet-400',
  tools: 'text-emerald-400',
  media: 'text-rose-400',
};

const CATEGORY_BG: Record<FeatureCategory, string> = {
  study: 'bg-amber-500/10',
  editor: 'bg-violet-500/10',
  tools: 'bg-emerald-500/10',
  media: 'bg-rose-500/10',
};

interface DownloadProgress {
  featureId: string;
  percent: number;
  error?: string;
}

export default function FeaturesPage() {
  const { enabled, enableFeature, disableFeature, downloads, setDownloaded } = useFeatureStore();
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  const isEnabled = useCallback(
    (id: string) => enabled[id] ?? false,
    [enabled]
  );

  const isDownloaded = useCallback(
    (downloadKey: string) => downloads[downloadKey]?.downloaded ?? false,
    [downloads]
  );

  const handleToggle = useCallback(
    (mod: FeatureModule) => {
      if (isEnabled(mod.id)) {
        disableFeature(mod.id);
      } else {
        // If requires download and not downloaded, don't toggle
        if (mod.requiresDownload && !isDownloaded(mod.requiresDownload.downloadKey)) {
          return;
        }
        enableFeature(mod.id);
      }
    },
    [isEnabled, isDownloaded, enableFeature, disableFeature]
  );

  const handleDownload = useCallback(
    async (mod: FeatureModule) => {
      if (!mod.requiresDownload) return;

      setDownloadProgress({ featureId: mod.id, percent: 0 });

      try {
        // Simulate download progress (real implementation would use Tauri events)
        // In production, this would call invoke('download_whisper_model', { model: 'base.en' })
        // and listen for progress events
        for (let i = 0; i <= 100; i += 5) {
          await new Promise((r) => setTimeout(r, 100));
          setDownloadProgress({ featureId: mod.id, percent: i });
        }

        setDownloaded(mod.id, mod.requiresDownload.downloadKey);
        enableFeature(mod.id);
        setDownloadProgress(null);
      } catch (err) {
        setDownloadProgress({
          featureId: mod.id,
          percent: 0,
          error: `Download failed: ${err}`,
        });
      }
    },
    [setDownloaded, enableFeature]
  );

  const cancelDownload = useCallback(() => {
    setDownloadProgress(null);
  }, []);

  // Group modules by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    meta: CATEGORY_META[cat],
    modules: FEATURE_MODULES.filter((m) => m.category === cat),
  }));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-2xl font-bold text-white mb-1">Features</h2>
      <p className="text-zinc-400 text-sm">
        Enable or disable optional modules. Only active features appear in your workspace.
      </p>

      {/* Info chip */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500/8 border border-violet-500/10">
        <Info size={14} className="text-violet-400 shrink-0" />
        <span className="text-xs text-violet-300/80">
          Disabled features are completely hidden from the UI — no clutter, no confusion.
        </span>
      </div>

      {/* Category groups */}
      {grouped.map(({ category, meta, modules }) => (
        <div key={category} className="space-y-3">
          {/* Category header */}
          <div className="flex items-center gap-2 pt-2">
            <div
              className={`w-2 h-2 rounded-full ${CATEGORY_COLORS[category].replace('text-', 'bg-')}`}
            />
            <h3 className={`text-xs font-semibold uppercase tracking-widest ${CATEGORY_COLORS[category]}`}>
              {meta.label}
            </h3>
            <span className="text-[10px] text-zinc-600">{meta.description}</span>
          </div>

          {/* Module cards */}
          <div className="space-y-2">
            {modules.map((mod) => {
              const Icon = getIcon(mod.icon);
              const on = isEnabled(mod.id);
              const isCoreModule = mod.id === 'notes';
              const needsDownload =
                mod.requiresDownload && !isDownloaded(mod.requiresDownload.downloadKey);
              const isDownloading = downloadProgress?.featureId === mod.id;
              const downloadError = isDownloading ? downloadProgress?.error : undefined;

              return (
                <div
                  key={mod.id}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl border transition-all duration-200 ${
                    on
                      ? 'bg-white/3 border-white/10'
                      : 'bg-zinc-900/30 border-white/5 opacity-70'
                  }`}
                >
                  {/* Icon */}
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${CATEGORY_BG[category]}`}
                  >
                    <Icon size={20} className={CATEGORY_COLORS[category]} />
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-200">{mod.name}</span>
                      {mod.dependsOn && mod.dependsOn.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">
                          requires {mod.dependsOn.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                      {mod.description}
                    </p>

                    {/* Download progress bar */}
                    {isDownloading && !downloadError && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-violet-500 rounded-full transition-all duration-300"
                              style={{ width: `${downloadProgress.percent}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-zinc-400 font-mono w-8 text-right">
                            {downloadProgress.percent}%
                          </span>
                          <button
                            onClick={cancelDownload}
                            className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors"
                            title="Cancel download"
                          >
                            <X size={12} />
                          </button>
                        </div>
                        <span className="text-[10px] text-zinc-500">
                          Downloading {mod.requiresDownload?.label}...{' '}
                          {Math.round(
                            ((downloadProgress.percent / 100) *
                              (mod.requiresDownload?.sizeBytes ?? 0)) /
                              1_000_000
                          )}{' '}
                          MB /{' '}
                          {Math.round((mod.requiresDownload?.sizeBytes ?? 0) / 1_000_000)} MB
                        </span>
                      </div>
                    )}

                    {/* Download error */}
                    {downloadError && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-red-400">{downloadError}</span>
                        <button
                          onClick={() => handleDownload(mod)}
                          className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Toggle / Download button */}
                  <div className="shrink-0">
                    {needsDownload && !isDownloading ? (
                      <button
                        onClick={() => handleDownload(mod)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors cursor-pointer"
                      >
                        <Download size={12} />
                        <span>Download & Enable</span>
                      </button>
                    ) : isDownloading ? (
                      <div className="w-10 h-5 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : isCoreModule ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">
                        <Check size={12} />
                        <span>Always On</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleToggle(mod)}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${
                          on ? 'bg-violet-600' : 'bg-zinc-700'
                        }`}
                        title={on ? 'Disable' : 'Enable'}
                      >
                        <div
                          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                            on ? 'translate-x-5.5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
