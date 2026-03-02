import { LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt';
import { v4 as uuidv4 } from 'uuid';
import type { BlockType, SerializedBlock, SerializedDocument, LoroBlock } from '../types/block';

/**
 * Manages a Loro Doc that holds the block tree for a single note.
 * Provides helpers to serialise ↔ deserialise for encrypted storage.
 *
 * IMPORTANT: plaintext never leaves this module unencrypted —
 * callers must encrypt the JSON string before persisting.
 */
export class BlockDocument {
  readonly doc: LoroDoc;
  /** Top-level ordered list of blocks */
  readonly blocks: LoroList;

  constructor(doc?: LoroDoc) {
    this.doc = doc ?? new LoroDoc();
    this.blocks = this.doc.getList('blocks');
  }

  /* ------------------------------------------------------------------ */
  /*  Serialisation (Loro → JSON string, ready for encryption)          */
  /* ------------------------------------------------------------------ */

  serialise(): string {
    const serialized: SerializedDocument = {
      version: 1,
      blocks: this.serialiseList(this.blocks),
    };
    return JSON.stringify(serialized);
  }

  private serialiseList(list: LoroList): SerializedBlock[] {
    const out: SerializedBlock[] = [];
    for (let i = 0; i < list.length; i++) {
      const container = list.get(i) as LoroMap;
      out.push(this.serialiseBlock(container));
    }
    return out;
  }

  serialiseBlock(container: LoroMap): SerializedBlock {
    const content = container.get('content') as LoroText | undefined;
    const children = container.get('children') as LoroList | undefined;
    const props = container.get('properties') as LoroMap | undefined;

    const propsObj: Record<string, unknown> = {};
    if (props) {
      for (const key of props.keys()) {
        propsObj[key] = props.get(key);
      }
    }

    return {
      id: (container.get('id') as string) ?? uuidv4(),
      type: (container.get('type') as BlockType) ?? 'text',
      content: content?.toString() ?? '',
      properties: propsObj,
      children: children ? this.serialiseList(children) : [],
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Deserialisation (JSON string → Loro)                              */
  /* ------------------------------------------------------------------ */

  /**
   * Replaces the entire block tree from a decrypted JSON string.
   */
  load(json: string): void {
    const parsed: SerializedDocument = JSON.parse(json);
    if (parsed.version !== 1) throw new Error(`Unsupported block doc version: ${parsed.version}`);

    // Clear existing blocks
    while (this.blocks.length > 0) {
      this.blocks.delete(this.blocks.length - 1, 1);
    }

    for (const sb of parsed.blocks) {
      this.pushBlock(this.blocks, sb);
    }
  }

  private pushBlock(list: LoroList, sb: SerializedBlock): void {
    const container = list.insertContainer(list.length, new LoroMap());
    container.set('id', sb.id);
    container.set('type', sb.type);

    const text = container.setContainer('content', new LoroText());
    text.insert(0, sb.content);

    const props = container.setContainer('properties', new LoroMap());
    for (const [k, v] of Object.entries(sb.properties)) {
      props.set(k, v);
    }

    const children = container.setContainer('children', new LoroList());
    for (const child of sb.children) {
      this.pushBlock(children, child);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Block CRUD helpers                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Creates and inserts a new block at `index`. Returns the new block id.
   */
  insertBlock(index: number, type: BlockType = 'text', content = ''): string {
    const id = uuidv4();
    const container = this.blocks.insertContainer(index, new LoroMap());
    container.set('id', id);
    container.set('type', type);

    const text = container.setContainer('content', new LoroText());
    text.insert(0, content);

    container.setContainer('properties', new LoroMap());
    container.setContainer('children', new LoroList());

    return id;
  }

  deleteBlock(index: number): void {
    this.blocks.delete(index, 1);
  }

  moveBlock(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const item = this.blocks.get(fromIndex) as LoroMap;
    const serialised = this.serialiseBlock(item);
    this.blocks.delete(fromIndex, 1);
    this.pushBlock(this.blocks, serialised);
  }

  /** Merges block into the previous one, deleting this block. Returns the new cursor offset. */
  mergeIntoPrevious(index: number): number | null {
    if (index <= 0 || index >= this.length) return null;
    const current = this.getBlockAt(index);
    const prev = this.getBlockAt(index - 1);
    const offset = prev.content.length;
    prev.content.insert(offset, current.content.toString());
    this.blocks.delete(index, 1);
    return offset;
  }

  /** Merges the next block into this one, deleting the next block. */
  mergeIntoNext(index: number): number | null {
    if (index < 0 || index >= this.length - 1) return null;
    const current = this.getBlockAt(index);
    const next = this.getBlockAt(index + 1);
    const offset = current.content.length;
    current.content.insert(offset, next.content.toString());
    this.blocks.delete(index + 1, 1);
    return offset;
  }

  getBlockAt(index: number): LoroBlock {
    const container = this.blocks.get(index) as LoroMap;
    return this.containerToBlock(container);
  }

  getAllBlocks(): LoroBlock[] {
    const result: LoroBlock[] = [];
    for (let i = 0; i < this.blocks.length; i++) {
      result.push(this.containerToBlock(this.blocks.get(i) as LoroMap));
    }
    return result;
  }

  private containerToBlock(container: LoroMap): LoroBlock {
    return {
      id: container.get('id') as string,
      type: container.get('type') as BlockType,
      content: container.get('content') as LoroText,
      properties: container.get('properties') as LoroMap,
      children: container.get('children') as LoroList,
      container,
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
