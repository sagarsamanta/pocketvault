import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { radius, spacing } from '../theme/theme';
import type { IconName } from './ui';

export interface SwipeAction {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}

function Actions({ actions, progress, side, close }: { actions: SwipeAction[]; progress: SharedValue<number>; side: 'left' | 'right'; close: () => void }) {
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.8, 1]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.7, 1]) }],
  }));
  return (
    <Animated.View style={[styles.actions, side === 'left' ? styles.left : styles.right, animated]}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          testID={`swipe-${a.key}`}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={() => {
            haptic.medium();
            close();
            a.onPress();
          }}
          style={[styles.action, { backgroundColor: a.color }]}
        >
          <Ionicons name={a.icon} size={20} color="#FFFFFF" />
          <Text style={styles.actionText}>{a.label}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

/** List row with swipe actions (swipe right: leftActions, swipe left: rightActions). */
export function SwipeRow({ children, leftActions = [], rightActions = [] }: { children: ReactNode; leftActions?: SwipeAction[]; rightActions?: SwipeAction[] }) {
  const ref = useRef<SwipeableMethods>(null);
  if (Platform.OS === 'web') return <View>{children}</View>;
  const close = () => ref.current?.close();
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      leftThreshold={40}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableWillOpen={() => haptic.tap()}
      renderLeftActions={leftActions.length ? (progress) => <Actions actions={leftActions} progress={progress} side="left" close={close} /> : undefined}
      renderRightActions={rightActions.length ? (progress) => <Actions actions={rightActions} progress={progress} side="right" close={close} /> : undefined}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm, paddingVertical: 2 },
  left: { paddingRight: spacing.sm },
  right: { paddingLeft: spacing.sm },
  action: { width: 74, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});
