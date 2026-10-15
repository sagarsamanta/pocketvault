import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { CollectionPicker } from '../components/CollectionPicker';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { TagEditor } from '../components/TagEditor';
import { Button, ErrorView, LoadingView, Segmented, TextField } from '../components/ui';
import type { ItemType } from '../db/types';
import { normalizeUrl } from '../lib/text';
import { useTheme } from '../theme/ThemeProvider';
import { font, spacing } from '../theme/theme';

/** Creates a note or link, or edits any existing item (`?id=`). */
export default function EditScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: string; collection?: string }>();
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editingId = params.id || null;

  const existing = useLiveQuery(
    () => (editingId ? services.repo.getItemWithRelations(editingId) : Promise.resolve(null)),
    [editingId],
  );
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const allTags = useLiveQuery(() => services.repo.listTags(), []);

  const [type, setType] = useState<ItemType>(params.type === 'link' ? 'link' : 'note');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [collectionId, setCollectionId] = useState<string | null>(params.collection || null);
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
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
          tagNames: tags,
          source: 'manual',
        });
        allowLeave.current = true;
        router.replace({ pathname: '/item/[id]', params: { id: item.id } });
      } else {
        await services.updateItem(editingId!, { title, note, url: cleanUrl || null, collectionId, isFavorite: favorite });
        await services.setTags(editingId!, tags);
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
        <TextField
          ref={noteRef}
          testID="input-note"
          label={type === 'link' ? 'Notes' : 'Note'}
          value={note}
          onChangeText={setNote}
          placeholder="Write anything…"
          multiline
        />
        <CollectionPicker
          collections={collections.data ?? []}
          value={collectionId}
          onChange={setCollectionId}
          onCreate={createCollection}
        />
        <TagEditor value={tags} onChange={setTags} allTags={allTags.data ?? []} />
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
        <Button testID="save-item" label={isNew ? 'Save' : 'Save changes'} icon="checkmark" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
});
