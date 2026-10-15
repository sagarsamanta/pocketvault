import { initDatabase } from '../../db/openDatabase';
import { NodeSqliteDriver, TempFileStore } from '../../test/nodeDb';
import {
  BackupError,
  createBackup,
  parseBackup,
  recoverInterruptedRestore,
  restoreBackup,
} from '../backup';
import { RESTORE_STAGING_DIR, attachmentPath } from '../fileStore';

const stores: TempFileStore[] = [];
afterAll(() => stores.forEach((s) => s.cleanup()));

async function makeEnv() {
  const files = new TempFileStore();
  stores.push(files);
  const opened = await initDatabase(new NodeSqliteDriver(':memory:'));
  return { ...opened, files };
}

async function seed(env: Awaited<ReturnType<typeof makeEnv>>) {
  const { repo, files } = env;
  const col = await repo.createCollection('Recipes');
  await files.writeBase64(attachmentPath('img-1.png'), Buffer.from('fake-png').toString('base64'));
  const item = await repo.createItem(
    { type: 'image', title: 'Pancakes', collectionId: col.id, tagNames: ['breakfast'], contentText: 'flour eggs' },
    [{ fileName: 'img-1.png', originalName: 'pancakes.png', mimeType: 'image/png', size: 8 }],
  );
  const reminder = await repo.createReminder(item.id, Date.now() + 3_600_000);
  await repo.updateReminder(reminder.id, { notificationId: 'native-1' });
  await repo.createItem({ type: 'link', title: 'Blog', url: 'https://example.com', isFavorite: true });
  await repo.setSetting('theme', 'dark');
  await repo.setSetting('onboarding_done', '1');
  return { col, item };
}

describe('backup round trip', () => {
  it('restores records, relationships, files and search into a fresh install', async () => {
    const source = await makeEnv();
    await seed(source);
    const backup = await createBackup(source.db, source.files);
    expect(backup.missingFiles).toEqual([]);
    const json = JSON.stringify(backup);

    const target = await makeEnv();
    await target.repo.createItem({ type: 'note', title: 'Will be replaced' });
    await target.files.writeBase64(attachmentPath('orphan.bin'), 'AAAA');
    const summary = await restoreBackup(target.db, target.repo, target.files, parseBackup(json));

    expect(summary).toMatchObject({ items: 2, collections: 1, tags: 1, reminders: 1, attachments: 1 });
    const items = await target.repo.listItems();
    expect(items.map((i) => i.title).sort()).toEqual(['Blog', 'Pancakes']);
    const pancakes = items.find((i) => i.title === 'Pancakes')!;
    expect(pancakes.collection?.name).toBe('Recipes');
    expect(pancakes.tags.map((t) => t.name)).toEqual(['breakfast']);
    expect(pancakes.attachments[0].originalName).toBe('pancakes.png');
    expect(items.find((i) => i.title === 'Blog')!.isFavorite).toBe(true);
    expect((await target.repo.listItems({ query: 'eggs' })).map((i) => i.title)).toEqual(['Pancakes']);
    const [reminder] = await target.repo.listReminders();
    expect(reminder.notificationId).toBeNull();
    expect(await target.repo.getSetting('theme')).toBe('dark');
    // Device-specific settings are neither exported nor overwritten.
    expect(backup.tables.settings.find((s) => s.key === 'onboarding_done')).toBeUndefined();
    expect(Buffer.from(await target.files.readBase64(attachmentPath('img-1.png')), 'base64').toString()).toBe(
      'fake-png',
    );
    expect(await target.files.exists(attachmentPath('orphan.bin'))).toBe(false);
    expect(await target.files.exists(RESTORE_STAGING_DIR)).toBe(false);
    expect(await target.repo.getSetting('pending_restore')).toBeNull();
  });

  it('records attachments whose files are missing instead of failing', async () => {
    const env = await makeEnv();
    await seed(env);
    await env.files.delete(attachmentPath('img-1.png'));
    const backup = await createBackup(env.db, env.files);
    expect(backup.missingFiles).toEqual(['img-1.png']);
    const target = await makeEnv();
    const summary = await restoreBackup(target.db, target.repo, target.files, parseBackup(JSON.stringify(backup)));
    expect(summary.missingFiles).toBe(1);
    expect(await target.repo.countItems()).toBe(2);
  });
});

describe('backup validation', () => {
  it.each([
    ['not json', /could not read JSON/],
    ['{"format":"other"}', /not a Stash backup/],
    ['{"format":"stash-backup","version":99,"tables":{}}', /newer version/],
    ['{"format":"stash-backup","version":1}', /missing its data/],
    ['{"format":"stash-backup","version":1,"tables":{"items":"x"}}', /damaged/],
    ['{"format":"stash-backup","version":1,"tables":{"items":[{"id":{}}]}}', /damaged/],
    [
      '{"format":"stash-backup","version":1,"tables":{"attachments":[{"file_name":"../../evil"}]}}',
      /unsafe file name/,
    ],
    ['{"format":"stash-backup","version":1,"tables":{},"files":{"../x":"AA"}}', /damaged attachment/],
  ])('rejects %s', (json, message) => {
    expect(() => parseBackup(json)).toThrow(BackupError);
    expect(() => parseBackup(json)).toThrow(message);
  });
});

describe('interrupted restore safety', () => {
  it('leaves existing data untouched when the restore transaction fails', async () => {
    const env = await makeEnv();
    await seed(env);
    const backup = await createBackup(env.db, env.files);
    // Corrupt the backup so a foreign key fails mid-transaction.
    backup.tables.item_tags.push({ item_id: 'missing-item', tag_id: 'missing-tag' });
    await expect(restoreBackup(env.db, env.repo, env.files, backup)).rejects.toThrow(/left unchanged/);
    expect(await env.repo.countItems()).toBe(2);
    expect(await env.files.exists(attachmentPath('img-1.png'))).toBe(true);
    expect(await env.files.exists(RESTORE_STAGING_DIR)).toBe(false);
    expect((await env.repo.listItems({ query: 'pancakes' })).length).toBe(1);
  });

  it('finishes moving staged files on next launch after a crash post-commit', async () => {
    const env = await makeEnv();
    await env.files.writeBase64(`${RESTORE_STAGING_DIR}/img-9.png`, 'QUJD');
    await env.repo.setSetting('pending_restore', '1');
    await env.db.run(
      "INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('i9', 'image', 'restored', 1, 1)",
    );
    await env.db.run(
      "INSERT INTO attachments (id, item_id, file_name, created_at) VALUES ('a9', 'i9', 'img-9.png', 1)",
    );
    expect(await recoverInterruptedRestore(env.db, env.files)).toBe(true);
    expect(await env.files.readBase64(attachmentPath('img-9.png'))).toBe('QUJD');
    expect(await env.repo.getSetting('pending_restore')).toBeNull();
    expect(await recoverInterruptedRestore(env.db, env.files)).toBe(false);
  });
});
