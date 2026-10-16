import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from '../../db/openDatabase';
import { NodeSqliteDriver, TempFileStore } from '../../test/nodeDb';
import { AppServices, SETTINGS } from '../appServices';
import { attachmentPath } from '../fileStore';
import type { BackupWriter, NetworkMonitor, Notifier, OcrEngine, PageFetcher, PermissionState, SecretKeyStore } from '../types';

class MemoryKeyStore implements SecretKeyStore {
  supported = true;
  key: Uint8Array | null = null;
  async getKey() {
    return this.key;
  }
  async createKey() {
    if (this.key) throw new Error('exists');
    this.key = globalThis.crypto.getRandomValues(new Uint8Array(32));
    return this.key;
  }
}

const notifier: Notifier = {
  supported: true,
  getPermission: async (): Promise<PermissionState> => 'granted',
  requestPermission: async (): Promise<PermissionState> => 'granted',
  schedule: async () => 'n1',
  cancel: async () => undefined,
  cancelAll: async () => undefined,
};

class FakeOcr implements OcrEngine {
  supported = true;
  calls: string[] = [];
  async recognize(uri: string) {
    this.calls.push(uri);
    return uri.includes('page-2') || this.calls.length === 2 ? 'Page two text' : 'INVOICE 77\nTOTAL ₹950.00\nCall 9876543210';
  }
}

class FakeFetcher implements PageFetcher {
  supported = true;
  fail = false;
  constructor(private files: TempFileStore) {}
  async fetchHtml(url: string) {
    if (this.fail) throw new Error('offline');
    return {
      finalUrl: url,
      html: `<html><head><meta property="og:title" content="Volcano Trek"><meta property="og:site_name" content="Hike Mag">
        <meta property="og:image" content="https://img.example/cover.jpg"><meta name="description" content="Best routes"></head>
        <body><article><p>${'Pack layers and crampons for the summit push at dawn. '.repeat(6)}</p></article></body></html>`,
    };
  }
  async downloadImage(_url: string, destPath: string) {
    await this.files.writeBase64(destPath, Buffer.from('jpegbytes').toString('base64'));
    return { size: 9, mimeType: 'image/jpeg' };
  }
}

class Online implements NetworkMonitor {
  online = true;
  async isOnline() {
    return this.online;
  }
}

class MemoryWriter implements BackupWriter {
  written: { folder: string; name: string; contents: string }[] = [];
  async write(folder: string, name: string, contents: string) {
    this.written.push({ folder, name, contents });
  }
}

const stores: TempFileStore[] = [];
afterAll(() => stores.forEach((s) => s.cleanup()));

async function setup(now?: () => number) {
  const files = new TempFileStore();
  stores.push(files);
  const { db, repo } = await initDatabase(new NodeSqliteDriver(':memory:'), now);
  const keyStore = new MemoryKeyStore();
  const fetcher = new FakeFetcher(files);
  const network = new Online();
  const writer = new MemoryWriter();
  const ocr = new FakeOcr();
  const app = new AppServices(db, repo, files, notifier, ocr, { keyStore, fetcher, network, backupWriter: writer }, now);
  const src = fs.mkdtempSync(path.join(files.root, 'src-'));
  const makeSource = (name: string, content: string) => {
    const p = path.join(src, name);
    fs.writeFileSync(p, content);
    return `file://${p}`;
  };
  return { app, repo, files, keyStore, fetcher, network, writer, ocr, makeSource, db };
}

describe('secret vault', () => {
  it('encrypts text and files, hides the item, and reveals it intact', async () => {
    const { app, repo, files, makeSource } = await setup();
    const [img] = await app.importFiles([{ uri: makeSource('id-card.png', 'PNGDATA'), name: 'id-card.png', mimeType: 'image/png' }]);
    await app.processOcrQueue();
    await app.updateItem(img.id, { note: 'passport number X1234567' });
    await app.vault.makeSecret(img.id);

    expect(await repo.listItems()).toEqual([]);
    expect(await repo.listItems({ query: 'passport' })).toEqual([]);
    const raw = await repo.getItemWithRelations(img.id);
    expect(raw?.note).toBe('');
    expect(raw?.attachments[0]).toMatchObject({ encrypted: true });
    expect(raw?.attachments[0].fileName).toMatch(/\.enc$/);
    const stored = Buffer.from(await files.readBase64(attachmentPath(raw!.attachments[0].fileName)), 'base64').toString();
    expect(stored).not.toContain('PNGDATA');

    const [listed] = await app.vault.listSecretItems();
    expect(listed.note).toBe('passport number X1234567');
    expect(await app.vault.listSecretItems('X1234567')).toHaveLength(1);
    expect(await app.vault.listSecretItems('nothing')).toHaveLength(0);
    const viewUri = await app.vault.viewableUri(raw!.attachments[0]);
    expect(fs.readFileSync(viewUri.replace('file://', ''), 'utf8')).toBe('PNGDATA');
    await app.vault.clearCache();
    expect(fs.existsSync(viewUri.replace('file://', ''))).toBe(false);

    await app.vault.updateSecret(img.id, { note: 'updated secret note' });
    expect((await app.vault.getSecretItem(img.id))?.note).toBe('updated secret note');

    await app.vault.revealSecret(img.id);
    const back = await repo.getItemWithRelations(img.id);
    expect(back).toMatchObject({ isSecret: false, note: 'updated secret note' });
    expect(back?.attachments[0].encrypted).toBe(false);
    expect(Buffer.from(await files.readBase64(attachmentPath(back!.attachments[0].fileName)), 'base64').toString()).toBe('PNGDATA');
    expect((await repo.listItems({ query: 'updated' })).length).toBe(1);
  });

  it('includes secrets only in password-protected backups and reseals them on restore', async () => {
    const source = await setup();
    const note = await source.app.createItem({ type: 'note', title: 'Wifi password', note: 'hunter2' });
    await source.app.createItem({ type: 'note', title: 'Public note' });
    await source.app.vault.makeSecret(note.id);

    const plain = await source.app.exportBackupJson();
    expect(plain.summary.excludedSecrets).toBe(1);
    expect(plain.json).not.toContain('hunter2');

    const locked = await source.app.exportBackupJson('2.0.0', { password: 'pw-1234' });
    expect(source.app.isEncryptedBackup(locked.json)).toBe(true);
    expect(locked.json).not.toContain('hunter2');
    expect(locked.summary.secretItems).toBe(1);

    const target = await setup();
    await expect(target.app.restoreBackupJson(locked.json)).rejects.toThrow(/password-protected/);
    await expect(target.app.restoreBackupJson(locked.json, 'wrong')).rejects.toThrow(/Wrong password/);
    const summary = await target.app.restoreBackupJson(locked.json, 'pw-1234');
    expect(summary.items).toBe(2);
    expect((await target.repo.listItems()).map((i) => i.title)).toEqual(['Public note']);
    const [secret] = await target.app.vault.listSecretItems();
    expect(secret).toMatchObject({ title: 'Wifi password', note: 'hunter2' });
    // Stored sealed with the target device's own key.
    const raw = await target.db.first<{ title: string; secret_payload: string }>('SELECT title, secret_payload FROM items WHERE is_secret = 1');
    expect(raw?.title).toBe('');
    expect(raw?.secret_payload).toMatch(/^v1:/);
    expect(await target.repo.listItems({ query: 'hunter2' })).toEqual([]);
  }, 30_000); // PBKDF2 (210k iterations) runs several times here
});

describe('smart facts', () => {
  it('detects facts from OCR and notes and keeps them in sync', async () => {
    const { app, repo, makeSource } = await setup();
    const [img] = await app.importFiles([{ uri: makeSource('1000000019.png', 'x'), name: '1000000019.png', mimeType: 'image/png' }]);
    await app.processOcrQueue();
    let item = await repo.getItemWithRelations(img.id);
    expect(item?.title).toBe('INVOICE 77');
    expect(item?.facts.find((f) => f.kind === 'total')).toMatchObject({ num: 950 });
    expect(item?.facts.find((f) => f.kind === 'phone')?.value).toBe('9876543210');
    expect((await repo.listItems({ receiptsOnly: true, amountMin: 900 })).map((i) => i.id)).toEqual([img.id]);

    const note = await app.createItem({ type: 'note', title: 'Call plumber', note: 'mail bob@pipes.co' });
    item = await repo.getItemWithRelations(note.id);
    expect(item?.facts.map((f) => f.kind)).toEqual(['email']);
    await app.updateItem(note.id, { note: 'no contact any more' });
    expect((await repo.getItemWithRelations(note.id))?.facts).toEqual([]);
  });
});

describe('link previews', () => {
  it('fetches title, site, image and reader text when online; waits when offline; retries after failure', async () => {
    const { app, repo, network, fetcher } = await setup();
    network.online = false;
    const link = await app.createItem({ type: 'link', url: 'https://hike.example/volcano' });
    await app.previews.processQueue();
    expect((await repo.getItem(link.id))?.previewStatus).toBe('pending');

    network.online = true;
    await app.previews.processQueue();
    const done = await repo.getItemWithRelations(link.id);
    expect(done).toMatchObject({ previewStatus: 'done', previewTitle: 'Volcano Trek', previewSite: 'Hike Mag', title: 'Volcano Trek' });
    expect(done?.readerText).toContain('crampons');
    expect(done?.attachments.find((a) => a.role === 'preview')).toMatchObject({ mimeType: 'image/jpeg' });
    expect((await repo.listItems({ query: 'crampons' })).map((i) => i.id)).toEqual([link.id]);

    fetcher.fail = true;
    const broken = await app.createItem({ type: 'link', url: 'https://down.example', title: 'Keep my title' });
    await app.previews.processQueue();
    expect((await repo.getItem(broken.id))?.previewStatus).toBe('failed');
    fetcher.fail = false;
    await app.previews.retry(broken.id);
    expect(await repo.getItem(broken.id)).toMatchObject({ previewStatus: 'done', title: 'Keep my title' });
  });

  it('flags duplicate links', async () => {
    const { app } = await setup();
    const a = await app.createItem({ type: 'link', url: 'https://www.news.example/story?utm_source=x' });
    expect((await app.findDuplicateLinks('https://news.example/story/')).map((i) => i.id)).toEqual([a.id]);
  });
});

describe('capture', () => {
  it('saves voice notes with transcript as searchable audio items', async () => {
    const { app, repo, makeSource } = await setup();
    const item = await app.createVoiceNote({
      uri: makeSource('rec.wav', 'RIFF....'),
      mimeType: 'audio/wav',
      durationMs: 4200,
      transcript: 'Remember to buy oat milk and call 9876543210',
    });
    const full = await repo.getItemWithRelations(item.id);
    expect(full).toMatchObject({ type: 'audio', title: 'Remember to buy oat milk and call 9876543210' });
    expect(full?.attachments[0]).toMatchObject({ role: 'audio', durationMs: 4200, mimeType: 'audio/wav' });
    expect(full?.facts.map((f) => f.kind)).toContain('phone');
    expect((await repo.listItems({ query: 'oat milk' })).length).toBe(1);
    const silent = await app.createVoiceNote({ uri: makeSource('r2.m4a', 'x'), mimeType: 'audio/mp4', durationMs: 1000 });
    expect(silent.title).toBe('Voice note');
  });

  it('saves multi-page scans with a PDF and OCRs every page', async () => {
    const { app, repo, ocr, makeSource } = await setup();
    const item = await app.createScan({
      pageUris: [makeSource('p1.jpg', '1'), makeSource('p2.jpg', '2')],
      pdfUri: makeSource('scan.pdf', '%PDF'),
    });
    await app.processOcrQueue();
    const full = await repo.getItemWithRelations(item.id);
    expect(full?.attachments.map((a) => a.role)).toEqual(['file', 'page', 'page']);
    expect(ocr.calls).toHaveLength(2);
    expect(full?.contentText).toContain('Page two text');
    expect(full?.title).toBe('INVOICE 77');
    await expect(app.createScan({ pageUris: [] })).rejects.toThrow(/No pages/);
  });
});

describe('automatic backups', () => {
  it('writes a backup weekly to the chosen folder', async () => {
    let clock = new Date(2026, 9, 16).getTime();
    const { app, repo, writer } = await setup(() => clock);
    await app.createItem({ type: 'note', title: 'x' });
    expect(await app.runAutoBackupIfDue()).toBe(false); // no folder chosen
    await repo.setSetting(SETTINGS.autoBackupUri, 'content://tree/backups');
    expect(await app.runAutoBackupIfDue()).toBe(true);
    expect(writer.written[0]).toMatchObject({ folder: 'content://tree/backups', name: 'pocketvault-auto-2026-10-16.json' });
    clock += 3 * 86_400_000;
    expect(await app.runAutoBackupIfDue()).toBe(false);
    clock += 5 * 86_400_000;
    expect(await app.runAutoBackupIfDue()).toBe(true);
    expect(writer.written).toHaveLength(2);
  });
});
