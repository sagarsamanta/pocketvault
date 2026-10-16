export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface Notifier {
  readonly supported: boolean;
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  /** Schedules a local notification and returns its id, or null if it could not be scheduled. */
  schedule(input: { reminderId: string; itemId: string; title: string; body: string; at: number }): Promise<string | null>;
  cancel(notificationId: string): Promise<void>;
  cancelAll(): Promise<void>;
}

export interface OcrEngine {
  readonly supported: boolean;
  recognize(imageUri: string): Promise<string>;
}

/** Holds the 256-bit key that encrypts secret items (Android Keystore-backed on device). */
export interface SecretKeyStore {
  readonly supported: boolean;
  getKey(): Promise<Uint8Array | null>;
  /** Creates and stores a new key. Must not overwrite an existing key. */
  createKey(): Promise<Uint8Array>;
}

/** Fetches web pages for link previews. */
export interface PageFetcher {
  readonly supported: boolean;
  fetchHtml(url: string): Promise<{ html: string; finalUrl: string }>;
  /** Downloads an image into the file store path; returns its size and MIME type. */
  downloadImage(url: string, destPath: string): Promise<{ size: number; mimeType: string }>;
}

export interface NetworkMonitor {
  isOnline(): Promise<boolean>;
}

/** Writes automatic backups to the folder the user picked. */
export interface BackupWriter {
  write(folderUri: string, fileName: string, contents: string): Promise<void>;
}

/** A file to import, from a picker or a share intent. */
export interface IncomingFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
}
