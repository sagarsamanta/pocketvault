import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { DbDriver, SqlParam } from '../db/adapter';
import { initDatabase } from '../db/openDatabase';
import { AppServices } from '../services/appServices';
import { nativeFileStore } from '../services/nativeFileStore';
import { notifier, ocrEngine } from '../services/platform';
import { createPlatformExtras } from '../services/platformExtras';
import { DATABASE_NAME } from './dbName';

export { DATABASE_NAME };

function expoDriver(db: SQLite.SQLiteDatabase): DbDriver {
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params: SqlParam[] = []) => db.runAsync(sql, params),
    getAllAsync: <T,>(sql: string, params: SqlParam[] = []) => db.getAllAsync<T>(sql, params),
    getFirstAsync: <T,>(sql: string, params: SqlParam[] = []) => db.getFirstAsync<T>(sql, params),
  };
}

/** On web the database file is locked by whichever page opened it (OPFS access handle). */
const isLockError = (error: unknown) =>
  /NoModificationAllowed|Access Handles? cannot be created|another open Access Handle/i.test(String(error));

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  // After a reload the previous page's worker may still hold the lock for a moment.
  const attempts = Platform.OS === 'web' ? 15 : 1;
  for (let i = 1; ; i++) {
    try {
      return await SQLite.openDatabaseAsync(DATABASE_NAME);
    } catch (error) {
      if (!isLockError(error) || i >= attempts) {
        if (isLockError(error)) {
          throw new Error('PocketVault is already open in another browser tab. Close it and try again.');
        }
        throw error;
      }
      await delay(200 * Math.min(i, 5));
    }
  }
}

export async function createServices(): Promise<AppServices> {
  const sqlite = await openDatabase();
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // Release the file lock as soon as the page goes away so a reload can reopen it.
    window.addEventListener('pagehide', () => {
      sqlite.closeAsync().catch(() => undefined);
    });
    // A page restored from the back/forward cache has a closed database; start fresh.
    window.addEventListener('pageshow', (event) => {
      if ((event as PageTransitionEvent).persisted) window.location.reload();
    });
  }
  const { db, repo } = await initDatabase(expoDriver(sqlite));
  const services = new AppServices(db, repo, nativeFileStore, notifier, ocrEngine, createPlatformExtras(nativeFileStore));
  await services.startup();
  return services;
}
