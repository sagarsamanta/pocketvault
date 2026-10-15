import { newId } from '../lib/id';
import { clampIndexedText } from '../lib/text';
import { Database, SqlParam } from './adapter';
import {
  AttachmentRow,
  CollectionRow,
  ItemRow,
  ReminderRow,
  TagRow,
  toAttachment,
  toCollection,
  toItem,
  toReminder,
  toTag,
} from './rows';
import { buildFtsQuery, escapeLike, tokenizeQuery } from './search';
import type {
  Attachment,
  Collection,
  Item,
  ItemFilter,
  ItemSource,
  ItemType,
  ItemWithRelations,
  OcrStatus,
  Reminder,
  ReminderStatus,
  ReminderWithItem,
  Tag,
} from './types';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface NewItemInput {
  type: ItemType;
  title?: string;
  note?: string;
  url?: string | null;
  contentText?: string;
  collectionId?: string | null;
  isFavorite?: boolean;
  ocrStatus?: OcrStatus;
  source?: ItemSource;
  tagNames?: string[];
}

export interface ItemPatch {
  title?: string;
  note?: string;
  url?: string | null;
  contentText?: string;
  collectionId?: string | null;
  isFavorite?: boolean;
  ocrStatus?: OcrStatus;
  ocrError?: string | null;
}

export interface NewAttachmentInput {
  id?: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
}

const COLLECTION_COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6'];

export class Repository {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
    /** Whether the items_fts table exists. Without it, search uses LIKE. */
    public ftsEnabled = true,
  ) {}

  // ---------------------------------------------------------------- items

  async createItem(input: NewItemInput, attachments: NewAttachmentInput[] = []): Promise<Item> {
    const id = newId();
    const ts = this.now();
    const title = (input.title ?? '').trim();
    const note = input.note ?? '';
    const url = input.url?.trim() || null;
    if (!title && !note.trim() && !url && attachments.length === 0) {
      throw new ValidationError('Add a title, note, link or file before saving.');
    }
    await this.db.transaction(async () => {
      if (input.collectionId) await this.requireCollection(input.collectionId);
      await this.db.run(
        `INSERT INTO items (id, type, title, note, url, content_text, collection_id, is_favorite, ocr_status, ocr_error, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          id,
          input.type,
          title,
          note,
          url,
          clampIndexedText(input.contentText ?? ''),
          input.collectionId ?? null,
          input.isFavorite ? 1 : 0,
          input.ocrStatus ?? 'none',
          input.source ?? 'manual',
          ts,
          ts,
        ],
      );
      for (const a of attachments) await this.insertAttachment(id, a, ts);
      if (input.tagNames?.length) await this.setItemTagsInternal(id, input.tagNames);
      await this.reindexItem(id);
    });
    return (await this.getItem(id))!;
  }

  async getItem(id: string): Promise<Item | null> {
    const row = await this.db.first<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
    return row ? toItem(row) : null;
  }

  async getItemWithRelations(id: string): Promise<ItemWithRelations | null> {
    const item = await this.getItem(id);
    if (!item) return null;
    const [withRel] = await this.attachRelations([item]);
    return withRel;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    await this.db.transaction(async () => {
      const existing = await this.db.first<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
      if (!existing) throw new NotFoundError('Item');
      if (patch.collectionId) await this.requireCollection(patch.collectionId);
      const sets: string[] = [];
      const params: SqlParam[] = [];
      const add = (col: string, value: SqlParam) => {
        sets.push(`${col} = ?`);
        params.push(value);
      };
      if (patch.title !== undefined) add('title', patch.title.trim());
      if (patch.note !== undefined) add('note', patch.note);
      if (patch.url !== undefined) add('url', patch.url?.trim() || null);
      if (patch.contentText !== undefined) add('content_text', clampIndexedText(patch.contentText));
      if (patch.collectionId !== undefined) add('collection_id', patch.collectionId);
      if (patch.isFavorite !== undefined) add('is_favorite', patch.isFavorite ? 1 : 0);
      if (patch.ocrStatus !== undefined) add('ocr_status', patch.ocrStatus);
      if (patch.ocrError !== undefined) add('ocr_error', patch.ocrError);
      if (sets.length === 0) return;
      add('updated_at', this.now());
      params.push(id);
      await this.db.run(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, params);
      await this.reindexItem(id);
    });
    const item = await this.getItem(id);
    if (!item) throw new NotFoundError('Item');
    return item;
  }

  async setFavorite(id: string, isFavorite: boolean) {
    return this.updateItem(id, { isFavorite });
  }

  /** Deletes an item and returns its attachment file names so callers can remove files. */
  async deleteItem(id: string): Promise<{ attachments: Attachment[]; reminders: Reminder[] }> {
    return this.db.transaction(async () => {
      const attachments = (
        await this.db.all<AttachmentRow>('SELECT * FROM attachments WHERE item_id = ?', [id])
      ).map(toAttachment);
      const reminders = (await this.db.all<ReminderRow>('SELECT * FROM reminders WHERE item_id = ?', [id])).map(
        toReminder,
      );
      const result = await this.db.run('DELETE FROM items WHERE id = ?', [id]);
      if (result.changes === 0) throw new NotFoundError('Item');
      if (this.ftsEnabled) await this.db.run('DELETE FROM items_fts WHERE item_id = ?', [id]);
      return { attachments, reminders };
    });
  }

  async listItems(filter: ItemFilter = {}): Promise<ItemWithRelations[]> {
    const where: string[] = [];
    const params: SqlParam[] = [];
    let from = 'items i';
    let order = 'i.updated_at DESC';

    const fts = filter.query ? buildFtsQuery(filter.query) : null;
    if (fts && this.ftsEnabled) {
      from = `items i JOIN (SELECT item_id, bm25(items_fts, 0, 10.0, 2.0, 4.0, 1.0, 6.0) AS rank FROM items_fts WHERE items_fts MATCH ?) s ON s.item_id = i.id`;
      params.push(fts);
      order = 's.rank ASC, i.updated_at DESC';
    } else if (fts) {
      // LIKE fallback: every token must appear in some searchable field.
      for (const token of tokenizeQuery(filter.query!)) {
        const pattern = `%${escapeLike(token)}%`;
        where.push(
          `(i.title LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\' OR i.url LIKE ? ESCAPE '\\' OR i.content_text LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name LIKE ? ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM attachments a WHERE a.item_id = i.id AND a.original_name LIKE ? ESCAPE '\\'))`,
        );
        params.push(pattern, pattern, pattern, pattern, pattern, pattern);
      }
    }
    if (filter.favoritesOnly) where.push('i.is_favorite = 1');
    if (filter.type) {
      where.push('i.type = ?');
      params.push(filter.type);
    }
    if (filter.collectionId) {
      where.push('i.collection_id = ?');
      params.push(filter.collectionId);
    }
    if (filter.tagId) {
      where.push('EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?)');
      params.push(filter.tagId);
    }
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    const offset = Math.max(0, filter.offset ?? 0);
    const sql = `SELECT i.* FROM ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
    const rows = await this.db.all<ItemRow>(sql, params);
    return this.attachRelations(rows.map(toItem));
  }

  async countItems(): Promise<number> {
    const row = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM items');
    return row?.n ?? 0;
  }

  async listItemsByOcrStatus(statuses: OcrStatus[]): Promise<Item[]> {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = await this.db.all<ItemRow>(
      `SELECT * FROM items WHERE ocr_status IN (${placeholders}) ORDER BY created_at ASC`,
      statuses,
    );
    return rows.map(toItem);
  }

  private async attachRelations(items: Item[]): Promise<ItemWithRelations[]> {
    if (items.length === 0) return [];
    const ids = items.map((i) => i.id);
    const placeholders = ids.map(() => '?').join(',');
    const tagRows = await this.db.all<TagRow & { item_id: string }>(
      `SELECT it.item_id, t.* FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`,
      ids,
    );
    const attRows = await this.db.all<AttachmentRow>(
      `SELECT * FROM attachments WHERE item_id IN (${placeholders}) ORDER BY created_at ASC`,
      ids,
    );
    const collectionIds = [...new Set(items.map((i) => i.collectionId).filter((c): c is string => !!c))];
    const colRows = collectionIds.length
      ? await this.db.all<CollectionRow>(
          `SELECT * FROM collections WHERE id IN (${collectionIds.map(() => '?').join(',')})`,
          collectionIds,
        )
      : [];
    const tagsByItem = new Map<string, Tag[]>();
    for (const r of tagRows) {
      const list = tagsByItem.get(r.item_id) ?? [];
      list.push(toTag(r));
      tagsByItem.set(r.item_id, list);
    }
    const attByItem = new Map<string, Attachment[]>();
    for (const r of attRows) {
      const list = attByItem.get(r.item_id) ?? [];
      list.push(toAttachment(r));
      attByItem.set(r.item_id, list);
    }
    const colById = new Map(colRows.map((r) => [r.id, toCollection(r)]));
    return items.map((i) => ({
      ...i,
      tags: tagsByItem.get(i.id) ?? [],
      attachments: attByItem.get(i.id) ?? [],
      collection: i.collectionId ? colById.get(i.collectionId) ?? null : null,
    }));
  }

  /** Rebuilds the full-text row for one item. Must run inside a transaction. */
  private async reindexItem(id: string) {
    if (!this.ftsEnabled) return;
    await this.db.run('DELETE FROM items_fts WHERE item_id = ?', [id]);
    const row = await this.db.first<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
    if (!row) return;
    const tags = await this.db.all<{ name: string }>(
      'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?',
      [id],
    );
    const attachments = await this.db.all<{ original_name: string }>(
      'SELECT original_name FROM attachments WHERE item_id = ?',
      [id],
    );
    const urlText = row.url ? `${row.url} ${row.url.replace(/[^\p{L}\p{N}]+/gu, ' ')}` : '';
    await this.db.run(
      'INSERT INTO items_fts (item_id, title, note, url, content_text, tags) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        `${row.title} ${attachments.map((a) => a.original_name).join(' ')}`.trim(),
        row.note,
        urlText,
        row.content_text,
        tags.map((t) => t.name).join(' '),
      ],
    );
  }

  /** Rebuilds the entire search index (used after restore). Must run inside a transaction. */
  async rebuildSearchIndexInTransaction() {
    if (!this.ftsEnabled) return;
    await this.db.run('DELETE FROM items_fts');
    const ids = await this.db.all<{ id: string }>('SELECT id FROM items');
    for (const { id } of ids) await this.reindexItem(id);
  }

  // ---------------------------------------------------------- attachments

  private async insertAttachment(itemId: string, a: NewAttachmentInput, ts: number) {
    await this.db.run(
      `INSERT INTO attachments (id, item_id, file_name, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [a.id ?? newId(), itemId, a.fileName, a.originalName, a.mimeType, a.size, ts],
    );
  }

  async listAllAttachments(): Promise<Attachment[]> {
    return (await this.db.all<AttachmentRow>('SELECT * FROM attachments')).map(toAttachment);
  }

  // ---------------------------------------------------------- collections

  async listCollections(): Promise<Collection[]> {
    const rows = await this.db.all<CollectionRow>(
      `SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.collection_id = c.id) AS item_count
       FROM collections c ORDER BY c.name COLLATE NOCASE`,
    );
    return rows.map(toCollection);
  }

  async getCollection(id: string): Promise<Collection | null> {
    const row = await this.db.first<CollectionRow>('SELECT * FROM collections WHERE id = ?', [id]);
    return row ? toCollection(row) : null;
  }

  private async requireCollection(id: string) {
    const row = await this.db.first<{ id: string }>('SELECT id FROM collections WHERE id = ?', [id]);
    if (!row) throw new NotFoundError('Collection');
  }

  private validateName(name: string, kind: string): string {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) throw new ValidationError(`${kind} name cannot be empty.`);
    if (trimmed.length > 40) throw new ValidationError(`${kind} name must be 40 characters or fewer.`);
    return trimmed;
  }

  async createCollection(name: string, color?: string): Promise<Collection> {
    const clean = this.validateName(name, 'Collection');
    const existing = await this.db.first<CollectionRow>('SELECT * FROM collections WHERE name = ?', [clean]);
    if (existing) throw new ValidationError(`A collection named “${existing.name}” already exists.`);
    const count = (await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM collections'))?.n ?? 0;
    const id = newId();
    const ts = this.now();
    await this.db.run('INSERT INTO collections (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      id,
      clean,
      color ?? COLLECTION_COLORS[count % COLLECTION_COLORS.length],
      ts,
      ts,
    ]);
    return (await this.getCollection(id))!;
  }

  async renameCollection(id: string, name: string): Promise<Collection> {
    const clean = this.validateName(name, 'Collection');
    const clash = await this.db.first<CollectionRow>('SELECT * FROM collections WHERE name = ? AND id <> ?', [
      clean,
      id,
    ]);
    if (clash) throw new ValidationError(`A collection named “${clash.name}” already exists.`);
    const res = await this.db.run('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?', [
      clean,
      this.now(),
      id,
    ]);
    if (res.changes === 0) throw new NotFoundError('Collection');
    return (await this.getCollection(id))!;
  }

  /** Deletes a collection; its items are kept and become uncategorized. */
  async deleteCollection(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('UPDATE items SET collection_id = NULL WHERE collection_id = ?', [id]);
      const res = await this.db.run('DELETE FROM collections WHERE id = ?', [id]);
      if (res.changes === 0) throw new NotFoundError('Collection');
    });
  }

  // ----------------------------------------------------------------- tags

  async listTags(): Promise<Tag[]> {
    const rows = await this.db.all<TagRow>(
      `SELECT t.*, (SELECT COUNT(*) FROM item_tags it WHERE it.tag_id = t.id) AS item_count
       FROM tags t ORDER BY t.name COLLATE NOCASE`,
    );
    return rows.map(toTag);
  }

  private async getOrCreateTag(name: string): Promise<string> {
    const clean = this.validateName(name, 'Tag');
    const existing = await this.db.first<{ id: string }>('SELECT id FROM tags WHERE name = ?', [clean]);
    if (existing) return existing.id;
    const id = newId();
    await this.db.run('INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)', [id, clean, this.now()]);
    return id;
  }

  private async setItemTagsInternal(itemId: string, names: string[]) {
    await this.db.run('DELETE FROM item_tags WHERE item_id = ?', [itemId]);
    for (const name of names) {
      const tagId = await this.getOrCreateTag(name);
      await this.db.run('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)', [itemId, tagId]);
    }
  }

  /** Replaces the tags of an item with `names`, creating tags as needed. */
  async setItemTags(itemId: string, names: string[]): Promise<void> {
    await this.db.transaction(async () => {
      const item = await this.db.first<{ id: string }>('SELECT id FROM items WHERE id = ?', [itemId]);
      if (!item) throw new NotFoundError('Item');
      await this.setItemTagsInternal(itemId, names);
      await this.db.run('UPDATE items SET updated_at = ? WHERE id = ?', [this.now(), itemId]);
      await this.reindexItem(itemId);
    });
  }

  async renameTag(id: string, name: string): Promise<void> {
    const clean = this.validateName(name, 'Tag');
    await this.db.transaction(async () => {
      const clash = await this.db.first<TagRow>('SELECT * FROM tags WHERE name = ? AND id <> ?', [clean, id]);
      if (clash) throw new ValidationError(`A tag named “${clash.name}” already exists.`);
      const res = await this.db.run('UPDATE tags SET name = ? WHERE id = ?', [clean, id]);
      if (res.changes === 0) throw new NotFoundError('Tag');
      const items = await this.db.all<{ item_id: string }>('SELECT item_id FROM item_tags WHERE tag_id = ?', [id]);
      for (const { item_id } of items) await this.reindexItem(item_id);
    });
  }

  async deleteTag(id: string): Promise<void> {
    await this.db.transaction(async () => {
      const items = await this.db.all<{ item_id: string }>('SELECT item_id FROM item_tags WHERE tag_id = ?', [id]);
      const res = await this.db.run('DELETE FROM tags WHERE id = ?', [id]);
      if (res.changes === 0) throw new NotFoundError('Tag');
      for (const { item_id } of items) await this.reindexItem(item_id);
    });
  }

  // ------------------------------------------------------------ reminders

  async createReminder(itemId: string, remindAt: number): Promise<Reminder> {
    if (!Number.isFinite(remindAt)) throw new ValidationError('Choose a valid date and time.');
    const item = await this.getItem(itemId);
    if (!item) throw new NotFoundError('Item');
    const id = newId();
    const ts = this.now();
    await this.db.run(
      `INSERT INTO reminders (id, item_id, remind_at, status, notification_id, created_at, updated_at) VALUES (?, ?, ?, 'scheduled', NULL, ?, ?)`,
      [id, itemId, remindAt, ts, ts],
    );
    return (await this.getReminder(id))!;
  }

  async getReminder(id: string): Promise<Reminder | null> {
    const row = await this.db.first<ReminderRow>('SELECT * FROM reminders WHERE id = ?', [id]);
    return row ? toReminder(row) : null;
  }

  async updateReminder(
    id: string,
    patch: { remindAt?: number; status?: ReminderStatus; notificationId?: string | null },
  ): Promise<Reminder> {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    if (patch.remindAt !== undefined) {
      if (!Number.isFinite(patch.remindAt)) throw new ValidationError('Choose a valid date and time.');
      sets.push('remind_at = ?');
      params.push(patch.remindAt);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.notificationId !== undefined) {
      sets.push('notification_id = ?');
      params.push(patch.notificationId);
    }
    sets.push('updated_at = ?');
    params.push(this.now(), id);
    const res = await this.db.run(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ?`, params);
    if (res.changes === 0) throw new NotFoundError('Reminder');
    return (await this.getReminder(id))!;
  }

  async deleteReminder(id: string): Promise<void> {
    await this.db.run('DELETE FROM reminders WHERE id = ?', [id]);
  }

  async listRemindersForItem(itemId: string): Promise<Reminder[]> {
    const rows = await this.db.all<ReminderRow>(
      'SELECT * FROM reminders WHERE item_id = ? ORDER BY remind_at ASC',
      [itemId],
    );
    return rows.map(toReminder);
  }

  async listReminders(status?: ReminderStatus): Promise<ReminderWithItem[]> {
    const rows = await this.db.all<ReminderRow & { item_title: string; item_note: string; item_url: string | null }>(
      `SELECT r.*, i.title AS item_title, i.note AS item_note, i.url AS item_url FROM reminders r JOIN items i ON i.id = r.item_id
       ${status ? 'WHERE r.status = ?' : ''}
       ORDER BY CASE r.status WHEN 'scheduled' THEN 0 ELSE 1 END, r.remind_at ASC`,
      status ? [status] : [],
    );
    return rows.map((r) => ({
      ...toReminder(r),
      itemTitle: r.item_title || r.item_url || r.item_note.slice(0, 60) || 'Untitled',
    }));
  }

  // ------------------------------------------------------------- settings

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // ---------------------------------------------------------- maintenance

  /** Removes all user content. Settings are kept unless `includeSettings` is set. */
  async eraseAll(includeSettings = false): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.exec(`
        DELETE FROM reminders;
        DELETE FROM item_tags;
        DELETE FROM attachments;
        DELETE FROM items;
        DELETE FROM tags;
        DELETE FROM collections;
      `);
      if (this.ftsEnabled) await this.db.exec('DELETE FROM items_fts');
      if (includeSettings) await this.db.exec('DELETE FROM settings');
    });
  }
}
