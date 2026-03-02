/**
 * featureStore.ts — Zustand store for managing enabled/disabled feature modules.
 * Persisted to localStorage under 'onyx_features'.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FEATURE_MODULES } from '@/lib/features/featureRegistry';

interface DownloadState {
  downloaded: boolean;
}

interface FeatureState {
  /** Map of feature ID → enabled boolean */
  enabled: Record<string, boolean>;
  /** Map of downloadKey → download state */
  downloads: Record<string, DownloadState>;

  /** Enable a feature by ID. Also enables dependencies. */
  enableFeature: (id: string) => void;
  /** Disable a feature by ID. */
  disableFeature: (id: string) => void;
  /** Check if a feature is enabled. */
  isEnabled: (id: string) => boolean;
  /** Mark a download as completed. */
  setDownloaded: (id: string, downloadKey: string) => void;
  /** Check if a download is completed. */
  isDownloaded: (downloadKey: string) => boolean;
}

/**
 * Build the default enabled map from the registry.
 */
function buildDefaultEnabled(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const mod of FEATURE_MODULES) {
    map[mod.id] = mod.enabled;
  }
  return map;
}

export const useFeatureStore = create<FeatureState>()(
  persist(
    (set, get) => ({
      enabled: buildDefaultEnabled(),
      downloads: {},

      enableFeature: (id: string) => {
        const mod = FEATURE_MODULES.find((m) => m.id === id);
        if (!mod) return;

        // If module requires download and it hasn't been downloaded yet, don't enable
        if (mod.requiresDownload) {
          const dl = get().downloads[mod.requiresDownload.downloadKey];
          if (!dl?.downloaded) return;
        }

        set((state) => {
          const next = { ...state.enabled, [id]: true };

          // Also enable dependencies
          if (mod.dependsOn) {
            for (const depId of mod.dependsOn) {
              next[depId] = true;
            }
          }

          return { enabled: next };
        });
      },

      disableFeature: (id: string) => {
        // Don't allow disabling core modules
        if (id === 'notes') return;

        set((state) => ({
          enabled: { ...state.enabled, [id]: false },
        }));
      },

      isEnabled: (id: string) => {
        return get().enabled[id] ?? false;
      },

      setDownloaded: (_id: string, downloadKey: string) => {
        set((state) => ({
          downloads: {
            ...state.downloads,
            [downloadKey]: { downloaded: true },
          },
        }));
      },

      isDownloaded: (downloadKey: string) => {
        return get().downloads[downloadKey]?.downloaded ?? false;
      },
    }),
    {
      name: 'onyx_features',
      version: 1,
    }
  )
);
