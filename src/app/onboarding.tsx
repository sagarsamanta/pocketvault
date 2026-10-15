import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { Button, Icon, IconName } from '../components/ui';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

const SLIDES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'bookmarks-outline',
    title: 'Everything you want to keep',
    body: 'Save notes, links, images and documents in one private place on your phone.',
  },
  {
    icon: 'share-social-outline',
    title: 'Share from any app',
    body:
      Platform.OS === 'web'
        ? 'On Android, use the Share button in any app and choose Stash.'
        : 'Use the Share button in your browser, gallery or files app and choose Stash.',
  },
  {
    icon: 'search-outline',
    title: 'Find it instantly',
    body: 'Search titles, notes, links, tags — and even the text inside your images.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Private and offline',
    body: 'No account, no cloud. Your stash stays on this device. Back it up whenever you like.',
  },
];

export default function Onboarding() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  const finish = async () => {
    setBusy(true);
    try {
      await services.repo.setSetting('onboarding_done', '1');
      services.notifyChanged();
      router.replace('/');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };

  return (
    <View
      testID="onboarding"
      style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View style={styles.skipRow}>
        {!last ? <Button testID="onboarding-skip" label="Skip" variant="ghost" compact onPress={finish} /> : null}
      </View>
      <View style={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.primarySoft }]}>
          <Icon name={slide.icon} size={56} color={colors.primary} />
        </View>
        <Text accessibilityRole="header" style={[font.title, styles.center, { color: colors.text }]}>
          {slide.title}
        </Text>
        <Text style={[font.body, styles.center, { color: colors.textMuted, fontSize: 16, lineHeight: 23 }]}>{slide.body}</Text>
      </View>
      <View style={styles.dots} accessibilityLabel={`Step ${index + 1} of ${SLIDES.length}`}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i === index ? colors.primary : colors.border, width: i === index ? 22 : 8 }]} />
        ))}
      </View>
      <View style={styles.actions}>
        {index > 0 ? <Button label="Back" variant="secondary" onPress={() => setIndex(index - 1)} style={{ flex: 1 }} /> : null}
        <Button
          testID="onboarding-next"
          label={last ? 'Get started' : 'Next'}
          onPress={last ? finish : () => setIndex(index + 1)}
          loading={busy}
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: spacing.xl },
  skipRow: { alignItems: 'flex-end', minHeight: 48 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, maxWidth: 420, alignSelf: 'center' },
  hero: { width: 120, height: 120, borderRadius: radius.lg * 2, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  center: { textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: spacing.xl },
  dot: { height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: spacing.md, maxWidth: 480, width: '100%', alignSelf: 'center' },
});
