// src/components/layout/BottomTabBar.tsx
// ─── Bottom navigation bar for phone layout ─────────────────────────────────
//
// 5 tabs: Notes, Today, Flashcards, Study, More
// Uses existing lucide-react icons. Standard Android bottom nav pattern.
// Sits above the system navigation gesture bar via safe-area-inset-bottom.

import { useState } from 'react';
import {
  PenLine,
  Sun,
  Layers,
  GraduationCap,
  MoreHorizontal,
  HelpCircle,
  Brain,
  Timer,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MobileTab = 'notes' | 'today' | 'flashcards' | 'study' | 'more';
export type StudySubTab = 'questions' | 'recall' | 'sessions';
export type MoreSubTab = 'calendar' | 'email' | 'passwords' | 'photos' | 'cloud' | 'settings' | 'messages';

interface BottomTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  /** Called when a study sub-option is selected */
  onStudySelect?: (sub: StudySubTab) => void;
  /** Called when a "more" sub-option is selected */
  onMoreSelect?: (sub: MoreSubTab) => void;
}

// ─── Tab Config ───────────────────────────────────────────────────────────────

interface TabDef {
  id: MobileTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const TABS: TabDef[] = [
  { id: 'notes', label: 'Notes', icon: PenLine },
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'flashcards', label: 'Cards', icon: Layers },
  { id: 'study', label: 'Study', icon: GraduationCap },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

const STUDY_OPTIONS: { id: StudySubTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'questions', label: 'Questions', icon: HelpCircle },
  { id: 'recall', label: 'Recall', icon: Brain },
  { id: 'sessions', label: 'Sessions', icon: Timer },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function BottomTabBar({ activeTab, onTabChange, onStudySelect, onMoreSelect: _onMoreSelect }: BottomTabBarProps) {
  const [popoverTab, setPopoverTab] = useState<'study' | 'more' | null>(null);

  const handleTabPress = (tab: MobileTab) => {
    if (tab === 'study') {
      // Toggle popover for study only
      setPopoverTab(prev => (prev === 'study' ? null : 'study'));
      onTabChange(tab);
    } else {
      // More tab navigates directly, no popover
      setPopoverTab(null);
      onTabChange(tab);
    }
  };

  const handleStudySelect = (sub: StudySubTab) => {
    setPopoverTab(null);
    onStudySelect?.(sub);
  };

  return (
    <>
      {/* Backdrop for dismissing popover */}
      {popoverTab && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setPopoverTab(null)}
        />
      )}

      {/* Popover menus */}
      {popoverTab === 'study' && (
        <PopoverMenu
          items={STUDY_OPTIONS}
          onSelect={(id) => handleStudySelect(id as StudySubTab)}
          position="right"
        />
      )}
      {/* Tab bar */}
      <nav
        className="shrink-0 bg-zinc-950/98 backdrop-blur-xl border-t border-zinc-800/40 z-50"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        <div className="flex items-center justify-around h-16">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabPress(tab.id)}
                className={`
                  flex flex-col items-center justify-center gap-1 flex-1 h-full
                  transition-all duration-200 relative
                  ${isActive
                    ? 'text-purple-400'
                    : 'text-zinc-600 active:text-zinc-400'
                  }
                `}
              >
                <div className={`relative p-1.5 rounded-xl transition-all duration-200 ${isActive ? 'bg-purple-500/10 scale-105' : ''}`}>
                  <Icon size={20} />
                </div>
                <span className={`text-[10px] leading-tight transition-all ${isActive ? 'font-bold' : 'font-medium'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

// ─── Popover Menu ─────────────────────────────────────────────────────────────

interface PopoverMenuProps {
  items: { id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[];
  onSelect: (id: string) => void;
  position?: 'left' | 'right';
}

function PopoverMenu({ items, onSelect, position = 'right' }: PopoverMenuProps) {
  return (
    <div
      className={`
        fixed bottom-16 z-50
        ${position === 'right' ? 'right-3' : 'left-3'}
        bg-zinc-900 border border-zinc-800/80 rounded-xl
        shadow-2xl shadow-black/50 overflow-hidden
        animate-fade-in-up
      `}
      style={{ marginBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}
    >
      <div className="p-1.5 min-w-44">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 active:bg-zinc-800 transition-colors"
            >
              <Icon size={16} className="text-zinc-500" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
