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
 * Migrations that rebuild tables referenced by foreign keys must run with foreign key
 * enforcement switched off (SQLite cannot change that inside a transaction), otherwise
 * dropping the old table would cascade-delete child rows. Their index is listed here.
 */
const MIGRATIONS_WITHOUT_FK = new Set<number>([1]);

// v2 — PocketVault 2.0: pinned/colour/secret items, link previews, voice notes, smart facts.
MIGRATIONS.push(`
  CREATE TABLE items_v2 (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('note','link','image','document','audio')),
    title TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    url TEXT,
    canonical_url TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    is_secret INTEGER NOT NULL DEFAULT 0,
    secret_payload TEXT,
    ocr_status TEXT NOT NULL DEFAULT 'none',
    ocr_error TEXT,
    preview_status TEXT NOT NULL DEFAULT 'none',
    preview_title TEXT,
    preview_description TEXT,
    preview_site TEXT,
    reader_text TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  INSERT INTO items_v2 (id, type, title, note, url, content_text, collection_id, is_favorite, ocr_status, ocr_error, source, created_at, updated_at,
                        preview_status)
    SELECT id, type, title, note, url, content_text, collection_id, is_favorite, ocr_status, ocr_error, source, created_at, updated_at,
           CASE WHEN type = 'link' AND url IS NOT NULL THEN 'pending' ELSE 'none' END
    FROM items;
  DROP TABLE items;
  ALTER TABLE items_v2 RENAME TO items;
  CREATE INDEX idx_items_updated ON items(updated_at DESC);
  CREATE INDEX idx_items_collection ON items(collection_id);
  CREATE INDEX idx_items_favorite ON items(is_favorite);
  CREATE INDEX idx_items_pinned ON items(is_pinned);
  CREATE INDEX idx_items_secret ON items(is_secret);
  CREATE INDEX idx_items_canonical ON items(canonical_url);
  CREATE INDEX idx_items_created ON items(created_at);

  ALTER TABLE attachments ADD COLUMN role TEXT NOT NULL DEFAULT 'file';
  ALTER TABLE attachments ADD COLUMN duration_ms INTEGER;
  ALTER TABLE attachments ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE item_facts (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    num REAL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_item_facts_item ON item_facts(item_id);
  CREATE INDEX idx_item_facts_kind ON item_facts(kind, num);
`);

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
    const withoutFk = MIGRATIONS_WITHOUT_FK.has(version);
    if (withoutFk) await db.exec('PRAGMA foreign_keys = OFF');
    try {
      await db.transaction(async () => {
        await db.exec(sql);
        if (withoutFk) {
          // Refuse to commit a rebuild that left dangling references.
          const broken = await db.all<{ table: string }>('PRAGMA foreign_key_check');
          if (broken.length) throw new Error(`Migration to v${target} broke ${broken.length} foreign key(s)`);
        }
        await db.exec(`PRAGMA user_version = ${target}`);
      });
    } finally {
      if (withoutFk) await db.exec('PRAGMA foreign_keys = ON');
    }
    version = target;
  }
  return version;
}
