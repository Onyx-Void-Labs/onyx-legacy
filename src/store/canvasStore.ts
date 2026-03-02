/**
 * canvasStore.ts — Zustand store for the Visual Canvas feature.
 * Manages canvas nodes, edges, viewport state, and persistence per note.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ─── Types ──────────────────────────────────────────────────── */

export type CanvasNodeType = 'note-card' | 'text' | 'shape' | 'image' | 'sticky' | 'group';

export interface CanvasNodeData {
  label: string;
  content?: string;
  color?: string;
  shape?: 'rectangle' | 'ellipse' | 'diamond' | 'rounded';
  fontSize?: number;
  noteId?: string; // link to an existing Onyx note
  width?: number;
  height?: number;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: CanvasNodeData;
  style?: Record<string, any>;
  parentId?: string;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'default' | 'straight' | 'step' | 'smoothstep';
  animated?: boolean;
  style?: Record<string, any>;
}

export interface CanvasData {
  id: string; // canvas document id
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  updatedAt: number;
}

/* ─── Store ──────────────────────────────────────────────────── */

interface CanvasState {
  canvases: CanvasData[];
  activeCanvasId: string | null;

  // CRUD
  createCanvas: (title?: string) => string;
  deleteCanvas: (id: string) => void;
  setActiveCanvas: (id: string | null) => void;
  getActiveCanvas: () => CanvasData | null;

  // Node operations
  addNode: (canvasId: string, node: CanvasNode) => void;
  updateNode: (canvasId: string, nodeId: string, updates: Partial<CanvasNode>) => void;
  removeNode: (canvasId: string, nodeId: string) => void;

  // Edge operations
  addEdge: (canvasId: string, edge: CanvasEdge) => void;
  removeEdge: (canvasId: string, edgeId: string) => void;

  // Bulk update (from React Flow onChange)
  updateNodes: (canvasId: string, nodes: CanvasNode[]) => void;
  updateEdges: (canvasId: string, edges: CanvasEdge[]) => void;
  updateViewport: (canvasId: string, viewport: { x: number; y: number; zoom: number }) => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      canvases: [],
      activeCanvasId: null,

      createCanvas: (title = 'Untitled Canvas') => {
        const id = generateId();
        const canvas: CanvasData = {
          id,
          title,
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          updatedAt: Date.now(),
        };
        set((s) => ({ canvases: [...s.canvases, canvas], activeCanvasId: id }));
        return id;
      },

      deleteCanvas: (id: string) => {
        set((s) => ({
          canvases: s.canvases.filter((c) => c.id !== id),
          activeCanvasId: s.activeCanvasId === id ? null : s.activeCanvasId,
        }));
      },

      setActiveCanvas: (id: string | null) => set({ activeCanvasId: id }),

      getActiveCanvas: () => {
        const { canvases, activeCanvasId } = get();
        return canvases.find((c) => c.id === activeCanvasId) ?? null;
      },

      addNode: (canvasId, node) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? { ...c, nodes: [...c.nodes, node], updatedAt: Date.now() }
              : c
          ),
        }));
      },

      updateNode: (canvasId, nodeId, updates) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? {
                  ...c,
                  nodes: c.nodes.map((n) =>
                    n.id === nodeId ? { ...n, ...updates } : n
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));
      },

      removeNode: (canvasId, nodeId) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? {
                  ...c,
                  nodes: c.nodes.filter((n) => n.id !== nodeId),
                  edges: c.edges.filter(
                    (e) => e.source !== nodeId && e.target !== nodeId
                  ),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));
      },

      addEdge: (canvasId, edge) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? { ...c, edges: [...c.edges, edge], updatedAt: Date.now() }
              : c
          ),
        }));
      },

      removeEdge: (canvasId, edgeId) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? {
                  ...c,
                  edges: c.edges.filter((e) => e.id !== edgeId),
                  updatedAt: Date.now(),
                }
              : c
          ),
        }));
      },

      updateNodes: (canvasId, nodes) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? { ...c, nodes: nodes as CanvasNode[], updatedAt: Date.now() }
              : c
          ),
        }));
      },

      updateEdges: (canvasId, edges) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId
              ? { ...c, edges: edges as CanvasEdge[], updatedAt: Date.now() }
              : c
          ),
        }));
      },

      updateViewport: (canvasId, viewport) => {
        set((s) => ({
          canvases: s.canvases.map((c) =>
            c.id === canvasId ? { ...c, viewport, updatedAt: Date.now() } : c
          ),
        }));
      },
    }),
    {
      name: 'onyx_canvas',
    }
  )
);
