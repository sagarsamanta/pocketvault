import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { CollectionPicker } from '../components/CollectionPicker';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { TagEditor } from '../components/TagEditor';
import { GradientButton } from '../components/motion';
import { haptic } from '../lib/haptics';
import { SETTINGS } from '../services/appServices';
import { Button, Card, EmptyState, Icon, LoadingView, TextField } from '../components/ui';
import { formatBytes, isImageMime, normalizeUrl } from '../lib/text';
import { IncomingShare, useIncomingShare } from '../share/incomingShare';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

/** Reviews content shared from another app before saving it. */
export default function ShareIntentScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { share: incoming, ready, clear } = useIncomingShare();
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const allTags = useLiveQuery(() => services.repo.listTags(), []);
  const quickSave = useLiveQuery(() => services.repo.getSetting(SETTINGS.quickSave), []);
  const [saved, setSaved] = useState<{ id: string | null; count: number; title: string } | null>(null);
  const autoSavedKey = useRef<string | null>(null);

  // Copy the shared payload once so it survives the native intent being reset.
  const [share, setShare] = useState<IncomingShare | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // A new share can arrive while this screen is open; reload the form when the payload changes.
  const incomingKey = incoming ? JSON.stringify(incoming) : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (incoming && incomingKey !== loadedKey) {
    setLoadedKey(incomingKey);
    setShare(incoming);
    setCollectionId(null);
    setTags([]);
    setTitle('');
    setNote('');
    setUrl('');
    setSaved(null);
    if (incoming.files.length === 0) {
      const text = incoming.webUrl && !incoming.text?.includes(incoming.webUrl)
        ? [incoming.webUrl, incoming.text].filter(Boolean).join('\n')
        : incoming.text ?? incoming.webUrl ?? '';
      const input = services.textToItemInput(text, incoming.subject);
      setTitle(input.title ?? '');
      setNote(input.note ?? '');
      setUrl(input.url ?? '');
    } else if (incoming.files.length === 1) {
      setTitle(incoming.subject ?? '');
      setNote(incoming.text ?? '');
    }
  }

  const leave = () => {
    clear();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const save = async (quick = false) => {
    if (!share) return;
    setSaving(true);
    try {
      let id: string | null = null;
      let count = 1;
      if (share.files.length) {
        const created = await services.importFiles(
          share.files,
          { title, note, collectionId, tagNames: tags },
          'share',
        );
        id = created.length === 1 ? created[0].id : null;
        count = created.length;
      } else {
        const cleanUrl = url.trim() ? normalizeUrl(url) : null;
        const item = await services.createItem({
          type: cleanUrl ? 'link' : 'note',
          title,
          note,
          url: cleanUrl,
          collectionId,
          tagNames: tags,
          source: 'share',
        });
        id = item.id;
      }
      clear();
      haptic.success();
      if (quick) {
        setSaved({ id, count, title: title || url || share.files[0]?.name || 'Saved item' });
        setSaving(false);
        return;
      }
      dialog.toast('Saved to PocketVault');
      if (id) router.replace({ pathname: '/item/[id]', params: { id } });
      else router.replace('/');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
      setSaving(false);
    }
  };

  // Quick save: store the share immediately, once per shared payload.
  useEffect(() => {
    if (quickSave.data !== '1' || !share || !loadedKey || autoSavedKey.current === loadedKey || saving) return;
    autoSavedKey.current = loadedKey;
    void save(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSave.data, share, loadedKey]);

  if (!share) {
    if (!ready) return <LoadingView />;
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          icon="share-social-outline"
          title="Nothing to save"
          message="Share a link, text, image or file to PocketVault from another app."
          action={<Button label="Go to library" onPress={() => router.replace('/')} />}
        />
      </View>
    );
  }

  const isFiles = share.files.length > 0;

  if (saved || (quickSave.data === '1' && saving)) {
    return (
      <LinearGradient testID="quick-saved" colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.saved, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.savedCenter}>
          {saved ? (
            <>
              <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.check}>
                <Ionicons name="checkmark" size={64} color={colors.gradient[1]} />
              </Animated.View>
              <Animated.Text entering={FadeInDown.delay(150)} style={[font.title, { color: '#FFFFFF', textAlign: 'center' }]}>
                Saved to PocketVault
              </Animated.Text>
              <Animated.Text entering={FadeInDown.delay(250)} style={[font.body, { color: 'rgba(255,255,255,0.85)', textAlign: 'center' }]} numberOfLines={2}>
                {saved.count > 1 ? `${saved.count} items` : saved.title}
              </Animated.Text>
            </>
          ) : (
            <Text style={[font.heading, { color: '#FFFFFF' }]}>Saving…</Text>
          )}
        </View>
        {saved ? (
          <Animated.View entering={FadeInDown.delay(350)} style={{ gap: spacing.md }}>
            <Button
              testID="quick-open"
              label="Open"
              variant="secondary"
              onPress={() => (saved.id ? router.replace({ pathname: '/item/[id]', params: { id: saved.id } }) : router.replace('/'))}
            />
            <Button testID="quick-done" label="Done" onPress={() => (Platform.OS === 'android' ? BackHandler.exitApp() : router.replace('/'))} />
          </Animated.View>
        ) : null}
      </LinearGradient>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Save to PocketVault' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
        {isFiles ? (
          <View style={{ gap: spacing.sm }}>
            {share.files.map((f, i) => (
              <Card key={`${f.uri}-${i}`}>
                <View style={styles.fileRow}>
                  {isImageMime(f.mimeType, f.name) ? (
                    <Image source={{ uri: f.uri }} style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} contentFit="cover" />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }]}>
                      <Icon name="document-outline" color={colors.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: colors.text, fontWeight: '500' }]} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text style={[font.small, { color: colors.textMuted }]}>
                      {f.size ? `${formatBytes(f.size)} · ` : ''}
                      {f.mimeType}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
            {share.files.length > 1 ? (
              <Text style={[font.small, { color: colors.textMuted }]}>Each file is saved as its own item.</Text>
            ) : null}
          </View>
        ) : null}

        {!isFiles ? (
          <TextField testID="share-url" label="Link" value={url} onChangeText={setUrl} placeholder="No link" autoCapitalize="none" keyboardType="url" />
        ) : null}
        {!isFiles || share.files.length === 1 ? (
          <>
            <TextField testID="share-title" label="Title" value={title} onChangeText={setTitle} placeholder="Optional" />
            <TextField testID="share-note" label="Note" value={note} onChangeText={setNote} placeholder="Add a note" multiline />
          </>
        ) : null}
        <CollectionPicker collections={collections.data ?? []} value={collectionId} onChange={setCollectionId} />
        <TagEditor value={tags} onChange={setTags} allTags={allTags.data ?? []} />
        <View style={styles.actions}>
          <Button label="Cancel" variant="secondary" onPress={leave} style={{ flex: 1 }} />
          <GradientButton testID="share-save" label={saving ? 'Saving…' : 'Save'} icon="checkmark" onPress={() => save()} disabled={saving} style={{ flex: 2 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  saved: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
  savedCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  check: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
});
