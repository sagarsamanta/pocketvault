import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

/** Opens the related item when the user taps a reminder notification. */
export function NotificationRouter() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const itemId = response.notification.request.content.data?.itemId;
    if (typeof itemId === 'string') router.push({ pathname: '/item/[id]', params: { id: itemId } });
  }, [response, router]);

  return null;
}
