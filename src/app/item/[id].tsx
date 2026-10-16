import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../../app-state/AppContext';
import { AudioPlayer } from '../../components/AudioPlayer';
import { CollectionPicker } from '../../components/CollectionPicker';
import { ColorPicker } from '../../components/ColorPicker';
import { errorMessage, useDialog } from '../../components/DialogProvider';
import { itemDisplayTitle, TYPE_ICON, TYPE_LABEL } from '../../components/ItemCard';
import { GradientIcon, PressableScale } from '../../components/motion';
import { NoteView } from '../../components/NoteView';
import { ReminderSheet } from '../../components/ReminderSheet';
import { SmartActions } from '../../components/SmartActions';
import { TagEditor } from '../../components/TagEditor';
import { Badge, Button, Card, EmptyState, Icon, IconButton, LoadingView, SectionTitle } from '../../components/ui';
import type { Attachment, ItemWithRelations, Reminder } from '../../db/types';
import { formatDateTime } from '../../lib/dates';
import { haptic } from '../../lib/haptics';
import { readingMinutes } from '../../lib/links';
import { formatBytes, hostnameOf, isImageMime } from '../../lib/text';
import { useNow } from '../../lib/useNow';
import { attachmentPath } from '../../services/fileStore';
import { copyItem, copyText, openAppSettings, openAttachment, openUrl, shareItem } from '../../services/itemActions';
import { useTheme } from '../../theme/ThemeProvider';
import { cardShadow, font, radius, spacing, TYPE_GRADIENT } from '../../theme/theme';

const HERO = 300;

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [reminderSheet, setReminderSheet] = useState<{ editing?: Reminder } | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const now = useNow();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const item = useLiveQuery<ItemWithRelations | null>(async () => {
    const raw = await services.repo.getItemWithRelations(id);
    return raw?.isSecret ? services.vault.getSecretItem(id) : raw;
  }, [id]);
  const reminders = useLiveQuery(() => services.repo.listRemindersForItem(id), [id]);
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const allTags = useLiveQuery(() => services.repo.listTags(), []);
  const files = useLiveQuery(async () => {
    const result: Record<string, { exists: boolean; uri: string | null }> = {};
    for (const a of item.data?.attachments ?? []) {
      const exists = services.files.supported && (await services.files.exists(attachmentPath(a.fileName)));
      let uri: string | null = null;
      if (exists) uri = a.encrypted ? await services.vault.viewableUri(a).catch(() => null) : services.files.uri(attachmentPath(a.fileName));
      result[a.id] = { exists, uri };
    }
    return result;
  }, [item.data?.attachments.map((a) => `${a.id}:${a.fileName}`).join(',')]);

  const heroStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [-HERO, 0, HERO], [-HERO / 2, 0, HERO * 0.6]) },
      { scale: interpolate(scrollY.value, [-HERO, 0], [1.6, 1], 'clamp') },
    ],
  }));

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) {
        haptic.success();
        dialog.toast(success);
      }
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  if (item.loading && !item.data) return <LoadingView />;
  const data = item.data;
  if (!data) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="trash-outline" title="Item not found" message="It may have been deleted." action={<Button label="Back to library" onPress={() => router.replace('/')} />} />
      </View>
    );
  }

  const title = itemDisplayTitle(data);
  const fileInfo = (a: Attachment) => files.data?.[a.id];
  const images = data.attachments.filter((a) => isImageMime(a.mimeType, a.originalName));
  const pages = images.filter((a) => a.role === 'page');
  const heroAtt = images.find((a) => a.role === 'file') ?? pages[0] ?? images.find((a) => a.role === 'preview');
  const heroUri = heroAtt ? fileInfo(heroAtt)?.uri ?? null : null;
  const audio = data.attachments.find((a) => a.role === 'audio');
  const mainFile = data.attachments.find((a) => a.role === 'file') ?? audio;
  const otherFiles = data.attachments.filter((a) => a.role === 'file' && !isImageMime(a.mimeType, a.originalName));
  const scheduled = (reminders.data ?? []).filter((r) => r.status === 'scheduled');
  const past = (reminders.data ?? []).filter((r) => r.status !== 'scheduled');
  const g = TYPE_GRADIENT[data.type];

  const saveNote = (note: string) =>
    run(() => (data.isSecret ? services.vault.updateSecret(data.id, { note }) : services.updateItem(data.id, { note })));

  const confirmDelete = async () => {
    const ok = await dialog.confirm({
      title: 'Delete this item?',
      message: 'It will be removed from this device along with its files and reminders. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await services.deleteItem(data.id);
      haptic.warning();
      dialog.toast('Item deleted');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const addOrEditReminder = async (at: number, editing?: Reminder) => {
    try {
      if (!editing && services.notifier.supported) {
        const permission = await services.notifier.requestPermission();
        if (permission !== 'granted') {
          await services.addReminder(data.id, at);
          const open = await dialog.confirm({
            title: 'Notifications are off',
            message: 'The reminder is saved and will appear in Reminders, but PocketVault cannot alert you. You can allow notifications in system settings.',
            confirmLabel: 'Open settings',
            cancelLabel: 'Not now',
          });
          if (open) await openAppSettings();
          return;
        }
      }
      const result = editing ? await services.rescheduleReminder(editing.id, at) : await services.addReminder(data.id, at);
      haptic.success();
      dialog.toast(result.notificationScheduled || !services.notifier.supported ? `Reminder set for ${formatDateTime(at)}` : `Reminder saved for ${formatDateTime(at)} (no notification)`);
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const toggleVault = async () => {
    if (data.isSecret) {
      await run(() => services.vault.revealSecret(data.id), 'Moved out of the vault');
      return;
    }
    const ok = await dialog.confirm({
      title: 'Move to secret vault?',
      message: 'The item will be encrypted, hidden from your library and search, and only visible after unlocking the vault.',
      confirmLabel: 'Move to vault',
    });
    if (!ok) return;
    await run(async () => {
      await services.vault.makeSecret(data.id);
      if (router.canGoBack()) router.back();
    }, 'Locked away in your vault 🔒');
  };

  const openMain = () => {
    if (data.url) return run(() => openUrl(data.url!));
    if (mainFile) return run(() => openAttachment(services.files, mainFile, fileInfo(mainFile)?.uri ?? undefined));
  };
  const canOpen = !!data.url || (!!mainFile && !!fileInfo(mainFile)?.exists);
  const shareAtt = mainFile && fileInfo(mainFile)?.exists ? mainFile : undefined;

  const actions: { key: string; icon: Parameters<typeof Icon>[0]['name']; label: string; onPress: () => void; active?: boolean; testID?: string }[] = [
    ...(canOpen ? [{ key: 'open', icon: 'open-outline' as const, label: data.url ? 'Open' : 'Open file', onPress: openMain, testID: 'action-open' }] : []),
    { key: 'copy', icon: 'copy-outline', label: 'Copy', onPress: () => run(() => copyItem(data), 'Copied to clipboard'), testID: 'action-copy' },
    { key: 'share', icon: 'share-social-outline', label: 'Share', onPress: () => run(() => shareItem(services.files, data, shareAtt, shareAtt ? fileInfo(shareAtt)?.uri ?? undefined : undefined)), testID: 'action-share' },
    ...(!data.isSecret ? [{ key: 'pin', icon: data.isPinned ? ('pin' as const) : ('pin-outline' as const), label: data.isPinned ? 'Pinned' : 'Pin', active: data.isPinned, onPress: () => run(() => services.updateItem(data.id, { isPinned: !data.isPinned }), data.isPinned ? 'Unpinned' : 'Pinned to top'), testID: 'action-pin' }] : []),
    { key: 'remind', icon: 'alarm-outline', label: 'Remind', onPress: () => setReminderSheet({}), testID: 'action-remind' },
    ...(services.vault.supported ? [{ key: 'vault', icon: data.isSecret ? ('lock-open-outline' as const) : ('lock-closed-outline' as const), label: data.isSecret ? 'Unlock' : 'Vault', onPress: toggleVault, testID: 'action-vault' }] : []),
  ];

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: '',
          headerTransparent: true,
          headerTintColor: heroUri ? '#FFFFFF' : colors.onGradient,
          headerStyle: { backgroundColor: 'transparent' },
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton testID="detail-favorite" icon={data.isFavorite ? 'star' : 'star-outline'} color={data.isFavorite ? colors.favorite : '#FFFFFF'} label={data.isFavorite ? 'Remove from favorites' : 'Add to favorites'} onPress={() => { haptic.light(); run(() => services.updateItem(data.id, { isFavorite: !data.isFavorite })); }} style={styles.headerBtn} />
              <IconButton testID="detail-edit" icon="create-outline" label="Edit" color="#FFFFFF" onPress={() => router.push({ pathname: '/edit', params: { id: data.id } })} style={styles.headerBtn} />
              <IconButton testID="detail-delete" icon="trash-outline" label="Delete" color="#FFFFFF" onPress={confirmDelete} style={styles.headerBtn} />
            </View>
          ),
        }}
      />
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }} keyboardShouldPersistTaps="handled">
        {/* Hero */}
        <View style={{ height: heroUri ? HERO : 170 + insets.top, overflow: 'hidden' }}>
          <Animated.View style={[StyleSheet.absoluteFill, heroStyle]}>
            {heroUri ? (
              <Pressable style={StyleSheet.absoluteFill} accessibilityRole="imagebutton" accessibilityLabel="Open image" onPress={() => heroAtt && run(() => openAttachment(services.files, heroAtt, heroUri))}>
                <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
              </Pressable>
            ) : (
              <LinearGradient colors={data.isSecret ? ['#1E1B4B', '#4C1D95'] : [g[0], g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
          </Animated.View>
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.45)', 'transparent', 'rgba(0,0,0,0.25)']} style={StyleSheet.absoluteFill} />
          {!heroUri ? (
            <Animated.View entering={FadeIn.delay(100)} style={[styles.heroIcon, { top: insets.top + 60 }]}>
              <Ionicons name={data.isSecret ? 'lock-closed' : TYPE_ICON[data.type]} size={46} color="rgba(255,255,255,0.9)" />
            </Animated.View>
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <Animated.View entering={FadeInDown.springify().damping(18)} style={{ gap: spacing.md }}>
            <View style={styles.badgeRow}>
              <View style={[styles.typeBadge, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name={TYPE_ICON[data.type]} size={12} color={colors.primary} />
                <Text style={[styles.typeBadgeText, { color: colors.primary }]}>{TYPE_LABEL[data.type].toUpperCase()}</Text>
              </View>
              {data.isSecret ? (
                <View testID="secret-badge" style={[styles.typeBadge, { backgroundColor: '#EDE9FE' }]}>
                  <Ionicons name="lock-closed" size={12} color="#6D28D9" />
                  <Text style={[styles.typeBadgeText, { color: '#6D28D9' }]}>SECRET · ENCRYPTED</Text>
                </View>
              ) : null}
              {data.isPinned ? <Ionicons name="pin" size={16} color={colors.accent} /> : null}
            </View>
            <Text testID="detail-title" accessibilityRole="header" style={[font.title, { color: colors.text }]} selectable>
              {title}
            </Text>
            {data.url ? (
              <Pressable accessibilityRole="link" onPress={() => run(() => openUrl(data.url!))} onLongPress={() => run(() => copyText(data.url!), 'Link copied')} style={styles.urlRow}>
                <Ionicons name="globe-outline" size={15} color={colors.primary} />
                <Text style={[font.small, { color: colors.primary, flex: 1 }]} numberOfLines={2}>
                  {data.previewSite ? `${data.previewSite} · ` : ''}
                  {data.url}
                </Text>
              </Pressable>
            ) : null}

            {/* Action bar */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionBar}>
              {actions.map((a) => (
                <PressableScale key={a.key} testID={a.testID} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.onPress} hapticOnPress style={styles.actionItem}>
                  <View style={[styles.actionIcon, { backgroundColor: a.active ? colors.accent : colors.elevated }, cardShadow(colors, 'sm')]}>
                    <Ionicons name={a.icon} size={22} color={a.active ? '#FFFFFF' : colors.primary} />
                  </View>
                  <Text style={[styles.actionLabel, { color: colors.textMuted }]}>{a.label}</Text>
                </PressableScale>
              ))}
            </ScrollView>
          </Animated.View>

          {!data.isSecret ? (
            <SmartActions facts={data.facts} onRemindAt={(at) => addOrEditReminder(at)} onError={(m) => dialog.toast(m, 'error')} />
          ) : null}

          {audio && fileInfo(audio)?.uri ? <AudioPlayer uri={fileInfo(audio)!.uri!} durationMs={audio.durationMs} seed={data.id} /> : null}
          {audio && files.data && !fileInfo(audio)?.exists ? <MissingFile attachment={audio} /> : null}

          {data.type === 'link' ? <LinkPreviewCard item={data} onRetry={() => run(() => services.previews.retry(data.id))} onRead={() => router.push({ pathname: '/reader', params: { id: data.id } })} /> : null}

          {data.note ? (
            <Card>
              <NoteView note={data.note} onChange={saveNote} />
            </Card>
          ) : null}

          {pages.length > 1 ? (
            <>
              <SectionTitle>{`${pages.length} pages`}</SectionTitle>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}>
                {pages.map((p, i) => (
                  <PressableScale key={p.id} accessibilityRole="imagebutton" accessibilityLabel={`Open page ${i + 1}`} onPress={() => run(() => openAttachment(services.files, p, fileInfo(p)?.uri ?? undefined))}>
                    {fileInfo(p)?.uri ? <Image source={{ uri: fileInfo(p)!.uri! }} style={[styles.page, { backgroundColor: colors.surfaceAlt }]} contentFit="cover" /> : <View style={[styles.page, { backgroundColor: colors.surfaceAlt }]} />}
                    <Text style={[font.small, { color: colors.textMuted, textAlign: 'center', marginTop: 4 }]}>Page {i + 1}</Text>
                  </PressableScale>
                ))}
              </ScrollView>
            </>
          ) : null}

          {otherFiles.length ? (
            <>
              <SectionTitle>Files</SectionTitle>
              {otherFiles.map((a) =>
                files.data && !fileInfo(a)?.exists ? (
                  <MissingFile key={a.id} attachment={a} />
                ) : (
                  <Card key={a.id} onPress={() => run(() => openAttachment(services.files, a, fileInfo(a)?.uri ?? undefined))} accessibilityLabel={`Open ${a.originalName}`}>
                    <View style={styles.fileRow}>
                      <GradientIcon icon={a.mimeType === 'application/pdf' ? 'document-text' : 'document'} colors={TYPE_GRADIENT.document} size={40} />
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
                          {a.originalName}
                        </Text>
                        <Text style={[font.small, { color: colors.textMuted }]}>
                          {formatBytes(a.size)} · {a.mimeType}
                        </Text>
                      </View>
                      <Icon name="open-outline" size={18} color={colors.textFaint} />
                    </View>
                  </Card>
                ),
              )}
            </>
          ) : null}
          {heroAtt && files.data && !fileInfo(heroAtt)?.exists ? <MissingFile attachment={heroAtt} /> : null}

          {data.type === 'image' || (data.type === 'document' && pages.length) ? (
            <>
              <SectionTitle
                action={
                  !data.isSecret && (data.ocrStatus === 'failed' || data.ocrStatus === 'done') ? (
                    <Button testID="ocr-retry" label={data.ocrStatus === 'failed' ? 'Retry' : 'Read again'} variant="ghost" compact icon="refresh" onPress={() => run(() => services.retryOcr(data.id))} />
                  ) : undefined
                }
              >
                {data.type === 'image' ? 'Text in image' : 'Scanned text'}
              </SectionTitle>
              <OcrSection status={data.ocrStatus} error={data.ocrError} text={data.contentText} supported={services.ocr.supported} />
            </>
          ) : data.type === 'document' && data.contentText ? (
            <>
              <SectionTitle>Document text</SectionTitle>
              <Card>
                <Text style={[font.small, { color: colors.textMuted }]} numberOfLines={12} selectable>
                  {data.contentText}
                </Text>
              </Card>
            </>
          ) : data.type === 'audio' && data.contentText ? (
            <>
              <SectionTitle>Transcript</SectionTitle>
              <Card>
                <Text testID="transcript" style={[font.body, { color: colors.text }]} selectable>
                  {data.contentText}
                </Text>
              </Card>
            </>
          ) : null}

          <SectionTitle>Organize</SectionTitle>
          {!data.isSecret ? (
            <CollectionPicker
              collections={collections.data ?? []}
              value={data.collectionId}
              onChange={(collectionId) => run(() => services.updateItem(data.id, { collectionId }))}
              onCreate={async () => {
                const name = await dialog.prompt({ title: 'New collection', placeholder: 'e.g. Recipes', confirmLabel: 'Create' });
                if (!name) return;
                await run(async () => {
                  const c = await services.repo.createCollection(name);
                  await services.updateItem(data.id, { collectionId: c.id });
                });
              }}
            />
          ) : null}
          {showColors ? (
            <ColorPicker value={data.color} onChange={(color) => run(() => services.updateItem(data.id, { color }))} />
          ) : (
            <Button testID="show-colors" label={data.color ? 'Change colour label' : 'Add colour label'} variant="ghost" compact icon="color-palette-outline" onPress={() => setShowColors(true)} style={{ alignSelf: 'flex-start' }} />
          )}
          {editingTags ? (
            <View style={{ gap: spacing.sm }}>
              <TagEditor value={data.tags.map((t) => t.name)} onChange={(names) => run(() => services.setTags(data.id, names))} allTags={allTags.data ?? []} />
              <Button label="Done" variant="secondary" compact onPress={() => setEditingTags(false)} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Tags</Text>
              <View style={styles.tagRow}>
                {data.tags.map((t) => (
                  <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`Show items tagged ${t.name}`} onPress={() => router.navigate({ pathname: '/', params: { tag: t.id, collection: '' } })} style={[styles.tag, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[font.small, { color: colors.primary, fontWeight: '700' }]}>#{t.name}</Text>
                  </Pressable>
                ))}
                <Button testID="edit-tags" label={data.tags.length ? 'Edit tags' : 'Add tags'} variant="ghost" compact icon="pricetag-outline" onPress={() => setEditingTags(true)} />
              </View>
            </View>
          )}

          <SectionTitle action={<Button testID="add-reminder" label="Add" icon="add" variant="ghost" compact onPress={() => setReminderSheet({})} />}>Reminders</SectionTitle>
          {scheduled.length === 0 && past.length === 0 ? <Text style={[font.small, { color: colors.textFaint }]}>No reminders. Add one to get notified later.</Text> : null}
          {scheduled.map((r) => (
            <ReminderRow key={r.id} reminder={r} now={now} onEdit={() => setReminderSheet({ editing: r })} onComplete={() => run(() => services.completeReminder(r.id), 'Marked as done')} onCancel={() => run(() => services.cancelReminder(r.id), 'Reminder cancelled')} />
          ))}
          {past.slice(0, 5).map((r) => (
            <ReminderRow key={r.id} reminder={r} now={now} onDelete={() => run(() => services.deleteReminder(r.id))} />
          ))}

          <Text style={[font.small, styles.meta, { color: colors.textFaint }]}>
            Saved {formatDateTime(data.createdAt)}
            {data.updatedAt !== data.createdAt ? ` · Edited ${formatDateTime(data.updatedAt)}` : ''}
            {data.source === 'share' ? ' · Shared from another app' : data.source === 'import' ? ' · Imported' : ''}
          </Text>
        </View>
      </Animated.ScrollView>
      <ReminderSheet
        visible={!!reminderSheet}
        title={reminderSheet?.editing ? 'Change reminder' : 'Remind me'}
        initial={reminderSheet?.editing?.remindAt}
        onClose={() => setReminderSheet(null)}
        onPick={(at) => addOrEditReminder(at, reminderSheet?.editing)}
      />
    </View>
  );
}

function LinkPreviewCard({ item, onRetry, onRead }: { item: ItemWithRelations; onRetry: () => void; onRead: () => void }) {
  const { colors } = useTheme();
  if (item.previewStatus === 'pending') {
    return (
      <View testID="preview-pending" style={[styles.previewInfo, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="sparkles" size={16} color={colors.primary} />
        <Text style={[font.small, { color: colors.primary, flex: 1 }]}>{Platform.OS === 'web' ? 'Link previews are created in the Android app.' : 'Fetching a rich preview when you are online…'}</Text>
      </View>
    );
  }
  if (item.previewStatus === 'failed') {
    return (
      <View testID="preview-failed" style={[styles.previewInfo, { backgroundColor: colors.warningSoft }]}>
        <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
        <Text style={[font.small, { color: colors.warning, flex: 1 }]}>Couldn’t load a preview for this link.</Text>
        <Button label="Retry" compact variant="ghost" onPress={onRetry} testID="preview-retry" />
      </View>
    );
  }
  if (item.previewStatus !== 'done') return null;
  return (
    <Card>
      <View style={{ gap: 6 }}>
        {item.previewSite || hostnameOf(item.url) ? <Text style={[styles.label, { color: colors.textFaint }]}>{(item.previewSite || hostnameOf(item.url)).toUpperCase()}</Text> : null}
        {item.previewDescription ? (
          <Text style={[font.body, { color: colors.textMuted }]} numberOfLines={4}>
            {item.previewDescription}
          </Text>
        ) : null}
        {item.readerText ? (
          <Button testID="read-offline" label={`Read offline · ${readingMinutes(item.readerText)} min`} icon="book-outline" variant="secondary" compact onPress={onRead} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        ) : null}
      </View>
    </Card>
  );
}

function MissingFile({ attachment }: { attachment: Attachment }) {
  const { colors } = useTheme();
  return (
    <View testID="missing-file" style={[styles.missing, { backgroundColor: colors.warningSoft }]}>
      <Icon name="warning-outline" color={colors.warning} />
      <Text style={[font.small, { color: colors.warning, flex: 1 }]}>“{attachment.originalName}” is missing from this device. The rest of the item is still available.</Text>
    </View>
  );
}

function OcrSection({ status, error, text, supported }: { status: string; error: string | null; text: string; supported: boolean }) {
  const { colors } = useTheme();
  if (!supported) return <Text style={[font.small, { color: colors.textFaint }]}>Text recognition is available in the Android app.</Text>;
  if (status === 'pending' || status === 'processing') {
    return (
      <View testID="ocr-processing" style={styles.fileRow}>
        <Badge label="✨ READING TEXT…" />
      </View>
    );
  }
  if (status === 'failed') {
    return (
      <View testID="ocr-failed" style={[styles.missing, { backgroundColor: colors.dangerSoft }]}>
        <Icon name="alert-circle-outline" color={colors.danger} />
        <Text style={[font.small, { color: colors.danger, flex: 1 }]}>Couldn’t read text: {error ?? 'Unknown error'}</Text>
      </View>
    );
  }
  if (status === 'done' && !text) return <Text style={[font.small, { color: colors.textFaint }]}>No text found.</Text>;
  if (!text) return null;
  return (
    <Card>
      <Text testID="ocr-text" style={[font.small, { color: colors.text }]} selectable>
        {text}
      </Text>
    </Card>
  );
}

function ReminderRow({ reminder, now, onEdit, onComplete, onCancel, onDelete }: { reminder: Reminder; now: number; onEdit?: () => void; onComplete?: () => void; onCancel?: () => void; onDelete?: () => void }) {
  const { colors } = useTheme();
  const overdue = reminder.status === 'scheduled' && reminder.remindAt < now;
  const done = reminder.status !== 'scheduled';
  return (
    <View testID={`reminder-${reminder.status}`} style={[styles.reminder, { backgroundColor: colors.elevated }, cardShadow(colors, 'sm')]}>
      <Icon name={done ? (reminder.status === 'completed' ? 'checkmark-circle' : 'close-circle-outline') : 'alarm'} color={done ? colors.textFaint : overdue ? colors.warning : colors.primary} />
      <Pressable style={{ flex: 1 }} onPress={onEdit} disabled={!onEdit} accessibilityRole={onEdit ? 'button' : undefined} accessibilityLabel={`Reminder ${formatDateTime(reminder.remindAt)}${onEdit ? ', tap to change' : ''}`}>
        <Text style={[font.body, { color: done ? colors.textFaint : colors.text, fontWeight: '600', textDecorationLine: done ? 'line-through' : 'none' }]}>{formatDateTime(reminder.remindAt)}</Text>
        {overdue ? <Text style={[font.small, { color: colors.warning }]}>Overdue</Text> : null}
        {done ? <Text style={[font.small, { color: colors.textFaint }]}>{reminder.status === 'completed' ? 'Done' : 'Cancelled'}</Text> : null}
      </Pressable>
      {onComplete ? <IconButton testID="reminder-complete" icon="checkmark" label="Mark reminder done" color={colors.success} onPress={onComplete} /> : null}
      {onCancel ? <IconButton testID="reminder-cancel" icon="close" label="Cancel reminder" color={colors.textMuted} onPress={onCancel} /> : null}
      {onDelete ? <IconButton icon="trash-outline" label="Delete reminder" color={colors.textFaint} onPress={onDelete} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerBtn: { backgroundColor: 'rgba(0,0,0,0.25)', width: 42, height: 42, borderRadius: 21 },
  heroIcon: { position: 'absolute', left: spacing.xl },
  sheet: { marginTop: -28, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  typeBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  urlRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  actionBar: { gap: spacing.md, paddingVertical: spacing.sm, paddingRight: spacing.lg },
  actionItem: { alignItems: 'center', gap: 6, width: 64 },
  actionIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 12, fontWeight: '600' },
  previewInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  page: { width: 110, height: 150, borderRadius: radius.md },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tag: { paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.pill, justifyContent: 'center' },
  missing: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.md, borderRadius: radius.md, minHeight: 58 },
  meta: { marginTop: spacing.xl, textAlign: 'center' },
});
