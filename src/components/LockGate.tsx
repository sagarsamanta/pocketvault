import { ReactNode, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useServices } from '../app-state/AppContext';
import { authSupported } from '../security/auth';
import { SETTINGS } from '../services/appServices';
import { LockScreen } from './LockScreen';

/**
 * Covers the app with an unlock screen at launch and after it has been in the background
 * longer than the chosen timeout (when "App lock" is enabled in Settings).
 */
export function LockGate({ children }: { children: ReactNode }) {
  const services = useServices();
  const [locked, setLocked] = useState<boolean | null>(authSupported ? null : false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!authSupported) return;
    services.repo.getSetting(SETTINGS.appLock).then((v) => setLocked(v === '1'));
  }, [services]);

  useEffect(() => {
    if (!authSupported) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
        await services.vault.clearCache().catch(() => undefined);
      } else if (state === 'active' && backgroundedAt.current) {
        const enabled = (await services.repo.getSetting(SETTINGS.appLock)) === '1';
        const timeout = Number((await services.repo.getSetting(SETTINGS.lockTimeout)) ?? 30) * 1000;
        if (enabled && Date.now() - backgroundedAt.current >= timeout) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [services]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {locked ? (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen title="PocketVault is locked" subtitle="Use your fingerprint, face or screen lock to continue." reason="Unlock PocketVault" onUnlocked={() => setLocked(false)} />
        </View>
      ) : null}
    </View>
  );
}
