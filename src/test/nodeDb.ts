import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Database, DbDriver, SqlParam } from '../db/adapter';
import { FileStore } from '../services/fileStore';

interface StatementSync {
  run(...params: SqlParam[]): { lastInsertRowid: number | bigint; changes: number | bigint };
  all(...params: SqlParam[]): unknown[];
  get(...params: SqlParam[]): unknown;
}
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

// `node:sqlite` is a prefix-only builtin that Jest's resolver does not know about,
// so it is loaded through process.getBuiltinModule instead of require().
const { DatabaseSync: NodeDatabaseSync } = (
  process as unknown as { getBuiltinModule(id: string): { DatabaseSync: new (file: string) => DatabaseSync } }
).getBuiltinModule('node:sqlite');

/** Driver backed by Node's built-in SQLite (has FTS5), used to test real SQL. */
export class NodeSqliteDriver implements DbDriver {
  readonly raw: DatabaseSync;

  constructor(file = ':memory:', options: { disableFts?: boolean } = {}) {
    this.raw = new NodeDatabaseSync(file);
    this.disableFts = !!options.disableFts;
  }

  private disableFts: boolean;

  private guard(sql: string) {
    if (this.disableFts && /fts5/i.test(sql)) throw new Error('no such module: fts5');
  }

  async execAsync(sql: string) {
    this.guard(sql);
    this.raw.exec(sql);
  }
  async runAsync(sql: string, params: SqlParam[] = []) {
    this.guard(sql);
    const r = this.raw.prepare(sql).run(...params);
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  async getAllAsync<T>(sql: string, params: SqlParam[] = []) {
    return this.raw.prepare(sql).all(...params).map((r) => ({ ...(r as object) })) as T[];
  }
  async getFirstAsync<T>(sql: string, params: SqlParam[] = []) {
    const row = this.raw.prepare(sql).get(...params);
    return (row ? { ...(row as object) } : null) as T | null;
  }
}

export function createTestDatabase(options: { disableFts?: boolean; file?: string } = {}) {
  const driver = new NodeSqliteDriver(options.file, options);
  return { driver, db: new Database(driver) };
}

/** FileStore over a temporary directory. */
export class TempFileStore implements FileStore {
  readonly supported = true;
  readonly root: string;

  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-test-'));
  }

  private abs(p: string) {
    return path.join(this.root, ...p.split('/'));
  }
  uri(p: string) {
    return `file://${this.abs(p)}`;
  }
  async exists(p: string) {
    return fs.existsSync(this.abs(p));
  }
  async size(p: string) {
    return fs.statSync(this.abs(p)).size;
  }
  private ensureParent(p: string) {
    fs.mkdirSync(path.dirname(this.abs(p)), { recursive: true });
  }
  async writeBase64(p: string, b64: string) {
    this.ensureParent(p);
    fs.writeFileSync(this.abs(p), Buffer.from(b64, 'base64'));
  }
  async writeText(p: string, text: string) {
    this.ensureParent(p);
    fs.writeFileSync(this.abs(p), text, 'utf8');
  }
  async readBase64(p: string) {
    return fs.readFileSync(this.abs(p)).toString('base64');
  }
  async readText(p: string) {
    return fs.readFileSync(this.abs(p), 'utf8');
  }
  async copyIn(sourceUri: string, p: string) {
    this.ensureParent(p);
    fs.copyFileSync(sourceUri.replace(/^file:\/\//, ''), this.abs(p));
    return fs.statSync(this.abs(p)).size;
  }
  async move(from: string, to: string) {
    this.ensureParent(to);
    fs.renameSync(this.abs(from), this.abs(to));
  }
  async delete(p: string) {
    fs.rmSync(this.abs(p), { force: true });
  }
  async list(dir: string) {
    const d = this.abs(dir);
    return fs.existsSync(d) ? fs.readdirSync(d) : [];
  }
  async deleteDir(dir: string) {
    fs.rmSync(this.abs(dir), { recursive: true, force: true });
  }
  cleanup() {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
