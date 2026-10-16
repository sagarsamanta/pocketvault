import * as LocalAuthentication from 'expo-local-authentication';

export const authSupported = true;

/** Whether the device has a screen lock (biometric, PIN, pattern or password). */
export async function canAuthenticate(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level >= LocalAuthentication.SecurityLevel.SECRET;
  } catch {
    return false;
  }
}

/** Fingerprint / face, falling back to the device PIN, pattern or password. */
export async function authenticate(reason: string): Promise<{ ok: boolean; error?: string }> {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
  if (result.success) return { ok: true };
  if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') {
    return { ok: false, error: 'Set up a screen lock (fingerprint, PIN or pattern) in Android settings first.' };
  }
  return { ok: false, error: result.error === 'user_cancel' || result.error === 'system_cancel' ? undefined : 'Could not verify it’s you.' };
}
