import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { CollectionPicker } from '../components/CollectionPicker';
import { ColorPicker } from '../components/ColorPicker';
import { GradientButton } from '../components/motion';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { TagEditor } from '../components/TagEditor';
import { ErrorView, LoadingView, Segmented, TextField } from '../components/ui';
import type { ItemColor, ItemType } from '../db/types';
import { applyFormat } from '../lib/checklist';
import { haptic } from '../lib/haptics';
import { normalizeUrl } from '../lib/text';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

/** Creates a note or link, or edits any existing item (`?id=`). */
export default function EditScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: string; collection?: string }>();
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editingId = params.id || null;

  const existing = useLiveQuery(async () => {
    if (!editingId) return null;
    const raw = await services.repo.getItemWithRelations(editingId);
    return raw?.isSecret ? services.vault.getSecretItem(editingId) : raw;
  }, [editingId]);
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const allTags = useLiveQuery(() => services.repo.listTags(), []);

  const [type, setType] = useState<ItemType>(params.type === 'link' ? 'link' : 'note');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(params.collection || null);
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [color, setColor] = useState<ItemColor | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const loaded = useRef(false);
  const noteRef = useRef<TextInput>(null);

  useEffect(() => {
    const item = existing.data;
    if (!item || loaded.current) return;
    loaded.current = true;
    setType(item.type);
    setTitle(item.title);
    setUrl(item.url ?? '');
    setNote(item.note);
    setCollectionId(item.collectionId);
    setTags(item.tags.map((t) => t.name));
    setFavorite(item.isFavorite);
    setPinned(item.isPinned);
    setColor(item.color);
  }, [existing.data]);

  // Ask before discarding unsaved changes (hardware back, header back, swipe).
  const navigation = useNavigation();
  const allowLeave = useRef(false);
  const dirtyRef = useRef(false);
  const initial = existing.data;
  const dirty = editingId
    ? !!initial &&
      (title !== initial.title ||
        note !== initial.note ||
        url !== (initial.url ?? '') ||
        collectionId !== initial.collectionId ||
        favorite !== initial.isFavorite ||
        pinned !== initial.isPinned ||
        color !== initial.color ||
        tags.join('\u0001') !== initial.tags.map((t) => t.name).join('\u0001'))
    : !!(title.trim() || note.trim() || url.trim() || tags.length);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (allowLeave.current || !dirtyRef.current) return;
        e.preventDefault();
        dialog
          .confirm({
            title: 'Discard changes?',
            message: 'You have unsaved changes. Leaving now will lose them.',
            confirmLabel: 'Discard',
            cancelLabel: 'Keep editing',
            destructive: true,
          })
          .then((discard) => {
            if (!discard) return;
            allowLeave.current = true;
            navigation.dispatch(e.data.action);
          });
      }),
    [navigation, dialog],
  );

  if (editingId && existing.loading && !existing.data) return <LoadingView />;
  if (editingId && !existing.loading && !existing.data) {
    return <ErrorView message={existing.error ? errorMessage(existing.error) : 'This item no longer exists.'} />;
  }

  const isNew = !editingId;
  const showUrl = type === 'link' || !!url;

  const createCollection = async () => {
    const name = await dialog.prompt({ title: 'New collection', placeholder: 'e.g. Recipes', confirmLabel: 'Create' });
    if (!name) return;
    try {
      const c = await services.repo.createCollection(name);
      services.notifyChanged();
      setCollectionId(c.id);
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const save = async () => {
    const cleanUrl = url.trim() ? normalizeUrl(url) : '';
    if (type === 'link' && !cleanUrl) {
      setUrlError('Enter a link to save.');
      return;
    }
    if (cleanUrl && !/^[a-z][a-z0-9+.-]*:\S+$/i.test(cleanUrl)) {
      setUrlError('This does not look like a valid link.');
      return;
    }
    // Warn before saving the same page twice.
    if (cleanUrl && (isNew || cleanUrl !== (initial?.url ?? '')) && !initial?.isSecret) {
      const dupes = await services.findDuplicateLinks(cleanUrl, editingId ?? undefined);
      if (dupes.length) {
        const saveAnyway = await dialog.confirm({
          title: 'Already in your vault',
          message: `You saved this link before${dupes[0].title ? ` as “${dupes[0].title}”` : ''}. Save it again?`,
          confirmLabel: 'Save anyway',
          cancelLabel: 'Open existing',
        });
        if (!saveAnyway) {
          allowLeave.current = true;
          router.replace({ pathname: '/item/[id]', params: { id: dupes[0].id } });
          return;
        }
      }
    }
    setSaving(true);
    try {
      if (isNew) {
        const item = await services.createItem({
          type,
          title,
          note,
          url: cleanUrl || null,
          collectionId,
          isFavorite: favorite,
          isPinned: pinned,
          color,
          tagNames: tags,
          source: 'manual',
        });
        haptic.success();
        allowLeave.current = true;
        router.replace({ pathname: '/item/[id]', params: { id: item.id } });
      } else if (initial?.isSecret) {
        await services.vault.updateSecret(editingId!, { title, note, url: cleanUrl || null });
        await services.updateItem(editingId!, { isFavorite: favorite, color });
        haptic.success();
        allowLeave.current = true;
        router.back();
      } else {
        await services.updateItem(editingId!, { title, note, url: cleanUrl || null, collectionId, isFavorite: favorite, isPinned: pinned, color });
        await services.setTags(editingId!, tags);
        haptic.success();
        allowLeave.current = true;
        router.back();
      }
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? (type === 'link' ? 'New link' : 'New note') : 'Edit item' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {isNew ? (
          <Segmented
            testIDPrefix="type"
            value={type}
            onChange={setType}
            options={[
              { value: 'note', label: 'Note', icon: 'document-text-outline' },
              { value: 'link', label: 'Link', icon: 'link-outline' },
            ]}
          />
        ) : null}
        {showUrl ? (
          <TextField
            testID="input-url"
            label="Link"
            value={url}
            onChangeText={(t) => {
              setUrl(t);
              setUrlError(null);
            }}
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={urlError}
            autoFocus={isNew && type === 'link'}
            returnKeyType="next"
          />
        ) : null}
        <TextField
          testID="input-title"
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder={type === 'link' ? 'Optional' : 'Give it a title'}
          maxLength={200}
          autoFocus={isNew && type === 'note'}
          returnKeyType="next"
          onSubmitEditing={() => noteRef.current?.focus()}
        />
        <View style={{ gap: spacing.sm }}>
          <TextField
            ref={noteRef}
            testID="input-note"
            label={type === 'link' ? 'Notes' : 'Note'}
            value={note}
            onChangeText={(text) => {
              // Keep the cursor estimate in sync while typing (web does not report every move).
              const delta = text.length - note.length;
              setNote(text);
              setSelection((s) => {
                const pos = Math.max(0, Math.min(text.length, s.end + delta));
                return { start: pos, end: pos };
              });
            }}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
            placeholder="Write anything… use the toolbar for checklists"
            multiline
          />
          <View style={[styles.toolbar, { backgroundColor: colors.surfaceAlt }]} accessibilityRole="toolbar">
            {(
              [
                ['check', 'checkbox-outline', 'Checklist item'],
                ['heading', 'text', 'Heading'],
                ['bullet', 'list', 'Bullet'],
                ['bold', 'brush', 'Bold'],
              ] as const
            ).map(([f, icon, label]) => (
              <Pressable
                key={f}
                testID={`format-${f}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => {
                  haptic.tap();
                  const next = applyFormat(note, selection, f);
                  setNote(next.text);
                  setSelection({ start: next.cursor, end: next.cursor });
                  noteRef.current?.focus();
                }}
                style={styles.toolBtn}
              >
                <Ionicons name={icon} size={20} color={colors.primary} />
                <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}>{label.split(' ')[0]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {!initial?.isSecret ? (
          <>
            <CollectionPicker collections={collections.data ?? []} value={collectionId} onChange={setCollectionId} onCreate={createCollection} />
            <TagEditor value={tags} onChange={setTags} allTags={allTags.data ?? []} />
          </>
        ) : null}
        <ColorPicker value={color} onChange={setColor} />
        <View style={[styles.switchRow, { borderColor: colors.border }]}>
          <Text style={[font.body, { color: colors.text, flex: 1 }]}>Favorite</Text>
          <Switch
            testID="input-favorite"
            accessibilityLabel="Favorite"
            value={favorite}
            onValueChange={setFavorite}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
          />
        </View>
        {!initial?.isSecret ? (
          <View style={[styles.switchRow, { borderColor: colors.border }]}>
            <Text style={[font.body, { color: colors.text, flex: 1 }]}>Pin to top</Text>
            <Switch
              testID="input-pinned"
              accessibilityLabel="Pin to top"
              value={pinned}
              onValueChange={setPinned}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
            />
          </View>
        ) : null}
        <GradientButton testID="save-item" label={saving ? 'Saving…' : isNew ? 'Save' : 'Save changes'} icon="checkmark" onPress={save} disabled={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  toolbar: { flexDirection: 'row', borderRadius: radius.md, padding: 4, gap: 4 },
  toolBtn: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, gap: 2 },
});
