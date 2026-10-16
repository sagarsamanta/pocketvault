import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { QuickCaptureWidget } from './QuickCaptureWidget';
import { loadWidgetData } from './widgetData';

/** Runs headless when Android asks the widget to (re)draw. */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') return;
  const data = await loadWidgetData();
  renderWidget(<QuickCaptureWidget data={data} compact={widgetInfo.height < 160} />);
}
