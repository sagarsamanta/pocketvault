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

/** A file to import, from a picker or a share intent. */
export interface IncomingFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
}
