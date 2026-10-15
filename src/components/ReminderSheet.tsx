import { useMemo } from 'react';
import { formatDateTime, reminderPresets } from '../lib/dates';
import { BottomSheet } from './BottomSheet';
import { pickDateTime } from './pickDateTime';
import { ListRow } from './ui';

/** Lets the user choose a reminder time from presets or a custom date/time. */
export function ReminderSheet({
  visible,
  title = 'Remind me',
  initial,
  onClose,
  onPick,
}: {
  visible: boolean;
  title?: string;
  initial?: number;
  onClose: () => void;
  onPick: (at: number) => void;
}) {
  // Recompute presets each time the sheet opens so they stay in the future.
  const presets = useMemo(() => (visible ? reminderPresets() : []), [visible]);

  const custom = async () => {
    const start = initial && initial > Date.now() ? initial : Date.now() + 3_600_000;
    onClose();
    const at = await pickDateTime(start);
    if (at) onPick(at);
  };

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose} testID="reminder-sheet">
      {presets.map((p) => (
        <ListRow
          key={p.label}
          testID={`preset-${p.label}`}
          icon="time-outline"
          title={p.label}
          subtitle={formatDateTime(p.at)}
          onPress={() => {
            onClose();
            onPick(p.at);
          }}
          right={null}
        />
      ))}
      <ListRow testID="preset-custom" icon="calendar-outline" title="Pick date & time…" onPress={custom} />
    </BottomSheet>
  );
}
