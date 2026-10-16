import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic } from '../lib/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { cardShadow, radius, spacing } from '../theme/theme';
import { formatDuration } from './ItemCard';

/** Deterministic pseudo-waveform so each recording has a recognisable shape. */
function bars(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: count }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2654435761);
    const v = ((h >>> 0) % 1000) / 1000;
    return 0.25 + 0.75 * Math.abs(Math.sin(i / 3 + v * 2)) * (0.6 + v * 0.4);
  });
}

export function AudioPlayer({ uri, durationMs, seed }: { uri: string; durationMs: number | null; seed: string }) {
  const { colors } = useTheme();
  const player = useAudioPlayer(uri, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const wave = useMemo(() => bars(seed, 40), [seed]);
  const duration = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  useEffect(() => {
    if (status.didJustFinish) player.seekTo(0).catch(() => undefined);
  }, [status.didJustFinish, player]);

  const toggle = () => {
    haptic.light();
    if (status.playing) player.pause();
    else player.play();
  };

  return (
    <View testID="audio-player" style={[styles.card, { backgroundColor: colors.elevated }, cardShadow(colors, 'sm')]}>
      <Pressable testID="audio-toggle" accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause' : 'Play'} onPress={toggle}>
        <LinearGradient colors={['#F43F5E', '#F97316']} style={styles.play}>
          <Ionicons name={status.playing ? 'pause' : 'play'} size={26} color="#FFFFFF" style={{ marginLeft: status.playing ? 0 : 3 }} />
        </LinearGradient>
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          onPress={(e) => {
            const w = 40 * 6;
            const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / w));
            player.seekTo(ratio * duration).catch(() => undefined);
          }}
          style={styles.wave}
        >
          {wave.map((h, i) => (
            <View
              key={i}
              style={[styles.bar, { height: 6 + h * 30, backgroundColor: i / wave.length <= progress ? colors.accent : colors.border }]}
            />
          ))}
        </Pressable>
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600' }}>
          {formatDuration(status.currentTime * 1000)} / {formatDuration(duration * 1000)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40 },
  bar: { width: 4, borderRadius: 2 },
});
