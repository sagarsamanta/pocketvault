import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Notifier, OcrEngine, PermissionState } from './types';

export const REMINDER_CHANNEL_ID = 'reminders';

let channelReady: Promise<void> | null = null;

/** Android shows the permission prompt only after a channel exists, so create it first. */
function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Reminders',
    description: 'Reminders you set on saved items',
    importance: Notifications.AndroidImportance.HIGH,
  }).then(() => undefined);
  return channelReady;
}

function mapStatus(status: Notifications.PermissionStatus | string): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export const notifier: Notifier = {
  supported: true,
  async getPermission() {
    await ensureChannel();
    const res = await Notifications.getPermissionsAsync();
    return mapStatus(res.status);
  },
  async requestPermission() {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return 'granted';
    if (!current.canAskAgain) return 'denied';
    const res = await Notifications.requestPermissionsAsync();
    return mapStatus(res.status);
  },
  async schedule({ reminderId, itemId, title, body, at }) {
    await ensureChannel();
    return Notifications.scheduleNotificationAsync({
      content: { title, body, data: { itemId, reminderId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: REMINDER_CHANNEL_ID },
    });
  },
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  cancelAll: () => Notifications.cancelAllScheduledNotificationsAsync(),
};

export const ocrEngine: OcrEngine = {
  supported: true,
  async recognize(imageUri) {
    const result = await recognizeText(imageUri);
    return result.text ?? '';
  },
};
