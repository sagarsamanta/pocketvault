/**
 * Minimal database surface used by the app. It matches the subset of expo-sqlite's
 * SQLiteDatabase that we rely on, which lets tests run the same repository code
 * against Node's built-in SQLite.
 */
export type SqlParam = string | number | null;

export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface DbDriver {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParam[]): Promise<RunResult>;
  getAllAsync<T>(sql: string, params?: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlParam[]): Promise<T | null>;
}

/**
 * Wraps a driver and serializes transactions so that concurrent async callers
 * never interleave BEGIN/COMMIT on the single shared connection.
 */
export class Database {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(public readonly driver: DbDriver) {}

  exec(sql: string) {
    return this.driver.execAsync(sql);
  }

  run(sql: string, params: SqlParam[] = []) {
    return this.driver.runAsync(sql, params);
  }

  all<T>(sql: string, params: SqlParam[] = []) {
    return this.driver.getAllAsync<T>(sql, params);
  }

  first<T>(sql: string, params: SqlParam[] = []) {
    return this.driver.getFirstAsync<T>(sql, params);
  }

  /** Runs `fn` inside BEGIN IMMEDIATE / COMMIT, rolling back on any error. */
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.driver.execAsync('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        await this.driver.execAsync('COMMIT');
        return result;
      } catch (error) {
        try {
          await this.driver.execAsync('ROLLBACK');
        } catch {
          // The transaction may already have been rolled back by SQLite.
        }
        throw error;
      }
    });
    // Keep the queue alive even if this transaction fails.
    this.queue = next.catch(() => undefined);
    return next;
  }
}
