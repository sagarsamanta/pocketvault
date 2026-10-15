export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  danger: string;
  dangerSoft: string;
  success: string;
  warning: string;
  warningSoft: string;
  favorite: string;
  overlay: string;
  inputBackground: string;
}

const light: Palette = {
  background: '#F6F6F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EEEEF3',
  border: '#E1E1E8',
  text: '#16161D',
  textMuted: '#5C5C6B',
  textFaint: '#8A8A99',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
  primarySoft: '#E8E7FD',
  danger: '#D92D20',
  dangerSoft: '#FDECEA',
  success: '#12805C',
  warning: '#B54708',
  warningSoft: '#FEF0E1',
  favorite: '#E8A400',
  overlay: 'rgba(15, 15, 25, 0.45)',
  inputBackground: '#FFFFFF',
};

const dark: Palette = {
  background: '#0F0F14',
  surface: '#1A1A22',
  surfaceAlt: '#24242E',
  border: '#2E2E3A',
  text: '#F2F2F7',
  textMuted: '#A9A9B8',
  textFaint: '#767686',
  primary: '#8B85FF',
  primaryText: '#0F0F14',
  primarySoft: '#2A2850',
  danger: '#FF6B5E',
  dangerSoft: '#3A1F1D',
  success: '#4ACB98',
  warning: '#F5A35C',
  warningSoft: '#3A2A1A',
  favorite: '#FFC94D',
  overlay: 'rgba(0, 0, 0, 0.6)',
  inputBackground: '#14141B',
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = {
  title: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
};

/** Minimum touch target (Android guideline is 48dp). */
export const TOUCH_TARGET = 48;
