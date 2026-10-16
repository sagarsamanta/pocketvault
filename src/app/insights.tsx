import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedProps, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { TYPE_ICON, TYPE_LABEL } from '../components/ItemCard';
import { GradientIcon, PressableScale } from '../components/motion';
import { Card, IconButton, SectionTitle } from '../components/ui';
import type { ItemType } from '../db/types';
import { useTheme } from '../theme/ThemeProvider';
import { cardShadow, font, radius, spacing, TYPE_GRADIENT } from '../theme/theme';

const ARect = Animated.createAnimatedComponent(Rect);

function Bar({ x, width, height, maxHeight, color, delay }: { x: number; width: number; height: number; maxHeight: number; color: string; delay: number }) {
  const h = useSharedValue(0);
  useEffect(() => {
    h.set(withDelay(delay, withSpring(height, { damping: 14 })));
  }, [height, delay, h]);
  const props = useAnimatedProps(() => ({ y: maxHeight - h.value, height: h.value }));
  return <ARect x={x} width={width} rx={6} fill={color} animatedProps={props} />;
}

function BarChart({ values, labels, color, format = (v: number) => String(v), testID }: { values: number[]; labels: string[]; color: string; format?: (v: number) => string; testID?: string }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...values);
  const H = 120;
  const W = 320;
  const gap = 8;
  const bw = (W - gap * (values.length - 1)) / values.length;
  return (
    <View testID={testID} accessibilityLabel={`Chart: ${values.map((v, i) => `${labels[i]} ${format(v)}`).join(', ')}`}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {values.map((v, i) => (
          <Bar key={i} x={i * (bw + gap)} width={bw} height={v === 0 ? 3 : (v / max) * (H - 6)} maxHeight={H} color={v === 0 ? colors.border : color} delay={i * 50} />
        ))}
      </Svg>
      <View style={styles.labels}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.axis, { color: colors.textFaint, width: `${100 / labels.length}%` }]} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function InsightsScreen() {
  const services = useServices();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const counts = useLiveQuery(() => services.repo.countsByType(), []);
  const weeks = useLiveQuery(() => services.repo.itemsPerWeek(8), []);
  const months = useLiveQuery(() => services.repo.monthlyTotals(6), []);
  const tags = useLiveQuery(() => services.repo.topTags(8), []);
  const receipts = useLiveQuery(() => services.repo.listItems({ receiptsOnly: true, limit: 5 }), []);

  const total = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0);
  const monthTotal = months.data?.at(-1)?.total ?? 0;
  const prevTotal = months.data?.at(-2)?.total ?? 0;
  const change = prevTotal > 0 ? Math.round(((monthTotal - prevTotal) / prevTotal) * 100) : null;
  const savedThisWeek = weeks.data?.at(-1)?.count ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView testID="insights" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <LinearGradient colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}>
          <View style={{ flexDirection: 'row', marginLeft: -spacing.sm }}>
            <IconButton icon="arrow-back" label="Back" color={colors.onGradient} onPress={() => router.back()} />
          </View>
          <Text style={[font.display, { color: colors.onGradient }]}>Insights</Text>
          <Text style={[font.body, { color: colors.onGradientMuted }]}>
            {total} items in your vault · {savedThisWeek} saved this week
          </Text>
        </LinearGradient>

        <View style={styles.content}>
          <View style={styles.grid}>
            {(Object.keys(TYPE_LABEL) as ItemType[]).map((t, i) => (
              <Animated.View key={t} entering={FadeInDown.delay(i * 50).springify()} style={styles.gridCell}>
                <PressableScale accessibilityRole="button" accessibilityLabel={`${counts.data?.[t] ?? 0} ${TYPE_LABEL[t]}s`} style={[styles.statCard, { backgroundColor: colors.elevated }, cardShadow(colors, 'sm')]}>
                  <GradientIcon icon={TYPE_ICON[t]} colors={TYPE_GRADIENT[t]} size={36} />
                  <Text testID={`count-${t}`} style={[styles.statNum, { color: colors.text }]}>{counts.data?.[t] ?? 0}</Text>
                  <Text style={[font.small, { color: colors.textMuted }]}>{TYPE_LABEL[t]}s</Text>
                </PressableScale>
              </Animated.View>
            ))}
          </View>

          <SectionTitle>Saved per week</SectionTitle>
          <Card>
            <BarChart
              testID="chart-weeks"
              values={weeks.data?.map((w) => w.count) ?? []}
              labels={weeks.data?.map((w) => new Date(w.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })) ?? []}
              color={colors.primary}
            />
          </Card>

          <SectionTitle>Spending from receipts</SectionTitle>
          <Card>
            <View style={styles.spendHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[font.small, { color: colors.textMuted }]}>This month</Text>
                <Text testID="month-total" style={[font.title, { color: colors.text }]}>{monthTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              </View>
              {change !== null ? (
                <View style={[styles.change, { backgroundColor: change > 0 ? colors.dangerSoft : colors.successSoft }]}>
                  <Ionicons name={change > 0 ? 'trending-up' : 'trending-down'} size={14} color={change > 0 ? colors.danger : colors.success} />
                  <Text style={{ color: change > 0 ? colors.danger : colors.success, fontWeight: '800', fontSize: 12 }}>{Math.abs(change)}% vs last month</Text>
                </View>
              ) : null}
            </View>
            <BarChart
              testID="chart-spending"
              values={months.data?.map((m) => m.total) ?? []}
              labels={months.data?.map((m) => new Date(m.month).toLocaleDateString(undefined, { month: 'short' })) ?? []}
              color={colors.success}
              format={(v) => v.toFixed(2)}
            />
            <Text style={[font.small, { color: colors.textFaint, marginTop: spacing.sm }]}>Totals are read automatically from receipts and bills you save as photos or scans.</Text>
          </Card>
          {receipts.data?.length ? (
            <View style={{ gap: spacing.sm }}>
              {receipts.data.map((r) => (
                <PressableScale key={r.id} accessibilityRole="button" accessibilityLabel={r.title} onPress={() => router.push({ pathname: '/item/[id]', params: { id: r.id } })} style={[styles.receipt, { backgroundColor: colors.elevated }]}>
                  <Ionicons name="receipt-outline" size={18} color={colors.success} />
                  <Text style={[font.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {r.title || 'Receipt'}
                  </Text>
                  <Text style={{ color: colors.success, fontWeight: '800' }}>{r.facts.find((f) => f.kind === 'total')?.value}</Text>
                </PressableScale>
              ))}
            </View>
          ) : null}

          {tags.data?.length ? (
            <>
              <SectionTitle>Top tags</SectionTitle>
              <View style={styles.tagCloud}>
                {tags.data.map((t, i) => (
                  <PressableScale key={t.id} accessibilityRole="button" accessibilityLabel={`Tag ${t.name}`} onPress={() => router.navigate({ pathname: '/', params: { tag: t.id, collection: '' } })} style={[styles.tag, { backgroundColor: i === 0 ? colors.primary : colors.primarySoft }]}>
                    <Text style={{ color: i === 0 ? colors.primaryText : colors.primary, fontWeight: '800', fontSize: 14 - Math.min(i, 3) }}>
                      #{t.name} · {t.itemCount}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, gap: spacing.xs },
  content: { padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  gridCell: { width: '33.33%', padding: spacing.xs },
  statCard: { borderRadius: radius.lg, padding: spacing.md, gap: 4, minHeight: 110 },
  statNum: { fontSize: 24, fontWeight: '800' },
  labels: { flexDirection: 'row', marginTop: 6 },
  axis: { fontSize: 10, textAlign: 'center' },
  spendHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.md, gap: spacing.sm },
  change: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  tagCloud: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
});
