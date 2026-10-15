import { Database, DbDriver } from './adapter';
import { ensureSearchIndex, migrate } from './migrations';
import { Repository } from './repository';

export interface OpenedDatabase {
  db: Database;
  repo: Repository;
  schemaVersion: number;
  ftsEnabled: boolean;
}

/** Migrates the database, prepares the search index and returns a repository. */
export async function initDatabase(driver: DbDriver, now: () => number = Date.now): Promise<OpenedDatabase> {
  const db = new Database(driver);
  await db.exec('PRAGMA journal_mode = WAL').catch(() => undefined);
  const schemaVersion = await migrate(db);
  const index = await ensureSearchIndex(db);
  const repo = new Repository(db, now, index !== 'unsupported');
  if (index === 'created') {
    await db.transaction(() => repo.rebuildSearchIndexInTransaction());
  }
  return { db, repo, schemaVersion, ftsEnabled: repo.ftsEnabled };
}
