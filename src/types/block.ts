import type { LoroText, LoroMap, LoroList } from 'loro-crdt';

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
 * No CRDT types here — pure JSON.
 */
export interface SerializedBlock {
  id: string;
  type: BlockType;
  content: string;
  properties: Record<string, unknown>;
  children: SerializedBlock[];
}

/**
 * Runtime block backed by Loro shared types.
 */
export interface LoroBlock {
  id: string;
  type: BlockType;
  content: LoroText;
  properties: LoroMap;
  children: LoroList;
  /** Reference to the LoroMap backing this block */
  container: LoroMap;
}

export interface SerializedDocument {
  version: 1;
  blocks: SerializedBlock[];
}
