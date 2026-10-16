import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveQuery, useServices } from '../app-state/AppContext';
import { errorMessage, useDialog } from '../components/DialogProvider';
import { Group, ListRow, SectionTitle, Segmented } from '../components/ui';
import { authSupported, authenticate, canAuthenticate } from '../security/auth';
import { SETTINGS } from '../services/appServices';
import { BackupSummary, summarize } from '../services/backup';
import { openAppSettings, shareFile } from '../services/itemActions';
import { pickBackupFolder, readExternalText, saveToPickedFolder, writeCacheFile } from '../services/nativeFileStore';
import { formatDateTime } from '../lib/dates';
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
  return `pocketvault-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
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
  const prefs = useLiveQuery(async () => {
    const [appLock, lockTimeout, quickSave, autoUri, autoLabel, lastAuto, secrets] = await Promise.all([
      services.repo.getSetting(SETTINGS.appLock),
      services.repo.getSetting(SETTINGS.lockTimeout),
      services.repo.getSetting(SETTINGS.quickSave),
      services.repo.getSetting(SETTINGS.autoBackupUri),
      services.repo.getSetting(SETTINGS.autoBackupLabel),
      services.repo.getSetting(SETTINGS.lastAutoBackup),
      services.repo.countSecretItems(),
    ]);
    return { appLock: appLock === '1', lockTimeout: lockTimeout ?? '30', quickSave: quickSave === '1', autoUri, autoLabel, lastAuto: Number(lastAuto ?? 0), secrets };
  }, []);

  const setPref = async (key: string, value: string) => {
    await services.repo.setSetting(key, value);
    services.notifyChanged();
  };

  const toggleAppLock = async (on: boolean) => {
    if (on) {
      if (!(await canAuthenticate())) {
        dialog.toast('Set up a fingerprint, PIN or pattern in Android settings first.', 'error');
        return;
      }
      const res = await authenticate('Confirm to turn on app lock');
      if (!res.ok) {
        if (res.error) dialog.toast(res.error, 'error');
        return;
      }
    }
    await setPref(SETTINGS.appLock, on ? '1' : '0');
    dialog.toast(on ? 'App lock on 🔒' : 'App lock off');
  };

  const askBackupPassword = async (): Promise<string | null | undefined> => {
    const protect = await dialog.confirm({
      title: 'Protect with a password?',
      message:
        prefs.data?.secrets
          ? `A password encrypts the backup and also includes your ${prefs.data.secrets} secret vault item${prefs.data.secrets === 1 ? '' : 's'}. Without one, secret items are left out.`
          : 'A password encrypts the backup file so only you can restore it.',
      confirmLabel: 'Add password',
      cancelLabel: 'No password',
    });
    if (!protect) return null;
    const pw = await dialog.prompt({ title: 'Backup password', message: 'At least 6 characters. You will need it to restore.', secure: true, maxLength: 128, validate: (v) => (v.length < 6 ? 'Use at least 6 characters.' : null) });
    if (!pw) return undefined;
    const again = await dialog.prompt({ title: 'Repeat password', secure: true, maxLength: 128 });
    if (again === null) return undefined;
    if (again !== pw) {
      dialog.toast('Passwords did not match — backup not created.', 'error');
      return undefined;
    }
    return pw;
  };

  const turnOnAutoBackup = async () => {
    const folder = await pickBackupFolder();
    if (!folder) return;
    await services.repo.setSetting(SETTINGS.autoBackupUri, folder.uri);
    await services.repo.setSetting(SETTINGS.autoBackupLabel, folder.label);
    await withBusy('auto', async () => {
      await services.runAutoBackupIfDue(true);
      dialog.toast(`Weekly backups will be saved to “${folder.label}”`);
    });
  };

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
      const password = Platform.OS === 'web' ? null : await askBackupPassword();
      if (password === undefined) return;
      const { json, summary } = await services.exportBackupJson(APP_VERSION, password ? { password } : {});
      const name = password ? backupFileName().replace('.json', '-protected.json') : backupFileName();
      if (summary.excludedSecrets) dialog.toast(`${summary.excludedSecrets} secret item(s) not included — add a password to include them.`);
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
      const shared = await shareFile(uri, 'application/json', 'Save PocketVault backup');
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
      let password: string | undefined;
      if (services.isEncryptedBackup(json)) {
        const pw = await dialog.prompt({ title: 'Password-protected backup', message: 'Enter the password used when this backup was created.', secure: true, maxLength: 128 });
        if (!pw) return;
        password = pw;
      }
      const summary = summarize(await services.previewBackup(json, password));
      const ok = await dialog.confirm({
        title: 'Restore this backup?',
        message: `This backup contains ${describe(summary)}. Restoring replaces everything currently in PocketVault on this device.`,
        confirmLabel: 'Restore',
        destructive: true,
      });
      if (!ok) return;
      const restored = await services.restoreBackupJson(json, password);
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

      {authSupported ? (
        <>
          <SectionTitle>Security</SectionTitle>
          <Group>
            <ListRow
              testID="app-lock-row"
              icon="finger-print"
              title="App lock"
              subtitle="Fingerprint, face or screen lock when opening PocketVault"
              right={<Switch testID="app-lock-switch" accessibilityLabel="App lock" value={!!prefs.data?.appLock} onValueChange={toggleAppLock} trackColor={{ true: colors.primary, false: colors.border }} />}
            />
            {prefs.data?.appLock ? (
              <View style={{ padding: spacing.md }}>
                <Text style={[font.small, { color: colors.textMuted, marginBottom: spacing.sm }]}>Lock after leaving the app for</Text>
                <Segmented
                  testIDPrefix="lock-timeout"
                  value={prefs.data.lockTimeout}
                  onChange={(v) => setPref(SETTINGS.lockTimeout, v)}
                  options={[
                    { value: '0', label: 'Instantly' },
                    { value: '30', label: '30 sec' },
                    { value: '300', label: '5 min' },
                  ]}
                />
              </View>
            ) : null}
            <Divider />
            <ListRow testID="nav-vault-settings" icon="lock-closed-outline" title="Secret vault" subtitle={`${prefs.data?.secrets ?? 0} encrypted item${prefs.data?.secrets === 1 ? '' : 's'}`} onPress={() => router.push('/vault')} />
          </Group>

          <SectionTitle>Capture</SectionTitle>
          <Group>
            <ListRow
              icon="flash-outline"
              title="Quick save from share"
              subtitle="Save shared links and files instantly, without the review screen"
              right={<Switch testID="quick-save-switch" accessibilityLabel="Quick save from share" value={!!prefs.data?.quickSave} onValueChange={(v) => setPref(SETTINGS.quickSave, v ? '1' : '0')} trackColor={{ true: colors.primary, false: colors.border }} />}
            />
          </Group>
        </>
      ) : null}

      <SectionTitle>Organize</SectionTitle>
      <Group>
        <ListRow testID="nav-insights-settings" icon="stats-chart-outline" title="Insights" subtitle="Stats, activity and spending" onPress={() => router.push('/insights')} />
        <Divider />
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
            <ListRow testID="backup-save" icon="folder-open-outline" title="Save backup to a folder" subtitle="Pick or create a folder (e.g. Download/PocketVault backups)" onPress={() => exportBackup('save')} right={busy === 'export' ? <ActivityIndicator color={colors.primary} /> : undefined} />
            <Divider />
            <ListRow testID="backup-share" icon="share-outline" title="Share backup" subtitle="Send it to Drive, email or another app" onPress={() => exportBackup('share')} />
          </>
        )}
        <Divider />
        <ListRow testID="backup-import" icon="cloud-upload-outline" title="Restore from backup" subtitle="Replaces the data on this device" onPress={importBackup} right={busy === 'import' ? <ActivityIndicator color={colors.primary} /> : undefined} />
      </Group>
      {Platform.OS !== 'web' ? (
        <View style={{ marginTop: spacing.md }}>
          <Group>
            {prefs.data?.autoUri ? (
              <>
                <ListRow
                  testID="auto-backup-row"
                  icon="time-outline"
                  title="Weekly automatic backup"
                  subtitle={`To “${prefs.data.autoLabel ?? 'folder'}”${prefs.data.lastAuto ? ` · last ${formatDateTime(prefs.data.lastAuto)}` : ''}`}
                  right={busy === 'auto' ? <ActivityIndicator color={colors.primary} /> : null}
                />
                <Divider />
                <ListRow icon="cloud-done-outline" title="Back up now" onPress={() => withBusy('auto', async () => { await services.runAutoBackupIfDue(true); dialog.toast('Backup saved'); })} />
                <Divider />
                <ListRow icon="close-circle-outline" title="Turn off automatic backup" destructive onPress={() => setPref(SETTINGS.autoBackupUri, '')} />
              </>
            ) : (
              <ListRow testID="auto-backup-on" icon="time-outline" title="Turn on weekly automatic backup" subtitle="Saved automatically to a folder you choose" onPress={turnOnAutoBackup} />
            )}
          </Group>
        </View>
      ) : null}
      <Text style={[font.small, styles.hint, { color: colors.textFaint }]}>
        Backups include items, files, collections, tags, reminders and settings. Keep them somewhere safe — PocketVault has no cloud copy.
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
        PocketVault {APP_VERSION} · Works fully offline · No account, no tracking
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
