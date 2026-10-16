import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';
import type { Attachment, Item } from '../db/types';
import { normalizeUrl } from '../lib/text';
import type { FileStore } from './fileStore';

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
  await Linking.openURL(normalizeUrl(url));
}

export async function openAttachment(_files: FileStore, _attachment: Attachment, _uri?: string): Promise<void> {
  throw new Error('Opening files is only available in the Android app.');
}

export async function shareItem(_files: FileStore, item: Item, attachment?: Attachment, _uri?: string): Promise<void> {
  if (attachment) throw new Error('Sharing files is only available in the Android app.');
  const nav = globalThis.navigator as Navigator & { share?: (d: { title?: string; text: string }) => Promise<void> };
  if (nav?.share) {
    await nav.share({ title: item.title || undefined, text: itemText(item) });
  } else {
    await Clipboard.setStringAsync(itemText(item));
    throw new Error('Sharing is not supported in this browser — copied to clipboard instead.');
  }
}

export async function shareFile(): Promise<boolean> {
  return false;
}

export function openAppSettings() {
  return Promise.resolve();
}
