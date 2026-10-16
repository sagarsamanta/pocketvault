import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../app-state/AppContext';
import { createServices } from '../app-state/createServices';
import { DialogProvider } from '../components/DialogProvider';
import { Button, EmptyState, LoadingView } from '../components/ui';
import type { AppServices } from '../services/appServices';
import { configureNotificationHandler } from '../services/platform';
import { LockGate } from '../components/LockGate';
import { NotificationRouter } from '../share/NotificationRouter';
import { WidgetSync } from '../widgets/WidgetSync';
import { ShareIntentGate } from '../share/incomingShare';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import type { ThemePreference } from '../theme/theme';

configureNotificationHandler();

type Boot =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; services: AppServices; theme: ThemePreference };

export default function RootLayout() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const services = await createServices();
        const stored = await services.repo.getSetting('theme');
        const theme: ThemePreference = stored === 'light' || stored === 'dark' ? stored : 'system';
        if (!cancelled) setBoot({ status: 'ready', services, theme });
      } catch (error) {
        if (!cancelled) setBoot({ status: 'error', message: (error as Error)?.message ?? String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const services = boot.status === 'ready' ? boot.services : null;
  const persistTheme = useCallback(
    (p: ThemePreference) => {
      services?.repo.setSetting('theme', p).catch(() => undefined);
    },
    [services],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider
          key={boot.status === 'ready' ? 'ready' : 'boot'}
          initialPreference={boot.status === 'ready' ? boot.theme : 'system'}
          onPreferenceChange={persistTheme}
        >
          {boot.status === 'ready' ? (
            <AppProvider services={boot.services}>
              <DialogProvider>
                <ShareIntentGate>
                  <NotificationRouter />
                  <WidgetSync />
                  <LockGate>
                    <AppStack />
                  </LockGate>
                </ShareIntentGate>
              </DialogProvider>
            </AppProvider>
          ) : (
            <BootScreen
              boot={boot}
              onRetry={() => {
                setBoot({ status: 'loading' });
                setAttempt((a) => a + 1);
              }}
            />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function BootScreen({ boot, onRetry }: { boot: Boot; onRetry: () => void }) {
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {boot.status === 'error' ? (
        <EmptyState
          icon="alert-circle-outline"
          title="PocketVault couldn't open your library"
          message={`Your data has not been changed. ${boot.message}`}
          action={<Button label="Try again" onPress={onRetry} />}
        />
      ) : (
        <LoadingView label="Opening your library" />
      )}
    </View>
  );
}

function AppStack() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'default',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'PocketVault', headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="item/[id]" options={{ title: '', animation: 'slide_from_right' }} />
        <Stack.Screen name="edit" options={{ title: 'New item' }} />
        <Stack.Screen name="shareintent" options={{ title: 'Save to PocketVault' }} />
        <Stack.Screen name="collections" options={{ title: 'Collections' }} />
        <Stack.Screen name="tags" options={{ title: 'Tags' }} />
        <Stack.Screen name="reminders" options={{ title: 'Reminders' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="insights" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="vault" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="record" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="reader" options={{ title: 'Reader' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan document' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
