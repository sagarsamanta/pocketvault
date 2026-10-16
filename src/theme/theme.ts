import type { ItemColor, ItemType } from '../db/types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  /** Slightly raised surface used for cards on top of tinted backgrounds. */
  elevated: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryText: string;
  primarySoft: string;
  accent: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  favorite: string;
  overlay: string;
  inputBackground: string;
  /** Hero gradient (header, FAB, highlights). */
  gradient: readonly [string, string, string];
  /** Text/icons drawn on top of the gradient. */
  onGradient: string;
  onGradientMuted: string;
  /** Translucent "glass" surface on top of the gradient. */
  glass: string;
  glassBorder: string;
  shadow: string;
}

const light: Palette = {
  background: '#F5F4FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEDF8',
  elevated: '#FFFFFF',
  border: '#E4E1F0',
  text: '#15131F',
  textMuted: '#5D5A70',
  textFaint: '#8E8AA3',
  primary: '#5B4BF5',
  primaryText: '#FFFFFF',
  primarySoft: '#ECE9FF',
  accent: '#E1428A',
  danger: '#DC2E3F',
  dangerSoft: '#FDEBEE',
  success: '#0F8F63',
  successSoft: '#E3F7EF',
  warning: '#B85A07',
  warningSoft: '#FFF1E2',
  favorite: '#F2A900',
  overlay: 'rgba(20, 14, 45, 0.5)',
  inputBackground: '#FFFFFF',
  gradient: ['#4F46E5', '#7C3AED', '#C026D3'],
  onGradient: '#FFFFFF',
  onGradientMuted: 'rgba(255,255,255,0.78)',
  glass: 'rgba(255,255,255,0.18)',
  glassBorder: 'rgba(255,255,255,0.32)',
  shadow: '#2E1A87',
};

const dark: Palette = {
  background: '#0C0A16',
  surface: '#171427',
  surfaceAlt: '#221E36',
  elevated: '#1D1930',
  border: '#2E2946',
  text: '#F3F1FC',
  textMuted: '#ABA6C4',
  textFaint: '#7A7593',
  primary: '#9B8CFF',
  primaryText: '#0C0A16',
  primarySoft: '#2A2550',
  accent: '#FF6FB0',
  danger: '#FF6B78',
  dangerSoft: '#3B1D26',
  success: '#45D6A0',
  successSoft: '#13362B',
  warning: '#FFAE5C',
  warningSoft: '#3A2A18',
  favorite: '#FFCC4D',
  overlay: 'rgba(0, 0, 0, 0.65)',
  inputBackground: '#141124',
  gradient: ['#3B2FC9', '#6D28D9', '#A21CAF'],
  onGradient: '#FFFFFF',
  onGradientMuted: 'rgba(255,255,255,0.75)',
  glass: 'rgba(255,255,255,0.12)',
  glassBorder: 'rgba(255,255,255,0.22)',
  shadow: '#000000',
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

/** Colour labels users can put on items. */
export const ITEM_COLOR_HEX: Record<ItemColor, string> = {
  red: '#EF4444',
  orange: '#F97316',
  yellow: '#EAB308',
  green: '#22C55E',
  teal: '#14B8A6',
  blue: '#3B82F6',
  purple: '#8B5CF6',
  pink: '#EC4899',
};

/** Accent gradients per item type, used for placeholders and icons. */
export const TYPE_GRADIENT: Record<ItemType, readonly [string, string]> = {
  note: ['#F59E0B', '#F97316'],
  link: ['#0EA5E9', '#6366F1'],
  image: ['#EC4899', '#8B5CF6'],
  document: ['#10B981', '#0EA5E9'],
  audio: ['#F43F5E', '#F97316'],
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const font = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.6 },
};

export function cardShadow(colors: Palette, strength: 'sm' | 'md' | 'lg' = 'md') {
  const s = { sm: [2, 6, 0.06, 2], md: [6, 16, 0.1, 4], lg: [12, 28, 0.18, 10] }[strength];
  return {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: s[0] },
    shadowRadius: s[1],
    shadowOpacity: s[2],
    elevation: s[3],
  };
}

/** Minimum touch target (Android guideline is 48dp). */
export const TOUCH_TARGET = 48;
