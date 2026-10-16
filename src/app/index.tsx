import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { thumbnailFor } from '../app-state/thumbs';
import { pagesToPdf, scannerSupported, scanPages } from '../capture/scan';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { FabMenu, type FabAction } from '../components/FabMenu';
import { estimateTileHeight, ItemCard, ItemTile } from '../components/ItemCard';
import { CardSkeleton, GradientButton, GradientIcon, PressableScale } from '../components/motion';
import { RediscoverCard } from '../components/RediscoverCard';
import { SwipeRow } from '../components/SwipeRow';
import { Button, Chip, ErrorView, Icon, IconButton } from '../components/ui';
import type { ItemType, ItemWithRelations } from '../db/types';
import { haptic } from '../lib/haptics';
import { parseSmartQuery } from '../lib/smartQuery';
import { SETTINGS } from '../services/appServices';
import type { IncomingFile } from '../services/types';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing, TYPE_GRADIENT } from '../theme/theme';

const PAGE = 60;
const REDISCOVER_KEY = 'rediscover_dismissed';

type QuickFilter = 'all' | 'favorites' | 'pinned' | 'receipts' | ItemType;
const QUICK_FILTERS: { value: QuickFilter; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { value: 'all', label: 'All', icon: 'apps-outline' },
  { value: 'favorites', label: 'Favorites', icon: 'star-outline' },
  { value: 'pinned', label: 'Pinned', icon: 'pin-outline' },
  { value: 'note', label: 'Notes', icon: 'document-text-outline' },
  { value: 'link', label: 'Links', icon: 'link-outline' },
  { value: 'image', label: 'Photos', icon: 'image-outline' },
  { value: 'document', label: 'Docs', icon: 'document-outline' },
  { value: 'audio', label: 'Voice', icon: 'mic-outline' },
  { value: 'receipts', label: 'Receipts', icon: 'receipt-outline' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function greeting(hour: number) {
  if (hour < 5) return 'Up late? 🌙';
  if (hour < 12) return 'Good morning ☀️';
  if (hour < 17) return 'Good afternoon 🌤️';
  if (hour < 21) return 'Good evening 🌆';
  return 'Good night 🌙';
}

const todayKey = () => new Date().toDateString();

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
  const [busy, setBusy] = useState<string | null>(null);
  const debouncedQuery = useDebounced(query, 220);

  // Apply filters passed by other screens (e.g. tapping a tag or collection).
  const [seenParams, setSeenParams] = useState({ collection: params.collection, tag: params.tag });
  if (seenParams.collection !== params.collection || seenParams.tag !== params.tag) {
    setSeenParams({ collection: params.collection, tag: params.tag });
    if (params.collection !== undefined) setCollectionId(params.collection || null);
    if (params.tag !== undefined) setTagId(params.tag || null);
  }

  const onboarding = useLiveQuery(() => services.repo.getSetting('onboarding_done'), []);
  const viewMode = useLiveQuery(() => services.repo.getSetting(SETTINGS.viewMode), []);
  const dismissed = useLiveQuery(() => services.repo.getSetting(REDISCOVER_KEY), []);
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const tags = useLiveQuery(() => services.repo.listTags(), []);
  const total = useLiveQuery(() => services.repo.countItems(), []);
  const upcoming = useLiveQuery(() => services.repo.listReminders('scheduled'), []);

  const smart = useMemo(
    () => parseSmartQuery(debouncedQuery, { collections: collections.data?.map((c) => ({ id: c.id, name: c.name })) ?? [] }),
    [debouncedQuery, collections.data],
  );

  const filterKey = `${debouncedQuery}|${quick}|${collectionId}|${tagId}`;
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;
  const filtersActive = !!debouncedQuery.trim() || quick !== 'all' || !!collectionId || !!tagId;

  const items = useLiveQuery(
    () =>
      services.repo.listItems({
        query: smart.text,
        type: (quick !== 'all' && quick !== 'favorites' && quick !== 'pinned' && quick !== 'receipts' ? quick : null) ?? smart.type,
        favoritesOnly: quick === 'favorites' || smart.favoritesOnly,
        pinnedOnly: quick === 'pinned' || smart.pinnedOnly,
        receiptsOnly: quick === 'receipts' || smart.receiptsOnly,
        collectionId: collectionId ?? smart.collectionId,
        tagId,
        tagNames: smart.tagNames,
        dateFrom: smart.dateFrom,
        dateTo: smart.dateTo,
        amountMin: smart.amountMin,
        amountMax: smart.amountMax,
        withReminders: smart.withReminders,
        limit: limit + 1,
      }),
    [JSON.stringify(smart), quick, collectionId, tagId, limit],
  );
  const rediscover = useLiveQuery(() => services.repo.rediscover(), []);

  const visible = useMemo(() => (items.data ?? []).slice(0, limit), [items.data, limit]);
  const hasMore = (items.data?.length ?? 0) > limit;
  const isGrid = viewMode.data === 'grid';
  const showRediscover = !filtersActive && rediscover.data && dismissed.data !== todayKey();

  const thumb = useCallback((item: ItemWithRelations) => thumbnailFor(services.files, item), [services]);

  const open = useCallback((item: ItemWithRelations) => router.push({ pathname: '/item/[id]', params: { id: item.id } }), [router]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) dialog.toast(ok);
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const toggleFavorite = useCallback(
    (item: ItemWithRelations) => run(() => services.updateItem(item.id, { isFavorite: !item.isFavorite })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services],
  );

  const confirmDelete = async (item: ItemWithRelations) => {
    const ok = await dialog.confirm({
      title: 'Delete this item?',
      message: 'It will be removed with its files and reminders. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await run(() => services.deleteItem(item.id), 'Item deleted');
  };

  const runImport = async (files: IncomingFile[]) => {
    if (files.length === 0) return;
    setBusy('Importing…');
    try {
      const created = await services.importFiles(files, collectionId ? { collectionId } : {});
      haptic.success();
      if (created.length === 1) router.push({ pathname: '/item/[id]', params: { id: created[0].id } });
      else dialog.toast(`Imported ${created.length} items`);
    } catch (e) {
      dialog.toast(`Import failed: ${errorMessage(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const importImages = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 });
      if (result.canceled) return;
      await runImport(result.assets.map((a, i) => ({ uri: a.uri, name: a.fileName || `image-${Date.now()}-${i}.jpg`, mimeType: a.mimeType || 'image/jpeg', size: a.fileSize })));
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const importDocuments = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      await runImport(result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType || '', size: a.size })));
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const scan = async () => {
    try {
      const pages = await scanPages();
      if (!pages) return;
      setBusy(`Saving ${pages.length} page${pages.length === 1 ? '' : 's'}…`);
      const pdf = await pagesToPdf(pages).catch(() => null);
      const item = await services.createScan({ pageUris: pages, pdfUri: pdf, extra: collectionId ? { collectionId } : {} });
      haptic.success();
      router.push({ pathname: '/item/[id]', params: { id: item.id } });
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const fabActions: FabAction[] = [
    { key: 'note', label: 'Note', icon: 'create', colors: TYPE_GRADIENT.note, onPress: () => router.push({ pathname: '/edit', params: { type: 'note', collection: collectionId ?? '' } }) },
    { key: 'link', label: 'Link', icon: 'link', colors: TYPE_GRADIENT.link, onPress: () => router.push({ pathname: '/edit', params: { type: 'link', collection: collectionId ?? '' } }) },
    ...(Platform.OS !== 'web'
      ? ([
          { key: 'voice', label: 'Voice note', icon: 'mic', colors: TYPE_GRADIENT.audio, onPress: () => router.push({ pathname: '/record', params: { collection: collectionId ?? '' } }) },
          ...(scannerSupported ? [{ key: 'scan', label: 'Scan document', icon: 'scan', colors: ['#06B6D4', '#3B82F6'] as const, onPress: scan }] : []),
          { key: 'image', label: 'Photos', icon: 'images', colors: TYPE_GRADIENT.image, onPress: importImages },
          { key: 'document', label: 'Files', icon: 'folder-open', colors: TYPE_GRADIENT.document, onPress: importDocuments },
        ] as FabAction[])
      : []),
  ];

  const setView = (mode: 'list' | 'grid') => {
    haptic.tap();
    run(async () => {
      await services.repo.setSetting(SETTINGS.viewMode, mode);
      services.notifyChanged();
    });
  };

  if (onboarding.loading && onboarding.data === undefined) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  if (onboarding.data !== '1' && !onboarding.loading) return <Redirect href="/onboarding" />;

  const activeCollection = collections.data?.find((c) => c.id === collectionId);
  const activeTag = tags.data?.find((t) => t.id === tagId);
  const hour = new Date().getHours();

  const header = (
    <View>
      <LinearGradient colors={colors.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={[font.small, { color: colors.onGradientMuted, fontWeight: '600' }]}>{greeting(hour)}</Text>
            <Text accessibilityRole="header" style={[font.display, { color: colors.onGradient }]}>
              PocketVault
            </Text>
          </View>
          <IconButton testID="nav-insights" icon="stats-chart" label="Insights" color={colors.onGradient} onPress={() => router.push('/insights')} />
          <IconButton testID="nav-vault" icon="lock-closed" label="Secret vault" color={colors.onGradient} onPress={() => router.push('/vault')} />
          <IconButton testID="nav-settings" icon="settings-outline" label="Settings" color={colors.onGradient} onPress={() => router.push('/settings')} />
        </View>
        <View style={styles.statsRow}>
          <PressableScale style={[styles.stat, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]} onPress={() => setQuick('all')} accessibilityRole="button" accessibilityLabel={`${total.data ?? 0} items`}>
            <Text style={[styles.statNum, { color: colors.onGradient }]}>{total.data ?? '–'}</Text>
            <Text style={[styles.statLabel, { color: colors.onGradientMuted }]}>items saved</Text>
          </PressableScale>
          <PressableScale testID="nav-reminders" style={[styles.stat, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]} onPress={() => router.push('/reminders')} accessibilityRole="button" accessibilityLabel="Reminders">
            <Text style={[styles.statNum, { color: colors.onGradient }]}>{upcoming.data?.length ?? '–'}</Text>
            <Text style={[styles.statLabel, { color: colors.onGradientMuted }]}>reminders</Text>
          </PressableScale>
          <PressableScale style={[styles.stat, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]} onPress={() => setQuick('favorites')} accessibilityRole="button" accessibilityLabel="Favorites">
            <Ionicons name="star" size={18} color={colors.favorite} />
            <Text style={[styles.statLabel, { color: colors.onGradientMuted }]}>favorites</Text>
          </PressableScale>
        </View>
        <View style={[styles.search, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            testID="search-input"
            value={query}
            onChangeText={setQuery}
            placeholder="Try “receipts over 500 last month”"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Search"
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query ? <IconButton icon="close-circle" size={18} label="Clear search" color={colors.textFaint} onPress={() => setQuery('')} /> : null}
        </View>
        {smart.chips.length ? (
          <Animated.View entering={FadeIn} style={styles.smartRow} testID="smart-chips">
            <Ionicons name="sparkles" size={14} color={colors.onGradient} />
            {smart.chips.map((c) => (
              <View key={c} style={[styles.smartChip, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
                <Text style={{ color: colors.onGradient, fontSize: 12, fontWeight: '700' }}>{c}</Text>
              </View>
            ))}
          </Animated.View>
        ) : null}
      </LinearGradient>

      <View style={styles.content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {QUICK_FILTERS.filter((f) => Platform.OS !== 'web' || f.value !== 'audio').map((f) => (
            <Chip key={f.value} testID={`filter-${f.value}`} label={f.label} icon={f.icon} selected={quick === f.value} onPress={() => { haptic.tap(); setQuick(f.value); }} />
          ))}
        </ScrollView>
        {collections.data?.length || tags.data?.some((t) => (t.itemCount ?? 0) > 0) ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { marginTop: spacing.sm }]} keyboardShouldPersistTaps="handled">
            {collections.data?.map((c) => (
              <Chip key={c.id} testID={`filter-collection-${c.name}`} label={c.name} color={c.color} selected={collectionId === c.id} onPress={() => setCollectionId(collectionId === c.id ? null : c.id)} />
            ))}
            {tags.data
              ?.filter((t) => (t.itemCount ?? 0) > 0)
              .map((t) => (
                <Chip key={t.id} testID={`filter-tag-${t.name}`} label={`#${t.name}`} selected={tagId === t.id} onPress={() => setTagId(tagId === t.id ? null : t.id)} />
              ))}
          </ScrollView>
        ) : null}

        {showRediscover ? (
          <View style={{ marginTop: spacing.lg }}>
            <RediscoverCard
              pick={rediscover.data!}
              thumbnailUri={thumb(rediscover.data!.item)}
              onOpen={() => open(rediscover.data!.item)}
              onDismiss={() =>
                run(async () => {
                  await services.repo.setSetting(REDISCOVER_KEY, todayKey());
                  services.notifyChanged();
                })
              }
            />
          </View>
        ) : null}

        <View style={styles.sectionRow}>
          <Text style={[font.heading, { color: colors.text, flex: 1 }]}>
            {filtersActive ? (activeCollection ? activeCollection.name : activeTag ? `#${activeTag.name}` : 'Results') : 'Recent'}
          </Text>
          <View style={[styles.viewToggle, { backgroundColor: colors.surfaceAlt }]}>
            <IconButton testID="view-list" icon="list" size={18} label="List view" color={isGrid ? colors.textFaint : colors.primary} onPress={() => setView('list')} style={styles.toggleBtn} />
            <IconButton testID="view-grid" icon="grid" size={18} label="Grid view" color={isGrid ? colors.primary : colors.textFaint} onPress={() => setView('grid')} style={styles.toggleBtn} />
          </View>
        </View>
      </View>
    </View>
  );

  const empty = items.error ? (
    <ErrorView message={errorMessage(items.error)} onRetry={items.reload} />
  ) : items.loading && !items.data ? (
    <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </View>
  ) : filtersActive ? (
    <Animated.View entering={FadeInDown} style={styles.empty}>
      <GradientIcon icon="search" colors={colors.gradient} size={72} />
      <Text style={[font.heading, { color: colors.text }]}>No matches</Text>
      <Text style={[font.body, { color: colors.textMuted, textAlign: 'center' }]}>Try different words or clear the filters.</Text>
      <Button label="Clear filters" variant="secondary" onPress={() => { setQuery(''); setQuick('all'); setCollectionId(null); setTagId(null); }} />
    </Animated.View>
  ) : (
    <Animated.View entering={FadeInDown} style={styles.empty}>
      <GradientIcon icon="sparkles" colors={colors.gradient} size={80} />
      <Text style={[font.title, { color: colors.text, textAlign: 'center' }]}>Your vault is empty</Text>
      <Text style={[font.body, { color: colors.textMuted, textAlign: 'center', maxWidth: 320 }]}>
        {Platform.OS === 'web'
          ? 'Save notes and links with the + button.'
          : 'Save notes, links, photos, scans and voice notes with the + button — or share to PocketVault from any app.'}
      </Text>
      <GradientButton testID="empty-add" label="Save your first item" icon="add" onPress={() => router.push({ pathname: '/edit', params: { type: 'note' } })} />
    </Animated.View>
  );

  const footer = hasMore ? (
    <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} />
  ) : visible.length > 0 && filtersActive ? (
    <Text style={[font.small, styles.footer, { color: colors.textFaint }]}>
      {visible.length} of {total.data ?? '…'} items
    </Text>
  ) : null;

  const listContent = { paddingBottom: insets.bottom + 110, flexGrow: 1 } as const;
  const refresh = <RefreshControl refreshing={false} onRefresh={items.reload} tintColor={colors.primary} colors={[colors.primary]} progressViewOffset={insets.top} />;

  let body;
  if (isGrid && visible.length) {
    // Masonry: place each tile into the shorter column.
    const cols: [ItemWithRelations[], ItemWithRelations[]] = [[], []];
    const heights = [0, 0];
    for (const it of visible) {
      const c = heights[0] <= heights[1] ? 0 : 1;
      cols[c].push(it);
      heights[c] += estimateTileHeight(it, !!thumb(it)) + spacing.md;
    }
    body = (
      <ScrollView testID="item-list" contentContainerStyle={listContent} keyboardShouldPersistTaps="handled" refreshControl={refresh}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (hasMore && layoutMeasurement.height + contentOffset.y > contentSize.height - 400) setPage({ key: filterKey, limit: limit + PAGE });
        }}
        scrollEventThrottle={200}
      >
        {header}
        <View style={[styles.masonry]}>
          {cols.map((col, ci) => (
            <View key={ci} style={{ flex: 1 }}>
              {col.map((it, i) => (
                <ItemTile key={it.id} item={it} index={i * 2 + ci} thumbnailUri={thumb(it)} onPress={() => open(it)} onToggleFavorite={() => toggleFavorite(it)} />
              ))}
            </View>
          ))}
        </View>
        {footer}
      </ScrollView>
    );
  } else {
    body = (
      <FlatList
        testID="item-list"
        data={visible}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={listContent}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.5}
        onEndReached={() => hasMore && setPage({ key: filterKey, limit: limit + PAGE })}
        initialNumToRender={10}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={refresh}
        renderItem={({ item, index }) => (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <SwipeRow
              leftActions={[
                { key: 'pin', label: item.isPinned ? 'Unpin' : 'Pin', icon: item.isPinned ? 'pin-outline' : 'pin', color: colors.accent, onPress: () => run(() => services.updateItem(item.id, { isPinned: !item.isPinned }), item.isPinned ? 'Unpinned' : 'Pinned to top') },
              ]}
              rightActions={[
                ...(services.vault.supported ? [{ key: 'vault', label: 'Vault', icon: 'lock-closed' as const, color: '#7C3AED', onPress: () => run(() => services.vault.makeSecret(item.id), 'Moved to secret vault 🔒') }] : []),
                { key: 'delete', label: 'Delete', icon: 'trash', color: colors.danger, onPress: () => confirmDelete(item) },
              ]}
            >
              <ItemCard item={item} index={index} thumbnailUri={thumb(item)} onPress={() => open(item)} onToggleFavorite={() => toggleFavorite(item)} />
            </SwipeRow>
          </View>
        )}
      />
    );
  }

  return (
    <View testID="home-screen" style={[styles.fill, { backgroundColor: colors.background }]}>
      {body}
      <FabMenu actions={fabActions} />
      {busy ? (
        <View style={[styles.busy, { backgroundColor: colors.overlay }]} accessibilityLiveRegion="polite">
          <View style={[styles.busyBox, { backgroundColor: colors.surface }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[font.body, { color: colors.text }]}>{busy}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Separator() {
  return <View style={{ height: spacing.sm + 2 }} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, borderRadius: radius.md, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 56, justifyContent: 'center' },
  statNum: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingLeft: spacing.md, minHeight: 50, marginTop: spacing.lg },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  smartRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: spacing.sm },
  smartChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  viewToggle: { flexDirection: 'row', borderRadius: radius.md, padding: 2 },
  toggleBtn: { width: 40, height: 36, borderRadius: 10 },
  masonry: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  footer: { textAlign: 'center', margin: spacing.lg },
  busy: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  busyBox: { flexDirection: 'row', gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, alignItems: 'center' },
});
