import { initDatabase } from '../openDatabase';
import { NotFoundError, Repository, ValidationError } from '../repository';
import { NodeSqliteDriver } from '../../test/nodeDb';
import { MIGRATIONS, SCHEMA_VERSION, getSchemaVersion } from '../migrations';

let clock = 1_000;
const now = () => ++clock;

async function setup(options: { disableFts?: boolean } = {}) {
  const driver = new NodeSqliteDriver(':memory:', options);
  const opened = await initDatabase(driver, now);
  return { ...opened, driver };
}

describe('migrations', () => {
  it('migrates a fresh database to the latest version', async () => {
    const { db, schemaVersion } = await setup();
    expect(schemaVersion).toBe(SCHEMA_VERSION);
    expect(await getSchemaVersion(db)).toBe(MIGRATIONS.length);
    const fk = await db.first<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
  });

  it('is idempotent and preserves data when reopened', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    const first = await initDatabase(driver, now);
    await first.repo.createItem({ type: 'note', title: 'Keep me' });
    const second = await initDatabase(driver, now);
    expect(await second.repo.countItems()).toBe(1);
    expect((await second.repo.listItems({ query: 'keep' }))[0].title).toBe('Keep me');
  });

  it('rebuilds a missing search index from existing items', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    const first = await initDatabase(driver, now);
    await first.repo.createItem({ type: 'note', title: 'Indexed later', note: 'zebra' });
    await first.db.exec('DROP TABLE items_fts');
    const second = await initDatabase(driver, now);
    expect((await second.repo.listItems({ query: 'zebra' })).map((i) => i.title)).toEqual(['Indexed later']);
  });

  it('refuses to open a database from a newer app version', async () => {
    const driver = new NodeSqliteDriver(':memory:');
    await initDatabase(driver, now);
    await driver.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
    await expect(initDatabase(driver, now)).rejects.toThrow(/newer than this app supports/);
  });
});

describe('items', () => {
  let repo: Repository;
  beforeEach(async () => {
    repo = (await setup()).repo;
  });

  it('creates, reads and updates an item', async () => {
    const item = await repo.createItem({ type: 'link', title: '  Expo docs ', url: 'https://docs.expo.dev' });
    expect(item.title).toBe('Expo docs');
    expect(item.isFavorite).toBe(false);
    const updated = await repo.updateItem(item.id, { note: 'Read later', isFavorite: true });
    expect(updated.note).toBe('Read later');
    expect(updated.isFavorite).toBe(true);
    expect(updated.updatedAt).toBeGreaterThan(item.updatedAt);
  });

  it('rejects empty items', async () => {
    await expect(repo.createItem({ type: 'note', title: '   ', note: '  ' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown collection', async () => {
    await expect(repo.createItem({ type: 'note', title: 'x', collectionId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('deletes an item with its attachments, tags and reminders', async () => {
    const item = await repo.createItem({ type: 'image', title: 'Pic', tagNames: ['photo'] }, [
      { fileName: 'a.jpg', originalName: 'a.jpg', mimeType: 'image/jpeg', size: 10 },
    ]);
    await repo.createReminder(item.id, Date.now() + 60_000);
    const removed = await repo.deleteItem(item.id);
    expect(removed.attachments.map((a) => a.fileName)).toEqual(['a.jpg']);
    expect(removed.reminders).toHaveLength(1);
    expect(await repo.getItem(item.id)).toBeNull();
    expect(await repo.listAllAttachments()).toEqual([]);
    expect(await repo.listReminders()).toEqual([]);
    expect((await repo.listTags())[0].itemCount).toBe(0);
    expect(await repo.listItems({ query: 'pic' })).toEqual([]);
    await expect(repo.deleteItem(item.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('filters by favorites, type, collection and tag', async () => {
    const col = await repo.createCollection('Work');
    const a = await repo.createItem({ type: 'note', title: 'A', isFavorite: true, collectionId: col.id });
    await repo.createItem({ type: 'link', title: 'B', url: 'https://b.example', tagNames: ['read'] });
    await repo.createItem({ type: 'note', title: 'C', tagNames: ['read'] });
    const tags = await repo.listTags();
    const read = tags.find((t) => t.name === 'read')!;

    expect((await repo.listItems({ favoritesOnly: true })).map((i) => i.id)).toEqual([a.id]);
    expect((await repo.listItems({ type: 'link' })).map((i) => i.title)).toEqual(['B']);
    expect((await repo.listItems({ collectionId: col.id })).map((i) => i.title)).toEqual(['A']);
    expect((await repo.listItems({ tagId: read.id })).map((i) => i.title).sort()).toEqual(['B', 'C']);
    expect((await repo.listItems({ tagId: read.id, type: 'note' })).map((i) => i.title)).toEqual(['C']);
    const full = (await repo.listItems({ collectionId: col.id }))[0];
    expect(full.collection?.name).toBe('Work');
  });

  it('orders by most recently updated', async () => {
    const a = await repo.createItem({ type: 'note', title: 'old' });
    await repo.createItem({ type: 'note', title: 'new' });
    await repo.updateItem(a.id, { note: 'touched' });
    expect((await repo.listItems()).map((i) => i.title)).toEqual(['old', 'new']);
  });
});

describe.each([
  ['FTS5', false],
  ['LIKE fallback', true],
])('search (%s)', (_label, disableFts) => {
  let repo: Repository;
  beforeEach(async () => {
    const opened = await setup({ disableFts });
    repo = opened.repo;
    expect(opened.ftsEnabled).toBe(!disableFts);
    await repo.createItem({ type: 'note', title: 'Grocery list', note: 'Buy oat milk and bananas' });
    await repo.createItem({ type: 'link', title: 'Article', url: 'https://reactnative.dev/blog/new-arch' });
    await repo.createItem({ type: 'note', title: 'Trip', note: 'Passport', tagNames: ['travel', 'Japan'] });
    await repo.createItem({ type: 'image', title: 'Receipt', contentText: 'TOTAL 42.00 Café Amélie' }, [
      { fileName: 'r.jpg', originalName: 'scan-0001.jpg', mimeType: 'image/jpeg', size: 1 },
    ]);
  });

  const titles = async (q: string) => (await repo.listItems({ query: q })).map((i) => i.title).sort();

  it('matches titles', async () => expect(await titles('grocery')).toEqual(['Grocery list']));
  it('matches notes', async () => expect(await titles('bananas')).toEqual(['Grocery list']));
  it('matches URLs', async () => expect(await titles('reactnative')).toEqual(['Article']));
  it('matches tags', async () => expect(await titles('japan')).toEqual(['Trip']));
  it('matches indexed OCR content', async () => expect(await titles('total')).toEqual(['Receipt']));
  it('matches attachment names', async () => expect(await titles('scan')).toEqual(['Receipt']));
  it('requires all terms', async () => {
    expect(await titles('oat milk')).toEqual(['Grocery list']);
    expect(await titles('oat passport')).toEqual([]);
  });
  it('treats special characters safely', async () => {
    expect(await titles('"grocery" AND (')).toEqual(['Grocery list']);
    expect(await titles('%_\\')).toEqual(await titles(''));
  });
  it('updates the index after edits and tag changes', async () => {
    const [trip] = await repo.listItems({ query: 'passport' });
    await repo.updateItem(trip.id, { note: 'Visa' });
    expect(await titles('passport')).toEqual([]);
    expect(await titles('visa')).toEqual(['Trip']);
    await repo.setItemTags(trip.id, ['holiday']);
    expect(await titles('japan')).toEqual([]);
    expect(await titles('holiday')).toEqual(['Trip']);
  });
});

describe('collections', () => {
  let repo: Repository;
  beforeEach(async () => {
    repo = (await setup()).repo;
  });

  it('creates, renames and lists collections with counts', async () => {
    const c = await repo.createCollection(' Reading ');
    await repo.createItem({ type: 'note', title: 'x', collectionId: c.id });
    const renamed = await repo.renameCollection(c.id, 'Books');
    expect(renamed.name).toBe('Books');
    const list = await repo.listCollections();
    expect(list).toHaveLength(1);
    expect(list[0].itemCount).toBe(1);
  });

  it('rejects duplicate and empty names (case-insensitive)', async () => {
    await repo.createCollection('Work');
    await expect(repo.createCollection('work')).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.createCollection('  ')).rejects.toBeInstanceOf(ValidationError);
    const other = await repo.createCollection('Home');
    await expect(repo.renameCollection(other.id, 'WORK')).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps items when a collection is deleted', async () => {
    const c = await repo.createCollection('Temp');
    const item = await repo.createItem({ type: 'note', title: 'survivor', collectionId: c.id });
    await repo.deleteCollection(c.id);
    expect((await repo.getItem(item.id))?.collectionId).toBeNull();
    expect(await repo.listCollections()).toEqual([]);
  });
});

describe('tags', () => {
  let repo: Repository;
  beforeEach(async () => {
    repo = (await setup()).repo;
  });

  it('assigns, replaces and removes tags, reusing existing ones', async () => {
    const a = await repo.createItem({ type: 'note', title: 'a', tagNames: ['Work'] });
    const b = await repo.createItem({ type: 'note', title: 'b', tagNames: ['work', 'urgent'] });
    let tags = await repo.listTags();
    expect(tags.map((t) => [t.name, t.itemCount])).toEqual([
      ['urgent', 1],
      ['Work', 2],
    ]);
    await repo.setItemTags(b.id, []);
    expect((await repo.getItemWithRelations(b.id))?.tags).toEqual([]);
    expect((await repo.getItemWithRelations(a.id))?.tags.map((t) => t.name)).toEqual(['Work']);
    tags = await repo.listTags();
    await repo.renameTag(tags.find((t) => t.name === 'Work')!.id, 'Job');
    expect(await repo.listItems({ query: 'job' })).toHaveLength(1);
    await repo.deleteTag(tags.find((t) => t.name === 'Work')!.id);
    expect((await repo.getItemWithRelations(a.id))?.tags).toEqual([]);
    expect(await repo.listItems({ query: 'job' })).toHaveLength(0);
  });
});

describe('reminders', () => {
  it('creates, edits, completes and cancels reminders', async () => {
    const { repo } = await setup();
    const item = await repo.createItem({ type: 'note', title: 'Call mom' });
    const r = await repo.createReminder(item.id, 5_000_000);
    expect(r.status).toBe('scheduled');
    await repo.updateReminder(r.id, { remindAt: 6_000_000, notificationId: 'n1' });
    expect((await repo.getReminder(r.id))?.remindAt).toBe(6_000_000);
    await repo.updateReminder(r.id, { status: 'completed' });
    const r2 = await repo.createReminder(item.id, 7_000_000);
    await repo.updateReminder(r2.id, { status: 'cancelled' });
    const all = await repo.listReminders();
    expect(all.map((x) => [x.status, x.itemTitle])).toEqual([
      ['completed', 'Call mom'],
      ['cancelled', 'Call mom'],
    ]);
    expect(await repo.listReminders('scheduled')).toEqual([]);
    await expect(repo.createReminder('missing', 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.createReminder(item.id, NaN)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('transactions', () => {
  it('rolls back a failed write without partial data', async () => {
    const { repo, db } = await setup();
    await expect(
      db.transaction(async () => {
        await db.run("INSERT INTO collections (id, name, color, created_at, updated_at) VALUES ('c1', 'X', '#000', 1, 1)");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repo.listCollections()).toEqual([]);
  });

  it('serializes concurrent transactions', async () => {
    const { repo } = await setup();
    await Promise.all(Array.from({ length: 20 }, (_, i) => repo.createItem({ type: 'note', title: `n${i}` })));
    expect(await repo.countItems()).toBe(20);
  });
});

describe('settings and erase', () => {
  it('stores settings and erases content', async () => {
    const { repo } = await setup();
    await repo.setSetting('theme', 'dark');
    await repo.setSetting('theme', 'light');
    expect(await repo.getSetting('theme')).toBe('light');
    await repo.createItem({ type: 'note', title: 'x', tagNames: ['t'] });
    await repo.createCollection('c');
    await repo.eraseAll();
    expect(await repo.countItems()).toBe(0);
    expect(await repo.listTags()).toEqual([]);
    expect(await repo.listCollections()).toEqual([]);
    expect(await repo.getSetting('theme')).toBe('light');
  });
});
