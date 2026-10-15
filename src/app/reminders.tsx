import { useRouter } from 'expo-router';
import { useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { ReminderSheet } from '../components/ReminderSheet';
import { Button, EmptyState, ErrorView, Icon, IconButton, LoadingView } from '../components/ui';
import type { ReminderWithItem } from '../db/types';
import { formatDateTime } from '../lib/dates';
import { useNow } from '../lib/useNow';
import { openAppSettings } from '../services/itemActions';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, spacing } from '../theme/theme';

export default function RemindersScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<ReminderWithItem | null>(null);
  const reminders = useLiveQuery(() => services.repo.listReminders(), []);
  const permission = useLiveQuery(() => services.notifier.getPermission(), []);
  const now = useNow();

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) dialog.toast(ok);
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    }
  };

  if (reminders.loading && !reminders.data) return <LoadingView />;
  if (reminders.error) return <ErrorView message={errorMessage(reminders.error)} onRetry={reminders.reload} />;

  const all = reminders.data ?? [];
  const upcoming = all.filter((r) => r.status === 'scheduled');
  const past = all.filter((r) => r.status !== 'scheduled').reverse().slice(0, 50);
  const sections = [
    ...(upcoming.length ? [{ title: 'Upcoming', data: upcoming }] : []),
    ...(past.length ? [{ title: 'Done & cancelled', data: past }] : []),
  ];
  const notificationsOff = services.notifier.supported && permission.data && permission.data !== 'granted' && upcoming.length > 0;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          notificationsOff ? (
            <View testID="notifications-off" style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
              <Icon name="notifications-off-outline" color={colors.warning} />
              <Text style={[font.small, { color: colors.warning, flex: 1 }]}>
                Notifications are off. Reminders still appear here, but you won’t be alerted.
              </Text>
              <Button
                label="Enable"
                compact
                variant="secondary"
                onPress={async () => {
                  const state = await services.notifier.requestPermission();
                  if (state === 'granted') {
                    const n = await services.resyncNotifications();
                    dialog.toast(`Notifications enabled for ${n} reminder${n === 1 ? '' : 's'}`);
                  } else {
                    await openAppSettings();
                  }
                  permission.reload();
                }}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState icon="alarm-outline" title="No reminders" message="Open any saved item and tap Add under Reminders." />
        }
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textMuted }]}>
            {section.title.toUpperCase()}
          </Text>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item: r }) => {
          const done = r.status !== 'scheduled';
          const overdue = !done && r.remindAt < now;
          return (
            <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  onPress={() => router.push({ pathname: '/item/[id]', params: { id: r.itemId } })}
                  accessibilityRole="link"
                  style={[font.body, { color: done ? colors.textFaint : colors.text, fontWeight: '600' }]}
                  numberOfLines={1}
                >
                  {r.itemTitle}
                </Text>
                <Text style={[font.small, { color: overdue ? colors.warning : colors.textMuted }]}>
                  {formatDateTime(r.remindAt)}
                  {overdue ? ' · Overdue' : done ? (r.status === 'completed' ? ' · Done' : ' · Cancelled') : ''}
                </Text>
              </View>
              {!done ? (
                <>
                  <IconButton icon="create-outline" label="Change time" onPress={() => setEditing(r)} />
                  <IconButton icon="checkmark" label="Mark done" color={colors.success} onPress={() => run(() => services.completeReminder(r.id), 'Marked as done')} />
                  <IconButton icon="close" label="Cancel reminder" color={colors.textMuted} onPress={() => run(() => services.cancelReminder(r.id), 'Reminder cancelled')} />
                </>
              ) : (
                <IconButton icon="trash-outline" label="Delete reminder" color={colors.textFaint} onPress={() => run(() => services.deleteReminder(r.id))} />
              )}
            </View>
          );
        }}
      />
      <ReminderSheet
        visible={!!editing}
        title="Change reminder"
        initial={editing?.remindAt}
        onClose={() => setEditing(null)}
        onPick={(at) => editing && run(() => services.rescheduleReminder(editing.id, at), `Moved to ${formatDateTime(at)}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: spacing.lg, flexGrow: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
});
