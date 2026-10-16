import { newId } from '../lib/id';
import { canonicalUrl } from '../lib/links';
import { clampIndexedText } from '../lib/text';
import { Database, SqlParam } from './adapter';
import {
  AttachmentRow,
  CollectionRow,
  FactRow,
  ItemRow,
  ReminderRow,
  TagRow,
  toAttachment,
  toCollection,
  toFact,
  toItem,
  toReminder,
  toTag,
} from './rows';
import { buildFtsQuery, escapeLike, tokenizeQuery } from './search';
import type {
  Attachment,
  AttachmentRole,
  Collection,
  FactKind,
  Item,
  ItemColor,
  ItemFilter,
  ItemSource,
  ItemType,
  ItemWithRelations,
  OcrStatus,
  PreviewStatus,
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
  readerText?: string;
  collectionId?: string | null;
  isFavorite?: boolean;
  isPinned?: boolean;
  color?: ItemColor | null;
  ocrStatus?: OcrStatus;
  previewStatus?: PreviewStatus;
  source?: ItemSource;
  tagNames?: string[];
}

export interface ItemPatch {
  title?: string;
  note?: string;
  url?: string | null;
  contentText?: string;
  readerText?: string;
  collectionId?: string | null;
  isFavorite?: boolean;
  isPinned?: boolean;
  color?: ItemColor | null;
  ocrStatus?: OcrStatus;
  ocrError?: string | null;
  previewStatus?: PreviewStatus;
  previewTitle?: string | null;
  previewDescription?: string | null;
  previewSite?: string | null;
}

/** Plaintext fields that are encrypted while an item is secret. */
export interface SecretFields {
  title: string;
  note: string;
  url: string | null;
  contentText: string;
  readerText: string;
  previewTitle: string | null;
  previewDescription: string | null;
  previewSite: string | null;
}

export interface NewAttachmentInput {
  id?: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  role?: AttachmentRole;
  durationMs?: number | null;
  encrypted?: boolean;
}

export interface RediscoverPick {
  item: ItemWithRelations;
  reason: string;
}

const COLLECTION_COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#14B8A6'];
const DAY = 86_400_000;

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
    const previewStatus = input.previewStatus ?? (input.type === 'link' && url ? 'pending' : 'none');
    await this.db.transaction(async () => {
      if (input.collectionId) await this.requireCollection(input.collectionId);
      await this.db.run(
        `INSERT INTO items (id, type, title, note, url, canonical_url, content_text, reader_text, collection_id, is_favorite, is_pinned, color,
                            ocr_status, ocr_error, preview_status, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          id,
          input.type,
          title,
          note,
          url,
          canonicalUrl(url),
          clampIndexedText(input.contentText ?? ''),
          clampIndexedText(input.readerText ?? ''),
          input.collectionId ?? null,
          input.isFavorite ? 1 : 0,
          input.isPinned ? 1 : 0,
          input.color ?? null,
          input.ocrStatus ?? 'none',
          previewStatus,
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

  async updateItem(id: string, patch: ItemPatch, options: { touch?: boolean } = {}): Promise<Item> {
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
      if (patch.url !== undefined) {
        const url = patch.url?.trim() || null;
        add('url', url);
        add('canonical_url', canonicalUrl(url));
        if (url !== existing.url && existing.type === 'link' && patch.previewStatus === undefined) {
          // A different page needs a fresh preview.
          add('preview_status', url ? 'pending' : 'none');
          add('preview_title', null);
          add('preview_description', null);
          add('preview_site', null);
          add('reader_text', '');
        }
      }
      if (patch.contentText !== undefined) add('content_text', clampIndexedText(patch.contentText));
      if (patch.readerText !== undefined) add('reader_text', clampIndexedText(patch.readerText));
      if (patch.collectionId !== undefined) add('collection_id', patch.collectionId);
      if (patch.isFavorite !== undefined) add('is_favorite', patch.isFavorite ? 1 : 0);
      if (patch.isPinned !== undefined) add('is_pinned', patch.isPinned ? 1 : 0);
      if (patch.color !== undefined) add('color', patch.color);
      if (patch.ocrStatus !== undefined) add('ocr_status', patch.ocrStatus);
      if (patch.ocrError !== undefined) add('ocr_error', patch.ocrError);
      if (patch.previewStatus !== undefined) add('preview_status', patch.previewStatus);
      if (patch.previewTitle !== undefined) add('preview_title', patch.previewTitle);
      if (patch.previewDescription !== undefined) add('preview_description', patch.previewDescription);
      if (patch.previewSite !== undefined) add('preview_site', patch.previewSite);
      if (sets.length === 0) return;
      if (options.touch !== false) add('updated_at', this.now());
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

  // --------------------------------------------------------- secret items

  /** Stores encrypted fields and wipes the plaintext copies, facts and search entry. */
  async makeSecret(id: string, secretPayload: string): Promise<void> {
    await this.db.transaction(async () => {
      const res = await this.db.run(
        `UPDATE items SET is_secret = 1, secret_payload = ?, title = '', note = '', url = NULL, canonical_url = NULL,
           content_text = '', reader_text = '', preview_title = NULL, preview_description = NULL, preview_site = NULL,
           ocr_status = CASE WHEN ocr_status IN ('pending','processing') THEN 'none' ELSE ocr_status END,
           preview_status = CASE WHEN preview_status = 'pending' THEN 'none' ELSE preview_status END,
           updated_at = ? WHERE id = ?`,
        [secretPayload, this.now(), id],
      );
      if (res.changes === 0) throw new NotFoundError('Item');
      await this.db.run('DELETE FROM item_facts WHERE item_id = ?', [id]);
      if (this.ftsEnabled) await this.db.run('DELETE FROM items_fts WHERE item_id = ?', [id]);
    });
  }

  /** Restores decrypted fields and makes the item visible and searchable again. */
  async revealSecret(id: string, fields: SecretFields): Promise<void> {
    await this.db.transaction(async () => {
      const res = await this.db.run(
        `UPDATE items SET is_secret = 0, secret_payload = NULL, title = ?, note = ?, url = ?, canonical_url = ?, content_text = ?,
           reader_text = ?, preview_title = ?, preview_description = ?, preview_site = ?, updated_at = ? WHERE id = ?`,
        [
          fields.title,
          fields.note,
          fields.url,
          canonicalUrl(fields.url),
          clampIndexedText(fields.contentText),
          clampIndexedText(fields.readerText),
          fields.previewTitle,
          fields.previewDescription,
          fields.previewSite,
          this.now(),
          id,
        ],
      );
      if (res.changes === 0) throw new NotFoundError('Item');
      await this.reindexItem(id);
    });
  }

  async updateSecretPayload(id: string, secretPayload: string): Promise<void> {
    const res = await this.db.run('UPDATE items SET secret_payload = ?, updated_at = ? WHERE id = ? AND is_secret = 1', [
      secretPayload,
      this.now(),
      id,
    ]);
    if (res.changes === 0) throw new NotFoundError('Secret item');
  }

  async getSecretPayload(id: string): Promise<string | null> {
    const row = await this.db.first<{ secret_payload: string | null }>('SELECT secret_payload FROM items WHERE id = ?', [id]);
    return row?.secret_payload ?? null;
  }

  async countSecretItems(): Promise<number> {
    return (await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE is_secret = 1'))?.n ?? 0;
  }

  // -------------------------------------------------------------- queries

  async listItems(filter: ItemFilter = {}): Promise<ItemWithRelations[]> {
    const where: string[] = [filter.secretOnly ? 'i.is_secret = 1' : 'i.is_secret = 0'];
    const params: SqlParam[] = [];
    let from = 'items i';
    let order = 'i.is_pinned DESC, i.updated_at DESC';

    const fts = filter.query ? buildFtsQuery(filter.query) : null;
    if (fts && this.ftsEnabled && !filter.secretOnly) {
      from = `items i JOIN (SELECT item_id, bm25(items_fts, 0, 10.0, 2.0, 4.0, 1.0, 6.0) AS rank FROM items_fts WHERE items_fts MATCH ?) s ON s.item_id = i.id`;
      params.push(fts);
      order = 's.rank ASC, i.updated_at DESC';
    } else if (fts) {
      // LIKE fallback: every token must appear in some searchable field.
      for (const token of tokenizeQuery(filter.query!)) {
        const pattern = `%${escapeLike(token)}%`;
        where.push(
          `(i.title LIKE ? ESCAPE '\\' OR i.note LIKE ? ESCAPE '\\' OR i.url LIKE ? ESCAPE '\\' OR i.content_text LIKE ? ESCAPE '\\'
            OR i.reader_text LIKE ? ESCAPE '\\' OR i.preview_title LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name LIKE ? ESCAPE '\\')
            OR EXISTS (SELECT 1 FROM attachments a WHERE a.item_id = i.id AND a.original_name LIKE ? ESCAPE '\\'))`,
        );
        params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
      }
    }
    if (filter.favoritesOnly) where.push('i.is_favorite = 1');
    if (filter.pinnedOnly) where.push('i.is_pinned = 1');
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
    for (const name of filter.tagNames ?? []) {
      where.push(
        'EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = ? COLLATE NOCASE)',
      );
      params.push(name);
    }
    if (filter.dateFrom !== undefined) {
      where.push('i.created_at >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      where.push('i.created_at < ?');
      params.push(filter.dateTo);
    }
    if (filter.receiptsOnly || filter.amountMin !== undefined || filter.amountMax !== undefined) {
      const conds = ["f.item_id = i.id", "f.kind = 'total'"];
      if (filter.amountMin !== undefined) {
        conds.push('f.num >= ?');
        params.push(filter.amountMin);
      }
      if (filter.amountMax !== undefined) {
        conds.push('f.num <= ?');
        params.push(filter.amountMax);
      }
      where.push(`EXISTS (SELECT 1 FROM item_facts f WHERE ${conds.join(' AND ')})`);
    }
    if (filter.withReminders) {
      where.push("EXISTS (SELECT 1 FROM reminders r WHERE r.item_id = i.id AND r.status = 'scheduled')");
    }
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    const offset = Math.max(0, filter.offset ?? 0);
    const sql = `SELECT i.* FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
    const rows = await this.db.all<ItemRow>(sql, params);
    return this.attachRelations(rows.map(toItem));
  }

  async countItems(): Promise<number> {
    const row = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE is_secret = 0');
    return row?.n ?? 0;
  }

  async listItemsByOcrStatus(statuses: OcrStatus[]): Promise<Item[]> {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = await this.db.all<ItemRow>(
      `SELECT * FROM items WHERE ocr_status IN (${placeholders}) AND is_secret = 0 ORDER BY created_at ASC`,
      statuses,
    );
    return rows.map(toItem);
  }

  async listItemsByPreviewStatus(statuses: PreviewStatus[]): Promise<Item[]> {
    const placeholders = statuses.map(() => '?').join(',');
    const rows = await this.db.all<ItemRow>(
      `SELECT * FROM items WHERE preview_status IN (${placeholders}) AND is_secret = 0 AND url IS NOT NULL ORDER BY created_at DESC`,
      statuses,
    );
    return rows.map(toItem);
  }

  /** Other (non-secret) items that point to the same page. */
  async findByCanonicalUrl(url: string, excludeId?: string): Promise<Item[]> {
    const canonical = canonicalUrl(url);
    if (!canonical) return [];
    const rows = await this.db.all<ItemRow>(
      'SELECT * FROM items WHERE canonical_url = ? AND is_secret = 0 AND id <> ? ORDER BY created_at DESC',
      [canonical, excludeId ?? ''],
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
    const factRows = await this.db.all<FactRow>(
      `SELECT item_id, kind, value, num FROM item_facts WHERE item_id IN (${placeholders}) ORDER BY rowid ASC`,
      ids,
    );
    const collectionIds = [...new Set(items.map((i) => i.collectionId).filter((c): c is string => !!c))];
    const colRows = collectionIds.length
      ? await this.db.all<CollectionRow>(
          `SELECT * FROM collections WHERE id IN (${collectionIds.map(() => '?').join(',')})`,
          collectionIds,
        )
      : [];
    const group = <R extends { item_id: string }, T>(rows: R[], map: (r: R) => T) => {
      const out = new Map<string, T[]>();
      for (const r of rows) {
        const list = out.get(r.item_id) ?? [];
        list.push(map(r));
        out.set(r.item_id, list);
      }
      return out;
    };
    const tagsByItem = group(tagRows, toTag);
    const attByItem = group(attRows, toAttachment);
    const factsByItem = group(factRows, toFact);
    const colById = new Map(colRows.map((r) => [r.id, toCollection(r)]));
    return items.map((i) => ({
      ...i,
      tags: tagsByItem.get(i.id) ?? [],
      attachments: attByItem.get(i.id) ?? [],
      facts: factsByItem.get(i.id) ?? [],
      collection: i.collectionId ? colById.get(i.collectionId) ?? null : null,
    }));
  }

  /** Rebuilds the full-text row for one item. Must run inside a transaction. */
  private async reindexItem(id: string) {
    if (!this.ftsEnabled) return;
    await this.db.run('DELETE FROM items_fts WHERE item_id = ?', [id]);
    const row = await this.db.first<ItemRow>('SELECT * FROM items WHERE id = ?', [id]);
    if (!row || row.is_secret === 1) return;
    const tags = await this.db.all<{ name: string }>(
      'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?',
      [id],
    );
    const attachments = await this.db.all<{ original_name: string }>(
      "SELECT original_name FROM attachments WHERE item_id = ? AND role <> 'preview'",
      [id],
    );
    const urlText = row.url ? `${row.url} ${row.url.replace(/[^\p{L}\p{N}]+/gu, ' ')}` : '';
    const content = [row.content_text, row.preview_title, row.preview_description, row.preview_site, row.reader_text]
      .filter(Boolean)
      .join('\n');
    await this.db.run(
      'INSERT INTO items_fts (item_id, title, note, url, content_text, tags) VALUES (?, ?, ?, ?, ?, ?)',
      [
        id,
        `${row.title} ${attachments.map((a) => a.original_name).join(' ')}`.trim(),
        row.note,
        urlText,
        content,
        tags.map((t) => t.name).join(' '),
      ],
    );
  }

  /** Rebuilds the entire search index (used after restore). Must run inside a transaction. */
  async rebuildSearchIndexInTransaction() {
    if (!this.ftsEnabled) return;
    await this.db.run('DELETE FROM items_fts');
    const ids = await this.db.all<{ id: string }>('SELECT id FROM items WHERE is_secret = 0');
    for (const { id } of ids) await this.reindexItem(id);
  }

  // ---------------------------------------------------------------- facts

  /** Replaces the smart facts (amounts, dates, phones…) detected in an item. */
  async setItemFacts(itemId: string, facts: { kind: FactKind; value: string; num: number | null }[]): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM item_facts WHERE item_id = ?', [itemId]);
      const ts = this.now();
      for (const f of facts.slice(0, 40)) {
        await this.db.run('INSERT INTO item_facts (item_id, kind, value, num, created_at) VALUES (?, ?, ?, ?, ?)', [
          itemId,
          f.kind,
          f.value,
          f.num,
          ts,
        ]);
      }
    });
  }

  // ------------------------------------------------------------- insights

  async countsByType(): Promise<Record<ItemType, number>> {
    const rows = await this.db.all<{ type: ItemType; n: number }>(
      'SELECT type, COUNT(*) AS n FROM items WHERE is_secret = 0 GROUP BY type',
    );
    const out: Record<ItemType, number> = { note: 0, link: 0, image: 0, document: 0, audio: 0 };
    for (const r of rows) out[r.type] = r.n;
    return out;
  }

  /** Items saved per week for the last `weeks` weeks (oldest first). */
  async itemsPerWeek(weeks: number): Promise<{ start: number; count: number }[]> {
    const now = this.now();
    const start = now - weeks * 7 * DAY;
    const rows = await this.db.all<{ created_at: number }>(
      'SELECT created_at FROM items WHERE is_secret = 0 AND created_at >= ?',
      [start],
    );
    const buckets = Array.from({ length: weeks }, (_, i) => ({ start: start + i * 7 * DAY, count: 0 }));
    for (const r of rows) {
      const idx = Math.min(weeks - 1, Math.floor((r.created_at - start) / (7 * DAY)));
      if (idx >= 0) buckets[idx].count++;
    }
    return buckets;
  }

  /** Sum of detected receipt totals per calendar month for the last `months` months (oldest first). */
  async monthlyTotals(months: number): Promise<{ month: number; total: number; count: number }[]> {
    const now = new Date(this.now());
    const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).getTime();
    const rows = await this.db.all<{ num: number; created_at: number }>(
      `SELECT f.num, i.created_at FROM item_facts f JOIN items i ON i.id = f.item_id
       WHERE f.kind = 'total' AND i.is_secret = 0 AND i.created_at >= ?`,
      [first],
    );
    const buckets = Array.from({ length: months }, (_, i) => ({
      month: new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1).getTime(),
      total: 0,
      count: 0,
    }));
    for (const r of rows) {
      const d = new Date(r.created_at);
      const idx = (d.getFullYear() - new Date(first).getFullYear()) * 12 + d.getMonth() - new Date(first).getMonth();
      if (idx >= 0 && idx < months) {
        buckets[idx].total += r.num ?? 0;
        buckets[idx].count++;
      }
    }
    return buckets.map((b) => ({ ...b, total: Math.round(b.total * 100) / 100 }));
  }

  async topTags(limit = 6): Promise<Tag[]> {
    const rows = await this.db.all<TagRow>(
      `SELECT t.*, COUNT(it.item_id) AS item_count FROM tags t JOIN item_tags it ON it.tag_id = t.id
       JOIN items i ON i.id = it.item_id AND i.is_secret = 0
       GROUP BY t.id ORDER BY item_count DESC, t.name COLLATE NOCASE LIMIT ?`,
      [limit],
    );
    return rows.map(toTag);
  }

  /**
   * Picks one older item to resurface today: something saved on this date in a previous
   * month or year, otherwise a stable "random" pick for the day.
   */
  async rediscover(): Promise<RediscoverPick | null> {
    const now = new Date(this.now());
    const cutoff = now.getTime() - 7 * DAY;
    const rows = await this.db.all<ItemRow>(
      'SELECT * FROM items WHERE is_secret = 0 AND created_at < ? ORDER BY created_at DESC LIMIT 500',
      [cutoff],
    );
    if (rows.length === 0) return null;
    const sameDay = rows.find((r) => {
      const d = new Date(r.created_at);
      return d.getDate() === now.getDate() && (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear());
    });
    let pick: ItemRow;
    let reason: string;
    if (sameDay) {
      const d = new Date(sameDay.created_at);
      const months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
      pick = sameDay;
      reason =
        months % 12 === 0
          ? `On this day ${months / 12} year${months === 12 ? '' : 's'} ago`
          : `Saved ${months} month${months === 1 ? '' : 's'} ago today`;
    } else {
      const daySeed = Math.floor(now.getTime() / DAY);
      pick = rows[(daySeed * 2654435761) % rows.length >>> 0] ?? rows[0];
      const days = Math.round((now.getTime() - pick.created_at) / DAY);
      reason = days >= 60 ? `From ${Math.round(days / 30)} months ago` : `From ${days} days ago`;
    }
    const [item] = await this.attachRelations([toItem(pick)]);
    return { item, reason };
  }

  // ---------------------------------------------------------- attachments

  private async insertAttachment(itemId: string, a: NewAttachmentInput, ts: number) {
    await this.db.run(
      `INSERT INTO attachments (id, item_id, file_name, original_name, mime_type, size, role, duration_ms, encrypted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        a.id ?? newId(),
        itemId,
        a.fileName,
        a.originalName,
        a.mimeType,
        a.size,
        a.role ?? 'file',
        a.durationMs ?? null,
        a.encrypted ? 1 : 0,
        ts,
      ],
    );
  }

  /** Adds attachments to an existing item (e.g. a downloaded link preview image). */
  async addAttachments(itemId: string, attachments: NewAttachmentInput[]): Promise<void> {
    await this.db.transaction(async () => {
      const ts = this.now();
      for (const a of attachments) await this.insertAttachment(itemId, a, ts);
    });
  }

  async deleteAttachment(id: string): Promise<Attachment | null> {
    const row = await this.db.first<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', [id]);
    if (!row) return null;
    await this.db.run('DELETE FROM attachments WHERE id = ?', [id]);
    return toAttachment(row);
  }

  async setAttachmentEncrypted(id: string, fileName: string, encrypted: boolean, size?: number): Promise<void> {
    await this.db.run(
      `UPDATE attachments SET file_name = ?, encrypted = ?${size !== undefined ? ', size = ?' : ''} WHERE id = ?`,
      size !== undefined ? [fileName, encrypted ? 1 : 0, size, id] : [fileName, encrypted ? 1 : 0, id],
    );
  }

  async listAllAttachments(): Promise<Attachment[]> {
    return (await this.db.all<AttachmentRow>('SELECT * FROM attachments')).map(toAttachment);
  }

  // ---------------------------------------------------------- collections

  async listCollections(): Promise<Collection[]> {
    const rows = await this.db.all<CollectionRow>(
      `SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.collection_id = c.id AND i.is_secret = 0) AS item_count
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
      `SELECT t.*, (SELECT COUNT(*) FROM item_tags it JOIN items i ON i.id = it.item_id AND i.is_secret = 0 WHERE it.tag_id = t.id) AS item_count
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
        DELETE FROM item_facts;
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
