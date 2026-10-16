import type { FactKind } from '../db/types';

export interface ExtractedFact {
  kind: FactKind;
  value: string;
  num: number | null;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  '₹': '₹',
  rs: '₹',
  'rs.': '₹',
  inr: '₹',
  $: '$',
  usd: '$',
  '€': '€',
  eur: '€',
  '£': '£',
  gbp: '£',
};

/** Parses "1,234.50", "1.234,50", "1 234.50" or "42" into a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot && s.length - lastComma - 1 === 2) {
    // European style 1.234,50
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_RE =
  /(₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s?((?:\d{1,3}(?:[,\s]\d{2,3})+|\d+)(?:[.,]\d{1,2})?)\s?(₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?/gi;
const TOTAL_LINE_RE = /\b(grand\s*total|total\s*(?:amount|due|payable)?|amount\s*(?:due|paid|payable)|net\s*payable|balance\s*due)\b/i;
const MONEY_CONTEXT_RE = /(₹|rs\.?|inr|\$|usd|€|eur|£|gbp|total|amount|price|subtotal|tax|gst|vat|paid|due|bill|invoice|receipt)/i;

function formatMoney(n: number, symbol: string | undefined): string {
  const fixed = n.toFixed(Number.isInteger(n) ? 0 : 2);
  return symbol ? `${symbol}${fixed}` : fixed;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function makeDate(y: number, m: number, d: number): number | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 ? date.getTime() : null;
}

function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Extracts dates written as 14/10/2026, 2026-10-14, 14 Oct 2026 or Oct 14, 2026 (day-first for slashes). */
export function extractDates(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const ts = makeDate(+m[1], +m[2], +m[3]);
    if (ts) out.add(ts);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    const ts = makeDate(+m[3], +m[2], +m[1]) ?? makeDate(+m[3], +m[1], +m[2]);
    if (ts) out.add(ts);
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b/gi)) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    const ts = mi >= 0 ? makeDate(+m[3], mi + 1, +m[1]) : null;
    if (ts) out.add(ts);
  }
  for (const m of text.matchAll(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    const ts = mi >= 0 ? makeDate(+m[3], mi + 1, +m[2]) : null;
    if (ts) out.add(ts);
  }
  return [...out];
}

export function extractEmails(text: string): string[] {
  return [...new Set((text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? []).map((e) => e.toLowerCase()))];
}

export function extractUrls(text: string): string[] {
  const urls = (text.match(/\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*/gi) ?? []).map((u) =>
    u.replace(/[),.;:!?\]}]+$/, ''),
  );
  return [...new Set(urls)];
}

/** Phone numbers with 10–13 digits (optionally +country code), ignoring dates and amounts. */
export function extractPhones(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?){2,4}\d{2,5}/g)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw) || /[.,]\d{2}$/.test(raw)) continue;
    // Plain long digit runs without separators or "+" are usually IDs, not phones,
    // unless they look like a 10-digit mobile number.
    if (!/[+\s()-]/.test(raw) && !(digits.length === 10 && /^[6-9]/.test(digits))) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(raw.replace(/\s+/g, ' '));
  }
  return out;
}

/** Finds money amounts; the amount on a "Total" line (or the largest) is reported as the total. */
export function extractAmounts(text: string): { amounts: ExtractedFact[]; total: ExtractedFact | null } {
  const amounts: ExtractedFact[] = [];
  let total: ExtractedFact | null = null;
  let largest: ExtractedFact | null = null;
  for (const line of text.split(/\r?\n/)) {
    const hasMoneyContext = MONEY_CONTEXT_RE.test(line);
    if (!hasMoneyContext) continue;
    const isTotalLine = TOTAL_LINE_RE.test(line) && !/sub\s*-?\s*total/i.test(line);
    for (const m of line.matchAll(AMOUNT_RE)) {
      const symbolRaw = (m[1] ?? m[3] ?? '').toLowerCase();
      const symbol = CURRENCY_SYMBOL[symbolRaw];
      const hasDecimals = /[.,]\d{1,2}$/.test(m[2]);
      // Require a currency symbol or decimals so years, quantities and IDs are skipped.
      if (!symbol && !hasDecimals) continue;
      const n = parseAmount(m[2]);
      if (n === null || n <= 0 || n > 10_000_000) continue;
      const fact: ExtractedFact = { kind: 'amount', value: formatMoney(n, symbol), num: n };
      amounts.push(fact);
      if (!largest || n > (largest.num ?? 0)) largest = fact;
      if (isTotalLine) total = { kind: 'total', value: fact.value, num: n };
    }
  }
  if (!total && largest && amounts.length > 0 && /total|invoice|receipt|bill|amount/i.test(text)) {
    total = { kind: 'total', value: largest.value, num: largest.num };
  }
  return { amounts, total };
}

/** Extracts all actionable facts from free text (OCR output, notes, documents). */
export function extractFacts(text: string): ExtractedFact[] {
  if (!text.trim()) return [];
  const facts: ExtractedFact[] = [];
  const { amounts, total } = extractAmounts(text);
  if (total) facts.push(total);
  const seenAmounts = new Set<string>();
  for (const a of amounts) {
    if (seenAmounts.has(a.value)) continue;
    seenAmounts.add(a.value);
    facts.push(a);
  }
  for (const ts of extractDates(text).slice(0, 5)) facts.push({ kind: 'date', value: isoDay(ts), num: ts });
  for (const p of extractPhones(text).slice(0, 5)) facts.push({ kind: 'phone', value: p, num: null });
  for (const e of extractEmails(text).slice(0, 5)) facts.push({ kind: 'email', value: e, num: null });
  for (const u of extractUrls(text).slice(0, 5)) facts.push({ kind: 'url', value: u, num: null });
  return facts;
}
