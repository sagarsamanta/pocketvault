/**
 * Lightweight note formatting stored as plain text, so notes stay readable everywhere:
 *   "- [ ] task" / "- [x] done"  → checklist items
 *   "# Heading", "## Heading"    → headings
 *   "**bold**"                   → bold
 *   "- item" / "• item"          → bullets
 */
export type NoteBlock =
  | { kind: 'check'; line: number; checked: boolean; text: string }
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'blank' };

const CHECK_RE = /^\s*[-*]\s\[( |x|X)\]\s?(.*)$/;

export function parseNote(note: string): NoteBlock[] {
  return note.split('\n').map((raw, line): NoteBlock => {
    const check = raw.match(CHECK_RE);
    if (check) return { kind: 'check', line, checked: check[1].toLowerCase() === 'x', text: check[2] };
    const heading = raw.match(/^(#{1,2})\s+(.*)$/);
    if (heading) return { kind: 'heading', level: heading[1].length as 1 | 2, text: heading[2] };
    const bullet = raw.match(/^\s*(?:[-*•])\s+(.*)$/);
    if (bullet) return { kind: 'bullet', text: bullet[1] };
    if (!raw.trim()) return { kind: 'blank' };
    return { kind: 'text', text: raw };
  });
}

/** Toggles the checklist item on `line`, returning the updated note text. */
export function toggleCheck(note: string, line: number): string {
  const lines = note.split('\n');
  const m = lines[line]?.match(CHECK_RE);
  if (!m) return note;
  lines[line] = lines[line].replace(/\[( |x|X)\]/, m[1] === ' ' ? '[x]' : '[ ]');
  return lines.join('\n');
}

export function checklistProgress(note: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const line of note.split('\n')) {
    const m = line.match(CHECK_RE);
    if (!m) continue;
    total++;
    if (m[1].toLowerCase() === 'x') done++;
  }
  return total ? { done, total } : null;
}

/** Splits text into plain and **bold** runs for rendering. */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
}

/** Strips formatting markers for previews and search snippets. */
export function plainText(note: string): string {
  return note
    .split('\n')
    .map((l) => l.replace(CHECK_RE, (_a, c, t) => `${c.toLowerCase() === 'x' ? '✓' : '○'} ${t}`).replace(/^#{1,2}\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1'))
    .join('\n');
}

export type Format = 'check' | 'heading' | 'bullet' | 'bold';

/**
 * Applies a toolbar formatting action at the cursor/selection of a plain-text note.
 * At the end of a non-empty line, list formats start a new line; on an empty or
 * mid-line position they toggle the prefix of the current line.
 */
export function applyFormat(text: string, sel: { start: number; end: number }, format: Format): { text: string; cursor: number } {
  if (format === 'bold') {
    const selected = text.slice(sel.start, sel.end) || 'bold text';
    return { text: `${text.slice(0, sel.start)}**${selected}**${text.slice(sel.end)}`, cursor: sel.start + selected.length + 4 };
  }
  const prefix = format === 'check' ? '- [ ] ' : format === 'heading' ? '# ' : '- ';
  const lineStart = text.lastIndexOf('\n', sel.start - 1) + 1;
  const lineEndIdx = text.indexOf('\n', sel.start);
  const lineEnd = lineEndIdx < 0 ? text.length : lineEndIdx;
  const line = text.slice(lineStart, lineEnd);
  const atLineEnd = sel.start === lineEnd;
  const bare = line.replace(/^(- \[[ xX]\] |# |## |- )/, '');
  if (atLineEnd && bare.trim()) {
    return { text: `${text.slice(0, sel.start)}\n${prefix}${text.slice(sel.start)}`, cursor: sel.start + 1 + prefix.length };
  }
  if (line.startsWith(prefix)) {
    return { text: text.slice(0, lineStart) + line.slice(prefix.length) + text.slice(lineEnd), cursor: Math.max(lineStart, sel.start - prefix.length) };
  }
  return { text: text.slice(0, lineStart) + prefix + text.slice(lineStart), cursor: sel.start + prefix.length };
}
