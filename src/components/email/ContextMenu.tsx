/**
 * ContextMenu.tsx — Reusable right-click context menu for email UI.
 * Positioned relative to the click position, auto-closes on outside click.
 */

import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    separator?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    // Clamp position to viewport
    useEffect(() => {
        if (!menuRef.current) return;
        const rect = menuRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (rect.right > vw) menuRef.current.style.left = `${vw - rect.width - 8}px`;
        if (rect.bottom > vh) menuRef.current.style.top = `${vh - rect.height - 8}px`;
    }, [x, y]);

    return (
        <div
            ref={menuRef}
            className="fixed z-9999 min-w-45 py-1 bg-zinc-800 border border-zinc-700/40 rounded-lg shadow-2xl backdrop-blur-sm"
            style={{ left: x, top: y }}
        >
            {items.map((item, i) => (
                <div key={i}>
                    {item.separator && <div className="my-1 h-px bg-zinc-700/40" />}
                    <button
                        onClick={() => { item.onClick(); onClose(); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
                            item.danger
                                ? 'text-red-400 hover:bg-red-500/10'
                                : 'text-zinc-300 hover:bg-zinc-700/50'
                        }`}
                    >
                        {item.icon && <span className="w-4 flex items-center justify-center">{item.icon}</span>}
                        {item.label}
                    </button>
                </div>
            ))}
        </div>
    );
}
