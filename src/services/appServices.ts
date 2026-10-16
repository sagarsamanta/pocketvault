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
import { decryptWithPassword, DecryptionError, encryptWithPassword, isEncryptedEnvelope } from '../lib/crypto';
import { extractFacts } from '../lib/facts';
import { BackupError, BackupSummary, createBackup, parseBackup, recoverInterruptedRestore, restoreBackup } from './backup';
import { FileStore, attachmentPath } from './fileStore';
import { PreviewService } from './previews';
import type { BackupWriter, IncomingFile, NetworkMonitor, Notifier, OcrEngine, PageFetcher, SecretKeyStore } from './types';
import { VaultService } from './vault';

/** Optional platform capabilities; tests and the web build may omit any of them. */
export interface ServiceExtras {
  keyStore?: SecretKeyStore;
  fetcher?: PageFetcher;
  network?: NetworkMonitor;
  backupWriter?: BackupWriter;
}

export const SETTINGS = {
  appLock: 'app_lock',
  lockTimeout: 'lock_timeout_s',
  quickSave: 'quick_save',
  viewMode: 'view_mode',
  autoBackupUri: 'auto_backup_uri',
  autoBackupLabel: 'auto_backup_label',
  lastAutoBackup: 'last_auto_backup',
  factsBackfilled: 'facts_backfilled_v2',
  previewsBackfilled: 'previews_backfilled_v2',
} as const;

const WEEK = 7 * 86_400_000;

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
export const DEFAULT_SCAN_TITLE = 'Scanned document';

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
  readonly vault: VaultService;
  readonly previews: PreviewService;

  constructor(
    readonly db: Database,
    readonly repo: Repository,
    readonly files: FileStore,
    readonly notifier: Notifier,
    readonly ocr: OcrEngine,
    readonly extras: ServiceExtras = {},
    private readonly now: () => number = Date.now,
  ) {
    this.vault = new VaultService(this);
    this.previews = new PreviewService(this);
  }

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
      await this.repo.updateItem(item.id, { ocrStatus: 'pending' }, { touch: false });
    }
    await this.vault.clearCache().catch(() => undefined);
    if (this.vault.supported) await this.vault.resealPending().catch(() => undefined);
    await this.backfillV2().catch(() => undefined);
    void this.processOcrQueue();
    void this.previews.processQueue();
    void this.runAutoBackupIfDue().catch(() => undefined);
  }

  /** One-time work after upgrading to 2.0: detect facts in existing items. */
  private async backfillV2() {
    if ((await this.repo.getSetting(SETTINGS.factsBackfilled)) !== '1') {
      const rows = await this.db.all<{ id: string }>('SELECT id FROM items WHERE is_secret = 0');
      for (const { id } of rows) await this.refreshFacts(id);
      await this.repo.setSetting(SETTINGS.factsBackfilled, '1');
    }
    if ((await this.repo.getSetting(SETTINGS.previewsBackfilled)) !== '1') {
      await this.db.run(
        "UPDATE items SET preview_status = 'pending' WHERE type = 'link' AND url IS NOT NULL AND is_secret = 0 AND preview_status = 'none'",
      );
      await this.repo.setSetting(SETTINGS.previewsBackfilled, '1');
    }
  }

  /** Re-detects amounts, dates, phones, emails and links in an item's text. */
  async refreshFacts(itemId: string): Promise<void> {
    const item = await this.repo.getItem(itemId);
    if (!item || item.isSecret) return;
    const text = [item.contentText, item.note, item.title].filter(Boolean).join('\n');
    await this.repo.setItemFacts(itemId, extractFacts(text));
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
    await this.refreshFacts(item.id);
    this.notifyChanged();
    if (item.previewStatus === 'pending') void this.previews.processQueue();
    return item;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    const item = await this.repo.updateItem(id, patch);
    if (patch.title !== undefined || patch.note !== undefined || patch.contentText !== undefined) {
      await this.refreshFacts(id);
    }
    this.notifyChanged();
    if (item.previewStatus === 'pending') void this.previews.processQueue();
    return item;
  }

  /** Other saved items that point to the same web page. */
  findDuplicateLinks(url: string, excludeId?: string): Promise<Item[]> {
    return this.repo.findByCanonicalUrl(url, excludeId);
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
        if (contentText) await this.refreshFacts(item.id);
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
    if (!item || item.isSecret) return;
    // Scanned documents have one image per page; photos have a single image.
    const images = item.attachments.filter(
      (a) => a.role !== 'preview' && !a.encrypted && isImageMime(a.mimeType, a.originalName),
    );
    if (images.length === 0) {
      await this.repo.updateItem(itemId, { ocrStatus: 'failed', ocrError: 'No image attached.' }, { touch: false });
      this.notifyChanged();
      return;
    }
    await this.repo.updateItem(itemId, { ocrStatus: 'processing', ocrError: null }, { touch: false });
    this.notifyChanged();
    try {
      const pages: string[] = [];
      for (const image of images) {
        const path = attachmentPath(image.fileName);
        if (!(await this.files.exists(path))) throw new Error('The image file is missing.');
        pages.push((await this.ocr.recognize(this.files.uri(path))).trim());
      }
      const text = pages.filter(Boolean).join('\n\n');
      // The item may have been deleted (or renamed) while OCR ran.
      const current = await this.repo.getItem(itemId);
      if (!current || current.isSecret) return;
      // Replace a placeholder title with the first line of recognized text.
      const placeholder =
        !current.title ||
        current.title === DEFAULT_IMAGE_TITLE ||
        current.title === DEFAULT_SCAN_TITLE ||
        current.title === images[0].originalName;
      const ocrTitle = placeholder && text ? deriveTitle(text) : '';
      await this.repo.updateItem(
        itemId,
        { contentText: text, ocrStatus: 'done', ocrError: null, ...(ocrTitle ? { title: ocrTitle } : {}) },
        { touch: false },
      );
      await this.refreshFacts(itemId);
    } catch (error) {
      if (!(await this.repo.getItem(itemId))) return;
      const message = (error as Error)?.message || 'Text recognition failed.';
      await this.repo.updateItem(itemId, { ocrStatus: 'failed', ocrError: message.slice(0, 300) }, { touch: false });
    }
    this.notifyChanged();
  }

  // ------------------------------------------------------------ capture

  private async storeFile(uri: string, name: string, mimeType: string, role: 'file' | 'page' | 'audio', durationMs?: number) {
    const id = newId();
    const ext = fileExtension(name) || 'bin';
    const fileName = `${id}.${ext}`;
    const size = await this.files.copyIn(uri, attachmentPath(fileName));
    const att: NewAttachmentInput = { id, fileName, originalName: name, mimeType, size, role, durationMs: durationMs ?? null };
    return att;
  }

  /** Saves a recorded voice note; the transcript (if any) becomes searchable text. */
  async createVoiceNote(input: {
    uri: string;
    mimeType: string;
    durationMs: number;
    transcript?: string;
    extra?: Partial<NewItemInput>;
  }): Promise<Item> {
    if (!this.files.supported) throw new ValidationError('Voice notes are only available in the Android app.');
    const ext = fileExtension(input.uri.split('?')[0]) || (input.mimeType.includes('wav') ? 'wav' : 'm4a');
    const att = await this.storeFile(input.uri, `voice-note.${ext}`, input.mimeType, 'audio', input.durationMs);
    const transcript = (input.transcript ?? '').trim();
    try {
      const item = await this.repo.createItem(
        {
          ...input.extra,
          type: 'audio',
          title: input.extra?.title?.trim() || deriveTitle(transcript, 60) || 'Voice note',
          contentText: transcript,
          source: 'manual',
        },
        [att],
      );
      if (transcript) await this.refreshFacts(item.id);
      this.notifyChanged();
      return item;
    } catch (error) {
      await this.files.delete(attachmentPath(att.fileName)).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Saves scanned pages as one document: a PDF (when provided) plus the page images,
   * which are OCR'd so the scan becomes searchable.
   */
  async createScan(input: { pageUris: string[]; pdfUri?: string | null; extra?: Partial<NewItemInput> }): Promise<Item> {
    if (!this.files.supported) throw new ValidationError('Scanning is only available in the Android app.');
    if (input.pageUris.length === 0) throw new ValidationError('No pages were scanned.');
    const stored: NewAttachmentInput[] = [];
    try {
      if (input.pdfUri) stored.push(await this.storeFile(input.pdfUri, 'scan.pdf', 'application/pdf', 'file'));
      for (let i = 0; i < input.pageUris.length; i++) {
        stored.push(await this.storeFile(input.pageUris[i], `page-${i + 1}.jpg`, 'image/jpeg', 'page'));
      }
      const item = await this.repo.createItem(
        {
          ...input.extra,
          type: 'document',
          title: input.extra?.title?.trim() || DEFAULT_SCAN_TITLE,
          ocrStatus: this.ocr.supported ? 'pending' : 'none',
          source: 'manual',
        },
        stored,
      );
      this.notifyChanged();
      void this.processOcrQueue();
      return item;
    } catch (error) {
      for (const a of stored) await this.files.delete(attachmentPath(a.fileName)).catch(() => undefined);
      throw error;
    }
  }

  // ---------------------------------------------------------- reminders

  private async scheduleNotification(reminder: Reminder): Promise<string | null> {
    if (!this.notifier.supported || reminder.remindAt <= this.now()) return null;
    const permission = await this.notifier.getPermission();
    if (permission !== 'granted') return null;
    const item = await this.repo.getItem(reminder.itemId);
    const title = item?.title || item?.url || 'PocketVault reminder';
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

  /**
   * Exports a backup. With a password the file is encrypted (PBKDF2 + AES-256-GCM) and
   * also contains secret items; without one, secret items are left out.
   */
  async exportBackupJson(
    appVersion?: string,
    options: { password?: string } = {},
  ): Promise<{ json: string; summary: BackupSummary }> {
    const secrets =
      options.password && this.vault.supported && (await this.repo.countSecretItems()) > 0
        ? {
            decryptItem: (row: Record<string, string | number | null>) => this.vault.decryptForBackup(row),
            decryptFile: (fileName: string) => this.vault.decryptFileForBackup(fileName),
          }
        : undefined;
    const backup = await createBackup(this.db, this.files, appVersion, secrets);
    const plain = JSON.stringify(backup);
    const summary: BackupSummary = {
      items: backup.tables.items.length,
      collections: backup.tables.collections.length,
      tags: backup.tables.tags.length,
      reminders: backup.tables.reminders.length,
      attachments: backup.tables.attachments.length,
      missingFiles: backup.missingFiles.length,
      secretItems: backup.tables.items.filter((r) => Number(r.is_secret) === 1).length,
      excludedSecrets: backup.excludedSecrets ?? 0,
    };
    return { json: options.password ? await encryptWithPassword(plain, options.password) : plain, summary };
  }

  /** True when the file is a password-protected backup. */
  isEncryptedBackup(json: string): boolean {
    return isEncryptedEnvelope(json);
  }

  /** Decrypts (if needed) and validates a backup without changing anything. */
  async previewBackup(json: string, password?: string) {
    const plain = await this.unwrapBackup(json, password);
    return parseBackup(plain);
  }

  private async unwrapBackup(json: string, password?: string): Promise<string> {
    if (!isEncryptedEnvelope(json)) return json;
    if (!password) throw new BackupError('This backup is password-protected. Enter its password to restore it.');
    try {
      return await decryptWithPassword(json, password);
    } catch (error) {
      throw new BackupError(error instanceof DecryptionError ? error.message : 'Could not decrypt the backup.');
    }
  }

  async restoreBackupJson(json: string, password?: string): Promise<BackupSummary> {
    const backup = parseBackup(await this.unwrapBackup(json, password));
    // Cancel notifications that belong to the data being replaced.
    for (const r of await this.repo.listReminders('scheduled')) {
      if (r.notificationId) await this.safeCancel(r.notificationId);
    }
    const summary = await restoreBackup(this.db, this.repo, this.files, backup);
    // Secret items arrive decrypted inside password backups; seal them with this device's key.
    if (this.vault.supported) await this.vault.resealPending();
    await this.resyncNotifications();
    this.notifyChanged();
    void this.processOcrQueue();
    void this.previews.processQueue();
    return summary;
  }

  /** Writes a weekly backup to the folder the user chose, when one is due. */
  async runAutoBackupIfDue(force = false): Promise<boolean> {
    const writer = this.extras.backupWriter;
    const folder = await this.repo.getSetting(SETTINGS.autoBackupUri);
    if (!writer || !folder) return false;
    const last = Number((await this.repo.getSetting(SETTINGS.lastAutoBackup)) ?? 0);
    if (!force && this.now() - last < WEEK) return false;
    const { json } = await this.exportBackupJson();
    const d = new Date(this.now());
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `pocketvault-auto-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    await writer.write(folder, name, json);
    await this.repo.setSetting(SETTINGS.lastAutoBackup, String(this.now()));
    this.notifyChanged();
    return true;
  }

  async eraseAllData(): Promise<void> {
    await this.notifier.cancelAll().catch(() => undefined);
    await this.repo.eraseAll();
    if (this.files.supported) await this.files.deleteDir('attachments');
    this.notifyChanged();
  }
}
