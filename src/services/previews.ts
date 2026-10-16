import { newId } from '../lib/id';
import { extractReadableText, parseHtmlMetadata } from '../lib/links';
import type { AppServices } from './appServices';
import { attachmentPath } from './fileStore';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Fetches link previews (title, description, site, image) and a reader-mode copy of the
 * article so links look rich and stay readable offline. Runs only when online; items wait
 * in the "pending" state otherwise.
 */
export class PreviewService {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly app: AppServices) {}

  get supported(): boolean {
    return !!this.app.extras.fetcher?.supported;
  }

  /** Processes pending previews one at a time; resolves when the queue is drained. */
  processQueue(): Promise<void> {
    if (!this.supported) return Promise.resolve();
    this.chain = this.chain.then(() => this.drain()).catch(() => undefined);
    return this.chain;
  }

  async retry(itemId: string): Promise<void> {
    await this.app.repo.updateItem(itemId, { previewStatus: 'pending' }, { touch: false });
    this.app.notifyChanged();
    await this.processQueue();
  }

  private async drain() {
    const network = this.app.extras.network;
    for (;;) {
      if (network && !(await network.isOnline())) return;
      const [next] = await this.app.repo.listItemsByPreviewStatus(['pending']);
      if (!next) return;
      await this.fetchPreview(next.id);
    }
  }

  private async fetchPreview(itemId: string) {
    const fetcher = this.app.extras.fetcher!;
    const item = await this.app.repo.getItemWithRelations(itemId);
    if (!item?.url || item.isSecret) return;
    try {
      const { html, finalUrl } = await fetcher.fetchHtml(item.url);
      const meta = parseHtmlMetadata(html, finalUrl);
      const readerText = extractReadableText(html);
      if (meta.imageUrl && this.app.files.supported && !item.attachments.some((a) => a.role === 'preview')) {
        const id = newId();
        const ext = (meta.imageUrl.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/i)?.[1] ?? 'jpg').toLowerCase();
        const fileName = `${id}.${ext}`;
        try {
          const { size, mimeType } = await fetcher.downloadImage(meta.imageUrl, attachmentPath(fileName));
          if (size > 0 && size <= MAX_IMAGE_BYTES && mimeType.startsWith('image/')) {
            await this.app.repo.addAttachments(itemId, [
              { id, fileName, originalName: `preview.${ext}`, mimeType, size, role: 'preview' },
            ]);
          } else {
            await this.app.files.delete(attachmentPath(fileName));
          }
        } catch {
          await this.app.files.delete(attachmentPath(fileName)).catch(() => undefined);
        }
      }
      // The item may have been deleted or made secret while we were fetching.
      const current = await this.app.repo.getItem(itemId);
      if (!current || current.isSecret) return;
      await this.app.repo.updateItem(
        itemId,
        {
          previewStatus: 'done',
          previewTitle: meta.title,
          previewDescription: meta.description,
          previewSite: meta.siteName,
          readerText,
          // Use the page title when the user did not give one.
          ...(!current.title && meta.title ? { title: meta.title } : {}),
        },
        { touch: false },
      );
    } catch {
      if (await this.app.repo.getItem(itemId)) {
        await this.app.repo.updateItem(itemId, { previewStatus: 'failed' }, { touch: false });
      }
    }
    this.app.notifyChanged();
  }
}
