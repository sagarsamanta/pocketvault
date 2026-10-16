import type { ItemType } from '../db/types';

/**
 * Turns natural-language search like "receipts over 500 last month #work" into structured
 * filters plus the remaining free-text words. Everything runs locally.
 */
export interface SmartQuery {
  text: string;
  type?: ItemType;
  receiptsOnly?: boolean;
  favoritesOnly?: boolean;
  pinnedOnly?: boolean;
  withReminders?: boolean;
  dateFrom?: number;
  dateTo?: number;
  amountMin?: number;
  amountMax?: number;
  tagNames: string[];
  collectionId?: string;
  /** Human-readable chips describing what was understood. */
  chips: string[];
}

const TYPE_WORDS: [RegExp, ItemType, string][] = [
  [/\b(photos?|images?|pictures?|pics?|screenshots?)\b/i, 'image', 'Photos'],
  [/\b(links?|urls?|websites?|articles?|bookmarks?)\b/i, 'link', 'Links'],
  [/\b(notes?)\b/i, 'note', 'Notes'],
  [/\b(docs?|documents?|pdfs?|files?|scans?)\b/i, 'document', 'Documents'],
  [/\b(voice|audio|recordings?|voice ?notes?|memos?)\b/i, 'audio', 'Voice notes'],
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function parseSmartQuery(
  input: string,
  options: { now?: number; collections?: { id: string; name: string }[] } = {},
): SmartQuery {
  const now = new Date(options.now ?? Date.now());
  const q: SmartQuery = { text: '', tagNames: [], chips: [] };
  let rest = ` ${input.trim()} `;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = rest.match(re);
    if (m) {
      fn(m);
      rest = rest.replace(m[0], ' ');
      return true;
    }
    return false;
  };

  // #tags
  for (const m of [...rest.matchAll(/#([\p{L}\p{N}_-]+)/gu)]) {
    q.tagNames.push(m[1]);
    q.chips.push(`#${m[1]}`);
    rest = rest.replace(m[0], ' ');
  }

  // in:collection or "in <collection name>"
  take(/\bin:([\p{L}\p{N}_-]+)/iu, (m) => {
    const c = options.collections?.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    if (c) {
      q.collectionId = c.id;
      q.chips.push(`In ${c.name}`);
    }
  });
  for (const c of [...(options.collections ?? [])].sort((a, b) => b.name.length - a.name.length)) {
    const escaped = c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!q.collectionId) take(new RegExp(`\\bin\\s+${escaped}\\b`, 'i'), () => {
      q.collectionId = c.id;
      q.chips.push(`In ${c.name}`);
    });
  }

  // Amounts: over/above/more than/> N, under/below/less than/< N, between A and B
  take(/\bbetween\s+[₹$€£]?\s?(\d+(?:\.\d+)?)\s+(?:and|-|to)\s+[₹$€£]?\s?(\d+(?:\.\d+)?)\b/i, (m) => {
    q.amountMin = Math.min(+m[1], +m[2]);
    q.amountMax = Math.max(+m[1], +m[2]);
    q.chips.push(`${q.amountMin}–${q.amountMax}`);
  });
  take(/(?:\b(?:over|above|more than|greater than|at least)|>=?)\s*[₹$€£]?\s?(\d+(?:\.\d+)?)\b/i, (m) => {
    q.amountMin = +m[1];
    q.chips.push(`> ${m[1]}`);
  });
  take(/(?:\b(?:under|below|less than|at most|cheaper than)|<=?)\s*[₹$€£]?\s?(\d+(?:\.\d+)?)\b/i, (m) => {
    q.amountMax = +m[1];
    q.chips.push(`< ${m[1]}`);
  });

  // Receipts / bills
  take(/\b(receipts?|bills?|invoices?|expenses?|spending|purchases?)\b/i, () => {
    q.receiptsOnly = true;
    q.chips.push('Receipts');
  });
  if ((q.amountMin !== undefined || q.amountMax !== undefined) && !q.receiptsOnly) q.receiptsOnly = true;

  // Flags
  take(/\b(favou?rites?|starred|faves?)\b/i, () => {
    q.favoritesOnly = true;
    q.chips.push('Favorites');
  });
  take(/\b(pinned)\b/i, () => {
    q.pinnedOnly = true;
    q.chips.push('Pinned');
  });
  take(/\b(?:with\s+)?reminders?\b/i, () => {
    q.withReminders = true;
    q.chips.push('With reminders');
  });

  // Types (first match wins)
  for (const [re, type, label] of TYPE_WORDS) {
    if (take(re, () => undefined)) {
      q.type = type;
      q.chips.push(label);
      break;
    }
  }

  // Dates
  const today = startOfDay(now);
  const DAY = 86_400_000;
  const setRange = (from: number, to: number, label: string) => {
    q.dateFrom = from;
    q.dateTo = to;
    q.chips.push(label);
  };
  take(/\btoday\b/i, () => setRange(today, today + DAY, 'Today')) ||
    take(/\byesterday\b/i, () => setRange(today - DAY, today, 'Yesterday')) ||
    take(/\b(?:last|past)\s+(\d+)\s+days?\b/i, (m) => setRange(today - (+m[1] - 1) * DAY, today + DAY, `Last ${m[1]} days`)) ||
    take(/\bthis\s+week\b/i, () => {
      const d = new Date(today);
      const monday = today - ((d.getDay() + 6) % 7) * DAY;
      setRange(monday, today + DAY, 'This week');
    }) ||
    take(/\blast\s+week\b/i, () => {
      const d = new Date(today);
      const monday = today - ((d.getDay() + 6) % 7) * DAY;
      setRange(monday - 7 * DAY, monday, 'Last week');
    }) ||
    take(/\bthis\s+month\b/i, () => setRange(new Date(now.getFullYear(), now.getMonth(), 1).getTime(), today + DAY, 'This month')) ||
    take(/\blast\s+month\b/i, () =>
      setRange(
        new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        'Last month',
      ),
    ) ||
    take(/\bthis\s+year\b/i, () => setRange(new Date(now.getFullYear(), 0, 1).getTime(), today + DAY, 'This year')) ||
    take(/\blast\s+year\b/i, () =>
      setRange(new Date(now.getFullYear() - 1, 0, 1).getTime(), new Date(now.getFullYear(), 0, 1).getTime(), 'Last year'),
    ) ||
    take(new RegExp(`\\b(?:in\\s+)?(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})\\b`, 'i'), (m) => {
      const idx = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
      // The most recent occurrence of that month (this year, or last year if it is still ahead).
      const year = idx > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
      const label = MONTHS[idx][0].toUpperCase() + MONTHS[idx].slice(1);
      setRange(new Date(year, idx, 1).getTime(), new Date(year, idx + 1, 1).getTime(), label);
    });

  // Drop filler words left over from phrases like "show me my ... from ..."
  q.text = rest
    .replace(/\b(show|me|my|all|the|from|with|of|for|in|on|and|items?|stuff|things?|saved)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return q;
}

/** True when the query used any structured filter (so the UI can show the chips). */
export function hasSmartFilters(q: SmartQuery): boolean {
  return q.chips.length > 0;
}
