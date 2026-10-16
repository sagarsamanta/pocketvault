import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { PressableScale } from '../components/motion';
import { Button, IconName } from '../components/ui';
import { haptic } from '../lib/haptics';
import { font, radius, spacing } from '../theme/theme';

const SLIDES: { icon: IconName; title: string; body: string; colors: readonly [string, string, string]; chips: string[] }[] = [
  {
    icon: 'sparkles',
    title: 'Everything you want to keep',
    body: 'Notes, links, photos, scans and voice notes — in one beautiful, private place on your phone.',
    colors: ['#4F46E5', '#7C3AED', '#C026D3'],
    chips: ['📝 Notes', '🔗 Links', '🖼️ Photos', '🎙️ Voice'],
  },
  {
    icon: 'flash',
    title: 'Capture in a second',
    body:
      Platform.OS === 'web'
        ? 'On Android, share from any app, scan documents and record voice notes with live transcripts.'
        : 'Share from any app, scan documents with auto-crop, or record a voice note with a live transcript.',
    colors: ['#0EA5E9', '#6366F1', '#8B5CF6'],
    chips: ['📤 Share', '📄 Scan', '🎙️ Transcribe'],
  },
  {
    icon: 'search',
    title: 'Smart search & actions',
    body: 'Search like you talk — “receipts over 500 last month”. Text in photos is read on-device, with one-tap call, email and reminders.',
    colors: ['#10B981', '#0EA5E9', '#6366F1'],
    chips: ['🧠 Smart search', '🧾 Spending', '📞 Smart actions'],
  },
  {
    icon: 'lock-closed',
    title: 'Private by design',
    body: 'Works offline, no account, no tracking. Lock the app with your fingerprint and hide secrets in an encrypted vault.',
    colors: ['#1E1B4B', '#6D28D9', '#DB2777'],
    chips: ['🔐 Secret vault', '👆 App lock', '📴 Offline'],
  },
];

export default function Onboarding() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  const finish = async () => {
    setBusy(true);
    try {
      await services.repo.setSetting('onboarding_done', '1');
      haptic.success();
      services.notifyChanged();
      router.replace('/');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };

  const next = () => {
    haptic.tap();
    setIndex(index + 1);
  };

  return (
    <LinearGradient testID="onboarding" colors={slide.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fill, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.skipRow}>
        {!last ? (
          <Button testID="onboarding-skip" label="Skip" variant="ghost" compact onPress={finish} style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
        ) : null}
      </View>
      <View key={index} style={styles.content}>
        <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.hero}>
          <View style={styles.heroInner}>
            <Ionicons name={slide.icon} size={60} color="#FFFFFF" />
          </View>
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(120).springify()} accessibilityRole="header" style={[font.title, styles.center, { color: '#FFFFFF', fontSize: 30 }]}>
          {slide.title}
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(200).springify()} style={[font.body, styles.center, { color: 'rgba(255,255,255,0.88)', fontSize: 16, lineHeight: 24 }]}>
          {slide.body}
        </Animated.Text>
        <Animated.View entering={FadeInUp.delay(300).springify()} style={styles.chips}>
          {slide.chips.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>{c}</Text>
            </View>
          ))}
        </Animated.View>
      </View>
      <View style={styles.dots} accessibilityLabel={`Step ${index + 1} of ${SLIDES.length}`}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.4)', width: i === index ? 26 : 8 }]} />
        ))}
      </View>
      <View style={styles.actions}>
        {index > 0 ? (
          <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => setIndex(index - 1)} style={[styles.btn, { backgroundColor: 'rgba(255,255,255,0.18)', flex: 1 }]}>
            <Text style={styles.btnTextLight}>Back</Text>
          </PressableScale>
        ) : null}
        <PressableScale testID="onboarding-next" accessibilityRole="button" accessibilityLabel={last ? 'Get started' : 'Next'} disabled={busy} onPress={last ? finish : next} style={[styles.btn, { backgroundColor: '#FFFFFF', flex: 2 }]}>
          <Text style={[styles.btnText, { color: slide.colors[1] }]}>{last ? 'Get started' : 'Next'}</Text>
          <Ionicons name={last ? 'rocket' : 'arrow-forward'} size={18} color={slide.colors[1]} />
        </PressableScale>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: spacing.xl },
  skipRow: { alignItems: 'flex-end', minHeight: 48 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, maxWidth: 440, alignSelf: 'center' },
  hero: { width: 150, height: 150, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  heroInner: { width: 112, height: 112, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.18)' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: spacing.xl },
  dot: { height: 8, borderRadius: 4 },
  actions: { flexDirection: 'row', gap: spacing.md, maxWidth: 480, width: '100%', alignSelf: 'center' },
  btn: { minHeight: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  btnText: { fontWeight: '800', fontSize: 16 },
  btnTextLight: { fontWeight: '700', fontSize: 16, color: '#FFFFFF' },
});
