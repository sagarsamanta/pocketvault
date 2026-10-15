const DAY = 86_400_000;

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today 9:00 AM", "Tomorrow 8:00 PM", "Mon, Oct 20, 9:00 AM". */
export function formatDateTime(ts: number, now = Date.now()): string {
  const diffDays = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
  if (diffDays === 0) return `Today ${formatTime(ts)}`;
  if (diffDays === 1) return `Tomorrow ${formatTime(ts)}`;
  if (diffDays === -1) return `Yesterday ${formatTime(ts)}`;
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Compact relative date for list rows: "now", "5m", "3h", "Yesterday", "Oct 3". */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < DAY && startOfDay(ts) === startOfDay(now)) return `${Math.floor(diff / 3_600_000)}h`;
  if (startOfDay(now) - startOfDay(ts) === DAY) return 'Yesterday';
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface ReminderPreset {
  label: string;
  at: number;
}

/** Quick reminder choices relative to `now`, all in the future. */
export function reminderPresets(now = Date.now()): ReminderPreset[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const presets: ReminderPreset[] = [{ label: 'In 1 hour', at: now + 3_600_000 }];
  const tonight = at(0, 20);
  if (tonight - now > 30 * 60_000) presets.push({ label: 'This evening', at: tonight });
  presets.push({ label: 'Tomorrow morning', at: at(1, 9) });
  const d = new Date(now);
  const daysToSaturday = (6 - d.getDay() + 7) % 7 || 7;
  presets.push({ label: 'This weekend', at: at(daysToSaturday, 10) });
  presets.push({ label: 'Next week', at: at(7, 9) });
  return presets;
}
