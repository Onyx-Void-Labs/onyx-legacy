
import { useState, useEffect, useMemo, useCallback } from "react";


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

import { useSync } from "@/contexts/SyncContext";
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import SettingsModal from "@/components/settings/v2/SettingsModal";
import AuthModal from "@/components/auth/AuthModal";

import type { NoteType, FileMeta } from "@/types/sync";

// Module Views
import MessagesView from "@/components/messages/MessagesView";
import CalendarView from "@/components/calendar/CalendarView";
import EmailView from "@/components/email/EmailView";
import PhotosView from "@/components/photos/PhotosView";
import PasswordsView from "@/components/passwords/PasswordsView";
import CloudView from "@/components/cloud/CloudView";
import QuestionLibrary from "@/components/questions/QuestionLibrary";
import CanvasView from "@/components/canvas/CanvasView";
import { useCanvasStore } from "@/store/canvasStore";

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

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange((_token, model) => {
      setUser(model);
    });
    return () => { unsubscribe(); };
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

  const openTab = (id: string, forceNew: boolean = false) => {
    if (tabs.includes(id)) {
      setActiveTabId(id);
      return;
    }
    if (forceNew || tabs.length === 0 || activeTabId === null) {
      setTabs([...tabs, id]);
      setActiveTabId(id);
    } else {
      if (activeTabId !== null) {
        const newTabs = tabs.map(t => t === activeTabId ? id : t);
        setTabs(newTabs);
        setActiveTabId(id);
      } else {
        setTabs([id]);
        setActiveTabId(id);
      }
    }
  };

  const closeTab = (id: string) => {
    const currentIndex = tabs.indexOf(id);
    const newTabs = tabs.filter((t) => t !== id);
    setTabs(newTabs);
    if (activeTabId === id && newTabs.length > 0) {
      const nextIndex = Math.min(currentIndex, newTabs.length - 1);
      setActiveTabId(newTabs[nextIndex]);
    } else if (newTabs.length === 0) {
      setActiveTabId(null);
    }
  };

  const handleDeleteNote = async (id: string) => {
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
  };

  const handleSearchSelect = (id: string) => {
    openTab(id, true);
  };

  const reorderTabs = (fromIndex: number, toIndex: number) => {
    const reorderedTabs = [...tabs];
    const [moved] = reorderedTabs.splice(fromIndex, 1);
    reorderedTabs.splice(toIndex, 0, moved);
    setTabs(reorderedTabs);
  };

  const handleLockNote = async (_id: string, _password: string) => {
    console.warn("Locking not yet implemented for Pure Yjs");
  };

  // ─── New note via type picker ────────────────────────────────────
  const handleNewNoteWithType = useCallback(
    (type: NoteType) => {
      try {
        const newId = createFile('Untitled', type);
        openTab(newId, true);
      } catch (err) {
        console.error('Failed to create note:', err);
      }
    },
    [createFile]
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
                  <ErrorBoundary fallbackTitle="Question Library crashed">
                    <QuestionLibrary />
                  </ErrorBoundary>
                ) : isCanvas && canvasId ? (
                  <ErrorBoundary fallbackTitle="Canvas crashed">
                    <CanvasView canvasId={canvasId} />
                  </ErrorBoundary>
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
        return <ErrorBoundary fallbackTitle="Messages crashed"><MessagesView /></ErrorBoundary>;
      case 'calendar':
        return <ErrorBoundary fallbackTitle="Calendar crashed"><CalendarView /></ErrorBoundary>;
      case 'email':
        return <ErrorBoundary fallbackTitle="Email crashed"><EmailView /></ErrorBoundary>;
      case 'photos':
        return <ErrorBoundary fallbackTitle="Photos crashed"><PhotosView /></ErrorBoundary>;
      case 'passwords':
        return <ErrorBoundary fallbackTitle="Passwords crashed"><PasswordsView /></ErrorBoundary>;
      case 'cloud':
        return <ErrorBoundary fallbackTitle="Cloud crashed"><CloudView /></ErrorBoundary>;
      default:
        return null;
    }
  };

  // Re-open properties panel when switching to a task note
  useEffect(() => {
    if (isTask) setPropertiesPanelOpen(true);
  }, [activeTabId, isTask]);

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