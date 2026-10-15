import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from '../../db/openDatabase';
import { NodeSqliteDriver, TempFileStore } from '../../test/nodeDb';
import { AppServices } from '../appServices';
import { attachmentPath } from '../fileStore';
import type { Notifier, OcrEngine, PermissionState } from '../types';

class FakeNotifier implements Notifier {
  supported = true;
  permission: PermissionState = 'granted';
  scheduled = new Map<string, { at: number; title: string }>();
  failNext = false;
  private seq = 0;
  async getPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
  async schedule(input: { title: string; at: number }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('alarm limit');
    }
    const id = `n${++this.seq}`;
    this.scheduled.set(id, { at: input.at, title: input.title });
    return id;
  }
  async cancel(id: string) {
    this.scheduled.delete(id);
  }
  async cancelAll() {
    this.scheduled.clear();
  }
}

class FakeOcr implements OcrEngine {
  supported = true;
  result: string | Error = 'HELLO WORLD';
  calls = 0;
  async recognize() {
    this.calls++;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const stores: TempFileStore[] = [];
afterAll(() => stores.forEach((s) => s.cleanup()));

const HOUR = 3_600_000;

async function setup() {
  const files = new TempFileStore();
  stores.push(files);
  const { db, repo } = await initDatabase(new NodeSqliteDriver(':memory:'));
  const notifier = new FakeNotifier();
  const ocr = new FakeOcr();
  const app = new AppServices(db, repo, files, notifier, ocr);
  // A source directory standing in for picker/share-intent cache files.
  const src = fs.mkdtempSync(path.join(files.root, 'src-'));
  const makeSource = (name: string, content: string) => {
    const p = path.join(src, name);
    fs.writeFileSync(p, content);
    return `file://${p}`;
  };
  return { app, repo, files, notifier, ocr, makeSource };
}

describe('text intake', () => {
  it('turns shared URLs and text into the right item types', async () => {
    const { app } = await setup();
    expect(app.textToItemInput('https://expo.dev/blog')).toMatchObject({ type: 'link', url: 'https://expo.dev/blog' });
    expect(app.textToItemInput('Great read https://a.dev/x', 'Subject')).toMatchObject({
      type: 'link',
      url: 'https://a.dev/x',
      title: 'Subject',
      note: 'Great read',
    });
    expect(app.textToItemInput('Just a thought\nsecond line')).toMatchObject({ type: 'note', title: 'Just a thought' });
    // Android often repeats the link: once as the URL and again inside the text.
    expect(app.textToItemInput('https://a.dev/x\nGreat read https://a.dev/x')).toMatchObject({
      type: 'link',
      url: 'https://a.dev/x',
      title: 'Great read',
      note: 'Great read',
    });
    expect(app.textToItemInput('https://a.dev/x')).toMatchObject({ type: 'link', title: '', note: '' });
  });
});

describe('file import', () => {
  it('imports images (queued for OCR) and indexes text documents', async () => {
    const { app, repo, files, ocr, makeSource } = await setup();
    const [img, doc] = await app.importFiles([
      { uri: makeSource('photo.jpg', 'jpgdata'), name: 'photo.jpg', mimeType: 'image/jpeg' },
      { uri: makeSource('notes.md', '# Quarterly plan\nship it'), name: 'notes.md', mimeType: 'text/markdown' },
    ]);
    expect(img.type).toBe('image');
    expect(doc.type).toBe('document');
    expect(doc.contentText).toContain('Quarterly plan');
    await app.processOcrQueue();
    expect(ocr.calls).toBe(1);
    const done = await repo.getItemWithRelations(img.id);
    expect(done?.ocrStatus).toBe('done');
    expect(done?.contentText).toBe('HELLO WORLD');
    expect(await files.exists(attachmentPath(done!.attachments[0].fileName))).toBe(true);
    expect((await repo.listItems({ query: 'hello' })).map((i) => i.id)).toEqual([img.id]);
    expect((await repo.listItems({ query: 'quarterly' })).map((i) => i.id)).toEqual([doc.id]);
  });

  it('titles generic photos from their OCR text, but keeps user and meaningful titles', async () => {
    const { app, repo, ocr, makeSource } = await setup();
    ocr.result = 'INVOICE 2048\nTOTAL 42.00';
    const [generic] = await app.importFiles([{ uri: makeSource('1000000019.png', 'x'), name: '1000000019.png', mimeType: 'image/png' }]);
    expect(generic.title).toBe('Photo');
    const [named] = await app.importFiles([{ uri: makeSource('passport scan.jpg', 'x'), name: 'passport scan.jpg', mimeType: 'image/jpeg' }]);
    const [custom] = await app.importFiles([{ uri: makeSource('IMG_0001.jpg', 'x'), name: 'IMG_0001.jpg', mimeType: 'image/jpeg' }], { title: 'My receipt' });
    await app.processOcrQueue();
    expect((await repo.getItem(generic.id))?.title).toBe('INVOICE 2048');
    expect((await repo.getItem(named.id))?.title).toBe('INVOICE 2048'); // file-name title is a placeholder too
    expect((await repo.getItem(custom.id))?.title).toBe('My receipt');
  });

  it('rolls back the whole import when a file cannot be copied', async () => {
    const { app, repo, files, makeSource } = await setup();
    await expect(
      app.importFiles([
        { uri: makeSource('ok.png', 'x'), name: 'ok.png', mimeType: 'image/png' },
        { uri: 'file:///definitely/missing.pdf', name: 'missing.pdf', mimeType: 'application/pdf' },
      ]),
    ).rejects.toThrow();
    expect(await repo.countItems()).toBe(0);
    expect(await files.list('attachments')).toEqual([]);
  });

  it('removes attachment files when an item is deleted', async () => {
    const { app, repo, files, makeSource } = await setup();
    const [item] = await app.importFiles([{ uri: makeSource('a.pdf', 'pdf'), name: 'a.pdf', mimeType: 'application/pdf' }]);
    const { attachments } = (await repo.getItemWithRelations(item.id))!;
    await app.deleteItem(item.id);
    expect(await files.exists(attachmentPath(attachments[0].fileName))).toBe(false);
  });

  it('cleans up orphaned files from interrupted imports at startup', async () => {
    const { app, files } = await setup();
    await files.writeBase64(attachmentPath('orphan.jpg'), 'AA==');
    await app.startup();
    expect(await files.list('attachments')).toEqual([]);
  });
});

describe('OCR errors and retry', () => {
  it('marks failures, then succeeds on retry', async () => {
    const { app, repo, ocr, makeSource } = await setup();
    ocr.result = new Error('Model unavailable');
    const [img] = await app.importFiles([{ uri: makeSource('s.png', 'x'), name: 's.png', mimeType: 'image/png' }]);
    await app.processOcrQueue();
    let item = await repo.getItem(img.id);
    expect(item?.ocrStatus).toBe('failed');
    expect(item?.ocrError).toBe('Model unavailable');
    ocr.result = 'Recovered text';
    await app.retryOcr(img.id);
    item = await repo.getItem(img.id);
    expect(item?.ocrStatus).toBe('done');
    expect(item?.contentText).toBe('Recovered text');
  });

  it('fails gracefully when the image file is missing', async () => {
    const { app, repo, files, makeSource } = await setup();
    const [img] = await app.importFiles([{ uri: makeSource('m.png', 'x'), name: 'm.png', mimeType: 'image/png' }]);
    const att = (await repo.getItemWithRelations(img.id))!.attachments[0];
    await files.delete(attachmentPath(att.fileName));
    await app.processOcrQueue();
    expect((await repo.getItem(img.id))?.ocrError).toMatch(/missing/);
  });

  it('resumes OCR interrupted by an app kill', async () => {
    const { app, repo, makeSource } = await setup();
    const [img] = await app.importFiles([{ uri: makeSource('k.png', 'x'), name: 'k.png', mimeType: 'image/png' }]);
    await repo.updateItem(img.id, { ocrStatus: 'processing' });
    await app.startup();
    await app.processOcrQueue();
    expect((await repo.getItem(img.id))?.ocrStatus).toBe('done');
  });
});

describe('reminders and notifications', () => {
  it('schedules, reschedules, completes and cancels with matching notifications', async () => {
    const { app, repo, notifier } = await setup();
    const item = await app.createItem({ type: 'note', title: 'Dentist' });
    const { reminder, notificationScheduled } = await app.addReminder(item.id, Date.now() + HOUR);
    expect(notificationScheduled).toBe(true);
    expect(notifier.scheduled.size).toBe(1);
    expect([...notifier.scheduled.values()][0].title).toBe('Dentist');

    const moved = await app.rescheduleReminder(reminder.id, Date.now() + 2 * HOUR);
    expect(notifier.scheduled.size).toBe(1);
    expect([...notifier.scheduled.values()][0].at).toBe(moved.reminder.remindAt);

    await app.completeReminder(reminder.id);
    expect(notifier.scheduled.size).toBe(0);
    expect((await repo.getReminder(reminder.id))?.status).toBe('completed');

    const second = await app.addReminder(item.id, Date.now() + HOUR);
    await app.cancelReminder(second.reminder.id);
    expect(notifier.scheduled.size).toBe(0);
    expect((await repo.getReminder(second.reminder.id))?.status).toBe('cancelled');
  });

  it('saves the reminder without a notification when permission is denied', async () => {
    const { app, repo, notifier } = await setup();
    notifier.permission = 'denied';
    const item = await app.createItem({ type: 'note', title: 'x' });
    const { reminder, notificationScheduled } = await app.addReminder(item.id, Date.now() + HOUR);
    expect(notificationScheduled).toBe(false);
    expect((await repo.getReminder(reminder.id))?.status).toBe('scheduled');
    // Once permission is granted, pending reminders get notifications.
    notifier.permission = 'granted';
    expect(await app.resyncNotifications()).toBe(1);
    expect((await repo.getReminder(reminder.id))?.notificationId).not.toBeNull();
  });

  it('keeps the reminder if the OS refuses to schedule', async () => {
    const { app, notifier } = await setup();
    notifier.failNext = true;
    const item = await app.createItem({ type: 'note', title: 'x' });
    const res = await app.addReminder(item.id, Date.now() + HOUR);
    expect(res.notificationScheduled).toBe(false);
  });

  it('rejects past times and cancels notifications when the item is deleted', async () => {
    const { app, notifier } = await setup();
    const item = await app.createItem({ type: 'note', title: 'x' });
    await expect(app.addReminder(item.id, Date.now() - 1000)).rejects.toThrow(/future/);
    await app.addReminder(item.id, Date.now() + HOUR);
    await app.deleteItem(item.id);
    expect(notifier.scheduled.size).toBe(0);
  });
});

describe('backup through services', () => {
  it('reschedules notifications after restore and erase clears everything', async () => {
    const { app, repo, notifier } = await setup();
    const item = await app.createItem({ type: 'note', title: 'Keep' });
    await app.addReminder(item.id, Date.now() + HOUR);
    const { json, summary } = await app.exportBackupJson();
    expect(summary.items).toBe(1);

    await app.eraseAllData();
    expect(await repo.countItems()).toBe(0);
    expect(notifier.scheduled.size).toBe(0);

    await app.restoreBackupJson(json);
    expect(await repo.countItems()).toBe(1);
    expect(notifier.scheduled.size).toBe(1);
    const [r] = await repo.listReminders('scheduled');
    expect(r.notificationId).not.toBeNull();
  });

  it('notifies subscribers on changes', async () => {
    const { app } = await setup();
    const listener = jest.fn();
    const unsubscribe = app.subscribe(listener);
    await app.createItem({ type: 'note', title: 'x' });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
