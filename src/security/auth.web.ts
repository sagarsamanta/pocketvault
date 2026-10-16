export const authSupported = false;

export async function canAuthenticate(): Promise<boolean> {
  return false;
}

export async function authenticate(_reason: string): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'App lock is only available in the Android app.' };
}
