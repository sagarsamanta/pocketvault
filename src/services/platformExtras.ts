import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { base64ToBytes, bytesToBase64, setRandomSource } from '../lib/crypto';
import type { ServiceExtras } from './appServices';
import type { FileStore } from './fileStore';
import type { BackupWriter, NetworkMonitor, PageFetcher, SecretKeyStore } from './types';

// Hermes has no Web Crypto; use the platform's secure random generator.
setRandomSource((length) => Crypto.getRandomBytes(length));

const VAULT_KEY = 'pocketvault.vault_key.v1';

const keyStore: SecretKeyStore = {
  supported: true,
  async getKey() {
    const stored = await SecureStore.getItemAsync(VAULT_KEY);
    return stored ? base64ToBytes(stored) : null;
  },
  async createKey() {
    if (await SecureStore.getItemAsync(VAULT_KEY)) throw new Error('A vault key already exists.');
    const key = Crypto.getRandomBytes(32);
    await SecureStore.setItemAsync(VAULT_KEY, bytesToBase64(key));
    return key;
  },
};

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const MAX_HTML_CHARS = 2_000_000;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function makeFetcher(files: FileStore): PageFetcher {
  return {
    supported: true,
    async fetchHtml(url) {
      const res = await fetchWithTimeout(url, 12_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (type && !/html|xml/i.test(type)) throw new Error('Not a web page');
      const html = (await res.text()).slice(0, MAX_HTML_CHARS);
      return { html, finalUrl: res.url || url };
    },
    async downloadImage(url, destPath) {
      const res = await fetchWithTimeout(url, 15_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
      const bytes = new Uint8Array(await res.arrayBuffer());
      await files.writeBase64(destPath, bytesToBase64(bytes));
      return { size: bytes.length, mimeType };
    },
  };
}

const network: NetworkMonitor = {
  async isOnline() {
    try {
      const state = await Network.getNetworkStateAsync();
      return !!state.isConnected && state.isInternetReachable !== false;
    } catch {
      return false;
    }
  },
};

const backupWriter: BackupWriter = {
  async write(folderUri, fileName, contents) {
    const dir = new Directory(folderUri);
    const file: File = dir.createFile(fileName, 'application/json');
    file.write(contents, { encoding: 'utf8' });
  },
};

export function createPlatformExtras(files: FileStore): ServiceExtras {
  return { keyStore, fetcher: makeFetcher(files), network, backupWriter };
}
