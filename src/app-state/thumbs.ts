import type { ItemWithRelations } from '../db/types';
import { isImageMime } from '../lib/text';
import { attachmentPath, FileStore } from '../services/fileStore';

/** Best image to show for an item: its photo, first scanned page, or link preview. */
export function thumbnailFor(files: FileStore, item: ItemWithRelations): string | null {
  if (!files.supported || item.isSecret) return null;
  const images = item.attachments.filter((a) => !a.encrypted && isImageMime(a.mimeType, a.originalName));
  const pick =
    images.find((a) => a.role === 'file') ?? images.find((a) => a.role === 'page') ?? images.find((a) => a.role === 'preview');
  return pick ? files.uri(attachmentPath(pick.fileName)) : null;
}
