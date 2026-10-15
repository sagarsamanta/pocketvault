import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Linking, Share } from 'react-native';
import type { Attachment, Item } from '../db/types';
import { normalizeUrl } from '../lib/text';
import { attachmentPath, FileStore } from './fileStore';

/** Text that best represents an item when copying or sharing it as text. */
export function itemText(item: Item): string {
  const parts = [item.title, item.url, item.note].filter((p): p is string => !!p && p.trim().length > 0);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  if (unique.length === 0 && item.contentText) return item.contentText;
  return unique.join('\n');
}

export async function copyItem(item: Item): Promise<void> {
  await Clipboard.setStringAsync(item.url || itemText(item));
}

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

export async function openUrl(url: string): Promise<void> {
  const target = normalizeUrl(url);
  try {
    await Linking.openURL(target);
  } catch {
    throw new Error('No app on this device can open this link.');
  }
}

/** Opens an attachment in another app using a content:// URI with read permission. */
export async function openAttachment(files: FileStore, attachment: Attachment): Promise<void> {
  const path = attachmentPath(attachment.fileName);
  if (!(await files.exists(path))) throw new Error('This file is missing from the device.');
  const file = new File(files.uri(path));
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: file.contentUri,
      type: attachment.mimeType,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch {
    throw new Error('No app on this device can open this type of file.');
  }
}

export async function shareItem(files: FileStore, item: Item, attachment?: Attachment): Promise<void> {
  if (attachment) {
    const path = attachmentPath(attachment.fileName);
    if (!(await files.exists(path))) throw new Error('This file is missing from the device.');
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    await Sharing.shareAsync(files.uri(path), { mimeType: attachment.mimeType, dialogTitle: item.title || 'Share' });
    return;
  }
  await Share.share({ message: itemText(item), title: item.title || undefined });
}

/** Shares a file (e.g. a backup) with the system share sheet. */
export async function shareFile(uri: string, mimeType: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType, dialogTitle });
  return true;
}

export function openAppSettings() {
  return Linking.openSettings();
}
