import type { ServiceExtras } from './appServices';
import type { FileStore } from './fileStore';

/**
 * The browser build keeps the core features only: no device key store (secret vault),
 * and no link-preview fetching (browsers block cross-origin page reads).
 */
export function createPlatformExtras(_files: FileStore): ServiceExtras {
  return {
    network: { isOnline: async () => typeof navigator === 'undefined' || navigator.onLine !== false },
  };
}
