/**
 * App-private file storage, addressed by relative paths such as "attachments/abc.jpg".
 * Native code implements it with expo-file-system; tests implement it with Node's fs.
 */
export interface FileStore {
  readonly supported: boolean;
  uri(path: string): string;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  writeBase64(path: string, base64: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  readBase64(path: string): Promise<string>;
  readText(path: string): Promise<string>;
  /** Copies an external file (e.g. a picker or share-intent URI) into the store. */
  copyIn(sourceUri: string, path: string): Promise<number>;
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  deleteDir(dir: string): Promise<void>;
}

export const ATTACHMENTS_DIR = 'attachments';
export const RESTORE_STAGING_DIR = 'restore-staging';

export const attachmentPath = (fileName: string) => `${ATTACHMENTS_DIR}/${fileName}`;
