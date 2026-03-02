// src/components/layout/StackNavigator.tsx
// ─── React state-based push/pop navigation for phone UX ─────────────────────
//
// No react-router needed. Keeps the same simple architecture as the rest
// of the app. Manages a stack of screens with push/pop transitions.

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StackScreen {
  /** Unique key for this screen instance */
  key: string;
  /** Component to render */
  component: ReactNode;
  /** Optional title for the mobile app bar */
  title?: string;
}

interface StackNavigatorContextValue {
  /** Current screen stack */
  stack: StackScreen[];
  /** Push a new screen onto the stack */
  push: (screen: StackScreen) => void;
  /** Pop the top screen (go back) */
  pop: () => void;
  /** Pop to root (clear all pushed screens) */
  popToRoot: () => void;
  /** Replace the current top screen */
  replace: (screen: StackScreen) => void;
  /** Whether we can go back (stack depth > 1) */
  canGoBack: boolean;
  /** Current screen depth */
  depth: number;
}

const StackNavigatorContext = createContext<StackNavigatorContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStackNavigator(): StackNavigatorContextValue {
  const ctx = useContext(StackNavigatorContext);
  if (!ctx) throw new Error('useStackNavigator must be used within a StackNavigatorProvider');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface StackNavigatorProviderProps {
  /** The root screen (always at bottom of stack) */
  rootScreen: StackScreen;
  children: ReactNode;
}

export function StackNavigatorProvider({ rootScreen, children }: StackNavigatorProviderProps) {
  const [stack, setStack] = useState<StackScreen[]>([rootScreen]);

  const push = useCallback((screen: StackScreen) => {
    setStack(prev => [...prev, screen]);
  }, []);

  const pop = useCallback(() => {
    setStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const popToRoot = useCallback(() => {
    setStack(prev => [prev[0]]);
  }, []);

  const replace = useCallback((screen: StackScreen) => {
    setStack(prev => {
      if (prev.length <= 1) return [screen];
      return [...prev.slice(0, -1), screen];
    });
  }, []);

  const value: StackNavigatorContextValue = {
    stack,
    push,
    pop,
    popToRoot,
    replace,
    canGoBack: stack.length > 1,
    depth: stack.length,
  };

  return (
    <StackNavigatorContext.Provider value={value}>
      {children}
    </StackNavigatorContext.Provider>
  );
}

// ─── Stack View (renders the top screen with transition) ──────────────────────

interface StackViewProps {
  className?: string;
}

export function StackView({ className = '' }: StackViewProps) {
  const { stack } = useStackNavigator();

  return (
    <div className={`relative flex-1 overflow-hidden ${className}`}>
      {/* Render all screens but only show the top one */}
      {stack.map((screen, index) => (
        <div
          key={screen.key}
          className="absolute inset-0 flex flex-col overflow-hidden"
          style={{
            transform: index === stack.length - 1 ? 'translateX(0)' : 'translateX(-30%)',
            opacity: index === stack.length - 1 ? 1 : 0,
            pointerEvents: index === stack.length - 1 ? 'auto' : 'none',
            transition: 'transform 0.25s ease-out, opacity 0.2s ease-out',
            zIndex: index,
          }}
        >
          {screen.component}
        </div>
      ))}
    </div>
  );
}
