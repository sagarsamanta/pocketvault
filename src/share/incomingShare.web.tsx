import { ReactNode } from 'react';
import type { IncomingFile } from '../services/types';

export interface IncomingShare {
  text: string | null;
  webUrl: string | null;
  subject: string | null;
  files: IncomingFile[];
}

/** Browsers cannot receive Android share intents. */
export function ShareIntentGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useIncomingShare(): { share: IncomingShare | null; ready: boolean; clear: () => void } {
  return { share: null, ready: true, clear: () => undefined };
}
