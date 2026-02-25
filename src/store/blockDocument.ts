import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import type { BlockType, SerializedBlock, SerializedDocument, YBlock } from '../types/block';

/**
 * Manages a Yjs Doc that holds the block tree for a single note.
 * Provides helpers to serialise ↔ deserialise for encrypted storage.
 *
 * IMPORTANT: plaintext never leaves this module unencrypted —
 * callers must encrypt the JSON string before persisting.
 */
export class BlockDocument {
  readonly ydoc: Y.Doc;
  /** Top-level ordered list of block Y.Maps */
  readonly blocks: Y.Array<Y.Map<unknown>>;

  constructor(ydoc?: Y.Doc) {
    this.ydoc = ydoc ?? new Y.Doc();
    this.blocks = this.ydoc.getArray<Y.Map<unknown>>('blocks');
  }

  /* ------------------------------------------------------------------ */
  /*  Serialisation (Yjs → JSON string, ready for encryption)           */
  /* ------------------------------------------------------------------ */

  serialise(): string {
    const doc: SerializedDocument = {
      version: 1,
      blocks: this.serialiseArray(this.blocks),
    };
    return JSON.stringify(doc);
  }

  private serialiseArray(arr: Y.Array<Y.Map<unknown>>): SerializedBlock[] {
    const out: SerializedBlock[] = [];
    for (let i = 0; i < arr.length; i++) {
      const yMap = arr.get(i);
      out.push(this.serialiseBlock(yMap));
    }
    return out;
  }

  serialiseBlock(yMap: Y.Map<unknown>): SerializedBlock {
    const content = yMap.get('content') as Y.Text | undefined;
    const children = yMap.get('children') as Y.Array<Y.Map<unknown>> | undefined;
    const props = yMap.get('properties') as Y.Map<unknown> | undefined;

    return {
      id: (yMap.get('id') as string) ?? uuidv4(),
      type: (yMap.get('type') as BlockType) ?? 'text',
      content: content?.toString() ?? '',
      properties: props ? Object.fromEntries(props.entries()) : {},
      children: children ? this.serialiseArray(children) : [],
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Deserialisation (JSON string → Yjs)                               */
  /* ------------------------------------------------------------------ */

  /**
   * Replaces the entire block tree from a decrypted JSON string.
   * Call inside a transact for best perf.
   */
  load(json: string): void {
    const doc: SerializedDocument = JSON.parse(json);
    if (doc.version !== 1) throw new Error(`Unsupported block doc version: ${doc.version}`);

    this.ydoc.transact(() => {
      this.blocks.delete(0, this.blocks.length);
      for (const sb of doc.blocks) {
        this.blocks.push([this.deserialiseBlock(sb)]);
      }
    });
  }

  deserialiseBlock(sb: SerializedBlock): Y.Map<unknown> {
    const yMap = new Y.Map<unknown>();
    yMap.set('id', sb.id);
    yMap.set('type', sb.type);

    const yText = new Y.Text(sb.content);
    yMap.set('content', yText);

    const yProps = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(sb.properties)) {
      yProps.set(k, v);
    }
    yMap.set('properties', yProps);

    const yChildren = new Y.Array<Y.Map<unknown>>();
    for (const child of sb.children) {
      yChildren.push([this.deserialiseBlock(child)]);
    }
    yMap.set('children', yChildren);

    return yMap;
  }

  /* ------------------------------------------------------------------ */
  /*  Block CRUD helpers                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Creates and inserts a new block at `index`. Returns the new block id.
   */
  insertBlock(index: number, type: BlockType = 'text', content = ''): string {
    const id = uuidv4();
    const yMap = new Y.Map<unknown>();
    yMap.set('id', id);
    yMap.set('type', type);
    yMap.set('content', new Y.Text(content));
    yMap.set('properties', new Y.Map<unknown>());
    yMap.set('children', new Y.Array<Y.Map<unknown>>());

    this.ydoc.transact(() => {
      this.blocks.insert(index, [yMap]);
    });
    return id;
  }

  deleteBlock(index: number): void {
    this.ydoc.transact(() => {
      this.blocks.delete(index, 1);
    });
  }

  moveBlock(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    this.ydoc.transact(() => {
      const item = this.blocks.get(fromIndex);
      // Clone data since Yjs doesn't support move natively
      const serialised = this.serialiseBlock(item);
      this.blocks.delete(fromIndex, 1);
      // DndKit provides the exact final index (newIndex).
      // Since we already deleted `fromIndex`, inserting at `toIndex` places it precisely where DndKit expects.
      this.blocks.insert(toIndex, [this.deserialiseBlock(serialised)]);
    });
  }

  /** Merges block into the previous one, deleting this block. Returns the new cursor offset. */
  mergeIntoPrevious(index: number): number | null {
    if (index <= 0 || index >= this.length) return null;
    let offset = 0;
    this.ydoc.transact(() => {
      const current = this.getBlockAt(index);
      const prev = this.getBlockAt(index - 1);
      offset = prev.content.length;
      prev.content.insert(offset, current.content.toString());
      this.blocks.delete(index, 1);
    });
    return offset;
  }

  /** Merges the next block into this one, deleting the next block. Returns the old length of this block. */
  mergeIntoNext(index: number): number | null {
    if (index < 0 || index >= this.length - 1) return null;
    let offset = 0;
    this.ydoc.transact(() => {
      const current = this.getBlockAt(index);
      const next = this.getBlockAt(index + 1);
      offset = current.content.length;
      current.content.insert(offset, next.content.toString());
      this.blocks.delete(index + 1, 1);
    });
    return offset;
  }

  getBlockAt(index: number): YBlock {
    const yMap = this.blocks.get(index);
    return this.yMapToBlock(yMap);
  }

  getAllBlocks(): YBlock[] {
    const result: YBlock[] = [];
    for (let i = 0; i < this.blocks.length; i++) {
      result.push(this.yMapToBlock(this.blocks.get(i)));
    }
    return result;
  }

  private yMapToBlock(yMap: Y.Map<unknown>): YBlock {
    return {
      id: yMap.get('id') as string,
      type: yMap.get('type') as BlockType,
      content: yMap.get('content') as Y.Text,
      properties: yMap.get('properties') as Y.Map<unknown>,
      children: yMap.get('children') as Y.Array<Y.Map<unknown>>,
      yMap,
    };
  }

  get length(): number {
    return this.blocks.length;
  }

  /** Ensure there's always at least one empty text block. */
  ensureNotEmpty(): void {
    if (this.blocks.length === 0) {
      this.insertBlock(0, 'text', '');
    }
  }
}
