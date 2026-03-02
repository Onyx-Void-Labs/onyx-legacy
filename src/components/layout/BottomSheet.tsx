// src/components/layout/BottomSheet.tsx
// ─── Slide-up bottom sheet for phone layout ─────────────────────────────────
//
// Used for Properties Panel on phone (replaces right-side panel).
// Supports drag-to-dismiss, snap points, and backdrop overlay.

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BottomSheetProps {
  /** Whether the sheet is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Content inside the sheet */
  children: ReactNode;
  /** Title shown in the sheet header */
  title?: string;
  /** Maximum height as fraction of viewport (default: 0.85) */
  maxHeight?: number;
  /** Minimum height as fraction of viewport (default: 0.3) */
  minHeight?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  title,
  maxHeight = 0.85,
  minHeight: _minHeight = 0.3,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    currentY: number;
    isDragging: boolean;
    sheetHeight: number;
  }>({ startY: 0, currentY: 0, isDragging: false, sheetHeight: 0 });

  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [visible, setVisible] = useState(false);

  // Animate in/out
  useEffect(() => {
    if (isOpen) {
      // Small delay for mount animation
      requestAnimationFrame(() => {
        setVisible(true);
      });
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  // Handle touch start on drag handle
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    dragRef.current = {
      startY: touch.clientY,
      currentY: touch.clientY,
      isDragging: true,
      sheetHeight: sheetRef.current?.offsetHeight ?? 0,
    };
    setIsDragging(true);
  }, []);

  // Handle touch move
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current.isDragging) return;

    const touch = e.touches[0];
    const deltaY = touch.clientY - dragRef.current.startY;

    // Only allow dragging down
    if (deltaY > 0) {
      setTranslateY(deltaY);
    }
    dragRef.current.currentY = touch.clientY;
  }, []);

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    if (!dragRef.current.isDragging) return;

    const deltaY = dragRef.current.currentY - dragRef.current.startY;
    const sheetHeight = dragRef.current.sheetHeight;
    const threshold = sheetHeight * 0.3; // 30% drag = dismiss

    dragRef.current.isDragging = false;
    setIsDragging(false);

    if (deltaY > threshold) {
      // Dismiss
      setTranslateY(sheetHeight);
      setTimeout(onClose, 200);
    } else {
      // Snap back
      setTranslateY(0);
    }
  }, [onClose]);

  // Reset position when closed
  useEffect(() => {
    if (!isOpen) {
      setTranslateY(0);
      setIsDragging(false);
    }
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxHeightPx = `${maxHeight * 100}vh`;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/60 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`
          fixed bottom-0 left-0 right-0 z-50
          bg-zinc-900 border-t border-zinc-800/60
          rounded-t-2xl shadow-2xl shadow-black/50
          flex flex-col overflow-hidden
          ${isDragging ? '' : 'transition-transform duration-300 ease-out'}
          ${visible ? '' : 'translate-y-full'}
        `}
        style={{
          maxHeight: maxHeightPx,
          transform: visible
            ? `translateY(${translateY}px)`
            : 'translateY(100%)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex flex-col items-center pt-3 pb-2 cursor-grab active:cursor-grabbing shrink-0"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-4 pb-3 border-b border-zinc-800/50 shrink-0">
            <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
            >
              Done
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </>
  );
}
