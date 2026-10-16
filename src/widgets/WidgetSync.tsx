import { useEffect } from 'react';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { useServices } from '../app-state/AppContext';
import { QuickCaptureWidget } from './QuickCaptureWidget';
import { loadWidgetData } from './widgetData';

/** Refreshes the home-screen widget shortly after data changes in the app. */
export function WidgetSync() {
  const services = useServices();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        requestWidgetUpdate({
          widgetName: 'QuickCapture',
          renderWidget: async (info) => <QuickCaptureWidget data={await loadWidgetData()} compact={info.height < 160} />,
          widgetNotFound: () => undefined,
        }).catch(() => undefined);
      }, 1500);
    };
    refresh();
    const unsubscribe = services.subscribe(refresh);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [services]);
  return null;
}
