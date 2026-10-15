import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { Group, ListRow, SectionTitle, Segmented } from '../components/ui';
import { BackupSummary, parseBackup, summarize } from '../services/backup';
import { openAppSettings, shareFile } from '../services/itemActions';
import { readExternalText, saveToPickedFolder, writeCacheFile } from '../services/nativeFileStore';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemePreference } from '../theme/theme';
import { font, spacing } from '../theme/theme';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

function describe(s: BackupSummary): string {
  const parts = [
    `${s.items} item${s.items === 1 ? '' : 's'}`,
    `${s.collections} collection${s.collections === 1 ? '' : 's'}`,
    `${s.tags} tag${s.tags === 1 ? '' : 's'}`,
    `${s.reminders} reminder${s.reminders === 1 ? '' : 's'}`,
    `${s.attachments} file${s.attachments === 1 ? '' : 's'}`,
  ];
  return parts.join(', ');
}

function backupFileName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `stash-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export default function SettingsScreen() {
  const services = useServices();
  const router = useRouter();
  const dialog = useDialog();
  const { colors, preference, setPreference } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);

  const stats = useLiveQuery(async () => {
    const [items, collections, tags, reminders] = await Promise.all([
      services.repo.countItems(),
      services.repo.listCollections(),
      services.repo.listTags(),
      services.repo.listReminders('scheduled'),
    ]);
    return { items, collections: collections.length, tags: tags.length, reminders: reminders.length };
  }, []);
  const permission = useLiveQuery(() => services.notifier.getPermission(), []);

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      dialog.toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const exportBackup = (mode: 'share' | 'save') =>
    withBusy('export', async () => {
      const { json, summary } = await services.exportBackupJson(APP_VERSION);
      const name = backupFileName();
      const missing = summary.missingFiles ? ` (${summary.missingFiles} missing file${summary.missingFiles === 1 ? '' : 's'} skipped)` : '';
      if (Platform.OS === 'web') {
        writeCacheFile(name, json);
        dialog.toast(`Backup downloaded: ${describe(summary)}${missing}`);
        return;
      }
      if (mode === 'save') {
        const saved = await saveToPickedFolder(name, 'application/json', json);
        if (saved) dialog.toast(`Backup saved${missing}`);
        return;
      }
      const uri = writeCacheFile(name, json);
      const shared = await shareFile(uri, 'application/json', 'Save Stash backup');
      if (!shared) dialog.toast('Sharing is not available — use “Save backup to a folder” instead.', 'error');
    });

  const importBackup = () =>
    withBusy('import', async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: Platform.OS === 'web' ? 'application/json' : ['application/json', 'text/plain', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const json = await readExternalText(result.assets[0].uri);
      const summary = summarize(parseBackup(json));
      const ok = await dialog.confirm({
        title: 'Restore this backup?',
        message: `This backup contains ${describe(summary)}. Restoring replaces everything currently in Stash on this device.`,
        confirmLabel: 'Restore',
        destructive: true,
      });
      if (!ok) return;
      const restored = await services.restoreBackupJson(json);
      dialog.toast(
        `Restored ${describe(restored)}${restored.missingFiles ? `. ${restored.missingFiles} file(s) were missing from the backup.` : ''}`,
      );
    });

  const eraseAll = async () => {
    const ok = await dialog.confirm({
      title: 'Erase all data?',
      message: 'Every item, file, collection, tag and reminder will be permanently deleted from this device. Export a backup first if you might need them.',
      confirmLabel: 'Erase everything',
      destructive: true,
      requireText: 'ERASE',
    });
    if (!ok) return;
    await withBusy('erase', async () => {
      await services.eraseAllData();
      dialog.toast('All data erased');
    });
  };

  const enableNotifications = async () => {
    const state = await services.notifier.requestPermission();
    if (state === 'granted') {
      const n = await services.resyncNotifications();
      dialog.toast(n ? `Notifications on — ${n} reminder${n === 1 ? '' : 's'} scheduled` : 'Notifications on');
    } else {
      await openAppSettings();
    }
    permission.reload();
  };

  const notificationSubtitle = !services.notifier.supported
    ? 'Available in the Android app'
    : permission.data === 'granted'
      ? 'Allowed — reminders will alert you'
      : permission.data === 'denied'
        ? 'Blocked — tap to open system settings'
        : 'Not yet allowed — tap to enable';

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
    >
      <SectionTitle>Appearance</SectionTitle>
      <Segmented<ThemePreference>
        testIDPrefix="theme"
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
          { value: 'light', label: 'Light', icon: 'sunny-outline' },
          { value: 'dark', label: 'Dark', icon: 'moon-outline' },
        ]}
      />

      <SectionTitle>Organize</SectionTitle>
      <Group>
        <ListRow testID="nav-collections" icon="folder-outline" title="Collections" subtitle={stats.data ? `${stats.data.collections}` : undefined} onPress={() => router.push('/collections')} />
        <Divider />
        <ListRow testID="nav-tags" icon="pricetags-outline" title="Tags" subtitle={stats.data ? `${stats.data.tags}` : undefined} onPress={() => router.push('/tags')} />
        <Divider />
        <ListRow icon="alarm-outline" title="Reminders" subtitle={stats.data ? `${stats.data.reminders} upcoming` : undefined} onPress={() => router.push('/reminders')} />
      </Group>

      <SectionTitle>Notifications</SectionTitle>
      <Group>
        <ListRow
          testID="notifications-row"
          icon={permission.data === 'granted' ? 'notifications-outline' : 'notifications-off-outline'}
          title="Reminder notifications"
          subtitle={notificationSubtitle}
          onPress={services.notifier.supported && permission.data !== 'granted' ? enableNotifications : undefined}
        />
      </Group>

      <SectionTitle>Backup & restore</SectionTitle>
      <Group>
        {Platform.OS === 'web' ? (
          <ListRow testID="backup-export" icon="download-outline" title="Download backup" subtitle="Saves a .json file with your data" onPress={() => exportBackup('share')} right={busy === 'export' ? <ActivityIndicator color={colors.primary} /> : undefined} />
        ) : (
          <>
            <ListRow testID="backup-save" icon="folder-open-outline" title="Save backup to a folder" subtitle="Pick or create a folder (e.g. Download/Stash backups)" onPress={() => exportBackup('save')} right={busy === 'export' ? <ActivityIndicator color={colors.primary} /> : undefined} />
            <Divider />
            <ListRow testID="backup-share" icon="share-outline" title="Share backup" subtitle="Send it to Drive, email or another app" onPress={() => exportBackup('share')} />
          </>
        )}
        <Divider />
        <ListRow testID="backup-import" icon="cloud-upload-outline" title="Restore from backup" subtitle="Replaces the data on this device" onPress={importBackup} right={busy === 'import' ? <ActivityIndicator color={colors.primary} /> : undefined} />
      </Group>
      <Text style={[font.small, styles.hint, { color: colors.textFaint }]}>
        Backups include items, files, collections, tags, reminders and settings. Keep them somewhere safe — Stash has no cloud copy.
      </Text>

      <SectionTitle>Data</SectionTitle>
      <Group>
        <ListRow icon="server-outline" title="Stored on this device" subtitle={stats.data ? `${stats.data.items} item${stats.data.items === 1 ? '' : 's'}` : '…'} />
        <Divider />
        <ListRow icon="school-outline" title="Show introduction again" onPress={async () => {
          await services.repo.setSetting('onboarding_done', '0');
          services.notifyChanged();
          router.replace('/onboarding');
        }} />
        <Divider />
        <ListRow testID="erase-all" icon="trash-outline" title="Erase all data" destructive onPress={eraseAll} right={busy === 'erase' ? <ActivityIndicator color={colors.danger} /> : undefined} />
      </Group>

      <Text style={[font.small, styles.about, { color: colors.textFaint }]}>
        Stash {APP_VERSION} · Works fully offline · No account, no tracking
      </Text>
    </ScrollView>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
  hint: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  about: { textAlign: 'center', marginTop: spacing.xxl },
});
