import { Database } from '../db/adapter';
import { ItemPatch, NewAttachmentInput, NewItemInput, Repository, ValidationError } from '../db/repository';
import type { Item, ItemSource, Reminder } from '../db/types';
import { newId } from '../lib/id';
import {
  clampIndexedText,
  deriveTitle,
  extractUrl,
  fileExtension,
  guessMimeType,
  isImageMime,
  isProbablyUrl,
  isTextDocument,
  sanitizeFileName,
} from '../lib/text';
import { BackupSummary, createBackup, parseBackup, recoverInterruptedRestore, restoreBackup } from './backup';
import { FileStore, attachmentPath } from './fileStore';
import type { IncomingFile, Notifier, OcrEngine } from './types';

type Listener = () => void;

export interface ScheduleResult {
  reminder: Reminder;
  /** False when the reminder was saved but no system notification could be scheduled. */
  notificationScheduled: boolean;
}

/** Text documents larger than this are stored but not indexed. */
const MAX_TEXT_DOC_BYTES = 2 * 1024 * 1024;

/** Default title for images whose file name carries no meaning (camera/picker names). */
export const DEFAULT_IMAGE_TITLE = 'Photo';

/** Camera and photo-picker names such as "1000000019.png", "IMG_20240101_1200.jpg" or "PXL_…". */
export function isGenericImageName(name: string): boolean {
  return /^(img|pxl|dsc|photo|image|screenshot|signal|whatsapp image)?[\s_-]*[\d\s_.-]*\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(name);
}

/**
 * Coordinates the database, attachment files, notifications and OCR so that
 * screens perform each user action through a single call.
 */
export class AppServices {
  private listeners = new Set<Listener>();
  private ocrChain: Promise<void> = Promise.resolve();

  constructor(
    readonly db: Database,
    readonly repo: Repository,
    readonly files: FileStore,
    readonly notifier: Notifier,
    readonly ocr: OcrEngine,
    private readonly now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------- events

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyChanged() {
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ startup

  /** Recovers from interrupted work. Safe to call on every launch. */
  async startup(): Promise<void> {
    await recoverInterruptedRestore(this.db, this.files);
    await this.removeOrphanFiles();
    // OCR that was running when the app was killed is retried.
    for (const item of await this.repo.listItemsByOcrStatus(['processing'])) {
      await this.repo.updateItem(item.id, { ocrStatus: 'pending' });
    }
    void this.processOcrQueue();
  }

  /** Deletes attachment files left behind by an import that was interrupted before saving. */
  async removeOrphanFiles(): Promise<number> {
    if (!this.files.supported) return 0;
    const referenced = new Set((await this.repo.listAllAttachments()).map((a) => a.fileName));
    let removed = 0;
    for (const name of await this.files.list('attachments')) {
      if (!referenced.has(name)) {
        await this.files.delete(attachmentPath(name)).catch(() => undefined);
        removed++;
      }
    }
    return removed;
  }

  // -------------------------------------------------------------- items

  async createItem(input: NewItemInput): Promise<Item> {
    const item = await this.repo.createItem(input);
    this.notifyChanged();
    return item;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    const item = await this.repo.updateItem(id, patch);
    this.notifyChanged();
    return item;
  }

  async setTags(id: string, names: string[]) {
    await this.repo.setItemTags(id, names);
    this.notifyChanged();
  }

  async deleteItem(id: string): Promise<void> {
    const { attachments, reminders } = await this.repo.deleteItem(id);
    for (const r of reminders) {
      if (r.notificationId) await this.safeCancel(r.notificationId);
    }
    for (const a of attachments) {
      await this.files.delete(attachmentPath(a.fileName)).catch(() => undefined);
    }
    this.notifyChanged();
  }

  /** Builds an item from shared/pasted text, detecting links. */
  textToItemInput(text: string, subject?: string | null, source: ItemSource = 'share'): NewItemInput {
    const trimmed = text.trim();
    const url = extractUrl(trimmed);
    if (url && (isProbablyUrl(trimmed) || trimmed.length < 300)) {
      // Remove every copy of the link (Android often sends it both as the URL and inside the text).
      const rest = trimmed.split(url).join(' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
      return {
        type: 'link',
        url,
        title: (subject ?? '').trim() || deriveTitle(rest) || '',
        note: rest,
        source,
      };
    }
    return { type: 'note', title: (subject ?? '').trim() || deriveTitle(trimmed), note: trimmed, source };
  }

  /**
   * Copies incoming files into app storage and creates one item per file.
   * Images are queued for OCR; small text documents are indexed directly.
   * If any step fails, files copied so far are removed and nothing is saved.
   */
  async importFiles(
    incoming: IncomingFile[],
    extra: Partial<NewItemInput> = {},
    source: ItemSource = 'import',
  ): Promise<Item[]> {
    if (!this.files.supported) throw new ValidationError('Importing files is only available in the Android app.');
    const created: Item[] = [];
    for (const file of incoming) {
      const name = sanitizeFileName(file.name || 'file');
      const mimeType = file.mimeType || guessMimeType(name);
      const isImage = isImageMime(mimeType, name);
      const ext = fileExtension(name) || (isImage ? 'jpg' : 'bin');
      const attachmentId = newId();
      const fileName = `${attachmentId}.${ext}`;
      const path = attachmentPath(fileName);
      try {
        const size = await this.files.copyIn(file.uri, path);
        let contentText = '';
        if (!isImage && isTextDocument(mimeType, name) && size <= MAX_TEXT_DOC_BYTES) {
          contentText = clampIndexedText(await this.files.readText(path).catch(() => ''));
        }
        const attachment: NewAttachmentInput = { id: attachmentId, fileName, originalName: name, mimeType, size };
        const item = await this.repo.createItem(
          {
            ...extra,
            type: isImage ? 'image' : 'document',
            title:
              (incoming.length === 1 ? extra.title?.trim() : '') ||
              (isImage && isGenericImageName(name) ? DEFAULT_IMAGE_TITLE : name),
            contentText,
            ocrStatus: isImage && this.ocr.supported ? 'pending' : 'none',
            source,
          },
          [attachment],
        );
        created.push(item);
      } catch (error) {
        await this.files.delete(path).catch(() => undefined);
        for (const item of created) await this.deleteItem(item.id).catch(() => undefined);
        throw error;
      }
    }
    this.notifyChanged();
    void this.processOcrQueue();
    return created;
  }

  // ---------------------------------------------------------------- OCR

  async retryOcr(itemId: string) {
    await this.repo.updateItem(itemId, { ocrStatus: 'pending', ocrError: null });
    this.notifyChanged();
    await this.processOcrQueue();
  }

  /**
   * Runs OCR for pending images one at a time. Calls are chained, so the returned
   * promise resolves only after everything pending at call time has been processed.
   */
  processOcrQueue(): Promise<void> {
    if (!this.ocr.supported) return Promise.resolve();
    this.ocrChain = this.ocrChain.then(() => this.drainOcr()).catch(() => undefined);
    return this.ocrChain;
  }

  private async drainOcr() {
    for (;;) {
      const [next] = await this.repo.listItemsByOcrStatus(['pending']);
      if (!next) break;
      await this.runOcr(next.id);
    }
  }

  private async runOcr(itemId: string) {
    const item = await this.repo.getItemWithRelations(itemId);
    if (!item) return;
    const image = item.attachments.find((a) => isImageMime(a.mimeType, a.originalName));
    if (!image) {
      await this.repo.updateItem(itemId, { ocrStatus: 'failed', ocrError: 'No image attached.' });
      this.notifyChanged();
      return;
    }
    await this.repo.updateItem(itemId, { ocrStatus: 'processing', ocrError: null });
    this.notifyChanged();
    try {
      const path = attachmentPath(image.fileName);
      if (!(await this.files.exists(path))) throw new Error('The image file is missing.');
      const text = (await this.ocr.recognize(this.files.uri(path))).trim();
      // The item may have been deleted (or renamed) while OCR ran.
      const current = await this.repo.getItem(itemId);
      if (!current) return;
      // Replace a placeholder title with the first line of recognized text.
      const placeholder = current.title === DEFAULT_IMAGE_TITLE || current.title === image.originalName || !current.title;
      const ocrTitle = placeholder && text ? deriveTitle(text) : '';
      await this.repo.updateItem(itemId, {
        contentText: text,
        ocrStatus: 'done',
        ocrError: null,
        ...(ocrTitle ? { title: ocrTitle } : {}),
      });
    } catch (error) {
      if (!(await this.repo.getItem(itemId))) return;
      const message = (error as Error)?.message || 'Text recognition failed.';
      await this.repo.updateItem(itemId, { ocrStatus: 'failed', ocrError: message.slice(0, 300) });
    }
    this.notifyChanged();
  }

  // ---------------------------------------------------------- reminders

  private async scheduleNotification(reminder: Reminder): Promise<string | null> {
    if (!this.notifier.supported || reminder.remindAt <= this.now()) return null;
    const permission = await this.notifier.getPermission();
    if (permission !== 'granted') return null;
    const item = await this.repo.getItem(reminder.itemId);
    const title = item?.title || item?.url || 'Stash reminder';
    const body = item?.note?.trim().slice(0, 120) || 'Tap to open your saved item.';
    try {
      return await this.notifier.schedule({
        reminderId: reminder.id,
        itemId: reminder.itemId,
        title,
        body,
        at: reminder.remindAt,
      });
    } catch {
      return null;
    }
  }

  private async safeCancel(notificationId: string) {
    try {
      await this.notifier.cancel(notificationId);
    } catch {
      // The notification may already have fired or been dismissed.
    }
  }

  async addReminder(itemId: string, at: number): Promise<ScheduleResult> {
    if (at <= this.now()) throw new ValidationError('Choose a time in the future.');
    let reminder = await this.repo.createReminder(itemId, at);
    const notificationId = await this.scheduleNotification(reminder);
    if (notificationId) reminder = await this.repo.updateReminder(reminder.id, { notificationId });
    this.notifyChanged();
    return { reminder, notificationScheduled: !!notificationId };
  }

  async rescheduleReminder(reminderId: string, at: number): Promise<ScheduleResult> {
    if (at <= this.now()) throw new ValidationError('Choose a time in the future.');
    const existing = await this.repo.getReminder(reminderId);
    if (!existing) throw new ValidationError('This reminder no longer exists.');
    if (existing.notificationId) await this.safeCancel(existing.notificationId);
    let reminder = await this.repo.updateReminder(reminderId, { remindAt: at, status: 'scheduled', notificationId: null });
    const notificationId = await this.scheduleNotification(reminder);
    if (notificationId) reminder = await this.repo.updateReminder(reminderId, { notificationId });
    this.notifyChanged();
    return { reminder, notificationScheduled: !!notificationId };
  }

  async completeReminder(reminderId: string) {
    await this.finishReminder(reminderId, 'completed');
  }

  async cancelReminder(reminderId: string) {
    await this.finishReminder(reminderId, 'cancelled');
  }

  private async finishReminder(reminderId: string, status: 'completed' | 'cancelled') {
    const existing = await this.repo.getReminder(reminderId);
    if (!existing) return;
    if (existing.notificationId) await this.safeCancel(existing.notificationId);
    await this.repo.updateReminder(reminderId, { status, notificationId: null });
    this.notifyChanged();
  }

  async deleteReminder(reminderId: string) {
    const existing = await this.repo.getReminder(reminderId);
    if (existing?.notificationId) await this.safeCancel(existing.notificationId);
    await this.repo.deleteReminder(reminderId);
    this.notifyChanged();
  }

  /**
   * Re-creates system notifications for all future scheduled reminders, e.g. after
   * a restore or once the user grants notification permission.
   * Returns how many were scheduled.
   */
  async resyncNotifications(): Promise<number> {
    if (!this.notifier.supported) return 0;
    await this.notifier.cancelAll().catch(() => undefined);
    let count = 0;
    for (const r of await this.repo.listReminders('scheduled')) {
      const notificationId = await this.scheduleNotification(r);
      await this.repo.updateReminder(r.id, { notificationId });
      if (notificationId) count++;
    }
    this.notifyChanged();
    return count;
  }

  // ------------------------------------------------------------- backup

  async exportBackupJson(appVersion?: string): Promise<{ json: string; summary: BackupSummary }> {
    const backup = await createBackup(this.db, this.files, appVersion);
    return {
      json: JSON.stringify(backup),
      summary: {
        items: backup.tables.items.length,
        collections: backup.tables.collections.length,
        tags: backup.tables.tags.length,
        reminders: backup.tables.reminders.length,
        attachments: backup.tables.attachments.length,
        missingFiles: backup.missingFiles.length,
      },
    };
  }

  async restoreBackupJson(json: string): Promise<BackupSummary> {
    const backup = parseBackup(json);
    // Cancel notifications that belong to the data being replaced.
    for (const r of await this.repo.listReminders('scheduled')) {
      if (r.notificationId) await this.safeCancel(r.notificationId);
    }
    const summary = await restoreBackup(this.db, this.repo, this.files, backup);
    await this.resyncNotifications();
    this.notifyChanged();
    return summary;
  }

  async eraseAllData(): Promise<void> {
    await this.notifier.cancelAll().catch(() => undefined);
    await this.repo.eraseAll();
    if (this.files.supported) await this.files.deleteDir('attachments');
    this.notifyChanged();
  }
}
