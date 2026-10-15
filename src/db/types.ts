export type ItemType = 'note' | 'link' | 'image' | 'document';
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
  collectionId: string | null;
  isFavorite: boolean;
  ocrStatus: OcrStatus;
  ocrError: string | null;
  source: ItemSource;
  createdAt: number;
  updatedAt: number;
}

export interface ItemWithRelations extends Item {
  tags: Tag[];
  attachments: Attachment[];
  collection: Collection | null;
}

export interface Attachment {
  id: string;
  itemId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
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
  limit?: number;
  offset?: number;
}
