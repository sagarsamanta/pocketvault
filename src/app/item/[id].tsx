import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../../app-state/AppContext';
import { CollectionPicker } from '../../components/CollectionPicker';
import { errorMessage, useDialog } from '../../components/DialogProvider';
import { itemDisplayTitle } from '../../components/ItemCard';
import { ReminderSheet } from '../../components/ReminderSheet';
import { TagEditor } from '../../components/TagEditor';
import { Badge, Button, Card, EmptyState, Icon, IconButton, LoadingView, SectionTitle } from '../../components/ui';
import type { Attachment, Reminder } from '../../db/types';
import { formatDateTime } from '../../lib/dates';
import { formatBytes, hostnameOf, isImageMime } from '../../lib/text';
import { useNow } from '../../lib/useNow';
import { attachmentPath } from '../../services/fileStore';
import { copyItem, copyText, openAppSettings, openAttachment, openUrl, shareItem } from '../../services/itemActions';
import { useTheme } from '../../theme/ThemeProvider';
import { font, radius, spacing } from '../../theme/theme';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [reminderSheet, setReminderSheet] = useState<{ editing?: Reminder } | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const now = useNow();

  const item = useLiveQuery(() => services.repo.getItemWithRelations(id), [id]);
  const reminders = useLiveQuery(() => services.repo.listRemindersForItem(id), [id]);
  const collections = useLiveQuery(() => services.repo.listCollections(), []);
  const allTags = useLiveQuery(() => services.repo.listTags(), []);
  const fileStatus = useLiveQuery(async () => {
    const result: Record<string, boolean> = {};
    for (const a of item.data?.attachments ?? []) {
      result[a.id] = services.files.supported && (await services.files.exists(attachmentPath(a.fileName)));
    }
    return result;
  }, [item.data?.attachments.map((a) => a.id).join(',')]);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) dialog.toast(success);
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
        <EmptyState
          icon="trash-outline"
          title="Item not found"
          message="It may have been deleted."
          action={<Button label="Back to library" onPress={() => router.replace('/')} />}
        />
      </View>
    );
  }

  const title = itemDisplayTitle(data);
  const image = data.attachments.find((a) => isImageMime(a.mimeType, a.originalName));
  const imageAvailable = image && fileStatus.data?.[image.id];
  const primaryAttachment = data.attachments[0];

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
      dialog.toast('Item deleted');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const addOrEditReminder = async (at: number) => {
    try {
      const editing = reminderSheet?.editing;
      if (!editing && services.notifier.supported) {
        const permission = await services.notifier.requestPermission();
        if (permission !== 'granted') {
          await services.addReminder(data.id, at);
          const open = await dialog.confirm({
            title: 'Notifications are off',
            message:
              'The reminder is saved and will appear in Reminders, but Stash cannot alert you. You can allow notifications in system settings.',
            confirmLabel: 'Open settings',
            cancelLabel: 'Not now',
          });
          if (open) await openAppSettings();
          return;
        }
      }
      const result = editing
        ? await services.rescheduleReminder(editing.id, at)
        : await services.addReminder(data.id, at);
      dialog.toast(
        result.notificationScheduled || !services.notifier.supported
          ? `Reminder set for ${formatDateTime(at)}`
          : `Reminder saved for ${formatDateTime(at)} (no notification)`,
      );
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  const openPrimary = () => {
    if (data.url) return run(() => openUrl(data.url!));
    if (primaryAttachment) return run(() => openAttachment(services.files, primaryAttachment));
  };

  const canOpen = !!data.url || (!!primaryAttachment && services.files.supported && fileStatus.data?.[primaryAttachment.id]);
  const scheduled = (reminders.data ?? []).filter((r) => r.status === 'scheduled');
  const past = (reminders.data ?? []).filter((r) => r.status !== 'scheduled');

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={styles.headerActions}>
              <IconButton
                testID="detail-favorite"
                icon={data.isFavorite ? 'star' : 'star-outline'}
                color={data.isFavorite ? colors.favorite : colors.text}
                label={data.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onPress={() => run(() => services.updateItem(data.id, { isFavorite: !data.isFavorite }))}
              />
              <IconButton
                testID="detail-edit"
                icon="create-outline"
                label="Edit"
                onPress={() => router.push({ pathname: '/edit', params: { id: data.id } })}
              />
              <IconButton testID="detail-delete" icon="trash-outline" label="Delete" color={colors.danger} onPress={confirmDelete} />
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]} keyboardShouldPersistTaps="handled">
        {image ? (
          imageAvailable ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open image ${image.originalName}`}
              onPress={() => run(() => openAttachment(services.files, image))}
            >
              <Image
                source={{ uri: services.files.uri(attachmentPath(image.fileName)) }}
                style={[styles.hero, { backgroundColor: colors.surfaceAlt }]}
                contentFit="contain"
              />
            </Pressable>
          ) : (
            <MissingFile attachment={image} />
          )
        ) : null}

        <Text testID="detail-title" accessibilityRole="header" style={[font.title, { color: colors.text }]} selectable>
          {title}
        </Text>
        {data.url ? (
          <Pressable accessibilityRole="link" onPress={() => run(() => openUrl(data.url!))} onLongPress={() => run(() => copyText(data.url!), 'Link copied')}>
            <Text style={[font.body, { color: colors.primary }]} numberOfLines={3}>
              {data.url}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          {canOpen ? (
            <Button testID="action-open" label="Open" icon="open-outline" compact onPress={openPrimary} accessibilityLabel={data.url ? `Open ${hostnameOf(data.url)}` : 'Open file'} />
          ) : null}
          <Button testID="action-copy" label="Copy" icon="copy-outline" variant="secondary" compact onPress={() => run(() => copyItem(data), 'Copied to clipboard')} />
          <Button
            testID="action-share"
            label="Share"
            icon="share-social-outline"
            variant="secondary"
            compact
            onPress={() => run(() => shareItem(services.files, data, primaryAttachment && fileStatus.data?.[primaryAttachment.id] ? primaryAttachment : undefined))}
          />
        </View>

        {data.note ? (
          <Card>
            <Text testID="detail-note" style={[font.body, { color: colors.text }]} selectable>
              {data.note}
            </Text>
          </Card>
        ) : null}

        {data.attachments.filter((a) => a !== image).length ? (
          <>
            <SectionTitle>Files</SectionTitle>
            {data.attachments
              .filter((a) => a !== image)
              .map((a) =>
                fileStatus.data?.[a.id] === false ? (
                  <MissingFile key={a.id} attachment={a} />
                ) : (
                  <Card key={a.id} onPress={() => run(() => openAttachment(services.files, a))} accessibilityLabel={`Open ${a.originalName}`}>
                    <View style={styles.fileRow}>
                      <Icon name="document-outline" color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: colors.text, fontWeight: '500' }]} numberOfLines={1}>
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

        {data.type === 'image' ? (
          <>
            <SectionTitle
              action={
                data.ocrStatus === 'failed' || data.ocrStatus === 'done' ? (
                  <Button
                    testID="ocr-retry"
                    label={data.ocrStatus === 'failed' ? 'Retry' : 'Read again'}
                    variant="ghost"
                    compact
                    icon="refresh"
                    onPress={() => run(() => services.retryOcr(data.id))}
                  />
                ) : undefined
              }
            >
              Text in image
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
        ) : null}

        <SectionTitle>Organize</SectionTitle>
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
        {editingTags ? (
          <View style={{ gap: spacing.sm }}>
            <TagEditor
              value={data.tags.map((t) => t.name)}
              onChange={(names) => run(() => services.setTags(data.id, names))}
              allTags={allTags.data ?? []}
            />
            <Button label="Done" variant="secondary" compact onPress={() => setEditingTags(false)} style={{ alignSelf: 'flex-start' }} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Tags</Text>
            <View style={styles.tagRow}>
              {data.tags.map((t) => (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Show items tagged ${t.name}`}
                  onPress={() => router.navigate({ pathname: '/', params: { tag: t.id, collection: '' } })}
                  style={[styles.tag, { backgroundColor: colors.primarySoft }]}
                >
                  <Text style={[font.small, { color: colors.primary, fontWeight: '600' }]}>#{t.name}</Text>
                </Pressable>
              ))}
              <Button testID="edit-tags" label={data.tags.length ? 'Edit tags' : 'Add tags'} variant="ghost" compact icon="pricetag-outline" onPress={() => setEditingTags(true)} />
            </View>
          </View>
        )}

        <SectionTitle
          action={
            <Button testID="add-reminder" label="Add" icon="add" variant="ghost" compact onPress={() => setReminderSheet({})} />
          }
        >
          Reminders
        </SectionTitle>
        {scheduled.length === 0 && past.length === 0 ? (
          <Text style={[font.small, { color: colors.textFaint }]}>No reminders. Add one to get notified later.</Text>
        ) : null}
        {scheduled.map((r) => (
          <ReminderRow
            key={r.id}
            reminder={r}
            now={now}
            onEdit={() => setReminderSheet({ editing: r })}
            onComplete={() => run(() => services.completeReminder(r.id), 'Marked as done')}
            onCancel={() => run(() => services.cancelReminder(r.id), 'Reminder cancelled')}
          />
        ))}
        {past.slice(0, 5).map((r) => (
          <ReminderRow key={r.id} reminder={r} now={now} onDelete={() => run(() => services.deleteReminder(r.id))} />
        ))}

        <Text style={[font.small, styles.meta, { color: colors.textFaint }]}>
          Saved {formatDateTime(data.createdAt)}
          {data.updatedAt !== data.createdAt ? ` · Edited ${formatDateTime(data.updatedAt)}` : ''}
          {data.source === 'share' ? ' · Shared from another app' : data.source === 'import' ? ' · Imported' : ''}
        </Text>
      </ScrollView>
      <ReminderSheet
        visible={!!reminderSheet}
        title={reminderSheet?.editing ? 'Change reminder' : 'Remind me'}
        initial={reminderSheet?.editing?.remindAt}
        onClose={() => setReminderSheet(null)}
        onPick={addOrEditReminder}
      />
    </View>
  );
}

function MissingFile({ attachment }: { attachment: Attachment }) {
  const { colors } = useTheme();
  return (
    <View testID="missing-file" style={[styles.missing, { backgroundColor: colors.warningSoft }]}>
      <Icon name="warning-outline" color={colors.warning} />
      <Text style={[font.small, { color: colors.warning, flex: 1 }]}>
        “{attachment.originalName}” is missing from this device. The rest of the item is still available.
      </Text>
    </View>
  );
}

function OcrSection({
  status,
  error,
  text,
  supported,
}: {
  status: string;
  error: string | null;
  text: string;
  supported: boolean;
}) {
  const { colors } = useTheme();
  if (!supported) {
    return <Text style={[font.small, { color: colors.textFaint }]}>Text recognition is available in the Android app.</Text>;
  }
  if (status === 'pending' || status === 'processing') {
    return (
      <View testID="ocr-processing" style={styles.fileRow}>
        <Badge label="READING TEXT…" />
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
  if (status === 'done' && !text) {
    return <Text style={[font.small, { color: colors.textFaint }]}>No text found in this image.</Text>;
  }
  if (!text) return null;
  return (
    <Card>
      <Text testID="ocr-text" style={[font.small, { color: colors.text }]} selectable>
        {text}
      </Text>
    </Card>
  );
}

function ReminderRow({
  reminder,
  now,
  onEdit,
  onComplete,
  onCancel,
  onDelete,
}: {
  reminder: Reminder;
  now: number;
  onEdit?: () => void;
  onComplete?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const { colors } = useTheme();
  const overdue = reminder.status === 'scheduled' && reminder.remindAt < now;
  const done = reminder.status !== 'scheduled';
  return (
    <View testID={`reminder-${reminder.status}`} style={[styles.reminder, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Icon
        name={done ? (reminder.status === 'completed' ? 'checkmark-circle' : 'close-circle-outline') : 'alarm-outline'}
        color={done ? colors.textFaint : overdue ? colors.warning : colors.primary}
      />
      <Pressable style={{ flex: 1 }} onPress={onEdit} disabled={!onEdit} accessibilityRole={onEdit ? 'button' : undefined} accessibilityLabel={`Reminder ${formatDateTime(reminder.remindAt)}${onEdit ? ', tap to change' : ''}`}>
        <Text style={[font.body, { color: done ? colors.textFaint : colors.text, textDecorationLine: done ? 'line-through' : 'none' }]}>
          {formatDateTime(reminder.remindAt)}
        </Text>
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
  content: { padding: spacing.lg, gap: spacing.md, width: '100%', maxWidth: 760, alignSelf: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  hero: { width: '100%', height: 260, borderRadius: radius.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { fontSize: 13, fontWeight: '600' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  tag: { paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.pill, justifyContent: 'center' },
  missing: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  reminder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  meta: { marginTop: spacing.xl, textAlign: 'center' },
});
