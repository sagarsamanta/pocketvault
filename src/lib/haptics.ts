import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Small, consistent haptic vocabulary. No-ops on web. */
export const haptic = {
  tap() {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
  },
  light() {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  medium() {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  success() {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  warning() {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
};
