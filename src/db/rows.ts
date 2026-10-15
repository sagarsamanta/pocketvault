import type { Attachment, Collection, Item, Reminder, Tag } from './types';

export interface ItemRow {
  id: string;
  type: Item['type'];
  title: string;
  note: string;
  url: string | null;
  content_text: string;
  collection_id: string | null;
  is_favorite: number;
  ocr_status: Item['ocrStatus'];
  ocr_error: string | null;
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
  created_at: number;
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
  contentText: r.content_text,
  collectionId: r.collection_id,
  isFavorite: r.is_favorite === 1,
  ocrStatus: r.ocr_status,
  ocrError: r.ocr_error,
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
  createdAt: r.created_at,
});

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
