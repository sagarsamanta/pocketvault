import { FileStore } from './fileStore';

const unsupported = async (): Promise<never> => {
  throw new Error('Files are only available in the Android app.');
};

/** The web build has no persistent file system, so attachments are not supported there. */
export const nativeFileStore: FileStore = {
  supported: false,
  uri: () => '',
  exists: async () => false,
  size: async () => 0,
  writeBase64: unsupported,
  writeText: unsupported,
  readBase64: unsupported,
  readText: unsupported,
  copyIn: unsupported,
  move: unsupported,
  delete: async () => undefined,
  list: async () => [],
  deleteDir: async () => undefined,
};

export async function readExternalText(uri: string): Promise<string> {
  const response = await fetch(uri);
  return response.text();
}

export async function saveToPickedFolder(name: string, _mimeType: string, text: string): Promise<boolean> {
  writeCacheFile(name, text);
  return true;
}

/** Triggers a browser download and returns an empty URI (nothing to share). */
export function writeCacheFile(name: string, text: string): string {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return '';
}
