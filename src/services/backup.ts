import { Database, SqlParam } from '../db/adapter';
import { Repository } from '../db/repository';
import { ATTACHMENTS_DIR, FileStore, RESTORE_STAGING_DIR, attachmentPath } from './fileStore';

export const BACKUP_FORMAT = 'pocketvault-backup';
export const BACKUP_VERSION = 2;
const PENDING_RESTORE_KEY = 'pending_restore';

/** Settings that describe this device rather than the user's content are not backed up. */
const DEVICE_SETTINGS = new Set([PENDING_RESTORE_KEY, 'onboarding_done']);

type Row = Record<string, SqlParam>;

interface TableSpec {
  name: string;
  columns: string[];
}

/** Tables in foreign-key order (parents first). */
const TABLES: TableSpec[] = [
  { name: 'collections', columns: ['id', 'name', 'color', 'created_at', 'updated_at'] },
  { name: 'tags', columns: ['id', 'name', 'created_at'] },
  {
    name: 'items',
    columns: [
      'id',
      'type',
      'title',
      'note',
      'url',
      'canonical_url',
      'content_text',
      'collection_id',
      'is_favorite',
      'is_pinned',
      'color',
      'is_secret',
      'secret_payload',
      'ocr_status',
      'ocr_error',
      'preview_status',
      'preview_title',
      'preview_description',
      'preview_site',
      'reader_text',
      'source',
      'created_at',
      'updated_at',
    ],
  },
  {
    name: 'attachments',
    columns: ['id', 'item_id', 'file_name', 'original_name', 'mime_type', 'size', 'role', 'duration_ms', 'encrypted', 'created_at'],
  },
  { name: 'item_tags', columns: ['item_id', 'tag_id'] },
  { name: 'item_facts', columns: ['item_id', 'kind', 'value', 'num', 'created_at'] },
  {
    name: 'reminders',
    columns: ['id', 'item_id', 'remind_at', 'status', 'notification_id', 'created_at', 'updated_at'],
  },
  { name: 'settings', columns: ['key', 'value'] },
];

/** Values for columns that older backups (v1) do not contain. */
const COLUMN_DEFAULTS: Record<string, Record<string, SqlParam>> = {
  items: { is_pinned: 0, is_secret: 0, preview_status: 'none', reader_text: '', content_text: '', note: '', title: '' },
  attachments: { role: 'file', encrypted: 0 },
  item_facts: {},
};

/** Tables whose rows belong to an item (dropped together with excluded secret items). */
const ITEM_CHILD_TABLES = ['attachments', 'item_tags', 'item_facts', 'reminders'];

/**
 * Optional hooks for secret items. Without them, secret items are left out of the backup.
 * With them (password-protected backups), secrets are exported decrypted inside the
 * encrypted file and re-encrypted with the device key on restore.
 */
export interface SecretExport {
  /** Returns the item row with its plaintext fields restored. */
  decryptItem(row: Row): Promise<Row>;
  /** Returns the decrypted content of an encrypted attachment file as base64. */
  decryptFile(fileName: string): Promise<string>;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  tables: Record<string, Row[]>;
  /** Attachment file contents keyed by file name, base64 encoded. */
  files: Record<string, string>;
  missingFiles: string[];
  /** Secret items that were deliberately left out (plain backups). */
  excludedSecrets?: number;
}

export interface BackupSummary {
  items: number;
  collections: number;
  tags: number;
  reminders: number;
  attachments: number;
  missingFiles: number;
  secretItems?: number;
  excludedSecrets?: number;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export function summarize(backup: BackupFile): BackupSummary {
  return {
    items: backup.tables.items?.length ?? 0,
    collections: backup.tables.collections?.length ?? 0,
    tags: backup.tables.tags?.length ?? 0,
    reminders: backup.tables.reminders?.length ?? 0,
    attachments: backup.tables.attachments?.length ?? 0,
    missingFiles: backup.missingFiles.length,
    secretItems: (backup.tables.items ?? []).filter((r) => Number(r.is_secret) === 1).length,
    excludedSecrets: backup.excludedSecrets ?? 0,
  };
}

export async function createBackup(
  db: Database,
  files: FileStore,
  appVersion = '1.0.0',
  secrets?: SecretExport,
): Promise<BackupFile> {
  const tables: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const rows = await db.all<Row>(`SELECT ${t.columns.join(', ')} FROM ${t.name}`);
    tables[t.name] = t.name === 'settings' ? rows.filter((r) => !DEVICE_SETTINGS.has(String(r.key))) : rows;
  }
  const secretIds = new Set(tables.items.filter((r) => Number(r.is_secret) === 1).map((r) => String(r.id)));
  let excludedSecrets = 0;
  if (secretIds.size && !secrets) {
    excludedSecrets = secretIds.size;
    tables.items = tables.items.filter((r) => !secretIds.has(String(r.id)));
    for (const t of ITEM_CHILD_TABLES) tables[t] = tables[t].filter((r) => !secretIds.has(String(r.item_id)));
  } else if (secretIds.size && secrets) {
    tables.items = await Promise.all(tables.items.map((r) => (secretIds.has(String(r.id)) ? secrets.decryptItem(r) : r)));
  }
  const fileContents: Record<string, string> = {};
  const missingFiles: string[] = [];
  for (const att of tables.attachments) {
    const name = String(att.file_name);
    const path = attachmentPath(name);
    if (!files.supported || !(await files.exists(path))) {
      missingFiles.push(name);
    } else if (Number(att.encrypted) === 1 && secrets) {
      fileContents[name] = await secrets.decryptFile(name);
      att.encrypted = 0; // stored decrypted inside the (password-encrypted) backup
    } else {
      fileContents[name] = await files.readBase64(path);
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: `PocketVault ${appVersion}`,
    tables,
    files: fileContents,
    missingFiles,
    excludedSecrets,
  };
}

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]{1,160}$/;

/** Parses and validates backup JSON. Throws BackupError with a user-facing message. */
export function parseBackup(json: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new BackupError('This file is not a valid PocketVault backup (could not read JSON).');
  }
  const b = data as Partial<BackupFile>;
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not a PocketVault backup.');
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of PocketVault. Update the app to restore it.');
  }
  if (!b.tables || typeof b.tables !== 'object') throw new BackupError('The backup is missing its data.');
  for (const t of TABLES) {
    const rows = (b.tables as Record<string, unknown>)[t.name];
    if (rows === undefined) {
      (b.tables as Record<string, Row[]>)[t.name] = [];
      continue;
    }
    if (!Array.isArray(rows)) throw new BackupError(`The backup's ${t.name} data is damaged.`);
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new BackupError(`The backup's ${t.name} data is damaged.`);
      for (const value of Object.values(row as object)) {
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
          throw new BackupError(`The backup's ${t.name} data is damaged.`);
        }
      }
    }
  }
  for (const att of b.tables.attachments ?? []) {
    if (!SAFE_FILE_NAME.test(String(att.file_name))) throw new BackupError('The backup contains an unsafe file name.');
  }
  const files = b.files && typeof b.files === 'object' ? b.files : {};
  for (const [name, content] of Object.entries(files)) {
    if (!SAFE_FILE_NAME.test(name) || typeof content !== 'string') {
      throw new BackupError('The backup contains a damaged attachment.');
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    exportedAt: String(b.exportedAt ?? ''),
    app: String(b.app ?? ''),
    tables: b.tables as Record<string, Row[]>,
    files: files as Record<string, string>,
    missingFiles: Array.isArray(b.missingFiles) ? b.missingFiles.map(String) : [],
    excludedSecrets: typeof b.excludedSecrets === 'number' ? b.excludedSecrets : 0,
  };
}

/**
 * Replaces all local data with the backup.
 *
 * 1. Attachment files are written to a staging folder (existing data untouched).
 * 2. All rows are replaced in a single transaction that also records a
 *    "pending restore" marker. Any failure rolls back to the previous data.
 * 3. Staged files are moved into place and the marker is cleared. If the app is
 *    killed during this step, {@link recoverInterruptedRestore} finishes it on next launch.
 */
export async function restoreBackup(
  db: Database,
  repo: Repository,
  files: FileStore,
  backup: BackupFile,
): Promise<BackupSummary> {
  if (files.supported) {
    await files.deleteDir(RESTORE_STAGING_DIR);
    for (const [name, content] of Object.entries(backup.files)) {
      await files.writeBase64(`${RESTORE_STAGING_DIR}/${name}`, content);
    }
  }
  try {
    await db.transaction(async () => {
      for (const t of [...TABLES].reverse()) {
        if (t.name === 'settings') {
          await db.run(`DELETE FROM settings WHERE key NOT IN (${[...DEVICE_SETTINGS].map(() => '?').join(',')})`, [
            ...DEVICE_SETTINGS,
          ]);
        } else {
          await db.run(`DELETE FROM ${t.name}`);
        }
      }
      for (const t of TABLES) {
        const verb = t.name === 'settings' ? 'INSERT OR REPLACE' : 'INSERT';
        const sql = `${verb} INTO ${t.name} (${t.columns.join(', ')}) VALUES (${t.columns.map(() => '?').join(', ')})`;
        for (const row of backup.tables[t.name] ?? []) {
          if (t.name === 'settings' && DEVICE_SETTINGS.has(String(row.key))) continue;
          // Notifications from another install are not valid here; they are rescheduled after restore.
          const values = t.columns.map((c) =>
            t.name === 'reminders' && c === 'notification_id' ? null : row[c] ?? COLUMN_DEFAULTS[t.name]?.[c] ?? null,
          );
          await db.run(sql, values);
        }
      }
      await repo.rebuildSearchIndexInTransaction();
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [PENDING_RESTORE_KEY, '1']);
    });
  } catch (error) {
    if (files.supported) await files.deleteDir(RESTORE_STAGING_DIR);
    if (error instanceof BackupError) throw error;
    throw new BackupError(
      `The backup could not be restored, and your existing data was left unchanged. (${(error as Error).message})`,
    );
  }
  await finishRestore(db, files);
  return summarize(backup);
}

async function finishRestore(db: Database, files: FileStore) {
  if (files.supported) {
    const referenced = new Set(
      (await db.all<{ file_name: string }>('SELECT file_name FROM attachments')).map((r) => r.file_name),
    );
    // Remove attachments that no longer belong to any item.
    for (const name of await files.list(ATTACHMENTS_DIR)) {
      const staged = await files.exists(`${RESTORE_STAGING_DIR}/${name}`);
      if (!referenced.has(name) || staged) await files.delete(attachmentPath(name));
    }
    for (const name of await files.list(RESTORE_STAGING_DIR)) {
      await files.move(`${RESTORE_STAGING_DIR}/${name}`, attachmentPath(name));
    }
    await files.deleteDir(RESTORE_STAGING_DIR);
  }
  await db.run('DELETE FROM settings WHERE key = ?', [PENDING_RESTORE_KEY]);
}

/** Completes a restore that was interrupted after its database commit. */
export async function recoverInterruptedRestore(db: Database, files: FileStore): Promise<boolean> {
  const row = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [PENDING_RESTORE_KEY]);
  if (row?.value === '1') {
    await finishRestore(db, files);
    return true;
  }
  if (files.supported) await files.deleteDir(RESTORE_STAGING_DIR);
  return false;
}
