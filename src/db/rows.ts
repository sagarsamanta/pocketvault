import { ITEM_COLORS } from './types';
import type { Attachment, Collection, Item, ItemColor, ItemFact, Reminder, Tag } from './types';

export interface ItemRow {
  id: string;
  type: Item['type'];
  title: string;
  note: string;
  url: string | null;
  canonical_url: string | null;
  content_text: string;
  collection_id: string | null;
  is_favorite: number;
  is_pinned: number;
  color: string | null;
  is_secret: number;
  secret_payload: string | null;
  ocr_status: Item['ocrStatus'];
  ocr_error: string | null;
  preview_status: Item['previewStatus'];
  preview_title: string | null;
  preview_description: string | null;
  preview_site: string | null;
  reader_text: string;
  source: Item['source'];
  created_at: number;
  updated_at: number;
}

export interface AttachmentRow {
  id: string;
  item_id: string;
  file_name: string;
  original_name: string;
  mime_type: string;
  size: number;
  role: Attachment['role'];
  duration_ms: number | null;
  encrypted: number;
  created_at: number;
}

export interface FactRow {
  item_id: string;
  kind: ItemFact['kind'];
  value: string;
  num: number | null;
}

export interface CollectionRow {
  id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
  item_count?: number;
}

export interface TagRow {
  id: string;
  name: string;
  created_at: number;
  item_count?: number;
}

export interface ReminderRow {
  id: string;
  item_id: string;
  remind_at: number;
  status: Reminder['status'];
  notification_id: string | null;
  created_at: number;
  updated_at: number;
}

export const toItem = (r: ItemRow): Item => ({
  id: r.id,
  type: r.type,
  title: r.title,
  note: r.note,
  url: r.url,
  canonicalUrl: r.canonical_url,
  contentText: r.content_text,
  collectionId: r.collection_id,
  isFavorite: r.is_favorite === 1,
  isPinned: r.is_pinned === 1,
  color: (ITEM_COLORS as readonly string[]).includes(r.color ?? '') ? (r.color as ItemColor) : null,
  isSecret: r.is_secret === 1,
  ocrStatus: r.ocr_status,
  ocrError: r.ocr_error,
  previewStatus: r.preview_status,
  previewTitle: r.preview_title,
  previewDescription: r.preview_description,
  previewSite: r.preview_site,
  readerText: r.reader_text,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  itemId: r.item_id,
  fileName: r.file_name,
  originalName: r.original_name,
  mimeType: r.mime_type,
  size: r.size,
  role: r.role ?? 'file',
  durationMs: r.duration_ms ?? null,
  encrypted: r.encrypted === 1,
  createdAt: r.created_at,
});

export const toFact = (r: FactRow): ItemFact => ({ kind: r.kind, value: r.value, num: r.num });

export const toCollection = (r: CollectionRow): Collection => ({
  id: r.id,
  name: r.name,
  color: r.color,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.item_count !== undefined ? { itemCount: r.item_count } : {}),
});

export const toTag = (r: TagRow): Tag => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  ...(r.item_count !== undefined ? { itemCount: r.item_count } : {}),
});

export const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  itemId: r.item_id,
  remindAt: r.remind_at,
  status: r.status,
  notificationId: r.notification_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
