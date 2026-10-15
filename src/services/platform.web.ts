import type { Notifier, OcrEngine } from './types';

export const REMINDER_CHANNEL_ID = 'reminders';

export function configureNotificationHandler() {}

/** Browser builds keep reminders in the app but cannot schedule system notifications. */
export const notifier: Notifier = {
  supported: false,
  getPermission: async () => 'denied',
  requestPermission: async () => 'denied',
  schedule: async () => null,
  cancel: async () => undefined,
  cancelAll: async () => undefined,
};

export const ocrEngine: OcrEngine = {
  supported: false,
  recognize: async () => {
    throw new Error('Text recognition is only available in the Android app.');
  },
};
