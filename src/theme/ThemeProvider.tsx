import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { ColorScheme, Palette, palettes, ThemePreference } from './theme';

interface ThemeContextValue {
  colors: Palette;
  scheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreference = 'system',
  onPreferenceChange,
}: {
  children: ReactNode;
  initialPreference?: ThemePreference;
  onPreferenceChange?: (p: ThemePreference) => void;
}) {
  const system = useColorScheme();
  // `initialPreference` is read once; remount the provider (via `key`) to apply a new initial value.
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);

  const scheme: ColorScheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const colors = palettes[scheme];

  useEffect(() => {
    if (Platform.OS !== 'web') SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  const setPreference = useCallback(
    (p: ThemePreference) => {
      setPreferenceState(p);
      onPreferenceChange?.(p);
    },
    [onPreferenceChange],
  );

  const value = useMemo(() => ({ colors, scheme, preference, setPreference }), [colors, scheme, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
