export type ItemType = 'note' | 'link' | 'image' | 'document' | 'audio';
export type PreviewStatus = 'none' | 'pending' | 'done' | 'failed';
export type AttachmentRole = 'file' | 'preview' | 'page' | 'audio';
export type FactKind = 'total' | 'amount' | 'date' | 'phone' | 'email' | 'url';
/** Colour labels users can put on items. */
export const ITEM_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type ItemColor = (typeof ITEM_COLORS)[number];
export type OcrStatus = 'none' | 'pending' | 'processing' | 'done' | 'failed';
export type ItemSource = 'manual' | 'share' | 'import';
export type ReminderStatus = 'scheduled' | 'completed' | 'cancelled';

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  note: string;
  url: string | null;
  contentText: string;
  canonicalUrl: string | null;
  collectionId: string | null;
  isFavorite: boolean;
  isPinned: boolean;
  color: ItemColor | null;
  isSecret: boolean;
  ocrStatus: OcrStatus;
  ocrError: string | null;
  previewStatus: PreviewStatus;
  previewTitle: string | null;
  previewDescription: string | null;
  previewSite: string | null;
  readerText: string;
  source: ItemSource;
  createdAt: number;
  updatedAt: number;
}

export interface ItemWithRelations extends Item {
  tags: Tag[];
  attachments: Attachment[];
  collection: Collection | null;
  facts: ItemFact[];
}

export interface ItemFact {
  kind: FactKind;
  /** Display value, e.g. "₹42.00", "+91 98765 43210", "2026-10-14". */
  value: string;
  /** Numeric value for amounts (in the document's currency) or a timestamp for dates. */
  num: number | null;
}

export interface Attachment {
  id: string;
  itemId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  role: AttachmentRole;
  durationMs: number | null;
  encrypted: boolean;
  createdAt: number;
}

export interface Collection {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  itemCount?: number;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
  itemCount?: number;
}

export interface Reminder {
  id: string;
  itemId: string;
  remindAt: number;
  status: ReminderStatus;
  notificationId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReminderWithItem extends Reminder {
  itemTitle: string;
}

export interface ItemFilter {
  query?: string;
  favoritesOnly?: boolean;
  type?: ItemType | null;
  collectionId?: string | null;
  tagId?: string | null;
  tagNames?: string[];
  pinnedOnly?: boolean;
  secretOnly?: boolean;
  dateFrom?: number;
  dateTo?: number;
  receiptsOnly?: boolean;
  amountMin?: number;
  amountMax?: number;
  withReminders?: boolean;
  limit?: number;
  offset?: number;
}
