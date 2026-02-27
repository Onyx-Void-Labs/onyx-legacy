import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X, PanelLeftClose, PanelLeft, PenLine, MessageCircle, CalendarDays, Mail, Image, Cloud, KeyRound, LayoutGrid, Settings, ChevronDown, Info, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useWorkspace, MODULE_ORDER, MODULES, type WorkspaceModule } from '../../contexts/WorkspaceContext';
import { useSettings } from '../../contexts/SettingsContext';
import SyncStatusIndicator from './SyncStatusIndicator';

// Map module IDs → Lucide icon components
const MODULE_ICONS: Record<WorkspaceModule, React.ComponentType<{ size?: number; className?: string }>> = {
    notes: PenLine,
    messages: MessageCircle,
    calendar: CalendarDays,
    email: Mail,
    photos: Image,
    passwords: KeyRound,
    cloud: Cloud,
};

interface TitlebarProps {
    sidebarCollapsed: boolean;
    onToggleSidebar: () => void;
}

export default function Titlebar({ sidebarCollapsed, onToggleSidebar }: TitlebarProps) {
    // Robust detection for Tauri v2 window
    let appWindow: any = null;
    // @ts-ignore
    const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

    if (isTauri) {
        try {
            // @ts-ignore
            appWindow = getCurrentWindow();
        } catch {
            // Silent catch
        }
    }
    const { activeWorkspace, setActiveWorkspace, enabledModules } = useWorkspace();
    const { toggleSettings } = useSettings();

    const [menuOpen, setMenuOpen] = useState(false);
    const [switcherOpen, setSwitcherOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const switcherRef = useRef<HTMLDivElement>(null);

    // Zoom State
    const [zoomLevel, setZoomLevel] = useState(() => {
        const saved = localStorage.getItem('onyx-zoom');
        return saved ? parseFloat(saved) : 1;
    });

    const handleZoom = (delta: number, reset = false) => {
        setZoomLevel((prev) => {
            let next = reset ? 1 : prev + delta;
            next = Math.min(Math.max(next, 0.5), 2);
            localStorage.setItem('onyx-zoom', next.toString());
            document.documentElement.style.setProperty('--app-zoom', next.toString());
            document.documentElement.style.fontSize = `${next * 16}px`;
            return next;
        });
    };

    useEffect(() => {
        document.documentElement.style.setProperty('--app-zoom', zoomLevel.toString());
        document.documentElement.style.fontSize = `${zoomLevel * 16}px`;
    }, []);

    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                handleZoom(e.deltaY > 0 ? -0.1 : 0.1);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoom(0.1); }
                else if (e.key === '-') { e.preventDefault(); handleZoom(-0.1); }
                else if (e.key === '0') { e.preventDefault(); handleZoom(0, true); }
            }
            // Ctrl+Shift+M toggles app switcher
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
                e.preventDefault();
                setSwitcherOpen(prev => !prev);
            }
        };
        window.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('keydown', handleKey);
        };
    }, []);

    const handleMinimize = () => appWindow?.minimize();
    const handleMaximize = () => appWindow?.toggleMaximize();
    const handleClose = () => appWindow?.close();

    // Close ONYX menu on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        window.addEventListener('mousedown', handleClick);
        return () => window.removeEventListener('mousedown', handleClick);
    }, [menuOpen]);

    // Close app switcher on outside click / Escape
    useEffect(() => {
        if (!switcherOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false);
        };
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSwitcherOpen(false); };
        window.addEventListener('mousedown', handleClick);
        window.addEventListener('keydown', handleKey);
        return () => { window.removeEventListener('mousedown', handleClick); window.removeEventListener('keydown', handleKey); };
    }, [switcherOpen]);

    useEffect(() => {
        if (!menuOpen) return;
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [menuOpen]);

    const visibleModules = MODULE_ORDER.filter((m) => enabledModules.includes(m));
    const activeConfig = MODULES[activeWorkspace];
    const ActiveIcon = MODULE_ICONS[activeWorkspace];

    return (
        <header
            className="h-11 bg-zinc-950/90 backdrop-blur-md flex items-center justify-between select-none shrink-0 border-b border-zinc-800/40 z-50 relative"
            data-tauri-drag-region
            onDoubleClick={(e) => {
                if ((e.target as HTMLElement).dataset.tauriDragRegion !== undefined) handleMaximize();
            }}
        >
            {/* LEFT: Sidebar Toggle + ONYX Branding */}
            <div className="flex items-center gap-1 px-2 min-w-48 h-full">
                <button
                    onClick={onToggleSidebar}
                    className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                    title={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
                >
                    {sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
                </button>

                {/* ONYX branding + menu */}
                {!import.meta.env.VITE_DEMO_MODE && (
                    <div className="relative" ref={menuRef}>
                        <button
                            onClick={() => setMenuOpen(!menuOpen)}
                            className={`flex items-center gap-1.5 ml-1 px-2 py-1 rounded-lg transition-all duration-150 ${
                                menuOpen ? 'bg-zinc-800 shadow-sm' : 'hover:bg-zinc-800/60'
                            }`}
                        >
                            <span className="text-zinc-100 font-extrabold tracking-widest text-[11px]">
                                ONYX<span className="text-purple-400">.</span>
                            </span>
                            <ChevronDown
                                size={11}
                                className={`text-zinc-500 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {menuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-900 border border-zinc-800/80 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-9999"
                                style={{ animation: 'fadeIn 0.15s ease-out' }}
                            >
                                <div className="p-1.5 border-b border-zinc-800/50">
                                    <button
                                        onClick={() => { toggleSettings(true); setMenuOpen(false); }}
                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                                    >
                                        <Settings size={15} className="text-zinc-500" />
                                        <span>Settings</span>
                                        <span className="ml-auto text-[10px] text-zinc-600 font-medium">Ctrl+,</span>
                                    </button>
                                </div>
                                <div className="p-1.5 border-b border-zinc-800/50">
                                    <div className="flex items-center justify-between px-3 py-1.5 mb-1">
                                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Zoom</span>
                                        <span className="text-[10px] text-zinc-400 font-mono bg-zinc-800/50 px-1.5 py-0.5 rounded">
                                            {Math.round(zoomLevel * 100)}%
                                        </span>
                                    </div>
                                    <button onClick={() => handleZoom(0.1)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors">
                                        <ZoomIn size={15} className="text-zinc-500" />
                                        <span>Zoom In</span>
                                        <span className="ml-auto text-[10px] text-zinc-600 font-medium">Ctrl++</span>
                                    </button>
                                    <button onClick={() => handleZoom(-0.1)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors">
                                        <ZoomOut size={15} className="text-zinc-500" />
                                        <span>Zoom Out</span>
                                        <span className="ml-auto text-[10px] text-zinc-600 font-medium">Ctrl+-</span>
                                    </button>
                                    <button onClick={() => handleZoom(0, true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors">
                                        <RotateCcw size={15} className="text-zinc-500" />
                                        <span>Reset</span>
                                        <span className="ml-auto text-[10px] text-zinc-600 font-medium">Ctrl+0</span>
                                    </button>
                                </div>
                                <div className="p-1.5">
                                    <button
                                        onClick={() => { toggleSettings(true); setMenuOpen(false); }}
                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                                    >
                                        <Info size={15} className="text-zinc-500" />
                                        <span>About ONYX</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* CENTER: Active module name — focused mode */}
            <div className="flex items-center h-full flex-1 justify-center gap-2" data-tauri-drag-region>
                <div className="flex items-center gap-2 text-zinc-400">
                    <ActiveIcon size={14} className="text-purple-400" />
                    <span className="text-[12px] font-semibold tracking-wide text-zinc-300">
                        ONYX<span className="text-purple-400">.</span> {activeConfig.label}
                    </span>
                </div>
            </div>

            {/* RIGHT: App Switcher + Window Controls */}
            <div className="flex items-center h-full min-w-48 justify-end" data-tauri-drag-region>
                {/* App switcher grid icon */}
                <div className="relative" ref={switcherRef}>
                    <button
                        onClick={() => setSwitcherOpen(!switcherOpen)}
                        className={`p-1.5 rounded-md transition-all duration-150 mr-1 ${
                            switcherOpen
                                ? 'bg-purple-500/15 text-purple-300'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                        }`}
                        title="App Switcher (Ctrl+Shift+M)"
                    >
                        <LayoutGrid size={16} />
                    </button>

                    {/* App Switcher Popover */}
                    {switcherOpen && (
                        <div
                            className="absolute top-full right-0 mt-1.5 w-64 bg-zinc-900 border border-zinc-800/80 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-9999 origin-top-right"
                            style={{ animation: 'fadeIn 0.15s ease-out' }}
                        >
                            <div className="p-2">
                                <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-2 py-1.5">
                                    Modules
                                </div>
                                <div className="grid grid-cols-3 gap-1 mt-1">
                                    {visibleModules
                                        .filter((m) => !(import.meta.env.VITE_DEMO_MODE && m === 'photos'))
                                        .map((moduleId) => {
                                            const config = MODULES[moduleId];
                                            const isActive = activeWorkspace === moduleId;
                                            const Icon = MODULE_ICONS[moduleId];

                                            return (
                                                <button
                                                    key={moduleId}
                                                    onClick={() => {
                                                        setActiveWorkspace(moduleId);
                                                        setSwitcherOpen(false);
                                                    }}
                                                    className={`
                                                        flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all duration-150
                                                        ${isActive
                                                            ? 'bg-purple-500/15 text-purple-300 shadow-sm shadow-purple-500/10'
                                                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                                                        }
                                                    `}
                                                >
                                                    <Icon size={20} className={isActive ? 'text-purple-400' : ''} />
                                                    <span className="text-[10px] font-medium">{config.label}</span>
                                                </button>
                                            );
                                        })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Window Controls — hidden in demo mode */}
                <SyncStatusIndicator />
                {!import.meta.env.VITE_DEMO_MODE && (
                    <>
                        <button onClick={handleMinimize} className="h-full w-11 flex items-center justify-center hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors">
                            <Minus size={14} />
                        </button>
                        <button onClick={handleMaximize} className="h-full w-11 flex items-center justify-center hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors">
                            <Square size={11} />
                        </button>
                        <button onClick={handleClose} className="h-full w-11 flex items-center justify-center hover:bg-red-500 text-zinc-500 hover:text-white transition-colors">
                            <X size={15} />
                        </button>
                    </>
                )}
            </div>
        </header>
    );
}
