import { initDatabase } from '../openDatabase';
import { NodeSqliteDriver } from '../../test/nodeDb';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];

describe('large dataset', () => {
  it('lists, filters and searches 5,000 items quickly', async () => {
    const { repo, db } = await initDatabase(new NodeSqliteDriver(':memory:'));
    const col = await repo.createCollection('Big');
    await db.transaction(async () => {
      for (let i = 0; i < 5000; i++) {
        const w = WORDS[i % WORDS.length];
        await db.run(
          `INSERT INTO items (id, type, title, note, url, content_text, collection_id, is_favorite, created_at, updated_at)
           VALUES (?, 'note', ?, ?, NULL, ?, ?, ?, ?, ?)`,
          [`id-${i}`, `Item ${i} ${w}`, `Note about ${w} number ${i}`, i % 7 === 0 ? `scanned receipt ${i}` : '', i % 3 === 0 ? col.id : null, i % 5 === 0 ? 1 : 0, i, i],
        );
      }
      await repo.rebuildSearchIndexInTransaction();
    });

    const time = async <T,>(fn: () => Promise<T>) => {
      const start = performance.now();
      const result = await fn();
      return { result, ms: performance.now() - start };
    };

    const page = await time(() => repo.listItems({ limit: 100 }));
    expect(page.result).toHaveLength(100);
    expect(page.result[0].title).toContain('4999');

    const search = await time(() => repo.listItems({ query: 'golf receipt', limit: 1000 }));
    expect(search.result.length).toBeGreaterThan(0);
    expect(search.result.every((i) => i.title.includes('golf') && i.contentText.includes('receipt'))).toBe(true);

    const filtered = await time(() => repo.listItems({ collectionId: col.id, favoritesOnly: true, limit: 1000 }));
    expect(filtered.result.length).toBe(Math.ceil(5000 / 15));

    // Generous budgets so the test is stable on slow CI machines.
    expect(page.ms).toBeLessThan(500);
    expect(search.ms).toBeLessThan(500);
    expect(filtered.ms).toBeLessThan(500);
  });
});
