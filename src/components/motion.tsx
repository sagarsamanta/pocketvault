import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect } from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { cardShadow, font, radius, spacing } from '../theme/theme';
import type { IconName } from './ui';

const APressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that gently shrinks while pressed — the app's signature touch feedback. */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  hapticOnPress = false,
  onPress,
  ...rest
}: Omit<PressableProps, 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  hapticOnPress?: boolean;
}) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(pressed.value, [0, 1], [1, scaleTo]) }] }));
  return (
    <APressable
      {...rest}
      onPressIn={(e) => {
        pressed.set(withSpring(1, { damping: 18, stiffness: 400 }));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, { damping: 14, stiffness: 300 }));
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (hapticOnPress) haptic.tap();
        onPress?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </APressable>
  );
}

/** Round icon on a gradient — used for item types and feature tiles. */
export function GradientIcon({
  icon,
  colors,
  size = 44,
  iconSize,
  rounded = 'xl',
}: {
  icon: IconName;
  colors: readonly [string, string, ...string[]];
  size?: number;
  iconSize?: number;
  rounded?: 'md' | 'xl' | 'full';
}) {
  const r = rounded === 'full' ? size / 2 : rounded === 'xl' ? size * 0.32 : size * 0.22;
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: r, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.48)} color="#FFFFFF" />
    </LinearGradient>
  );
}

/** Animated shimmering placeholder shown while content loads. */
export function Skeleton({ width, height, style }: { width: number | `${number}%`; height: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [t]);
  const animated = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 1], [0.45, 1]) }));
  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }, animated, style]} />;
}

export function CardSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={[styles.skeletonCard, { backgroundColor: colors.surface }]}>
      <Skeleton width={48} height={48} style={{ borderRadius: 16 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={12} />
      </View>
    </View>
  );
}

/** Primary call-to-action with the brand gradient. */
export function GradientButton({
  label,
  icon,
  onPress,
  disabled,
  testID,
  style,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hapticOnPress
      style={[{ opacity: disabled ? 0.5 : 1, borderRadius: radius.md }, cardShadow(colors, 'md'), style]}
    >
      <LinearGradient colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradientButton}>
        {icon ? <Ionicons name={icon} size={18} color={colors.onGradient} /> : null}
        <Text style={[font.body, { color: colors.onGradient, fontWeight: '700' }]}>{label}</Text>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  skeletonCard: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, alignItems: 'center' },
  gradientButton: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
