// src/hooks/usePlatform.ts
// ─── Single source of truth for platform detection ──────────────────────────
//
// Replaces all ad-hoc `window.__TAURI_INTERNALS__` checks across the codebase.
// Provides runtime detection for: Android, iOS, mobile (phone), tablet, desktop, Tauri.
//
// Usage:
//   const { isAndroid, isMobile, isTablet, isDesktop, isTauri, platform } = usePlatform();
//
// Layout switching is runtime (not build-time) — handles screen rotation,
// tablet multitasking, and split-screen correctly.

import { useState, useEffect, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Platform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web';
export type FormFactor = 'phone' | 'tablet' | 'desktop';

export interface PlatformInfo {
  /** The underlying OS platform */
  platform: Platform;
  /** Current form factor based on screen dimensions */
  formFactor: FormFactor;
  /** Running inside Tauri (desktop or mobile) */
  isTauri: boolean;
  /** Android OS (Tauri mobile or WebView) */
  isAndroid: boolean;
  /** iOS (Tauri mobile or WebView) */
  isIOS: boolean;
  /** Mobile phone form factor (narrow screen, < 768px) */
  isMobile: boolean;
  /** Tablet form factor (768px–1024px, or Android/iOS with larger screen) */
  isTablet: boolean;
  /** Desktop form factor (> 1024px on non-mobile OS, or Tauri desktop) */
  isDesktop: boolean;
  /** Touch-capable device */
  isTouch: boolean;
  /** Screen width in pixels */
  screenWidth: number;
  /** Screen height in pixels */
  screenHeight: number;
  /** Portrait orientation */
  isPortrait: boolean;
  /** Landscape orientation */
  isLandscape: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Breakpoint: phone → tablet */
const TABLET_BREAKPOINT = 768;

// ─── Platform Detection (stable, computed once) ───────────────────────────────

function detectTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'web';

  const ua = navigator.userAgent.toLowerCase();

  // Android detection (works in Tauri Android WebView too)
  if (ua.includes('android')) return 'android';

  // iOS detection
  if (/iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && 'ontouchend' in document)) {
    return 'ios';
  }

  // Desktop OS detection via userAgent
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macos')) return 'macos';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';

  // Check Vite env override (for dev/testing on desktop)
  if (import.meta.env.VITE_PLATFORM === 'android') return 'android';

  return 'web';
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (navigator as any).msMaxTouchPoints > 0
  );
}

// ─── Form Factor (dynamic, changes with resize/rotation) ─────────────────────

function computeFormFactor(
  platform: Platform,
  width: number,
  _height: number
): FormFactor {
  const isMobileOS = platform === 'android' || platform === 'ios';

  if (isMobileOS) {
    // On mobile OS, use width breakpoints to distinguish phone vs tablet
    // In landscape, a phone might be wide — use the narrower dimension
    const narrowDim = Math.min(width, _height);
    if (narrowDim < TABLET_BREAKPOINT) return 'phone';
    return 'tablet';
  }

  // Desktop OS — always desktop form factor
  // (even if window is resized small, desktop UX is still appropriate)
  return 'desktop';
}

// ─── Stable values (computed once) ────────────────────────────────────────────

const _isTauri = detectTauri();
const _platform = detectPlatform();
const _isTouch = detectTouch();
const _isAndroid = _platform === 'android';
const _isIOS = _platform === 'ios';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePlatform(): PlatformInfo {
  const [dimensions, setDimensions] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  // Listen for resize (screen rotation, multitasking, etc.)
  useEffect(() => {
    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setDimensions({ width: window.innerWidth, height: window.innerHeight });
      });
    };

    window.addEventListener('resize', handleResize);

    // Also listen for orientation change on mobile
    if ('screen' in window && 'orientation' in screen) {
      screen.orientation.addEventListener('change', handleResize);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      if ('screen' in window && 'orientation' in screen) {
        screen.orientation.removeEventListener('change', handleResize);
      }
    };
  }, []);

  const info = useMemo<PlatformInfo>(() => {
    const formFactor = computeFormFactor(_platform, dimensions.width, dimensions.height);

    return {
      platform: _platform,
      formFactor,
      isTauri: _isTauri,
      isAndroid: _isAndroid,
      isIOS: _isIOS,
      isMobile: formFactor === 'phone',
      isTablet: formFactor === 'tablet',
      isDesktop: formFactor === 'desktop',
      isTouch: _isTouch,
      screenWidth: dimensions.width,
      screenHeight: dimensions.height,
      isPortrait: dimensions.height > dimensions.width,
      isLandscape: dimensions.width >= dimensions.height,
    };
  }, [dimensions.width, dimensions.height]);

  return info;
}

// ─── Non-hook utility for use outside React components ────────────────────────

/** Get platform info without React hook (static, no resize tracking) */
export function getPlatformInfo(): PlatformInfo {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const height = typeof window !== 'undefined' ? window.innerHeight : 800;
  const formFactor = computeFormFactor(_platform, width, height);

  return {
    platform: _platform,
    formFactor,
    isTauri: _isTauri,
    isAndroid: _isAndroid,
    isIOS: _isIOS,
    isMobile: formFactor === 'phone',
    isTablet: formFactor === 'tablet',
    isDesktop: formFactor === 'desktop',
    isTouch: _isTouch,
    screenWidth: width,
    screenHeight: height,
    isPortrait: height > width,
    isLandscape: width >= height,
  };
}

// ─── Constants re-export (for use without hooks) ──────────────────────────────

export const IS_TAURI = _isTauri;
export const IS_ANDROID = _isAndroid;
export const IS_IOS = _isIOS;
export const PLATFORM = _platform;
