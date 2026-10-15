import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { BottomSheet } from '../components/BottomSheet';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { ItemCard } from '../components/ItemCard';
import { Button, Chip, EmptyState, ErrorView, Icon, IconButton, ListRow, LoadingView } from '../components/ui';
import type { ItemType, ItemWithRelations } from '../db/types';
import { attachmentPath } from '../services/fileStore';
import type { IncomingFile } from '../services/types';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

const PAGE = 100;

type QuickFilter = 'all' | 'favorites' | ItemType;
const QUICK_FILTERS: { value: QuickFilter; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { value: 'all', label: 'All', icon: 'albums-outline' },
  { value: 'favorites', label: 'Favorites', icon: 'star-outline' },
  { value: 'note', label: 'Notes', icon: 'document-text-outline' },
  { value: 'link', label: 'Links', icon: 'link-outline' },
  { value: 'image', label: 'Images', icon: 'image-outline' },
  { value: 'document', label: 'Docs', icon: 'document-outline' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function HomeScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ collection?: string; tag?: string }>();

  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');
  const [collectionId, setCollectionId] = useState<string | null>(params.collection ?? null);
  const [tagId, setTagId] = useState<string | null>(params.tag ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const debouncedQuery = useDebounced(query, 200);

  // Apply filters passed by other screens (e.g. tapping a tag or collection).
  const [seenParams, setSeenParams] = useState({ collection: params.collection, tag: params.tag });
  if (seenParams.collection !== params.collection || seenParams.tag !== params.tag) {
    setSeenParams({ collection: params.collection, tag: params.tag });
    if (params.collection !== undefined) setCollectionId(params.collection || null);
    if (params.tag !== undefined) setTagId(params.tag || null);
  }

  // Paging restarts whenever the filters change.
  const filterKey = `${debouncedQuery}|${quick}|${collectionId}|${tagId}`;
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;

  const onboarding = useLiveQuery(() => services.repo.getSetting('onboarding_done'), []);
  const items = useLiveQuery(
    () =>
      services.repo.listItems({
        query: debouncedQuery,
        favoritesOnly: quick === 'favorites',
        type: quick !== 'all' && quick !== 'favorites' ? quick : null,
        collectionId,
        tagId,
        limit: limit + 1,
      }),
    [debouncedQuery, quick, collectionId, tagId, limit],
  );
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const tags = useLiveQuery(() => services.repo.listTags(), []);
  const total = useLiveQuery(() => services.repo.countItems(), []);

  const visible = useMemo(() => (items.data ?? []).slice(0, limit), [items.data, limit]);
  const hasMore = (items.data?.length ?? 0) > limit;
  const filtersActive = !!debouncedQuery.trim() || quick !== 'all' || !!collectionId || !!tagId;

  const thumbFor = useCallback(
    (item: ItemWithRelations) => {
      if (!services.files.supported || item.type !== 'image') return null;
      const att = item.attachments[0];
      return att ? services.files.uri(attachmentPath(att.fileName)) : null;
    },
    [services],
  );

  const toggleFavorite = useCallback(
    async (item: ItemWithRelations) => {
      try {
        await services.updateItem(item.id, { isFavorite: !item.isFavorite });
      } catch (e) {
        dialog.toast(errorMessage(e), 'error');
      }
    },
    [services, dialog],
  );

  const runImport = async (files: IncomingFile[]) => {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const created = await services.importFiles(files, collectionId ? { collectionId } : {});
      if (created.length === 1) {
        router.push({ pathname: '/item/[id]', params: { id: created[0].id } });
      } else {
        dialog.toast(`Imported ${created.length} items`);
      }
    } catch (e) {
      dialog.toast(`Import failed: ${errorMessage(e)}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const importImages = async () => {
    setAddOpen(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 20,
        quality: 1,
      });
      if (result.canceled) return;
      await runImport(
        result.assets.map((a, i) => ({
          uri: a.uri,
          name: a.fileName || `image-${Date.now()}-${i}.jpg`,
          mimeType: a.mimeType || 'image/jpeg',
          size: a.fileSize,
        })),
      );
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const importDocuments = async () => {
    setAddOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      await runImport(
        result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType || '', size: a.size })),
      );
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  if (onboarding.loading && onboarding.data === undefined) return <LoadingView />;
  if (onboarding.data !== '1' && !onboarding.loading) return <Redirect href="/onboarding" />;

  const activeCollection = collections.data?.find((c) => c.id === collectionId);
  const activeTag = tags.data?.find((t) => t.id === tagId);

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
      <View style={styles.topBar}>
        <Text accessibilityRole="header" style={[font.title, { color: colors.text, flex: 1 }]}>
          Stash
        </Text>
        <IconButton testID="nav-reminders" icon="alarm-outline" label="Reminders" onPress={() => router.push('/reminders')} />
        <IconButton testID="nav-settings" icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
      </View>

      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="search" size={18} color={colors.textFaint} />
        <SearchInput value={query} onChange={setQuery} />
        {query ? <IconButton icon="close-circle" size={18} label="Clear search" color={colors.textFaint} onPress={() => setQuery('')} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {QUICK_FILTERS.map((f) => (
          <Chip
            key={f.value}
            testID={`filter-${f.value}`}
            label={f.label}
            icon={f.icon}
            selected={quick === f.value}
            onPress={() => setQuick(f.value)}
          />
        ))}
      </ScrollView>

      {(collections.data?.length || tags.data?.length) ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {collections.data?.map((c) => (
            <Chip
              key={c.id}
              testID={`filter-collection-${c.name}`}
              label={c.name}
              color={c.color}
              selected={collectionId === c.id}
              onPress={() => setCollectionId(collectionId === c.id ? null : c.id)}
            />
          ))}
          {tags.data?.filter((t) => (t.itemCount ?? 0) > 0).map((t) => (
            <Chip
              key={t.id}
              testID={`filter-tag-${t.name}`}
              label={`#${t.name}`}
              selected={tagId === t.id}
              onPress={() => setTagId(tagId === t.id ? null : t.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {activeCollection || activeTag ? (
        <Text style={[font.small, { color: colors.textMuted }]}>
          Showing {activeCollection ? `collection “${activeCollection.name}”` : ''}
          {activeCollection && activeTag ? ' and ' : ''}
          {activeTag ? `tag #${activeTag.name}` : ''}
        </Text>
      ) : null}
    </View>
  );

  const empty = items.error ? (
    <ErrorView message={errorMessage(items.error)} onRetry={items.reload} />
  ) : items.loading && !items.data ? (
    <LoadingView />
  ) : filtersActive ? (
    <EmptyState
      icon="search-outline"
      title="No matches"
      message="Try different words or clear the filters."
      action={
        <Button
          label="Clear filters"
          variant="secondary"
          onPress={() => {
            setQuery('');
            setQuick('all');
            setCollectionId(null);
            setTagId(null);
          }}
        />
      }
    />
  ) : (
    <EmptyState
      icon="bookmarks-outline"
      title="Your stash is empty"
      message={
        Platform.OS === 'web'
          ? 'Save notes and links with the + button.'
          : 'Save notes, links, images and documents with the + button, or share them to Stash from any app.'
      }
      action={<Button testID="empty-add" label="Add your first item" icon="add" onPress={() => setAddOpen(true)} />}
    />
  );

  return (
    <View testID="home-screen" style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <FlatList
        testID="item-list"
        data={visible}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.5}
        onEndReached={() => hasMore && setPage({ key: filterKey, limit: limit + PAGE })}
        initialNumToRender={12}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={<RefreshControl refreshing={false} onRefresh={items.reload} tintColor={colors.primary} colors={[colors.primary]} />}
        ListFooterComponent={
          hasMore ? (
            <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} />
          ) : visible.length > 0 && filtersActive ? (
            <Text style={[font.small, styles.footer, { color: colors.textFaint }]}>
              {visible.length} of {total.data ?? '…'} items
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            thumbnailUri={thumbFor(item)}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
            onToggleFavorite={() => toggleFavorite(item)}
          />
        )}
      />

      <Pressable
        testID="fab-add"
        accessibilityRole="button"
        accessibilityLabel="Add item"
        onPress={() => setAddOpen(true)}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: colors.primary, bottom: insets.bottom + 24, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <Icon name="add" size={28} color={colors.primaryText} />
      </Pressable>

      {importing ? (
        <View style={[styles.importing, { backgroundColor: colors.overlay }]} accessibilityLiveRegion="polite">
          <View style={[styles.importBox, { backgroundColor: colors.surface }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[font.body, { color: colors.text }]}>Importing…</Text>
          </View>
        </View>
      ) : null}

      <BottomSheet visible={addOpen} title="Add to Stash" onClose={() => setAddOpen(false)} testID="add-sheet">
        <ListRow
          testID="add-note"
          icon="document-text-outline"
          title="Note"
          subtitle="Write something down"
          onPress={() => {
            setAddOpen(false);
            router.push({ pathname: '/edit', params: { type: 'note', collection: collectionId ?? '' } });
          }}
        />
        <ListRow
          testID="add-link"
          icon="link-outline"
          title="Link"
          subtitle="Save a web address"
          onPress={() => {
            setAddOpen(false);
            router.push({ pathname: '/edit', params: { type: 'link', collection: collectionId ?? '' } });
          }}
        />
        {services.files.supported ? (
          <>
            <ListRow testID="add-image" icon="image-outline" title="Images" subtitle="Import from your photos — text is recognized automatically" onPress={importImages} />
            <ListRow testID="add-document" icon="document-outline" title="Documents" subtitle="PDFs, text files and more" onPress={importDocuments} />
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  return (
    <TextInput
      testID="search-input"
      value={value}
      onChangeText={onChange}
      placeholder="Search titles, notes, links, tags, text"
      placeholderTextColor={colors.textFaint}
      accessibilityLabel="Search"
      returnKeyType="search"
      autoCorrect={false}
      style={[styles.searchInput, { color: colors.text }]}
    />
  );
}

function Separator() {
  return <View style={{ height: spacing.sm }} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingLeft: spacing.md,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  footer: { textAlign: 'center', margin: spacing.lg },
  fab: {
    position: 'absolute',
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  importing: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  importBox: { flexDirection: 'row', gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, alignItems: 'center' },
});
