import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { haptic } from '../lib/haptics';
import { authenticate } from '../security/auth';
import { font, radius, spacing } from '../theme/theme';
import { PressableScale } from './motion';

/** Full-screen unlock prompt with an animated padlock. Auto-prompts once on mount. */
export function LockScreen({
  title,
  subtitle,
  reason,
  onUnlocked,
  testID = 'lock-screen',
}: {
  title: string;
  subtitle: string;
  reason: string;
  onUnlocked: () => void;
  testID?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const shake = useSharedValue(0);
  const glow = useSharedValue(0);
  const shackle = useSharedValue(0);

  useEffect(() => {
    glow.set(withRepeat(withTiming(1, { duration: 1600 }), -1, true));
  }, [glow]);

  const handleResult = (res: { ok: boolean; error?: string }) => {
    setError(null);
    if (res.ok) {
      haptic.success();
      setOpening(true);
      shackle.set(withSpring(1, { damping: 10 }));
      setTimeout(onUnlocked, 420);
    } else {
      if (res.error) setError(res.error);
      haptic.warning();
      shake.set(withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 })));
    }
  };

  const tryUnlock = async () => handleResult(await authenticate(reason));

  // Prompt once as soon as the lock screen appears.
  useEffect(() => {
    authenticate(reason).then(handleResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lockStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }, { scale: 1 + shackle.value * 0.15 }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.25 + glow.value * 0.35, transform: [{ scale: 1 + glow.value * 0.25 }] }));

  return (
    <LinearGradient testID={testID} colors={['#1E1B4B', '#4C1D95', '#831843']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
      <View style={styles.center}>
        <View style={styles.lockWrap}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <Animated.View style={[styles.lock, lockStyle]}>
            <Ionicons name={opening ? 'lock-open' : 'lock-closed'} size={56} color="#FFFFFF" />
          </Animated.View>
        </View>
        <Text style={[font.title, { color: '#FFFFFF', textAlign: 'center' }]}>{title}</Text>
        <Text style={[font.body, { color: 'rgba(255,255,255,0.8)', textAlign: 'center', maxWidth: 300 }]}>{subtitle}</Text>
        {error ? <Text style={[font.small, { color: '#FECACA', textAlign: 'center' }]}>{error}</Text> : null}
      </View>
      <PressableScale testID="unlock-button" accessibilityRole="button" accessibilityLabel="Unlock" onPress={tryUnlock} style={styles.button}>
        <Ionicons name="finger-print" size={22} color="#4C1D95" />
        <Text style={{ color: '#4C1D95', fontWeight: '800', fontSize: 16 }}>Unlock</Text>
      </PressableScale>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  lockWrap: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  glow: { position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: '#A78BFA' },
  lock: { width: 112, height: 112, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  button: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', minHeight: 56, borderRadius: radius.lg, marginBottom: spacing.xl },
});
