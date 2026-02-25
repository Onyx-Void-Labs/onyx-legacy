import * as Y from 'yjs';

export type BlockType =
  | 'text'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'checklist'
  | 'quote'
  | 'callout'
  | 'code'
  | 'image'
  | 'grid'
  | 'table'
  | 'math'
  | 'youtube'
  | 'divider';

/**
 * Serializable block representation (for encryption/storage).
 * No Yjs types here — pure JSON.
 */
export interface SerializedBlock {
  id: string;
  type: BlockType;
  content: string;
  properties: Record<string, unknown>;
  children: SerializedBlock[];
}

/**
 * Runtime block backed by Yjs shared types.
 */
export interface YBlock {
  id: string;
  type: BlockType;
  content: Y.Text;
  properties: Y.Map<unknown>;
  children: Y.Array<Y.Map<unknown>>;
  /** Reference to the Y.Map backing this block */
  yMap: Y.Map<unknown>;
}

export interface SerializedDocument {
  version: 1;
  blocks: SerializedBlock[];
}
