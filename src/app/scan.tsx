import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useServices } from '../app-state/AppContext';
import { pagesToPdf, scanPages } from '../capture/scan';
import { errorMessage } from '../components/DialogProvider';
import { Button } from '../components/ui';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { font, spacing } from '../theme/theme';

/** Deep-link target (e.g. from the home-screen widget) that opens the scanner straight away. */
export default function ScanScreen() {
  const services = useServices();
  const router = useRouter();
  const { colors } = useTheme();
  const [status, setStatus] = useState('Opening scanner…');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const pages = await scanPages();
        if (!pages) {
          router.replace('/');
          return;
        }
        setStatus(`Saving ${pages.length} page${pages.length === 1 ? '' : 's'}…`);
        const pdf = await pagesToPdf(pages).catch(() => null);
        const item = await services.createScan({ pageUris: pages, pdfUri: pdf });
        haptic.success();
        router.replace({ pathname: '/item/[id]', params: { id: item.id } });
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [router, services]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Scan document' }} />
      {error ? (
        <>
          <Text style={[font.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          <Button label="Back to library" onPress={() => router.replace('/')} />
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[font.body, { color: colors.textMuted }]}>{status}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl } });
