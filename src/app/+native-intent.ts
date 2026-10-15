import { getShareExtensionKey } from 'expo-share-intent';

/** Routes deep links created by the share extension to the share screen. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/shareintent';
    return path;
  } catch {
    return '/';
  }
}
