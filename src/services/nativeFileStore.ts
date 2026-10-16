import { Directory, File, Paths } from 'expo-file-system';
import { FileStore } from './fileStore';

const ROOT_NAME = 'pocketvault';

function rootDir(): Directory {
  const dir = new Directory(Paths.document, ROOT_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileAt(path: string): File {
  return new File(rootDir(), ...path.split('/'));
}

function dirAt(path: string): Directory {
  return new Directory(rootDir(), ...path.split('/'));
}

function ensureParent(path: string) {
  const parts = path.split('/');
  parts.pop();
  if (parts.length === 0) return;
  const dir = new Directory(rootDir(), ...parts);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

/** App-private storage under the document directory (survives cache clears). */
export const nativeFileStore: FileStore = {
  supported: true,
  uri: (path) => fileAt(path).uri,
  exists: async (path) => fileAt(path).exists,
  size: async (path) => fileAt(path).size ?? 0,
  async writeBase64(path, base64) {
    ensureParent(path);
    const f = fileAt(path);
    if (!f.exists) f.create({ overwrite: true });
    f.write(base64, { encoding: 'base64' });
  },
  async writeText(path, text) {
    ensureParent(path);
    const f = fileAt(path);
    if (!f.exists) f.create({ overwrite: true });
    f.write(text, { encoding: 'utf8' });
  },
  readBase64: (path) => fileAt(path).base64(),
  readText: (path) => fileAt(path).text(),
  async copyIn(sourceUri, path) {
    ensureParent(path);
    const dest = fileAt(path);
    await new File(sourceUri).copy(dest, { overwrite: true });
    return fileAt(path).size ?? 0;
  },
  async move(from, to) {
    ensureParent(to);
    await fileAt(from).move(fileAt(to), { overwrite: true });
  },
  async delete(path) {
    const f = fileAt(path);
    if (f.exists) f.delete();
  },
  async list(dir) {
    const d = dirAt(dir);
    if (!d.exists) return [];
    return d
      .list()
      .filter((entry) => entry instanceof File)
      .map((entry) => entry.name);
  },
  async deleteDir(dir) {
    const d = dirAt(dir);
    if (d.exists) d.delete();
  },
};

/** Reads a file outside the store (e.g. a picked document) as UTF-8 text. */
export async function readExternalText(uri: string): Promise<string> {
  return new File(uri).text();
}

/**
 * Lets the user pick a folder (Downloads, an SD card, a cloud provider…) and writes the
 * file there. Resolves false if the user cancelled the folder picker.
 */
export async function saveToPickedFolder(name: string, mimeType: string, text: string): Promise<boolean> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  if (!dir) return false;
  const file = dir.createFile(name, mimeType);
  file.write(text, { encoding: 'utf8' });
  return true;
}

/** Writes text to the cache directory and returns its URI (used for exports). */
export function writeCacheFile(name: string, text: string): string {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(text, { encoding: 'utf8' });
  return f.uri;
}

/** Lets the user choose the folder for automatic backups. Returns null if cancelled. */
export async function pickBackupFolder(): Promise<{ uri: string; label: string } | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    if (!dir) return null;
    const decoded = decodeURIComponent(dir.uri);
    const label = decoded.split(/[:/]/).filter(Boolean).pop() ?? 'Selected folder';
    return { uri: dir.uri, label };
  } catch {
    return null;
  }
}
