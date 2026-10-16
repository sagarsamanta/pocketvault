import { Database } from '../adapter';
import { MIGRATIONS, SCHEMA_VERSION } from '../migrations';
import { initDatabase } from '../openDatabase';
import { Repository } from '../repository';
import { NodeSqliteDriver, TempFileStore } from '../../test/nodeDb';
import { createBackup, parseBackup, restoreBackup } from '../../services/backup';

const DAY = 86_400_000;

describe('migration v1 → v2', () => {
  it('upgrades a v1 database in place without losing data or relationships', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    const db = new Database(driver);
    await db.exec('PRAGMA foreign_keys = ON');
    await db.exec(MIGRATIONS[0]);
    await db.exec('PRAGMA user_version = 1');
    await db.exec(`
      INSERT INTO collections VALUES ('c1', 'Travel', '#000', 1, 1);
      INSERT INTO tags VALUES ('t1', 'japan', 1);
      INSERT INTO items (id, type, title, note, url, content_text, collection_id, is_favorite, ocr_status, source, created_at, updated_at)
        VALUES ('i1', 'link', 'Guide', 'n', 'https://www.example.com/a?utm_source=x', '', 'c1', 1, 'none', 'share', 10, 20),
               ('i2', 'image', 'Receipt', '', NULL, 'TOTAL 42.00', NULL, 0, 'done', 'import', 30, 40);
      INSERT INTO attachments (id, item_id, file_name, original_name, mime_type, size, created_at) VALUES ('a1', 'i2', 'f.png', 'r.png', 'image/png', 5, 30);
      INSERT INTO item_tags VALUES ('i1', 't1');
      INSERT INTO reminders VALUES ('r1', 'i1', 999, 'scheduled', NULL, 1, 1);
    `);

    const { repo, schemaVersion, db: migrated } = await initDatabase(driver);
    expect(schemaVersion).toBe(SCHEMA_VERSION);
    const items = await repo.listItems();
    expect(items.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
    const link = items.find((i) => i.id === 'i1')!;
    expect(link).toMatchObject({ title: 'Guide', isFavorite: true, isPinned: false, isSecret: false, previewStatus: 'pending' });
    expect(link.collection?.name).toBe('Travel');
    expect(link.tags.map((t) => t.name)).toEqual(['japan']);
    const image = items.find((i) => i.id === 'i2')!;
    expect(image.attachments[0]).toMatchObject({ fileName: 'f.png', role: 'file', encrypted: false });
    expect(await repo.listReminders()).toHaveLength(1);
    // Search index still works, foreign keys still enforced and cascading.
    expect((await repo.listItems({ query: 'japan' })).map((i) => i.id)).toEqual(['i1']);
    expect((await migrated.first<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
    await repo.deleteItem('i2');
    expect(await repo.listAllAttachments()).toEqual([]);
    await expect(
      migrated.run("INSERT INTO item_tags VALUES ('missing', 't1')"),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

async function setup(now = () => Date.now()) {
  const { repo, db } = await initDatabase(new NodeSqliteDriver(':memory:'), now);
  return { repo, db };
}

describe('v2 repository features', () => {
  let repo: Repository;
  beforeEach(async () => {
    repo = (await setup()).repo;
  });

  it('lists pinned items first and stores colour labels', async () => {
    await repo.createItem({ type: 'note', title: 'older pinned', isPinned: true, color: 'purple' });
    await repo.createItem({ type: 'note', title: 'newer' });
    const list = await repo.listItems();
    expect(list.map((i) => i.title)).toEqual(['older pinned', 'newer']);
    expect(list[0].color).toBe('purple');
    expect((await repo.listItems({ pinnedOnly: true })).map((i) => i.title)).toEqual(['older pinned']);
  });

  it('keeps secret items out of lists, search, counts and facts; reveals them back', async () => {
    const item = await repo.createItem({ type: 'note', title: 'Bank PIN', note: '4321', tagNames: ['private'] });
    await repo.setItemFacts(item.id, [{ kind: 'phone', value: '9876543210', num: null }]);
    await repo.makeSecret(item.id, 'v1:sealed');
    expect(await repo.listItems()).toEqual([]);
    expect(await repo.listItems({ query: 'bank' })).toEqual([]);
    expect(await repo.countItems()).toBe(0);
    expect((await repo.listTags())[0].itemCount).toBe(0);
    const [secret] = await repo.listItems({ secretOnly: true });
    expect(secret).toMatchObject({ isSecret: true, title: '', note: '' });
    expect(secret.facts).toEqual([]);
    expect(await repo.getSecretPayload(item.id)).toBe('v1:sealed');
    expect(await repo.countSecretItems()).toBe(1);

    await repo.revealSecret(item.id, {
      title: 'Bank PIN',
      note: '4321',
      url: null,
      contentText: '',
      readerText: '',
      previewTitle: null,
      previewDescription: null,
      previewSite: null,
    });
    expect((await repo.listItems({ query: 'bank' })).map((i) => i.title)).toEqual(['Bank PIN']);
    expect(await repo.getSecretPayload(item.id)).toBeNull();
  });

  it('detects duplicate links by canonical URL', async () => {
    const a = await repo.createItem({ type: 'link', url: 'https://www.site.com/post/?utm_source=tw' });
    expect(a.previewStatus).toBe('pending');
    expect((await repo.findByCanonicalUrl('http://site.com/post')).map((i) => i.id)).toEqual([a.id]);
    expect(await repo.findByCanonicalUrl('http://site.com/post', a.id)).toEqual([]);
  });

  it('marks a link for a fresh preview when its URL changes', async () => {
    const a = await repo.createItem({ type: 'link', url: 'https://a.com' });
    await repo.updateItem(a.id, { previewStatus: 'done', previewTitle: 'A' });
    const b = await repo.updateItem(a.id, { url: 'https://b.com' });
    expect(b).toMatchObject({ previewStatus: 'pending', previewTitle: null, canonicalUrl: 'b.com' });
  });

  it('searches preview titles and reader text', async () => {
    const a = await repo.createItem({ type: 'link', url: 'https://x.com/1' });
    await repo.updateItem(a.id, { previewTitle: 'Volcano hiking', readerText: 'Pack crampons for the glacier.' });
    expect((await repo.listItems({ query: 'volcano' })).length).toBe(1);
    expect((await repo.listItems({ query: 'crampons' })).length).toBe(1);
  });

  it('filters by smart filters: dates, receipts, amounts, tag names, reminders', async () => {
    const r1 = await repo.createItem({ type: 'image', title: 'Big receipt', tagNames: ['Work'] });
    const r2 = await repo.createItem({ type: 'image', title: 'Small receipt' });
    await repo.createItem({ type: 'note', title: 'Plain' });
    await repo.setItemFacts(r1.id, [{ kind: 'total', value: '₹900', num: 900 }]);
    await repo.setItemFacts(r2.id, [{ kind: 'total', value: '₹40', num: 40 }]);
    await repo.createReminder(r2.id, Date.now() + DAY);
    const titles = async (f: Parameters<Repository['listItems']>[0]) => (await repo.listItems(f)).map((i) => i.title).sort();
    expect(await titles({ receiptsOnly: true })).toEqual(['Big receipt', 'Small receipt']);
    expect(await titles({ amountMin: 500 })).toEqual(['Big receipt']);
    expect(await titles({ amountMax: 100 })).toEqual(['Small receipt']);
    expect(await titles({ tagNames: ['work'] })).toEqual(['Big receipt']);
    expect(await titles({ withReminders: true })).toEqual(['Small receipt']);
    expect(await titles({ dateFrom: Date.now() + DAY })).toEqual([]);
    expect((await repo.getItemWithRelations(r1.id))?.facts).toEqual([{ kind: 'total', value: '₹900', num: 900 }]);
  });
});

describe('insights and rediscover', () => {
  it('summarizes counts, weekly activity and monthly receipt totals', async () => {
    let clock = new Date(2026, 9, 16, 12).getTime();
    const { repo, db } = await setup(() => clock);
    const a = await repo.createItem({ type: 'image', title: 'Oct receipt' });
    await repo.setItemFacts(a.id, [{ kind: 'total', value: '₹200', num: 200 }]);
    const b = await repo.createItem({ type: 'image', title: 'Sep receipt' });
    await db.run('UPDATE items SET created_at = ? WHERE id = ?', [new Date(2026, 8, 3).getTime(), b.id]);
    await repo.setItemFacts(b.id, [{ kind: 'total', value: '₹50.5', num: 50.5 }]);
    await repo.createItem({ type: 'link', url: 'https://x.y', tagNames: ['read'] });

    expect(await repo.countsByType()).toMatchObject({ image: 2, link: 1, note: 0, document: 0, audio: 0 });
    const months = await repo.monthlyTotals(3);
    expect(months.map((m) => [new Date(m.month).getMonth(), m.total])).toEqual([
      [7, 0],
      [8, 50.5],
      [9, 200],
    ]);
    const weeks = await repo.itemsPerWeek(8);
    expect(weeks).toHaveLength(8);
    expect(weeks.reduce((s, w) => s + w.count, 0)).toBe(3);
    expect((await repo.topTags()).map((t) => [t.name, t.itemCount])).toEqual([['read', 1]]);
    clock += 1;
  });

  it('resurfaces an item saved on this date in a previous month, never secrets or new items', async () => {
    const clock = new Date(2026, 9, 16, 12).getTime();
    const { repo, db } = await setup(() => clock);
    expect(await repo.rediscover()).toBeNull();
    const fresh = await repo.createItem({ type: 'note', title: 'fresh' });
    expect(await repo.rediscover()).toBeNull(); // nothing older than a week
    const old = await repo.createItem({ type: 'note', title: 'from august' });
    await db.run('UPDATE items SET created_at = ? WHERE id = ?', [new Date(2026, 7, 16, 9).getTime(), old.id]);
    const secret = await repo.createItem({ type: 'note', title: 'secret' });
    await db.run('UPDATE items SET created_at = ? WHERE id = ?', [new Date(2025, 9, 16, 9).getTime(), secret.id]);
    await repo.makeSecret(secret.id, 'v1:x');
    const pick = await repo.rediscover();
    expect(pick?.item.title).toBe('from august');
    expect(pick?.reason).toBe('Saved 2 months ago today');
    expect(fresh.id).not.toBe(pick?.item.id);
  });
});

describe('backup v2', () => {
  it('leaves secret items out of plain backups and restores v1-style rows with defaults', async () => {
    const files = new TempFileStore();
    const { repo, db } = await setup();
    const keep = await repo.createItem({ type: 'note', title: 'Normal', isPinned: true, color: 'green' });
    const hidden = await repo.createItem({ type: 'note', title: 'Hidden', tagNames: ['x'] });
    await repo.makeSecret(hidden.id, 'v1:sealed');
    const backup = await createBackup(db, files);
    expect(backup.excludedSecrets).toBe(1);
    expect(backup.tables.items.map((r) => r.id)).toEqual([keep.id]);
    expect(backup.tables.item_tags).toEqual([]);

    // Simulate a v1 backup: strip the new columns.
    const v1 = JSON.parse(JSON.stringify(backup));
    v1.version = 1;
    v1.tables.items = v1.tables.items.map(({ id, type, title, note, url, content_text, collection_id, is_favorite, ocr_status, ocr_error, source, created_at, updated_at }: Record<string, unknown>) => ({ id, type, title, note, url, content_text, collection_id, is_favorite, ocr_status, ocr_error, source, created_at, updated_at }));
    delete v1.tables.item_facts;
    const target = await setup();
    await restoreBackup(target.db, target.repo, files, parseBackup(JSON.stringify(v1)));
    const [restored] = await target.repo.listItems();
    expect(restored).toMatchObject({ title: 'Normal', isPinned: false, isSecret: false, previewStatus: 'none' });
    files.cleanup();
  });
});
