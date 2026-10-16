import Ionicons from '@expo/vector-icons/Ionicons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Paths } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { formatDuration } from '../components/ItemCard';
import { haptic } from '../lib/haptics';
import { openAppSettings } from '../services/itemActions';
import { font, radius, spacing } from '../theme/theme';

type Mode = 'speech' | 'audio';
type Phase = 'idle' | 'recording' | 'saving';

/** Picks an installed on-device speech model matching the device language, if any. */
async function pickOnDeviceLocale(): Promise<string | null> {
  try {
    if (!ExpoSpeechRecognitionModule.supportsRecording() || !ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return null;
    const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    if (!installedLocales.length) return null;
    const device = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
    const lang = device.split('-')[0].toLowerCase();
    return (
      installedLocales.find((l) => l.toLowerCase() === device.toLowerCase()) ??
      installedLocales.find((l) => l.toLowerCase().startsWith(lang)) ??
      installedLocales.find((l) => l.toLowerCase().startsWith('en')) ??
      installedLocales[0]
    );
  } catch {
    return null;
  }
}

export default function RecordScreen() {
  const params = useLocalSearchParams<{ collection?: string }>();
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 120);

  const [mode, setMode] = useState<Mode | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [finals, setFinals] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const speechUri = useRef<string | null>(null);
  const stopResolve = useRef<((uri: string | null) => void) | null>(null);
  const level = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    pickOnDeviceLocale().then((l) => {
      setLocale(l);
      setMode(l ? 'speech' : 'audio');
    });
  }, []);

  // Pulse only while recording; an idle infinite animation burns frames for invisible rings.
  useEffect(() => {
    if (phase !== 'recording') return;
    pulse.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
    return () => {
      cancelAnimation(pulse);
      pulse.set(0);
    };
  }, [phase, pulse]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => clearInterval(t);
  }, [phase]);

  // Voice level from expo-audio metering (dBFS) in audio mode.
  useEffect(() => {
    if (mode !== 'audio' || phase !== 'recording' || recorderState.metering === undefined) return;
    level.set(withSpring(Math.max(0, Math.min(1, (recorderState.metering + 60) / 60)), { damping: 12 }));
  }, [recorderState.metering, mode, phase, level]);

  useSpeechRecognitionEvent('volumechange', (e) => {
    level.set(withSpring(Math.max(0, Math.min(1, (e.value + 2) / 12)), { damping: 12 }));
  });
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    if (e.isFinal) {
      setFinals((f) => [...f, text.trim()].filter(Boolean));
      setInterim('');
    } else {
      setInterim(text);
    }
  });
  useSpeechRecognitionEvent('audioend', (e) => {
    speechUri.current = e.uri ?? speechUri.current;
  });
  useSpeechRecognitionEvent('end', () => {
    stopResolve.current?.(speechUri.current);
    stopResolve.current = null;
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    dialog.toast(`Transcription stopped: ${e.message || e.error}`, 'error');
  });

  const ring1 = useAnimatedStyle(() => ({ opacity: phase === 'recording' ? 0.5 * (1 - pulse.value) : 0, transform: [{ scale: 1 + pulse.value * (0.6 + level.value * 0.8) }] }));
  const ring2 = useAnimatedStyle(() => ({ opacity: phase === 'recording' ? 0.35 : 0, transform: [{ scale: 1.08 + level.value * 0.5 }] }));

  const start = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        const open = await dialog.confirm({ title: 'Microphone access needed', message: 'Allow microphone access to record voice notes.', confirmLabel: 'Open settings', cancelLabel: 'Not now' });
        if (open) await openAppSettings();
        return;
      }
      setFinals([]);
      setInterim('');
      speechUri.current = null;
      if (mode === 'speech' && locale) {
        const sp = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!sp.granted) throw new Error('Speech recognition permission was denied.');
        ExpoSpeechRecognitionModule.start({
          lang: locale,
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: true,
          addsPunctuation: true,
          volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
          recordingOptions: { persist: true, outputDirectory: Paths.cache.uri, outputFileName: `voice-${Date.now()}.wav` },
        });
      } else {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record();
      }
      startedAt.current = Date.now();
      setElapsed(0);
      setPhase('recording');
      haptic.medium();
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const stopAndSave = async () => {
    setPhase('saving');
    haptic.success();
    const durationMs = Date.now() - startedAt.current;
    try {
      let uri: string | null;
      let mimeType: string;
      if (mode === 'speech') {
        uri = await new Promise<string | null>((resolve) => {
          stopResolve.current = resolve;
          ExpoSpeechRecognitionModule.stop();
          setTimeout(() => resolve(speechUri.current), 4000);
        });
        mimeType = 'audio/wav';
      } else {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        uri = recorder.uri;
        mimeType = 'audio/mp4';
      }
      if (!uri) throw new Error('The recording could not be saved.');
      const transcript = [...finals, interim].filter(Boolean).join(' ');
      const item = await services.createVoiceNote({
        uri,
        mimeType,
        durationMs,
        transcript,
        extra: params.collection ? { collectionId: params.collection } : {},
      });
      router.replace({ pathname: '/item/[id]', params: { id: item.id } });
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
      setPhase('idle');
    }
  };

  const cancel = async () => {
    if (phase === 'recording') {
      if (mode === 'speech') ExpoSpeechRecognitionModule.abort();
      else await recorder.stop().catch(() => undefined);
    }
    router.back();
  };

  const downloadModel = async () => {
    try {
      const device = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
      const res = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: device });
      dialog.toast(res.status === 'download_success' ? 'Speech model installed — reopen the recorder' : 'Speech model download started');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const transcript = [...finals, interim].filter(Boolean).join(' ');

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center', padding: spacing.xl }]}>
        <Text style={{ color: '#fff' }}>Voice notes are available in the Android app.</Text>
      </View>
    );
  }

  return (
    <LinearGradient colors={['#1E1B4B', '#6D28D9', '#DB2777']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fill, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable testID="record-cancel" accessibilityRole="button" accessibilityLabel="Cancel recording" onPress={cancel} style={styles.close}>
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.modePill}>
          <Ionicons name={mode === 'speech' ? 'text' : 'mic'} size={13} color="#FFFFFF" />
          <Text style={styles.modeText}>{mode === null ? 'Preparing…' : mode === 'speech' ? `Live transcript · on-device (${locale})` : 'Audio only'}</Text>
        </View>
      </View>

      <Text testID="record-timer" style={styles.timer}>
        {formatDuration(elapsed)}
      </Text>
      <Text style={styles.hint}>{phase === 'recording' ? 'Listening… tap the button to finish' : phase === 'saving' ? 'Saving your note…' : 'Tap the mic to start'}</Text>

      <ScrollView style={styles.transcriptBox} contentContainerStyle={{ padding: spacing.lg }}>
        {transcript ? (
          <Animated.Text entering={FadeIn} testID="live-transcript" style={styles.transcript}>
            {finals.join(' ')} <Text style={{ opacity: 0.6 }}>{interim}</Text>
          </Animated.Text>
        ) : (
          <Text style={[styles.transcript, { opacity: 0.55 }]}>
            {mode === 'audio' ? 'Your words will be saved as audio. Install an offline speech model to get a searchable transcript.' : 'Your words will appear here as you speak.'}
          </Text>
        )}
      </ScrollView>

      <View style={styles.micArea}>
        <Animated.View style={[styles.ring, ring1]} />
        <Animated.View style={[styles.ring, ring2]} />
        <Pressable
          testID="record-toggle"
          accessibilityRole="button"
          accessibilityLabel={phase === 'recording' ? 'Stop and save' : 'Start recording'}
          disabled={mode === null || phase === 'saving'}
          onPress={phase === 'recording' ? stopAndSave : start}
          style={styles.mic}
        >
          <Ionicons name={phase === 'recording' ? 'stop' : 'mic'} size={phase === 'recording' ? 34 : 40} color="#6D28D9" />
        </Pressable>
      </View>

      {mode === 'audio' && phase === 'idle' && ExpoSpeechRecognitionModule.supportsRecording() ? (
        <Pressable accessibilityRole="button" onPress={downloadModel} style={styles.link}>
          <Ionicons name="cloud-download-outline" size={16} color="#FFFFFF" />
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Get the offline speech model</Text>
        </Pressable>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: spacing.lg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, maxWidth: '78%' },
  modeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  timer: { ...font.display, fontSize: 56, color: '#FFFFFF', textAlign: 'center', marginTop: spacing.xxl, fontVariant: ['tabular-nums'] },
  hint: { color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: spacing.xs },
  transcriptBox: { flex: 1, marginVertical: spacing.xl, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.lg },
  transcript: { color: '#FFFFFF', fontSize: 20, lineHeight: 30, fontWeight: '600' },
  micArea: { alignItems: 'center', justifyContent: 'center', height: 180 },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFFFFF' },
  mic: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 10 },
  link: { flexDirection: 'row', gap: 6, alignSelf: 'center', alignItems: 'center', padding: spacing.md },
});
