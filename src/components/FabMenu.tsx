import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { cardShadow, spacing } from '../theme/theme';
import { GradientIcon } from './motion';
import type { IconName } from './ui';

export interface FabAction {
  key: string;
  label: string;
  icon: IconName;
  colors: readonly [string, string];
  onPress: () => void;
}

function ActionRow({ action, index, open, onSelect }: { action: FabAction; index: number; open: SharedValue<number>; onSelect: () => void }) {
  const { colors } = useTheme();
  const animated = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [
      { translateY: interpolate(open.value, [0, 1], [24 + index * 8, 0]) },
      { scale: interpolate(open.value, [0, 1], [0.6, 1]) },
    ],
  }));
  return (
    <Animated.View style={[styles.row, animated]}>
      <Pressable
        testID={`fab-${action.key}`}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        onPress={onSelect}
        style={styles.rowPress}
      >
        <View style={[styles.label, { backgroundColor: colors.elevated }, cardShadow(colors, 'sm')]}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{action.label}</Text>
        </View>
        <GradientIcon icon={action.icon} colors={action.colors} size={48} rounded="full" />
      </Pressable>
    </Animated.View>
  );
}

/** Floating "+" button that blooms into a speed-dial of capture actions. */
export function FabMenu({ actions, testID = 'fab-add' }: { actions: FabAction[]; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const open = useSharedValue(0);
  const delayed = useSharedValue(0);
  const staggered = actions.map((_, i) => i);

  useEffect(() => {
    open.set(isOpen ? withSpring(1, { damping: 16, stiffness: 180 }) : withTiming(0, { duration: 160 }));
  }, [isOpen, open]);

  useEffect(() => {
    if (!isOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setIsOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [isOpen]);

  // Close instantly when leaving the screen: a blurred screen is frozen mid-animation,
  // which otherwise leaves the "+" stuck rotated (looking like an "×") on return.
  const closeNow = useCallback(() => {
    open.set(0);
    delayed.set(0);
    setIsOpen(false);
  }, [open, delayed]);
  useFocusEffect(useCallback(() => closeNow, [closeNow]));

  const backdrop = useAnimatedStyle(() => ({ opacity: open.value }));
  const rotate = useAnimatedStyle(() => ({ transform: [{ rotate: `${interpolate(open.value, [0, 1], [0, 135])}deg` }] }));
  useEffect(() => {
    delayed.set(isOpen ? withDelay(40, withSpring(1, { damping: 15 })) : withTiming(0, { duration: 120 }));
  }, [isOpen, delayed]);

  return (
    <>
      {isOpen ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close menu" onPress={() => setIsOpen(false)} />
        </Animated.View>
      ) : null}
      {isOpen ? (
        <View testID="add-sheet" style={[styles.menu, { bottom: insets.bottom + 100 }]} pointerEvents="box-none">
          {[...staggered].reverse().map((i) => (
            <ActionRow
              key={actions[i].key}
              action={actions[i]}
              index={i}
              open={delayed}
              onSelect={() => {
                haptic.light();
                closeNow();
                actions[i].onPress();
              }}
            />
          ))}
        </View>
      ) : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={isOpen ? 'Close add menu' : 'Add item'}
        onPress={() => {
          haptic.medium();
          setIsOpen((v) => !v);
        }}
        style={[styles.fab, { bottom: insets.bottom + 24 }, cardShadow(colors, 'lg')]}
      >
        <LinearGradient colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
          <Animated.View style={rotate}>
            <Ionicons name="add" size={32} color={colors.onGradient} />
          </Animated.View>
        </LinearGradient>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 20, width: 64, height: 64, borderRadius: 32 },
  fabInner: { flex: 1, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', right: 28, gap: spacing.md, alignItems: 'flex-end' },
  row: { alignItems: 'flex-end' },
  rowPress: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  label: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 12 },
});
