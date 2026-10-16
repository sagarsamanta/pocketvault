import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import type { RediscoverPick } from '../db/repository';
import { useTheme } from '../theme/ThemeProvider';
import { cardShadow, font, radius, spacing, TYPE_GRADIENT } from '../theme/theme';
import { itemDisplayTitle, TYPE_ICON } from './ItemCard';
import { PressableScale } from './motion';

/** Daily "on this day" card that resurfaces an older saved item. */
export function RediscoverCard({
  pick,
  thumbnailUri,
  onOpen,
  onDismiss,
}: {
  pick: RediscoverPick;
  thumbnailUri: string | null;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const g = TYPE_GRADIENT[pick.item.type];
  return (
    <Animated.View entering={FadeInUp.springify().damping(16)} exiting={FadeOut} testID="rediscover-card">
      <PressableScale accessibilityRole="button" accessibilityLabel={`Rediscover: ${itemDisplayTitle(pick.item)}`} onPress={onOpen} style={[styles.card, cardShadow(colors, 'md')]}>
        <LinearGradient colors={[g[0], g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.badge}>
              <Ionicons name="sparkles" size={12} color="#FFFFFF" />
              <Text style={styles.badgeText}>REDISCOVER · {pick.reason.toUpperCase()}</Text>
            </View>
            <Text style={[font.heading, { color: '#FFFFFF' }]} numberOfLines={2}>
              {itemDisplayTitle(pick.item)}
            </Text>
            <Text style={[font.small, { color: 'rgba(255,255,255,0.85)' }]}>Tap to revisit</Text>
          </View>
          {thumbnailUri ? (
            <Image source={{ uri: thumbnailUri }} style={styles.thumb} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, styles.iconThumb]}>
              <Ionicons name={TYPE_ICON[pick.item.type]} size={28} color="#FFFFFF" />
            </View>
          )}
        </LinearGradient>
      </PressableScale>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss rediscover" onPress={onDismiss} hitSlop={6} style={styles.close} testID="rediscover-dismiss">
        <Ionicons name="close" size={16} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg },
  gradient: { borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 110 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  thumb: { width: 72, height: 72, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  iconThumb: { backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 6, right: 6, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
});
