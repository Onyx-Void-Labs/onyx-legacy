/**
 * useFeature.ts — Hook to check if a feature module is enabled.
 * Used to conditionally render UI elements gated by the modular feature system.
 *
 * Usage:
 *   const isPainterEnabled = useFeature('painter');
 *   if (!isPainterEnabled) return null;
 */

import { useFeatureStore } from '@/store/featureStore';

export function useFeature(id: string): boolean {
  return useFeatureStore((s) => s.isEnabled(id));
}
