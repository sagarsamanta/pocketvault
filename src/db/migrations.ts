import { Database } from './adapter';

/**
 * Ordered schema migrations. Each entry upgrades the schema by exactly one version.
 * Never edit a released migration — append a new one instead, so existing user data
 * is upgraded in place.
 */
export const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE collections (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366F1',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE items (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('note','link','image','document')),
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    url TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    ocr_status TEXT NOT NULL DEFAULT 'none',
    ocr_error TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_items_updated ON items(updated_at DESC);
  CREATE INDEX idx_items_collection ON items(collection_id);
  CREATE INDEX idx_items_favorite ON items(is_favorite);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_attachments_item ON attachments(item_id);

  CREATE TABLE tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
  );
  CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);

  CREATE TABLE reminders (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    remind_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
    notification_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_reminders_item ON reminders(item_id);
  CREATE INDEX idx_reminders_status_time ON reminders(status, remind_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
];

/**
 * The full-text index is derived data and lives outside the versioned schema: it is
 * created when the SQLite build supports FTS5 (Android/iOS) and rebuilt from the items
 * table when missing. Builds without FTS5 (e.g. the web wasm build) fall back to LIKE.
 */
const FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    item_id UNINDEXED,
    title,
    note,
    url,
    content_text,
    tags,
    tokenize = 'unicode61 remove_diacritics 2'
  )`;

/** Returns 'created' when the index had to be (re)built, 'exists', or 'unsupported'. */
export async function ensureSearchIndex(db: Database): Promise<'created' | 'exists' | 'unsupported'> {
  const existing = await db.first<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items_fts'",
  );
  if (existing) return 'exists';
  try {
    await db.exec(FTS_DDL);
    return 'created';
  } catch {
    return 'unsupported';
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function getSchemaVersion(db: Database): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Applies pending migrations. Each migration and its version bump run in a single
 * transaction, so a crash mid-migration leaves the previous version intact.
 */
export async function migrate(db: Database): Promise<number> {
  await db.exec('PRAGMA foreign_keys = ON');
  let version = await getSchemaVersion(db);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${version} is newer than this app supports (v${SCHEMA_VERSION}). Please update the app.`,
    );
  }
  while (version < SCHEMA_VERSION) {
    const sql = MIGRATIONS[version];
    const target = version + 1;
    await db.transaction(async () => {
      await db.exec(sql);
      await db.exec(`PRAGMA user_version = ${target}`);
    });
    version = target;
  }
  return version;
}
