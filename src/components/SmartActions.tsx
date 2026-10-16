import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import type { ItemFact } from '../db/types';
import { normalizeUrl } from '../lib/text';
import { useNow } from '../lib/useNow';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/theme';
import { PressableScale } from './motion';
import type { IconName } from './ui';

interface Action {
  key: string;
  icon: IconName;
  label: string;
  sub?: string;
  color: string;
  onPress: () => void;
}

/** One-tap actions built from facts detected in the item (call, email, remind, open, total). */
export function SmartActions({
  facts,
  onRemindAt,
  onError,
}: {
  facts: ItemFact[];
  onRemindAt: (at: number) => void;
  onError: (message: string) => void;
}) {
  const { colors } = useTheme();
  const now = useNow(60_000);
  const open = (url: string) => Linking.openURL(url).catch(() => onError('No app on this device can handle this.'));
  const actions: Action[] = [];
  const total = facts.find((f) => f.kind === 'total');
  if (total) actions.push({ key: 'total', icon: 'receipt', label: total.value, sub: 'Total detected', color: '#10B981', onPress: () => undefined });
  for (const f of facts) {
    if (f.kind === 'phone') actions.push({ key: `p${f.value}`, icon: 'call', label: 'Call', sub: f.value, color: '#22C55E', onPress: () => open(`tel:${f.value.replace(/[^\d+]/g, '')}`) });
    if (f.kind === 'email') actions.push({ key: `e${f.value}`, icon: 'mail', label: 'Email', sub: f.value, color: '#3B82F6', onPress: () => open(`mailto:${f.value}`) });
    if (f.kind === 'url') actions.push({ key: `u${f.value}`, icon: 'globe', label: 'Open', sub: f.value.replace(/^https?:\/\//, ''), color: '#6366F1', onPress: () => open(normalizeUrl(f.value)) });
    if (f.kind === 'date' && f.num) {
      const at = new Date(f.num);
      at.setHours(9, 0, 0, 0);
      if (at.getTime() > now) {
        actions.push({
          key: `d${f.value}`,
          icon: 'alarm',
          label: 'Remind me',
          sub: at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
          color: '#F59E0B',
          onPress: () => onRemindAt(at.getTime()),
        });
      }
    }
  }
  if (actions.length === 0) return null;
  return (
    <View testID="smart-actions" style={{ gap: spacing.sm }}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={14} color={colors.accent} />
        <Text style={[styles.title, { color: colors.textMuted }]}>SMART ACTIONS</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
        {actions.slice(0, 10).map((a, i) => (
          <Animated.View key={a.key} entering={FadeInRight.delay(i * 60).springify()}>
            <PressableScale
              testID={`smart-${a.key.slice(0, 1)}`}
              accessibilityRole="button"
              accessibilityLabel={`${a.label}${a.sub ? ` ${a.sub}` : ''}`}
              onPress={a.onPress}
              hapticOnPress
              style={[styles.action, { backgroundColor: colors.elevated, borderColor: colors.border }]}
            >
              <View style={[styles.icon, { backgroundColor: a.color }]}>
                <Ionicons name={a.icon} size={16} color="#FFFFFF" />
              </View>
              <View style={{ maxWidth: 160 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
                  {a.label}
                </Text>
                {a.sub ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                    {a.sub}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, minHeight: 52 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
