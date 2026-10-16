import { SecretFields } from '../db/repository';
import type { Attachment, ItemWithRelations } from '../db/types';
import { base64ToBytes, bytesToBase64, SecretBox } from '../lib/crypto';
import type { AppServices } from './appServices';
import { attachmentPath } from './fileStore';

/** Decrypted copies of secret files live here only while being viewed. */
export const SECRET_CACHE_DIR = 'secret-cache';

/**
 * Secret items: their text fields are AES-GCM encrypted into `secret_payload` and their
 * files are encrypted on disk. The key lives in the platform key store, never in the DB.
 */
export class VaultService {
  private box: SecretBox | null = null;

  constructor(private readonly app: AppServices) {}

  get supported(): boolean {
    return !!this.app.extras.keyStore?.supported && this.app.files.supported;
  }

  private async getBox(create: boolean): Promise<SecretBox> {
    if (this.box) return this.box;
    const store = this.app.extras.keyStore;
    if (!store?.supported) throw new Error('Secret items are only available in the Android app.');
    let key = await store.getKey();
    if (!key) {
      if (!create) throw new Error('The vault key is missing on this device.');
      key = await store.createKey();
    }
    this.box = new SecretBox(key);
    return this.box;
  }

  private fieldsOf(item: ItemWithRelations): SecretFields {
    return {
      title: item.title,
      note: item.note,
      url: item.url,
      contentText: item.contentText,
      readerText: item.readerText,
      previewTitle: item.previewTitle,
      previewDescription: item.previewDescription,
      previewSite: item.previewSite,
    };
  }

  private async encryptFile(att: Attachment, box: SecretBox) {
    if (att.encrypted) return;
    const plainPath = attachmentPath(att.fileName);
    if (!(await this.app.files.exists(plainPath))) return;
    const sealed = box.encryptBytes(base64ToBytes(await this.app.files.readBase64(plainPath)));
    const encName = `${att.fileName}.enc`;
    await this.app.files.writeBase64(attachmentPath(encName), bytesToBase64(sealed));
    await this.app.repo.setAttachmentEncrypted(att.id, encName, true, sealed.length);
    await this.app.files.delete(plainPath);
  }

  private async decryptFile(att: Attachment, box: SecretBox) {
    if (!att.encrypted) return;
    const encPath = attachmentPath(att.fileName);
    if (!(await this.app.files.exists(encPath))) return;
    const plain = box.decryptBytes(base64ToBytes(await this.app.files.readBase64(encPath)));
    const plainName = att.fileName.replace(/\.enc$/, '');
    await this.app.files.writeBase64(attachmentPath(plainName), bytesToBase64(plain));
    await this.app.repo.setAttachmentEncrypted(att.id, plainName, false, plain.length);
    await this.app.files.delete(encPath);
  }

  /** Moves an item into the vault: encrypts its text and files and hides it everywhere else. */
  async makeSecret(itemId: string): Promise<void> {
    const box = await this.getBox(true);
    const item = await this.app.repo.getItemWithRelations(itemId);
    if (!item) throw new Error('Item not found');
    if (item.isSecret) return;
    await this.app.repo.makeSecret(itemId, box.encryptText(JSON.stringify(this.fieldsOf(item))));
    for (const att of item.attachments) await this.encryptFile(att, box);
    this.app.notifyChanged();
  }

  /** Moves an item out of the vault, decrypting it back into a normal item. */
  async revealSecret(itemId: string): Promise<void> {
    const box = await this.getBox(false);
    const payload = await this.app.repo.getSecretPayload(itemId);
    const item = await this.app.repo.getItemWithRelations(itemId);
    if (!item || !payload) throw new Error('Secret item not found');
    for (const att of item.attachments) await this.decryptFile(att, box);
    await this.app.repo.revealSecret(itemId, JSON.parse(box.decryptText(payload)) as SecretFields);
    await this.app.refreshFacts(itemId);
    this.app.notifyChanged();
  }

  private async decrypt(item: ItemWithRelations, box: SecretBox): Promise<ItemWithRelations> {
    const payload = await this.app.repo.getSecretPayload(item.id);
    if (!payload) return item;
    try {
      return { ...item, ...(JSON.parse(box.decryptText(payload)) as SecretFields) };
    } catch {
      return { ...item, title: '🔒 Could not decrypt', note: '' };
    }
  }

  async listSecretItems(query = ''): Promise<ItemWithRelations[]> {
    if (!this.supported || (await this.app.repo.countSecretItems()) === 0) return [];
    const box = await this.getBox(false);
    const items = await Promise.all((await this.app.repo.listItems({ secretOnly: true, limit: 1000 })).map((i) => this.decrypt(i, box)));
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => [i.title, i.note, i.url, i.contentText].some((f) => f?.toLowerCase().includes(q)));
  }

  async getSecretItem(itemId: string): Promise<ItemWithRelations | null> {
    const item = await this.app.repo.getItemWithRelations(itemId);
    if (!item) return null;
    if (!item.isSecret) return item;
    return this.decrypt(item, await this.getBox(false));
  }

  /** Saves edits to a secret item (re-encrypting its fields). */
  async updateSecret(itemId: string, patch: Partial<SecretFields>): Promise<void> {
    const box = await this.getBox(false);
    const current = await this.getSecretItem(itemId);
    if (!current) throw new Error('Secret item not found');
    const fields = { ...this.fieldsOf(current), ...patch };
    await this.app.repo.updateSecretPayload(itemId, box.encryptText(JSON.stringify(fields)));
    this.app.notifyChanged();
  }

  /** Returns a viewable file:// URI, decrypting into a temporary cache when needed. */
  async viewableUri(att: Attachment): Promise<string> {
    if (!att.encrypted) return this.app.files.uri(attachmentPath(att.fileName));
    const box = await this.getBox(false);
    const tempPath = `${SECRET_CACHE_DIR}/${att.fileName.replace(/\.enc$/, '')}`;
    if (!(await this.app.files.exists(tempPath))) {
      const plain = box.decryptBytes(base64ToBytes(await this.app.files.readBase64(attachmentPath(att.fileName))));
      await this.app.files.writeBase64(tempPath, bytesToBase64(plain));
    }
    return this.app.files.uri(tempPath);
  }

  /** Removes decrypted temporary files (on lock and at startup). */
  async clearCache(): Promise<void> {
    if (this.app.files.supported) await this.app.files.deleteDir(SECRET_CACHE_DIR);
  }

  /** Decrypts a secret item for export inside a password-protected backup. */
  async decryptForBackup(row: Record<string, string | number | null>): Promise<Record<string, string | number | null>> {
    const box = await this.getBox(false);
    const fields = JSON.parse(box.decryptText(String(row.secret_payload))) as SecretFields;
    return {
      ...row,
      secret_payload: null,
      title: fields.title,
      note: fields.note,
      url: fields.url,
      content_text: fields.contentText,
      reader_text: fields.readerText,
      preview_title: fields.previewTitle,
      preview_description: fields.previewDescription,
      preview_site: fields.previewSite,
    };
  }

  async decryptFileForBackup(fileName: string): Promise<string> {
    const box = await this.getBox(false);
    return bytesToBase64(box.decryptBytes(base64ToBytes(await this.app.files.readBase64(attachmentPath(fileName)))));
  }

  /**
   * Re-encrypts items that are marked secret but stored in plaintext — after restoring a
   * password-protected backup, or if the app stopped half-way through.
   */
  async resealPending(): Promise<number> {
    const pending = await this.app.db.all<{ id: string }>(
      'SELECT id FROM items WHERE is_secret = 1 AND secret_payload IS NULL',
    );
    if (pending.length === 0) return 0;
    const box = await this.getBox(true);
    for (const { id } of pending) {
      const item = await this.app.repo.getItemWithRelations(id);
      if (!item) continue;
      await this.app.repo.makeSecret(id, box.encryptText(JSON.stringify(this.fieldsOf(item))));
      for (const att of item.attachments) await this.encryptFile(att, box);
    }
    this.app.notifyChanged();
    return pending.length;
  }
}
