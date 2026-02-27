// src/components/layout/MobileShell.tsx
// ─── Phone-specific app chrome ──────────────────────────────────────────────
//
// Wraps the entire phone UI with:
//   - Top app bar (replaces Titlebar)
//   - Stack navigation (push/pop between screens)
//   - Bottom tab bar (5 tabs)
//   - Floating Action Button (new note)
//
// Only rendered when usePlatform().isMobile is true.

import { useState, useCallback, useMemo, type ReactNode } from 'react';
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

// ─── Mobile App Bar ──────────────────────────────────────────────────────────

interface MobileAppBarProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onSearch?: () => void;
  onMore?: () => void;
  rightActions?: ReactNode;
}

function MobileAppBar({ title, showBack, onBack, onSearch, onMore, rightActions }: MobileAppBarProps) {
  return (
    <header
      className="bg-zinc-950/95 backdrop-blur-lg flex items-center justify-between px-2 shrink-0 border-b border-zinc-800/40 z-40"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 'calc(48px + env(safe-area-inset-top, 0px))' }}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {showBack && (
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-zinc-400 active:bg-zinc-800 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <span className="text-sm font-semibold text-zinc-200 truncate px-2">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-1">
        {rightActions}
        {onSearch && (
          <button
            onClick={onSearch}
            className="p-2 rounded-lg text-zinc-400 active:bg-zinc-800 transition-colors"
          >
            <Search size={18} />
          </button>
        )}
        {onMore && (
          <button
            onClick={onMore}
            className="p-2 rounded-lg text-zinc-400 active:bg-zinc-800 transition-colors"
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
}

function FAB({ onClick }: FABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed right-4 z-40 w-14 h-14 rounded-2xl bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white shadow-lg shadow-purple-900/30 flex items-center justify-center transition-all active:scale-95"
      style={{ bottom: 'calc(4rem + max(env(safe-area-inset-bottom, 0px), 12px))' }}
      aria-label="New Note"
    >
      <Plus size={24} />
    </button>
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

  // Get the title for the app bar
  const appBarTitle = useMemo(() => {
    if (showingEditor) return 'Editor';
    if (activeTab === 'more' && activeMoreScreen) {
      const labels: Record<MoreSubTab, string> = {
        calendar: 'Calendar',
        email: 'Email',
        passwords: 'Vault',
        photos: 'Photos',
        cloud: 'Cloud',
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

  // Whether to show back button
  const showBack = showingEditor || (activeTab === 'more' && activeMoreScreen !== null);

  const handleBack = useCallback(() => {
    if (showingEditor) {
      onBackFromEditor();
    } else if (activeTab === 'more' && activeMoreScreen !== null) {
      setActiveMoreScreen(null);
    }
  }, [showingEditor, activeTab, activeMoreScreen, onBackFromEditor]);

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
    if (tab !== 'more') setActiveMoreScreen(null);
    if (tab !== 'study') setActiveStudyScreen(null);
    // When switching to notes tab, go back to list
    if (tab === 'notes' && hasSelectedNote) {
      onBackFromEditor();
    }
  }, [hasSelectedNote, onBackFromEditor]);

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
        // If a note is selected, show editor; otherwise show list
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
        // Recall and Sessions can be added when those views exist as standalone
        return questionsScreen; // Default to questions for now
      case 'more':
        if (activeMoreScreen === 'calendar') return calendarScreen;
        if (activeMoreScreen === 'email') return emailScreen;
        if (activeMoreScreen === 'passwords') return passwordsScreen;
        if (activeMoreScreen === 'photos') return photosScreen;
        if (activeMoreScreen === 'cloud') return cloudScreen;
        if (activeMoreScreen === 'messages') return messagesScreen;
        // Default: show a "More" menu grid
        return <MoreMenuGrid onSelect={handleMoreSelect} />;
      default:
        return notesListScreen;
    }
  };

  const showFAB = activeTab === 'notes' && !showingEditor;

  return (
    <div
      className="flex flex-col h-screen w-screen app-bg overflow-hidden select-none"
    >
      {/* Top app bar */}
      <MobileAppBar
        title={appBarTitle}
        showBack={showBack}
        onBack={handleBack}
        onSearch={!showingEditor ? onOpenSearch : undefined}
      />

      {/* Main content area */}
      <div className="flex-1 overflow-hidden relative">
        {renderContent()}
      </div>

      {/* FAB for new note */}
      {showFAB && <FAB onClick={onNewNote} />}

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
  const items: { id: MoreSubTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }[] = [
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, color: 'text-emerald-400' },
    { id: 'email', label: 'Email', icon: Mail, color: 'text-amber-400' },
    { id: 'messages', label: 'Messages', icon: MessageCircle, color: 'text-blue-400' },
    { id: 'passwords', label: 'Vault', icon: KeyRound, color: 'text-indigo-400' },
    { id: 'photos', label: 'Photos', icon: Image, color: 'text-rose-400' },
    { id: 'cloud', label: 'Cloud', icon: Cloud, color: 'text-sky-400' },
    { id: 'settings', label: 'Settings', icon: Settings, color: 'text-zinc-400' },
  ];

  return (
    <div className="p-4 grid grid-cols-3 gap-3">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className="flex flex-col items-center gap-2 p-5 rounded-2xl bg-zinc-900/50 border border-zinc-800/30 active:bg-zinc-800/70 transition-all"
          >
            <Icon size={24} className={item.color} />
            <span className="text-xs font-medium text-zinc-400">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
