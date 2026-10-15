import { usePathname, useRouter } from 'expo-router';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { ReactNode, useEffect } from 'react';
import type { IncomingFile } from '../services/types';

export interface IncomingShare {
  text: string | null;
  webUrl: string | null;
  subject: string | null;
  files: IncomingFile[];
}

function toFileUri(path: string): string {
  return /^[a-z]+:\/\//i.test(path) ? path : `file://${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Wraps the app so content shared from other apps opens the share screen. */
export function ShareIntentGate({ children }: { children: ReactNode }) {
  return (
    <ShareIntentProvider options={{ resetOnBackground: false }}>
      <ShareRedirect />
      {children}
    </ShareIntentProvider>
  );
}

function ShareRedirect() {
  const { hasShareIntent } = useShareIntentContext();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (hasShareIntent && pathname !== '/shareintent') router.push('/shareintent');
  }, [hasShareIntent, router, pathname]);
  return null;
}

/** Returns the pending shared content, normalized, plus a function to clear it. */
export function useIncomingShare(): { share: IncomingShare | null; ready: boolean; clear: () => void } {
  const { hasShareIntent, shareIntent, resetShareIntent, isReady } = useShareIntentContext();
  if (!hasShareIntent) return { share: null, ready: isReady, clear: () => resetShareIntent() };
  return {
    ready: isReady,
    clear: () => resetShareIntent(),
    share: {
      text: shareIntent.text ?? null,
      webUrl: shareIntent.webUrl ?? null,
      subject: shareIntent.meta?.title ?? null,
      files: (shareIntent.files ?? []).map((f) => ({
        uri: toFileUri(f.path),
        name: f.fileName || 'shared-file',
        mimeType: f.mimeType || 'application/octet-stream',
        size: f.size,
      })),
    },
  };
}
