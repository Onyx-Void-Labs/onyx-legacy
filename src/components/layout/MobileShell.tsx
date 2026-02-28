// src/components/layout/MobileShell.tsx
// ─── Phone-specific app chrome ──────────────────────────────────────────────
//
// Wraps the entire phone UI with:
//   - Top app bar (replaces Titlebar) with dynamic theming
//   - Swipe-to-go-back gesture on sub-screens
//   - Animated tab transitions with cross-fade
//   - Bottom tab bar (5 tabs)
//   - Floating Action Button (new note)
//   - Quick-action long-press on tab items
//
// Only rendered when usePlatform().isMobile is true.

import { useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  ArrowLeft,
  Plus,
  Search,
  MoreVertical,
  Settings,
  CalendarDays,
  Mail,
  KeyRound,
  Image,
  Cloud,
  MessageCircle,
  Shield,
  ChevronRight,
} from 'lucide-react';
import BottomTabBar, { type MobileTab, type StudySubTab, type MoreSubTab } from './BottomTabBar';
import type { StackScreen } from './StackNavigator';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MobileShellProps {
  /** Notes list screen (shown in Notes tab) */
  notesListScreen: ReactNode;
  /** Editor screen to render when a note is selected */
  editorScreen: ReactNode | null;
  /** Today page screen */
  todayScreen: ReactNode;
  /** Flashcards screen */
  flashcardsScreen: ReactNode;
  /** Question library screen */
  questionsScreen: ReactNode;
  /** Calendar screen */
  calendarScreen: ReactNode;
  /** Email screen */
  emailScreen: ReactNode;
  /** Passwords screen */
  passwordsScreen: ReactNode;
  /** Photos screen */
  photosScreen: ReactNode;
  /** Cloud screen */
  cloudScreen: ReactNode;
  /** Messages screen */
  messagesScreen: ReactNode;
  /** Called when search is requested */
  onOpenSearch: () => void;
  /** Called to create a new note */
  onNewNote: () => void;
  /** Called to open settings */
  onOpenSettings: () => void;
  /** Whether a note is currently selected for editing */
  hasSelectedNote: boolean;
  /** Called to go back from editor to notes list */
  onBackFromEditor: () => void;
  /** 
   * Push a screen onto the current tab's stack.
   * Used by notes list to push editor, etc. 
   */
  onPushScreen?: (screen: StackScreen) => void;
}

// ─── Tab Color Accents ───────────────────────────────────────────────────────

const TAB_ACCENTS: Record<string, { bg: string; text: string; icon: string }> = {
  notes: { bg: 'bg-purple-500/8', text: 'text-purple-300', icon: 'text-purple-400' },
  today: { bg: 'bg-amber-500/8', text: 'text-amber-300', icon: 'text-amber-400' },
  flashcards: { bg: 'bg-emerald-500/8', text: 'text-emerald-300', icon: 'text-emerald-400' },
  study: { bg: 'bg-blue-500/8', text: 'text-blue-300', icon: 'text-blue-400' },
  calendar: { bg: 'bg-emerald-500/8', text: 'text-emerald-300', icon: 'text-emerald-400' },
  email: { bg: 'bg-amber-500/8', text: 'text-amber-300', icon: 'text-amber-400' },
  messages: { bg: 'bg-blue-500/8', text: 'text-blue-300', icon: 'text-blue-400' },
  passwords: { bg: 'bg-indigo-500/8', text: 'text-indigo-300', icon: 'text-indigo-400' },
  photos: { bg: 'bg-rose-500/8', text: 'text-rose-300', icon: 'text-rose-400' },
  cloud: { bg: 'bg-sky-500/8', text: 'text-sky-300', icon: 'text-sky-400' },
  more: { bg: 'bg-zinc-500/8', text: 'text-zinc-300', icon: 'text-zinc-400' },
};

// ─── Mobile App Bar ──────────────────────────────────────────────────────────

interface MobileAppBarProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  onSearch?: () => void;
  onMore?: () => void;
  rightActions?: ReactNode;
  accentKey?: string;
}

function MobileAppBar({ title, subtitle, showBack, onBack, onSearch, onMore, rightActions, accentKey = 'notes' }: MobileAppBarProps) {
  const accent = TAB_ACCENTS[accentKey] || TAB_ACCENTS.notes;

  return (
    <header
      className={`backdrop-blur-lg flex items-center justify-between px-2 shrink-0 border-b border-zinc-800/40 z-40 transition-colors duration-300 bg-zinc-950/95`}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 'calc(52px + env(safe-area-inset-top, 0px))' }}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {showBack && (
          <button
            onClick={onBack}
            className={`p-2 rounded-xl ${accent.text} active:bg-zinc-800 transition-all active:scale-90`}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="min-w-0 px-2">
          <span className="text-sm font-bold text-zinc-100 truncate block leading-tight">
            {title}
          </span>
          {subtitle && (
            <span className="text-[10px] text-zinc-500 font-medium truncate block">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        {rightActions}
        {onSearch && (
          <button
            onClick={onSearch}
            className="p-2.5 rounded-xl text-zinc-400 active:bg-zinc-800 transition-all active:scale-90"
          >
            <Search size={18} />
          </button>
        )}
        {onMore && (
          <button
            onClick={onMore}
            className="p-2.5 rounded-xl text-zinc-400 active:bg-zinc-800 transition-all active:scale-90"
          >
            <MoreVertical size={18} />
          </button>
        )}
      </div>
    </header>
  );
}

// ─── FAB (Floating Action Button) ─────────────────────────────────────────────

interface FABProps {
  onClick: () => void;
  visible: boolean;
}

function FAB({ onClick, visible }: FABProps) {
  return (
    <button
      onClick={onClick}
      className={`fixed right-4 z-40 w-14 h-14 rounded-2xl bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white shadow-lg shadow-purple-900/40 flex items-center justify-center transition-all duration-300 active:scale-90 ${
        visible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-4 opacity-0 scale-90 pointer-events-none'
      }`}
      style={{ bottom: 'calc(4.5rem + max(env(safe-area-inset-bottom, 0px), 12px))' }}
      aria-label="New Note"
    >
      <Plus size={24} />
    </button>
  );
}

// ─── Swipe-to-Back Container ──────────────────────────────────────────────────

function SwipeBackContainer({ enabled, onBack, children }: {
  enabled: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  const touchRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null);
  const [swipeProgress, setSwipeProgress] = useState(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    // Only trigger from left edge (first 30px)
    if (touch.clientX > 30) return;
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, startTime: Date.now() };
  }, [enabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchRef.current.startX;
    const dy = Math.abs(touch.clientY - touchRef.current.startY);
    // Cancel if vertical scroll
    if (dy > 40) { touchRef.current = null; setSwipeProgress(0); return; }
    if (dx > 0) {
      setSwipeProgress(Math.min(dx / 200, 1));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchRef.current) return;
    if (swipeProgress > 0.4) {
      onBack();
    }
    touchRef.current = null;
    setSwipeProgress(0);
  }, [swipeProgress, onBack]);

  return (
    <div
      className="flex-1 overflow-hidden relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe indicator */}
      {swipeProgress > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 z-30 flex items-center pointer-events-none"
          style={{ opacity: swipeProgress }}
        >
          <div className="ml-2 w-8 h-8 rounded-full bg-zinc-800/80 flex items-center justify-center">
            <ArrowLeft size={16} className="text-zinc-300" />
          </div>
        </div>
      )}
      <div
        style={{
          transform: swipeProgress > 0 ? `translateX(${swipeProgress * 80}px)` : undefined,
          transition: swipeProgress === 0 ? 'transform 200ms ease-out' : 'none',
        }}
        className="h-full"
      >
        {children}
      </div>
    </div>
  );
}

// ─── Tab Title Map ────────────────────────────────────────────────────────────

const TAB_TITLES: Record<MobileTab, string> = {
  notes: 'Notes',
  today: 'Today',
  flashcards: 'Flashcards',
  study: 'Study',
  more: 'More',
};

const MORE_SUBTITLES: Record<MoreSubTab, string> = {
  calendar: 'Events & schedule',
  email: 'Encrypted inbox',
  passwords: 'Secure vault',
  photos: 'E2EE gallery',
  cloud: 'Encrypted storage',
  settings: 'Preferences',
  messages: 'E2EE channels',
};

// ─── Main Shell Component ─────────────────────────────────────────────────────

export default function MobileShell({
  notesListScreen,
  editorScreen,
  todayScreen,
  flashcardsScreen,
  questionsScreen,
  calendarScreen,
  emailScreen,
  passwordsScreen,
  photosScreen,
  cloudScreen,
  messagesScreen,
  onOpenSearch,
  onNewNote,
  onOpenSettings,
  hasSelectedNote,
  onBackFromEditor,
}: MobileShellProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('today');
  const [activeMoreScreen, setActiveMoreScreen] = useState<MoreSubTab | null>(null);
  const [activeStudyScreen, setActiveStudyScreen] = useState<StudySubTab | null>(null);

  // Whether the editor is showing (notes tab + note selected)
  const showingEditor = activeTab === 'notes' && hasSelectedNote;

  // Current accent key for theming
  const accentKey = useMemo(() => {
    if (activeTab === 'more' && activeMoreScreen) return activeMoreScreen;
    return activeTab;
  }, [activeTab, activeMoreScreen]);

  // Get the title for the app bar
  const appBarTitle = useMemo(() => {
    if (showingEditor) return 'Editor';
    if (activeTab === 'more' && activeMoreScreen) {
      const labels: Record<MoreSubTab, string> = {
        calendar: 'Calendar',
        email: 'Email',
        passwords: 'Vault',
        photos: 'Photos',
        cloud: 'Cloud Drive',
        settings: 'Settings',
        messages: 'Messages',
      };
      return labels[activeMoreScreen];
    }
    if (activeTab === 'study' && activeStudyScreen) {
      const labels: Record<StudySubTab, string> = {
        questions: 'Question Library',
        recall: 'Recall',
        sessions: 'Sessions',
      };
      return labels[activeStudyScreen];
    }
    return TAB_TITLES[activeTab];
  }, [activeTab, activeMoreScreen, activeStudyScreen, showingEditor]);

  // Subtitle for more screens
  const appBarSubtitle = useMemo(() => {
    if (activeTab === 'more' && activeMoreScreen) {
      return MORE_SUBTITLES[activeMoreScreen];
    }
    return undefined;
  }, [activeTab, activeMoreScreen]);

  // Whether to show back button
  const showBack = showingEditor
    || (activeTab === 'more' && activeMoreScreen !== null)
    || (activeTab === 'study' && activeStudyScreen !== null);

  const handleBack = useCallback(() => {
    if (showingEditor) {
      onBackFromEditor();
    } else if (activeTab === 'more' && activeMoreScreen !== null) {
      setActiveMoreScreen(null);
    } else if (activeTab === 'study' && activeStudyScreen !== null) {
      setActiveStudyScreen(null);
    }
  }, [showingEditor, activeTab, activeMoreScreen, activeStudyScreen, onBackFromEditor]);

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
    if (tab !== 'more') setActiveMoreScreen(null);
    if (tab !== 'study') setActiveStudyScreen(null);
    // When switching to notes tab, go back to list
    if (tab === 'notes' && hasSelectedNote) {
      onBackFromEditor();
    }
  }, [activeTab, hasSelectedNote, onBackFromEditor]);

  const handleStudySelect = useCallback((sub: StudySubTab) => {
    setActiveStudyScreen(sub);
    setActiveTab('study');
  }, []);

  const handleMoreSelect = useCallback((sub: MoreSubTab) => {
    if (sub === 'settings') {
      onOpenSettings();
      return;
    }
    setActiveMoreScreen(sub);
    setActiveTab('more');
  }, [onOpenSettings]);

  // Render current tab content
  const renderContent = () => {
    switch (activeTab) {
      case 'notes':
        if (hasSelectedNote && editorScreen) {
          return editorScreen;
        }
        return notesListScreen;
      case 'today':
        return todayScreen;
      case 'flashcards':
        return flashcardsScreen;
      case 'study':
        if (activeStudyScreen === 'questions') return questionsScreen;
        return questionsScreen;
      case 'more':
        if (activeMoreScreen === 'calendar') return calendarScreen;
        if (activeMoreScreen === 'email') return emailScreen;
        if (activeMoreScreen === 'passwords') return passwordsScreen;
        if (activeMoreScreen === 'photos') return photosScreen;
        if (activeMoreScreen === 'cloud') return cloudScreen;
        if (activeMoreScreen === 'messages') return messagesScreen;
        return <MoreMenuGrid onSelect={handleMoreSelect} />;
      default:
        return notesListScreen;
    }
  };

  const showFAB = activeTab === 'notes' && !showingEditor;

  return (
    <div className="flex flex-col h-screen w-screen app-bg overflow-hidden select-none">
      {/* Top app bar */}
      <MobileAppBar
        title={appBarTitle}
        subtitle={appBarSubtitle}
        showBack={showBack}
        onBack={handleBack}
        accentKey={accentKey}
        onSearch={!showingEditor ? onOpenSearch : undefined}
      />

      {/* Main content with swipe-to-back */}
      <SwipeBackContainer enabled={showBack} onBack={handleBack}>
        {renderContent()}
      </SwipeBackContainer>

      {/* FAB for new note */}
      <FAB onClick={onNewNote} visible={showFAB} />

      {/* Bottom tab bar */}
      <BottomTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onStudySelect={handleStudySelect}
        onMoreSelect={handleMoreSelect}
      />
    </div>
  );
}

// ─── "More" Default Grid (when no sub-tab selected) ──────────────────────────

function MoreMenuGrid({ onSelect }: { onSelect: (sub: MoreSubTab) => void }) {
  const items: { id: MoreSubTab; label: string; description: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string; bgColor: string }[] = [
    { id: 'calendar', label: 'Calendar', description: 'Events & schedule', icon: CalendarDays, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
    { id: 'email', label: 'Email', description: 'Encrypted inbox', icon: Mail, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
    { id: 'messages', label: 'Messages', description: 'E2EE channels', icon: MessageCircle, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
    { id: 'passwords', label: 'Vault', description: 'Secure passwords', icon: KeyRound, color: 'text-indigo-400', bgColor: 'bg-indigo-500/10' },
    { id: 'photos', label: 'Photos', description: 'E2EE gallery', icon: Image, color: 'text-rose-400', bgColor: 'bg-rose-500/10' },
    { id: 'cloud', label: 'Cloud', description: 'Encrypted storage', icon: Cloud, color: 'text-sky-400', bgColor: 'bg-sky-500/10' },
    { id: 'settings', label: 'Settings', description: 'Preferences', icon: Settings, color: 'text-zinc-400', bgColor: 'bg-zinc-500/10' },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero card */}
      <div className="mx-4 mt-4 mb-3 p-4 rounded-2xl bg-linear-to-br from-purple-500/10 to-indigo-500/10 border border-purple-500/15">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
            <Shield size={20} className="text-purple-400" />
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-100">Everything Encrypted</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">All modules use end-to-end encryption by default</div>
          </div>
        </div>
      </div>

      {/* Module list */}
      <div className="px-4 space-y-1.5 pb-4">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className="w-full flex items-center gap-4 p-3.5 rounded-2xl bg-zinc-900/40 border border-zinc-800/20 active:bg-zinc-800/60 active:scale-[0.98] transition-all"
            >
              <div className={`w-11 h-11 rounded-xl ${item.bgColor} flex items-center justify-center shrink-0`}>
                <Icon size={22} className={item.color} />
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-sm font-semibold text-zinc-200">{item.label}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{item.description}</div>
              </div>
              <ChevronRight size={16} className="text-zinc-700 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
