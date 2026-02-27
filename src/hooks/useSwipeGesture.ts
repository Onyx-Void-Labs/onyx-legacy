// src/hooks/useSwipeGesture.ts
// ─── Touch swipe gesture detection ──────────────────────────────────────────
//
// Lightweight swipe handler for flashcard ratings and navigation.
// No external dependencies — pure React touch events.
//
// Usage:
//   const handlers = useSwipeGesture({
//     onSwipeLeft: () => handleRate('again'),
//     onSwipeRight: () => handleRate('good'),
//     onSwipeUp: () => handleRate('easy'),
//     threshold: 80,
//   });
//   <div {...handlers}>...</div>

import { useRef, useCallback, type TouchEvent as ReactTouchEvent } from 'react';

interface SwipeGestureOptions {
  /** Callback when user swipes left */
  onSwipeLeft?: () => void;
  /** Callback when user swipes right */
  onSwipeRight?: () => void;
  /** Callback when user swipes up */
  onSwipeUp?: () => void;
  /** Callback when user swipes down */
  onSwipeDown?: () => void;
  /** Minimum swipe distance in pixels (default: 80) */
  threshold?: number;
  /** Max time for swipe in ms (default: 500) */
  maxTime?: number;
}

interface SwipeHandlers {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchMove: (e: ReactTouchEvent) => void;
  onTouchEnd: (e: ReactTouchEvent) => void;
}

export function useSwipeGesture(options: SwipeGestureOptions): SwipeHandlers {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 80,
    maxTime = 500,
  } = options;

  const touchRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    tracking: boolean;
  }>({ startX: 0, startY: 0, startTime: 0, tracking: false });

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    const touch = e.touches[0];
    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      tracking: true,
    };
  }, []);

  const onTouchMove = useCallback((_e: ReactTouchEvent) => {
    // Can be used for visual feedback (card tilt, etc.)
  }, []);

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      if (!touchRef.current.tracking) return;
      touchRef.current.tracking = false;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchRef.current.startX;
      const deltaY = touch.clientY - touchRef.current.startY;
      const elapsed = Date.now() - touchRef.current.startTime;

      // Must complete within time limit
      if (elapsed > maxTime) return;

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Determine direction (require minimum threshold)
      if (absX > absY && absX > threshold) {
        // Horizontal swipe
        if (deltaX > 0) {
          onSwipeRight?.();
        } else {
          onSwipeLeft?.();
        }
      } else if (absY > absX && absY > threshold) {
        // Vertical swipe
        if (deltaY > 0) {
          onSwipeDown?.();
        } else {
          onSwipeUp?.();
        }
      }
    },
    [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, maxTime]
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
