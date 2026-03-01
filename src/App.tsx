
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";


import Sidebar from "@/components/ui/Sidebar";
import TabBar from "@/components/ui/TabBar";
import Titlebar from "@/components/ui/Titlebar";
import SearchModal from "@/components/ui/SearchModal";
import NoteTypePicker from "@/components/ui/NoteTypePicker";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import OnboardingFlow, { shouldShowOnboarding } from "@/components/ui/OnboardingFlow";
import { pb } from "@/lib/pocketbase";
import Editor from "@/components/editor/Editor";
import TodayPage from "@/components/editor/TodayPage";
import FlashcardView from "@/components/editor/FlashcardView";
import CollectionView from "@/components/editor/CollectionView";
import PropertiesPanel from "@/components/editor/PropertiesPanel";
import TopicQuery from "@/components/editor/TopicQuery";
import TrashView from "@/components/editor/TrashView";

import { remove } from "@tauri-apps/plugin-fs";
import { documentDir, join } from "@tauri-apps/api/path";
import { listen } from "@tauri-apps/api/event";

import { useSync } from "@/contexts/SyncContext";
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import SettingsModal from "@/components/settings/v2/SettingsModal";
import AuthModal from "@/components/auth/AuthModal";

import type { NoteType, FileMeta } from "@/types/sync";

// Mobile Layout
import { usePlatform } from "@/hooks/usePlatform";
import MobileShell from "@/components/layout/MobileShell";
import BottomSheet from "@/components/layout/BottomSheet";

// ─── Lazy-loaded module views (only loaded when workspace switches) ──
const MessagesView = lazy(() => import("@/components/messages/MessagesView"));
const CalendarView = lazy(() => import("@/components/calendar/CalendarView"));
const EmailView = lazy(() => import("@/components/email/EmailView"));
const PhotosView = lazy(() => import("@/components/photos/PhotosView"));
const PasswordsView = lazy(() => import("@/components/passwords/PasswordsView"));
const CloudView = lazy(() => import("@/components/cloud/CloudView"));
const QuestionLibrary = lazy(() => import("@/components/questions/QuestionLibrary"));
const CanvasView = lazy(() => import("@/components/canvas/CanvasView"));

import { useCanvasStore } from "@/store/canvasStore";

// ─── Shared lazy-load spinner ──
function ModuleLoader() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--onyx-bg)' }}>
      <div className="animate-pulse text-zinc-500 text-sm">Loading...</div>
    </div>
  );
}

const TODAY_SENTINEL = '__today__';
const FLASHCARD_SENTINEL = '__flashcards__';
const TRASH_SENTINEL = '__trash__';
const QUESTIONS_SENTINEL = '__questions__';
const CANVAS_PREFIX = '__canvas:'; // e.g. __canvas:abc123
const COLLECTION_PREFIX = '__collection:'; // e.g. __collection:task

function AppContent() {
  // Use Sync Context for File List (Single Source of Truth)
  const { files, deleteFile, createFile, updateFile } = useSync();
  const { toggleSettings, settings } = useSettings();
  const { activeWorkspace } = useWorkspace();
  const { isMobile, isTauri: isTauriPlatform } = usePlatform();

  // Local UI State
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<any>(pb.authStore.model);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => shouldShowOnboarding());

  // Mobile: track which note is open in the editor (separate from desktop tabs)
  const [mobileSelectedNoteId, setMobileSelectedNoteId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, model) => {
      setUser(model);
    });
    return () => { unsubscribe(); };
  }, []);

  // ─── Forward console messages from embedded Outlook WebView ──────
  useEffect(() => {
    if (!isTauriPlatform) return;

    let cancelled = false;
    const unlistenPromise = listen<{ level: string; message: string }>(
      'onyx-outlook-console',
      (event) => {
        if (cancelled) return;
        const { level, message } = event.payload;
        if (level === 'error') console.error('[Onyx Outlook]', message);
        else if (level === 'warn') console.warn('[Onyx Outlook]', message);
        else console.log('[Onyx Outlook]', message);
      },
    );

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Process imported notes from onboarding
  useEffect(() => {
    const pending = localStorage.getItem('onyx-import-pending');
    if (!pending) return;
    try {
      const notes: { name: string; content: string }[] = JSON.parse(pending);
      for (const note of notes) {
        const id = createFile();
        updateFile(id, { title: note.name || 'Imported Note' });
        // Content will be set as plain text in the note body via a custom event
        window.dispatchEvent(new CustomEvent('onyx:import-content', { detail: { noteId: id, content: note.content } }));
      }
    } catch {
      // ignore parse errors
    }
    localStorage.removeItem('onyx-import-pending');
  }, [createFile, updateFile]);

  const handleLogout = () => {
    pb.authStore.clear();
  };

  // Cleanup tabs when files are deleted remotely
  useEffect(() => {
    const loadedNoteIds = new Set(files.map(n => n.id));
    const isSentinel = (id: string) =>
      id === TODAY_SENTINEL || id === FLASHCARD_SENTINEL || id === TRASH_SENTINEL || id === QUESTIONS_SENTINEL || id.startsWith(COLLECTION_PREFIX) || id.startsWith(CANVAS_PREFIX);
    const validTabs = tabs.filter(tabId => isSentinel(tabId) || loadedNoteIds.has(tabId));

    if (validTabs.length !== tabs.length) {
      setTabs(validTabs);
      if (activeTabId !== null && !isSentinel(activeTabId) && !loadedNoteIds.has(activeTabId)) {
        setActiveTabId(validTabs.length > 0 ? validTabs[validTabs.length - 1] : null);
      }
    }
  }, [files, tabs, activeTabId]);

  // Listen for note-link navigation events from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.noteId) {
        openTab(detail.noteId, true);
      }
    };
    window.addEventListener('onyx:open-note', handler);
    return () => window.removeEventListener('onyx:open-note', handler);
  }, [tabs, activeTabId]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 't')) {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        if (!import.meta.env.VITE_DEMO_MODE) {
          toggleSettings(true);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setSidebarCollapsed(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (activeTabId !== null) {
          closeTab(activeTabId);
        }
      }
      if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId !== null) {
          const currentIndex = tabs.indexOf(activeTabId);
          const nextIndex = (currentIndex + 1) % tabs.length;
          setActiveTabId(tabs[nextIndex]);
        }
      }
      if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        if (tabs.length > 1 && activeTabId !== null) {
          const currentIndex = tabs.indexOf(activeTabId);
          const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          setActiveTabId(tabs[prevIndex]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, activeTabId]);

  const openTab = useCallback((id: string, forceNew: boolean = false) => {
    setTabs(prev => {
      if (prev.includes(id)) {
        setActiveTabId(id);
        return prev;
      }
      if (forceNew || prev.length === 0) {
        setActiveTabId(id);
        return [...prev, id];
      }
      setActiveTabId(id);
      return prev.map(t => t === activeTabId ? id : t);
    });
    setActiveTabId(id);
  }, [activeTabId]);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const currentIndex = prev.indexOf(id);
      const newTabs = prev.filter((t) => t !== id);
      if (activeTabId === id && newTabs.length > 0) {
        const nextIndex = Math.min(currentIndex, newTabs.length - 1);
        setActiveTabId(newTabs[nextIndex]);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }
      return newTabs;
    });
  }, [activeTabId]);

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      deleteFile(id);

      if (settings.mirrorEnabled) {
        try {
          let basePath = settings.mirrorPath;
          if (!basePath) {
            const docs = await documentDir();
            basePath = await join(docs, 'Onyx Notes');
          }
          const storedFilename = localStorage.getItem(`mirror-filename-${id}`);
          if (storedFilename) {
            const fileName = `${storedFilename}.md`;
            const fullPath = await join(basePath, fileName);

            if (settings.mirrorDeleteToBin) {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('move_to_trash', { path: fullPath });
            } else {
              await remove(fullPath);
            }
            localStorage.removeItem(`mirror-filename-${id}`);
          }
        } catch (err) {
          console.error('[App] Failed to delete mirror file:', err);
        }
      }

      closeTab(id);
    } catch (e) {
      console.error("Delete failed", e);
    }
  }, [deleteFile, settings.mirrorEnabled, settings.mirrorPath, settings.mirrorDeleteToBin, closeTab]);

  const handleSearchSelect = useCallback((id: string) => {
    openTab(id, true);
  }, [openTab]);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(prev => {
      const reorderedTabs = [...prev];
      const [moved] = reorderedTabs.splice(fromIndex, 1);
      reorderedTabs.splice(toIndex, 0, moved);
      return reorderedTabs;
    });
  }, []);

  const handleLockNote = async (_id: string, _password: string) => {
    console.warn("Locking not yet implemented");
  };

  // ─── New note via type picker ────────────────────────────────────
  const handleNewNoteWithType = useCallback(
    (type: NoteType) => {
      try {
        const newId = createFile('Untitled', type);
        openTab(newId, true);
        // On mobile, also select the new note for the editor
        if (isMobile) {
          setMobileSelectedNoteId(newId);
        }
      } catch (err) {
        console.error('Failed to create note:', err);
      }
    },
    [createFile, isMobile]
  );

  // ─── Go to Today Page ────────────────────────────────────────────
  const handleGoToToday = useCallback(() => {
    if (tabs.includes(TODAY_SENTINEL)) {
      setActiveTabId(TODAY_SENTINEL);
    } else {
      setTabs((prev) => [...prev, TODAY_SENTINEL]);
      setActiveTabId(TODAY_SENTINEL);
    }
  }, [tabs]);

  const handleGoToFlashcards = useCallback(() => {
    if (tabs.includes(FLASHCARD_SENTINEL)) {
      setActiveTabId(FLASHCARD_SENTINEL);
    } else {
      setTabs((prev) => [...prev, FLASHCARD_SENTINEL]);
      setActiveTabId(FLASHCARD_SENTINEL);
    }
  }, [tabs]);

  const handleGoToTrash = useCallback(() => {
    if (tabs.includes(TRASH_SENTINEL)) {
      setActiveTabId(TRASH_SENTINEL);
    } else {
      setTabs((prev) => [...prev, TRASH_SENTINEL]);
      setActiveTabId(TRASH_SENTINEL);
    }
  }, [tabs]);

  const handleGoToQuestions = useCallback(() => {
    if (tabs.includes(QUESTIONS_SENTINEL)) {
      setActiveTabId(QUESTIONS_SENTINEL);
    } else {
      setTabs((prev) => [...prev, QUESTIONS_SENTINEL]);
      setActiveTabId(QUESTIONS_SENTINEL);
    }
  }, [tabs]);

  const handleGoToCanvas = useCallback(() => {
    // Open the active canvas or create one, then open its tab
    const { canvases, createCanvas, activeCanvasId } = useCanvasStore.getState();
    let cid = activeCanvasId;
    if (!cid || !canvases.find((c) => c.id === cid)) {
      cid = createCanvas('Untitled Canvas');
    }
    const tabId = `${CANVAS_PREFIX}${cid}`;
    if (tabs.includes(tabId)) {
      setActiveTabId(tabId);
    } else {
      setTabs((prev) => [...prev, tabId]);
      setActiveTabId(tabId);
    }
  }, [tabs]);

  // ─── Open a collection view (all notes of a type) ────────────────
  const handleOpenCollection = useCallback((type: NoteType) => {
    const id = `${COLLECTION_PREFIX}${type}`;
    if (tabs.includes(id)) {
      setActiveTabId(id);
    } else {
      setTabs((prev) => [...prev, id]);
      setActiveTabId(id);
    }
  }, [tabs]);

  // ─── Active note metadata ────────────────────────────────────────
  const activeNoteMeta: FileMeta | undefined = useMemo(
    () => (activeTabId ? files.find((f) => f.id === activeTabId) : undefined),
    [activeTabId, files]
  );

  const isToday = activeTabId === TODAY_SENTINEL;
  const isFlashcards = activeTabId === FLASHCARD_SENTINEL;
  const isTrash = activeTabId === TRASH_SENTINEL;
  const isQuestions = activeTabId === QUESTIONS_SENTINEL;
  const isCanvas = activeTabId?.startsWith(CANVAS_PREFIX) ?? false;
  const canvasId = isCanvas ? activeTabId!.slice(CANVAS_PREFIX.length) : null;
  const isCollection = activeTabId?.startsWith(COLLECTION_PREFIX) ?? false;
  const collectionType = isCollection
    ? (activeTabId!.slice(COLLECTION_PREFIX.length) as NoteType)
    : null;
  const isTask = activeNoteMeta?.type === 'task';
  const isTopic = activeNoteMeta?.type === 'topic';

  // ─── Mobile: selected note metadata ─────────────────────────────
  const mobileNoteMeta: FileMeta | undefined = useMemo(
    () => (mobileSelectedNoteId ? files.find((f) => f.id === mobileSelectedNoteId) : undefined),
    [mobileSelectedNoteId, files]
  );

  // ─── Determine sidebar visibility per module ────────────────────
  const showNoteSidebar = activeWorkspace === 'notes';

  // ─── Render the active module content ────────────────────────────
  const renderModuleContent = () => {
    switch (activeWorkspace) {
      case 'notes':
        return (
          <div className="flex flex-col flex-1 overflow-hidden relative">
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              onCloseTab={closeTab}
              onReorderTabs={reorderTabs}
              notes={files}
            />

            <div className="flex flex-1 overflow-hidden">
              {/* Main editor / today area */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {isToday ? (
                  <ErrorBoundary fallbackTitle="Today page crashed">
                    <TodayPage onOpenNote={(id) => openTab(id, true)} />
                  </ErrorBoundary>
                ) : isFlashcards ? (
                  <ErrorBoundary fallbackTitle="Flashcards crashed">
                    <FlashcardView onOpenNote={(id) => openTab(id, true)} />
                  </ErrorBoundary>
                ) : isTrash ? (
                  <ErrorBoundary fallbackTitle="Trash view crashed">
                    <TrashView onOpenNote={(id) => openTab(id, true)} />
                  </ErrorBoundary>
                ) : isQuestions ? (
                  <Suspense fallback={<ModuleLoader />}>
                    <ErrorBoundary fallbackTitle="Question Library crashed">
                      <QuestionLibrary />
                    </ErrorBoundary>
                  </Suspense>
                ) : isCanvas && canvasId ? (
                  <Suspense fallback={<ModuleLoader />}>
                    <ErrorBoundary fallbackTitle="Canvas crashed">
                      <CanvasView canvasId={canvasId} />
                    </ErrorBoundary>
                  </Suspense>
                ) : isCollection && collectionType ? (
                  <ErrorBoundary fallbackTitle="Collection view crashed">
                    <CollectionView
                      type={collectionType}
                      onOpenNote={(id) => openTab(id, true)}
                      onNewNote={handleNewNoteWithType}
                    />
                  </ErrorBoundary>
                ) : (
                  <>
                    <ErrorBoundary fallbackTitle="Editor crashed">
                      <Editor
                        activeNoteId={activeTabId}
                        meta={activeNoteMeta}
                        onOpenProperties={() => setPropertiesPanelOpen(true)}
                      />
                    </ErrorBoundary>
                    {/* Topic auto-query section at bottom */}
                    {isTopic && activeNoteMeta && (
                      <TopicQuery
                        topicTitle={activeNoteMeta.title}
                        onOpenNote={(id) => openTab(id, true)}
                      />
                    )}
                  </>
                )}
              </div>

              {/* Properties panel on right */}
              {activeNoteMeta && propertiesPanelOpen && activeTabId && !isToday && !isFlashcards && (
                <ErrorBoundary fallbackTitle="Properties panel crashed">
                  <PropertiesPanel
                    noteId={activeTabId}
                    meta={activeNoteMeta}
                    onClose={() => setPropertiesPanelOpen(false)}
                  />
                </ErrorBoundary>
              )}
            </div>
          </div>
        );
      case 'messages':
        return <Suspense fallback={<ModuleLoader />}><ErrorBoundary fallbackTitle="Messages crashed"><MessagesView /></ErrorBoundary></Suspense>;
      case 'calendar':
        return <Suspense fallback={<ModuleLoader />}><ErrorBoundary fallbackTitle="Calendar crashed"><CalendarView /></ErrorBoundary></Suspense>;
      case 'email':
        return <Suspense fallback={<ModuleLoader />}><ErrorBoundary fallbackTitle="Email crashed"><EmailView /></ErrorBoundary></Suspense>;
      case 'photos':
        return <Suspense fallback={<ModuleLoader />}><ErrorBoundary fallbackTitle="Photos crashed"><PhotosView /></ErrorBoundary></Suspense>;
      case 'passwords':
        return <Suspense fallback={<ModuleLoader />}><ErrorBoundary fallbackTitle="Passwords crashed"><PasswordsView /></ErrorBoundary></Suspense>;
      case 'cloud':
        return <Suspense fallback={<ModuleLoader />}><ErrorBoundary fallbackTitle="Cloud crashed"><CloudView /></ErrorBoundary></Suspense>;
      default:
        return null;
    }
  };

  // Re-open properties panel when switching to a task note
  useEffect(() => {
    if (isTask) setPropertiesPanelOpen(true);
  }, [activeTabId, isTask]);

  // ─── Mobile Layout (Phone) ────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <MobileShell
          notesListScreen={
            <ErrorBoundary fallbackTitle="Notes list crashed">
              <Sidebar
                onSelectNote={(id) => {
                  openTab(id, true);
                  setMobileSelectedNoteId(id);
                }}
                activeNoteId={mobileSelectedNoteId}
                notes={files}
                openTabs={tabs}
                onDeleteNote={handleDeleteNote}
                onOpenSearch={() => setSearchOpen(true)}
                onLockNote={handleLockNote}
                onOpenAuth={() => toggleSettings(true)}
                onNewNote={() => setTypePickerOpen(true)}
                onGoToToday={handleGoToToday}
                onGoToFlashcards={handleGoToFlashcards}
                onOpenCollection={handleOpenCollection}
                onGoToTrash={handleGoToTrash}
                onGoToQuestions={handleGoToQuestions}
                onGoToCanvas={handleGoToCanvas}
              />
            </ErrorBoundary>
          }
          editorScreen={
            mobileSelectedNoteId ? (
              <ErrorBoundary fallbackTitle="Editor crashed">
                <Editor
                  activeNoteId={mobileSelectedNoteId}
                  meta={mobileNoteMeta}
                  onOpenProperties={() => setPropertiesPanelOpen(true)}
                />
              </ErrorBoundary>
            ) : null
          }
          hasSelectedNote={!!mobileSelectedNoteId}
          onBackFromEditor={() => setMobileSelectedNoteId(null)}
          todayScreen={
            <ErrorBoundary fallbackTitle="Today page crashed">
              <TodayPage onOpenNote={(id) => openTab(id, true)} />
            </ErrorBoundary>
          }
          flashcardsScreen={
            <ErrorBoundary fallbackTitle="Flashcards crashed">
              <FlashcardView onOpenNote={(id) => openTab(id, true)} />
            </ErrorBoundary>
          }
          questionsScreen={
            <ErrorBoundary fallbackTitle="Questions crashed">
              <QuestionLibrary />
            </ErrorBoundary>
          }
          calendarScreen={
            <ErrorBoundary fallbackTitle="Calendar crashed">
              <CalendarView />
            </ErrorBoundary>
          }
          emailScreen={
            <ErrorBoundary fallbackTitle="Email crashed">
              <EmailView />
            </ErrorBoundary>
          }
          passwordsScreen={
            <ErrorBoundary fallbackTitle="Passwords crashed">
              <PasswordsView />
            </ErrorBoundary>
          }
          photosScreen={
            <ErrorBoundary fallbackTitle="Photos crashed">
              <PhotosView />
            </ErrorBoundary>
          }
          cloudScreen={
            <ErrorBoundary fallbackTitle="Cloud crashed">
              <CloudView />
            </ErrorBoundary>
          }
          messagesScreen={
            <ErrorBoundary fallbackTitle="Messages crashed">
              <MessagesView sidebarCollapsed />
            </ErrorBoundary>
          }
          onOpenSearch={() => setSearchOpen(true)}
          onNewNote={() => setTypePickerOpen(true)}
          onOpenSettings={() => toggleSettings(true)}
        />

        {/* Properties as bottom sheet on mobile */}
        <BottomSheet
          isOpen={propertiesPanelOpen && !!activeNoteMeta}
          onClose={() => setPropertiesPanelOpen(false)}
          title="Properties"
        >
          {activeNoteMeta && activeTabId && (
            <PropertiesPanel
              noteId={activeTabId}
              meta={activeNoteMeta}
              onClose={() => setPropertiesPanelOpen(false)}
            />
          )}
        </BottomSheet>

        <SearchModal
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
          notes={files}
          onSelectNote={handleSearchSelect}
        />

        <SettingsModal user={user} onLogout={handleLogout} />
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        <NoteTypePicker
          isOpen={typePickerOpen}
          onClose={() => setTypePickerOpen(false)}
          onSelect={handleNewNoteWithType}
        />

        {showOnboarding && (
          <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
        )}
      </>
    );
  }

  // ─── Desktop / Tablet Layout ──────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen app-bg overflow-hidden select-none rounded-lg relative">
      <Titlebar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Notes sidebar — only shown for notes workspace */}
        {showNoteSidebar && (
          <div
            className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${sidebarCollapsed ? 'w-0' : 'w-55'}`}
          >
            <ErrorBoundary fallbackTitle="Sidebar crashed">
              <Sidebar
                onSelectNote={openTab}
                activeNoteId={activeTabId}
                notes={files}
                openTabs={tabs}
                onDeleteNote={handleDeleteNote}
                onOpenSearch={() => setSearchOpen(true)}
                onLockNote={handleLockNote}
                onOpenAuth={() => toggleSettings(true)}
                onNewNote={() => setTypePickerOpen(true)}
                onGoToToday={handleGoToToday}
                onGoToFlashcards={handleGoToFlashcards}
                onOpenCollection={handleOpenCollection}
                onGoToTrash={handleGoToTrash}
                onGoToQuestions={handleGoToQuestions}
                onGoToCanvas={handleGoToCanvas}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* Main content area — switches based on active workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderModuleContent()}
        </div>
      </div>

      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        notes={files}
        onSelectNote={handleSearchSelect}
      />

      <SettingsModal
        user={user}
        onLogout={handleLogout}
      />

      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
      />

      <NoteTypePicker
        isOpen={typePickerOpen}
        onClose={() => setTypePickerOpen(false)}
        onSelect={handleNewNoteWithType}
      />

      {/* Onboarding overlay — first launch only */}
      {showOnboarding && (
        <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <WorkspaceProvider>
        <AppContent />
      </WorkspaceProvider>
    </SettingsProvider>
  );
}