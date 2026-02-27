/**
 * CanvasView.tsx — Full infinite canvas with draggable nodes, edges, panning, zooming.
 * Built with native React + SVG — no external dependencies required.
 * Supports node types: note-card, text, sticky, shape.
 * Features: pan (middle-click/space+drag), zoom (scroll), drag nodes, connect nodes, minimap.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
    Plus,
    Type,
    StickyNote,
    Square,
    Circle,
    Diamond,
    Trash2,
    ZoomIn,
    ZoomOut,
    Maximize2,
    X,
    FileText,
    Move,
    Link2,
} from 'lucide-react';
import { useCanvasStore, type CanvasNode, type CanvasEdge, type CanvasNodeData } from '../../store/canvasStore';
import { useFeature } from '../../hooks/useFeature';

/* ─── Constants ──────────────────────────────────────────────── */

const NODE_DEFAULTS: Record<string, Partial<CanvasNodeData>> = {
    'note-card': { label: 'New Note', color: '#7c6ef7', width: 200, height: 120 },
    'text': { label: 'Text', color: '#a1a1aa', fontSize: 14, width: 160, height: 40 },
    'sticky': { label: 'Sticky Note', color: '#fbbf24', width: 180, height: 140 },
    'shape': { label: '', color: '#7c6ef7', shape: 'rectangle', width: 120, height: 80 },
};

// Available shape colors for the color picker
const _SHAPE_COLORS = ['#7c6ef7', '#f43f5e', '#06b6d4', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
void _SHAPE_COLORS;

function generateId(): string {
    return 'n' + Math.random().toString(36).slice(2, 9);
}

/* ─── Node Renderer ──────────────────────────────────────────── */

function CanvasNodeComponent({
    node,
    isSelected,
    onSelect,
    onDragStart,
    onUpdateLabel,
    onDelete,
}: {
    node: CanvasNode;
    isSelected: boolean;
    onSelect: () => void;
    onDragStart: (e: React.MouseEvent) => void;
    onUpdateLabel: (label: string) => void;
    onDelete: () => void;
    zoom?: number;
}) {
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(node.data.label);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const width = node.data.width ?? 180;
    const height = node.data.height ?? 100;

    const nodeStyle: React.CSSProperties = {
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        width,
        minHeight: height,
        zIndex: isSelected ? 20 : 10,
        transform: `scale(${1})`,
        cursor: 'grab',
    };

    const getNodeContent = () => {
        switch (node.type) {
            case 'sticky':
                return (
                    <div
                        style={{ backgroundColor: node.data.color ?? '#fbbf24' }}
                        className="rounded-md p-3 shadow-lg h-full"
                        onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }}
                        onClick={(e) => { e.stopPropagation(); onSelect(); }}
                        onDoubleClick={() => setEditing(true)}
                    >
                        {editing ? (
                            <textarea
                                ref={inputRef}
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onBlur={() => { onUpdateLabel(editText); setEditing(false); }}
                                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); } }}
                                className="w-full h-full bg-transparent text-zinc-900 text-[13px] resize-none outline-none"
                            />
                        ) : (
                            <p className="text-[13px] text-zinc-900 font-medium whitespace-pre-wrap">{node.data.label}</p>
                        )}
                    </div>
                );

            case 'text':
                return (
                    <div
                        className="p-1"
                        onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }}
                        onClick={(e) => { e.stopPropagation(); onSelect(); }}
                        onDoubleClick={() => setEditing(true)}
                    >
                        {editing ? (
                            <textarea
                                ref={inputRef}
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onBlur={() => { onUpdateLabel(editText); setEditing(false); }}
                                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); } }}
                                className="w-full bg-transparent text-zinc-200 text-[14px] resize-none outline-none"
                                style={{ fontSize: node.data.fontSize ?? 14 }}
                            />
                        ) : (
                            <p className="text-zinc-200 whitespace-pre-wrap" style={{ fontSize: node.data.fontSize ?? 14 }}>
                                {node.data.label}
                            </p>
                        )}
                    </div>
                );

            case 'shape': {
                const shapeClass = node.data.shape === 'ellipse'
                    ? 'rounded-full'
                    : node.data.shape === 'diamond'
                        ? 'rotate-45'
                        : node.data.shape === 'rounded'
                            ? 'rounded-2xl'
                            : 'rounded-md';
                return (
                    <div
                        className={`${shapeClass} border-2 flex items-center justify-center h-full`}
                        style={{ borderColor: node.data.color ?? '#7c6ef7', backgroundColor: `${node.data.color ?? '#7c6ef7'}15` }}
                        onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }}
                        onClick={(e) => { e.stopPropagation(); onSelect(); }}
                        onDoubleClick={() => setEditing(true)}
                    >
                        {editing ? (
                            <textarea
                                ref={inputRef}
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onBlur={() => { onUpdateLabel(editText); setEditing(false); }}
                                onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); } }}
                                className={`w-full bg-transparent text-zinc-200 text-[13px] text-center resize-none outline-none ${node.data.shape === 'diamond' ? '-rotate-45' : ''}`}
                            />
                        ) : (
                            <span className={`text-[13px] text-zinc-300 ${node.data.shape === 'diamond' ? '-rotate-45' : ''}`}>
                                {node.data.label}
                            </span>
                        )}
                    </div>
                );
            }

            default: // note-card
                return (
                    <div
                        className="rounded-lg border border-zinc-700/60 bg-zinc-800/90 shadow-lg backdrop-blur-sm overflow-hidden h-full flex flex-col"
                        onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }}
                        onClick={(e) => { e.stopPropagation(); onSelect(); }}
                        onDoubleClick={() => setEditing(true)}
                    >
                        <div className="h-1 w-full" style={{ backgroundColor: node.data.color ?? '#7c6ef7' }} />
                        <div className="p-3 flex-1">
                            {editing ? (
                                <textarea
                                    ref={inputRef}
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onBlur={() => { onUpdateLabel(editText); setEditing(false); }}
                                    onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); } }}
                                    className="w-full bg-transparent text-zinc-200 text-[13px] resize-none outline-none"
                                />
                            ) : (
                                <>
                                    <h4 className="text-[13px] font-semibold text-zinc-200 mb-1">{node.data.label}</h4>
                                    {node.data.content && (
                                        <p className="text-[11px] text-zinc-400 line-clamp-4">{node.data.content}</p>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div style={nodeStyle}>
            {getNodeContent()}
            {isSelected && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500/80 rounded-full flex items-center justify-center text-white hover:bg-red-500 transition-colors cursor-pointer z-30"
                >
                    <X size={10} />
                </button>
            )}
        </div>
    );
}

/* ─── Edge Renderer (SVG) ────────────────────────────────────── */

function EdgeLine({
    edge,
    nodes,
    isSelected,
    onSelect,
}: {
    edge: CanvasEdge;
    nodes: CanvasNode[];
    isSelected: boolean;
    onSelect: () => void;
}) {
    const src = nodes.find((n) => n.id === edge.source);
    const tgt = nodes.find((n) => n.id === edge.target);
    if (!src || !tgt) return null;

    const srcW = src.data.width ?? 180;
    const srcH = src.data.height ?? 100;
    const tgtW = tgt.data.width ?? 180;
    const tgtH = tgt.data.height ?? 100;

    const x1 = src.position.x + srcW / 2;
    const y1 = src.position.y + srcH / 2;
    const x2 = tgt.position.x + tgtW / 2;
    const y2 = tgt.position.y + tgtH / 2;

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    return (
        <g onClick={(e) => { e.stopPropagation(); onSelect(); }}>
            {/* Hit area */}
            <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="transparent"
                strokeWidth={12}
                style={{ cursor: 'pointer' }}
            />
            {/* Visible line */}
            <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isSelected ? '#7c6ef7' : '#52525b'}
                strokeWidth={isSelected ? 2.5 : 1.5}
                strokeDasharray={edge.animated ? '6 4' : undefined}
                markerEnd="url(#arrowhead)"
            />
            {edge.label && (
                <text
                    x={midX} y={midY - 8}
                    fill="#a1a1aa"
                    fontSize={11}
                    textAnchor="middle"
                    className="select-none pointer-events-none"
                >
                    {edge.label}
                </text>
            )}
        </g>
    );
}

/* ─── Main Canvas View ───────────────────────────────────────── */

interface CanvasViewProps {
    canvasId: string;
}

export default function CanvasView({ canvasId }: CanvasViewProps) {
    const canvasEnabled = useFeature('canvas');
    const {
        canvases,
        addNode,
        updateNode,
        removeNode,
        addEdge,
        removeEdge,
        updateViewport,
    } = useCanvasStore();

    const canvas = useMemo(
        () => canvases.find((c) => c.id === canvasId),
        [canvases, canvasId]
    );

    const [viewport, setViewport] = useState(canvas?.viewport ?? { x: 0, y: 0, zoom: 1 });
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [isPanning, setIsPanning] = useState(false);
    const [dragState, setDragState] = useState<{ nodeId: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
    const [connectStart, setConnectStart] = useState<string | null>(null);
    const [showToolbar] = useState(true);

    const containerRef = useRef<HTMLDivElement>(null);
    const panStartRef = useRef<{ x: number; y: number; vpX: number; vpY: number } | null>(null);

    if (!canvasEnabled || !canvas) {
        return (
            <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--onyx-bg)' }}>
                <p className="text-zinc-500 text-sm">Canvas is not available.</p>
            </div>
        );
    }

    const nodes = canvas.nodes;
    const edges = canvas.edges;

    /* ── Handlers ─────────────────────────────────── */

    const addNewNode = (type: CanvasNode['type'], shape?: string) => {
        const defaults = NODE_DEFAULTS[type] ?? NODE_DEFAULTS['note-card'];
        const node: CanvasNode = {
            id: generateId(),
            type,
            position: {
                x: (-viewport.x + 400) / viewport.zoom,
                y: (-viewport.y + 300) / viewport.zoom,
            },
            data: {
                ...defaults,
                label: defaults.label ?? 'New Node',
                shape: shape as any ?? defaults.shape,
            } as CanvasNodeData,
        };
        addNode(canvasId, node);
        setSelectedNodeId(node.id);
    };

    const handleNodeDragStart = (nodeId: string) => (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;
        setDragState({
            nodeId,
            startX: e.clientX,
            startY: e.clientY,
            originX: node.position.x,
            originY: node.position.y,
        });
        setSelectedNodeId(nodeId);
        setSelectedEdgeId(null);
    };

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        // Node dragging
        if (dragState) {
            const dx = (e.clientX - dragState.startX) / viewport.zoom;
            const dy = (e.clientY - dragState.startY) / viewport.zoom;
            updateNode(canvasId, dragState.nodeId, {
                position: {
                    x: dragState.originX + dx,
                    y: dragState.originY + dy,
                },
            });
            return;
        }

        // Panning
        if (isPanning && panStartRef.current) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            setViewport({
                ...viewport,
                x: panStartRef.current.vpX + dx,
                y: panStartRef.current.vpY + dy,
            });
        }
    }, [dragState, isPanning, viewport, canvasId, updateNode]);

    const handleMouseUp = useCallback(() => {
        if (dragState) {
            setDragState(null);
        }
        if (isPanning) {
            setIsPanning(false);
            panStartRef.current = null;
            updateViewport(canvasId, viewport);
        }
    }, [dragState, isPanning, canvasId, viewport, updateViewport]);

    const handleMouseDown = (e: React.MouseEvent) => {
        // Middle mouse or space+left click for panning
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            e.preventDefault();
            setIsPanning(true);
            panStartRef.current = { x: e.clientX, y: e.clientY, vpX: viewport.x, vpY: viewport.y };
            return;
        }
        // Left click on background = deselect
        if (e.button === 0 && e.target === e.currentTarget) {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            if (connectStart) {
                setConnectStart(null);
            }
        }
    };

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.min(Math.max(viewport.zoom * delta, 0.1), 5);

        // Zoom towards cursor position
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const newX = mx - (mx - viewport.x) * (newZoom / viewport.zoom);
            const newY = my - (my - viewport.y) * (newZoom / viewport.zoom);
            setViewport({ x: newX, y: newY, zoom: newZoom });
        } else {
            setViewport({ ...viewport, zoom: newZoom });
        }
    }, [viewport]);

    const handleConnect = (nodeId: string) => {
        if (!connectStart) {
            setConnectStart(nodeId);
        } else if (connectStart !== nodeId) {
            addEdge(canvasId, {
                id: generateId(),
                source: connectStart,
                target: nodeId,
            });
            setConnectStart(null);
        } else {
            setConnectStart(null);
        }
    };

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedNodeId && !(document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement)) {
                removeNode(canvasId, selectedNodeId);
                setSelectedNodeId(null);
            }
            if (selectedEdgeId) {
                removeEdge(canvasId, selectedEdgeId);
                setSelectedEdgeId(null);
            }
        }
        if (e.key === 'Escape') {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
            setConnectStart(null);
        }
    }, [selectedNodeId, selectedEdgeId, canvasId, removeNode, removeEdge]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const zoomPercent = Math.round(viewport.zoom * 100);

    return (
        <div
            ref={containerRef}
            className="flex-1 relative overflow-hidden select-none"
            style={{ background: '#0d0d10', cursor: isPanning ? 'grabbing' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            {/* ── Canvas content (panned + zoomed) ─────────────── */}
            <div
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                    transformOrigin: '0 0',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                }}
            >
                {/* Grid dots */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ width: 10000, height: 10000, left: -5000, top: -5000 }}>
                    <defs>
                        <pattern id="grid-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                            <circle cx="1" cy="1" r="1" fill="#27272a" />
                        </pattern>
                        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                            <polygon points="0 0, 8 3, 0 6" fill="#52525b" />
                        </marker>
                    </defs>
                    <rect x="0" y="0" width="100%" height="100%" fill="url(#grid-dots)" />
                </svg>

                {/* Edges SVG */}
                <svg className="absolute inset-0 pointer-events-none" style={{ width: 10000, height: 10000, left: -5000, top: -5000, overflow: 'visible' }}>
                    <g className="pointer-events-auto">
                        {edges.map((edge) => (
                            <EdgeLine
                                key={edge.id}
                                edge={edge}
                                nodes={nodes}
                                isSelected={selectedEdgeId === edge.id}
                                onSelect={() => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
                            />
                        ))}
                    </g>
                </svg>

                {/* Nodes */}
                {nodes.map((node) => (
                    <CanvasNodeComponent
                        key={node.id}
                        node={node}
                        isSelected={selectedNodeId === node.id}
                        onSelect={() => {
                            if (connectStart) {
                                handleConnect(node.id);
                            } else {
                                setSelectedNodeId(node.id);
                                setSelectedEdgeId(null);
                            }
                        }}
                        onDragStart={handleNodeDragStart(node.id)}
                        onUpdateLabel={(label) => updateNode(canvasId, node.id, { data: { ...node.data, label } })}
                        onDelete={() => { removeNode(canvasId, node.id); setSelectedNodeId(null); }}
                    />
                ))}
            </div>

            {/* ── Floating Toolbar ─────────────────────────────── */}
            {showToolbar && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-zinc-900/90 border border-zinc-700/50 backdrop-blur-sm shadow-xl z-40">
                    <ToolbarButton
                        icon={<FileText size={14} />}
                        label="Note Card"
                        onClick={() => addNewNode('note-card')}
                    />
                    <ToolbarButton
                        icon={<Type size={14} />}
                        label="Text"
                        onClick={() => addNewNode('text')}
                    />
                    <ToolbarButton
                        icon={<StickyNote size={14} />}
                        label="Sticky"
                        onClick={() => addNewNode('sticky')}
                    />
                    <div className="w-px h-5 bg-zinc-700/50 mx-1" />
                    <ToolbarButton
                        icon={<Square size={14} />}
                        label="Rectangle"
                        onClick={() => addNewNode('shape', 'rectangle')}
                    />
                    <ToolbarButton
                        icon={<Circle size={14} />}
                        label="Ellipse"
                        onClick={() => addNewNode('shape', 'ellipse')}
                    />
                    <ToolbarButton
                        icon={<Diamond size={14} />}
                        label="Diamond"
                        onClick={() => addNewNode('shape', 'diamond')}
                    />
                    <div className="w-px h-5 bg-zinc-700/50 mx-1" />
                    <ToolbarButton
                        icon={<Link2 size={14} />}
                        label={connectStart ? 'Click target…' : 'Connect'}
                        onClick={() => {
                            if (selectedNodeId && !connectStart) {
                                setConnectStart(selectedNodeId);
                            } else {
                                setConnectStart(null);
                            }
                        }}
                        active={!!connectStart}
                    />
                </div>
            )}

            {/* ── Zoom controls ───────────────────────────────── */}
            <div className="absolute bottom-4 right-4 flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900/80 border border-zinc-700/50 backdrop-blur-sm z-40">
                <button
                    onClick={() => setViewport({ ...viewport, zoom: Math.max(0.1, viewport.zoom - 0.1) })}
                    className="p-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                    <ZoomOut size={14} />
                </button>
                <span className="text-[11px] text-zinc-400 font-mono w-10 text-center">{zoomPercent}%</span>
                <button
                    onClick={() => setViewport({ ...viewport, zoom: Math.min(5, viewport.zoom + 0.1) })}
                    className="p-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                    <ZoomIn size={14} />
                </button>
                <button
                    onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}
                    className="p-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Reset view"
                >
                    <Maximize2 size={14} />
                </button>
            </div>

            {/* ── Connection mode indicator ────────────────────── */}
            {connectStart && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 text-[12px] font-medium z-40 animate-pulse">
                    Click another node to connect · ESC to cancel
                </div>
            )}

            {/* ── Empty state ─────────────────────────────────── */}
            {nodes.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <Move size={32} className="text-zinc-700 mb-3" />
                    <p className="text-zinc-600 text-sm">Empty canvas — add nodes from the toolbar above</p>
                    <p className="text-zinc-700 text-[11px] mt-1">Alt+drag or middle-click to pan · Scroll to zoom</p>
                </div>
            )}
        </div>
    );
}

/* ─── Toolbar Button ─────────────────────────────────────────── */

function ToolbarButton({
    icon,
    label,
    onClick,
    active,
}: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    active?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                active
                    ? 'bg-violet-600/30 text-violet-300'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
            }`}
            title={label}
        >
            {icon}
            <span className="hidden sm:inline">{label}</span>
        </button>
    );
}

/* ─── Canvas List (sidebar for managing multiple canvases) ─── */

export function CanvasListPanel({
    onSelect,
}: {
    onSelect: (canvasId: string) => void;
}) {
    const { canvases, createCanvas, deleteCanvas, activeCanvasId } = useCanvasStore();

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
                <h2 className="text-[13px] font-semibold text-zinc-300">Canvases</h2>
                <button
                    onClick={() => {
                        const id = createCanvas();
                        onSelect(id);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-violet-400 transition-colors cursor-pointer"
                >
                    <Plus size={14} />
                </button>
            </div>
            <div className="flex-1 overflow-auto px-2 py-2 space-y-1">
                {canvases.length === 0 && (
                    <p className="text-[12px] text-zinc-600 px-2 py-4 text-center italic">
                        No canvases yet
                    </p>
                )}
                {canvases.map((c) => (
                    <div
                        key={c.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer group transition-colors ${
                            activeCanvasId === c.id
                                ? 'bg-violet-500/10 text-violet-300'
                                : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
                        }`}
                    >
                        <button onClick={() => onSelect(c.id)} className="flex-1 text-left cursor-pointer">
                            <span className="text-[13px] truncate">{c.title}</span>
                            <span className="text-[10px] text-zinc-600 block">
                                {c.nodes.length} nodes · {c.edges.length} edges
                            </span>
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); deleteCanvas(c.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all cursor-pointer"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
