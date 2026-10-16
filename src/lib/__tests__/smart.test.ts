import { boldRuns, checklistProgress, parseNote, plainText, toggleCheck } from '../checklist';
import {
  base64ToBytes,
  bytesToBase64,
  decryptWithPassword,
  DecryptionError,
  encryptWithPassword,
  isEncryptedEnvelope,
  SecretBox,
} from '../crypto';
import { extractAmounts, extractDates, extractEmails, extractFacts, extractPhones, parseAmount } from '../facts';
import { canonicalUrl, extractReadableText, parseHtmlMetadata, readingMinutes, resolveUrl } from '../links';
import { parseSmartQuery } from '../smartQuery';

describe('facts', () => {
  const receipt = `CAFE AMELIE\nInvoice #2048  Date: 14/10/2026\nCoffee beans   ₹12.50\nCroissant x2   ₹180.00\nSubtotal       ₹192.50\nGST 5%          9.63\nTOTAL          ₹202.13\nCall +91 98765 43210 or hello@cafe-amelie.in\nwww.cafe-amelie.in`;

  it('finds the total on the TOTAL line, not the subtotal', () => {
    const { total, amounts } = extractAmounts(receipt);
    expect(total).toMatchObject({ kind: 'total', value: '₹202.13', num: 202.13 });
    expect(amounts.map((a) => a.num)).toEqual(expect.arrayContaining([12.5, 180, 192.5, 9.63, 202.13]));
  });

  it('ignores years, invoice numbers and quantities', () => {
    const { amounts } = extractAmounts('Invoice 2048 for 2026\nQty 3\nPaid ₹500');
    expect(amounts.map((a) => a.num)).toEqual([500]);
  });

  it('parses international number formats', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseAmount('42')).toBe(42);
    expect(parseAmount('abc')).toBeNull();
  });

  it('extracts dates, phones, emails and URLs', () => {
    const facts = extractFacts(receipt);
    const kinds = (k: string) => facts.filter((f) => f.kind === k).map((f) => f.value);
    expect(kinds('date')).toEqual(['2026-10-14']);
    expect(kinds('phone')).toEqual(['+91 98765 43210']);
    expect(kinds('email')).toEqual(['hello@cafe-amelie.in']);
    expect(kinds('url')).toEqual(['www.cafe-amelie.in']);
    expect(facts[0]).toMatchObject({ kind: 'total', num: 202.13 });
  });

  it('handles written dates and rejects impossible ones', () => {
    expect(extractDates('Meeting on 3 March 2026 and Oct 12, 2025').length).toBe(2);
    expect(extractDates('31/02/2026')).toEqual([]);
    expect(extractDates('2026-10-14').length).toBe(1);
  });

  it('does not mistake amounts or dates for phone numbers', () => {
    expect(extractPhones('Total 1,234,567.00 on 2026-10-14')).toEqual([]);
    expect(extractPhones('mobile 9876543210')).toEqual(['9876543210']);
    expect(extractPhones('order id 12345678901234')).toEqual([]);
  });

  it('lowercases and dedupes emails', () => {
    expect(extractEmails('A@B.com a@b.com')).toEqual(['a@b.com']);
  });

  it('returns nothing for empty text', () => {
    expect(extractFacts('   ')).toEqual([]);
  });
});

describe('smart query', () => {
  const now = new Date(2026, 9, 16, 12).getTime(); // 16 Oct 2026
  const collections = [
    { id: 'c1', name: 'Travel' },
    { id: 'c2', name: 'Work Stuff' },
  ];
  const parse = (s: string) => parseSmartQuery(s, { now, collections });

  it('understands receipts, amounts and relative months', () => {
    const q = parse('receipts over 500 last month');
    expect(q.receiptsOnly).toBe(true);
    expect(q.amountMin).toBe(500);
    expect(new Date(q.dateFrom!).getMonth()).toBe(8); // September
    expect(new Date(q.dateTo!).getMonth()).toBe(9);
    expect(q.text).toBe('');
    expect(q.chips).toEqual(expect.arrayContaining(['Receipts', '> 500', 'Last month']));
  });

  it('understands types, tags, collections and leftover words', () => {
    const q = parse('photos of ramen #japan in travel');
    expect(q.type).toBe('image');
    expect(q.tagNames).toEqual(['japan']);
    expect(q.collectionId).toBe('c1');
    expect(q.text).toBe('ramen');
  });

  it('handles multi-word collections, between ranges and flags', () => {
    const q = parse('favorite pinned bills between 100 and 300 in Work Stuff');
    expect(q.collectionId).toBe('c2');
    expect(q).toMatchObject({ favoritesOnly: true, pinnedOnly: true, receiptsOnly: true, amountMin: 100, amountMax: 300 });
  });

  it('picks the most recent past month by name', () => {
    const q = parse('notes from december');
    expect(q.type).toBe('note');
    expect(new Date(q.dateFrom!).getFullYear()).toBe(2025);
    expect(new Date(q.dateFrom!).getMonth()).toBe(11);
  });

  it('keeps plain searches untouched', () => {
    const q = parse('grocery bananas');
    expect(q.text).toBe('grocery bananas');
    expect(q.chips).toEqual([]);
  });

  it('supports today / this week / last N days', () => {
    expect(parse('today').chips).toEqual(['Today']);
    expect(parse('this week').dateFrom).toBeLessThanOrEqual(now);
    expect(parse('last 7 days').chips).toEqual(['Last 7 days']);
  });
});

describe('links', () => {
  it('canonicalizes URLs for duplicate detection', () => {
    expect(canonicalUrl('https://www.Example.com/a/?utm_source=x&b=2&a=1#top')).toBe('example.com/a?a=1&b=2');
    expect(canonicalUrl('http://example.com/a')).toBe(canonicalUrl('https://example.com/a/'));
    expect(canonicalUrl(null)).toBeNull();
  });

  it('parses Open Graph metadata and resolves relative URLs', () => {
    const html = `<html><head><title>Fallback &amp; title</title>
      <meta property="og:title" content="Tokyo Food Guide">
      <meta content="30 must-try spots" name="description">
      <meta property="og:site_name" content="Japan Guide">
      <meta property="og:image" content="/img/cover.jpg">
      <link rel="icon" href="//cdn.example.com/icon.png"></head><body></body></html>`;
    expect(parseHtmlMetadata(html, 'https://www.japan-guide.com/e/e2036.html')).toEqual({
      title: 'Tokyo Food Guide',
      description: '30 must-try spots',
      siteName: 'Japan Guide',
      imageUrl: 'https://www.japan-guide.com/img/cover.jpg',
      faviconUrl: 'https://cdn.example.com/icon.png',
    });
    expect(parseHtmlMetadata('<title>Only &#39;title&#39;</title>', 'https://a.b/').title).toBe("Only 'title'");
    expect(resolveUrl('pic.png', 'https://a.b/dir/page.html')).toBe('https://a.b/dir/pic.png');
  });

  it('extracts readable article text without boilerplate', () => {
    const html = `<nav><p>Menu link that is long enough to count as a paragraph maybe</p></nav>
      <article><h1>Ramen guide</h1><p>${'Ramen is a Japanese noodle soup with many regional styles. '.repeat(10)}</p>
      <script>evil()</script><p>short</p><ul><li>Shoyu</li></ul></article><footer><p>Copyright footer text that is quite long indeed yes</p></footer>`;
    const text = extractReadableText(html);
    expect(text).toContain('## Ramen guide');
    expect(text).toContain('Ramen is a Japanese noodle soup');
    expect(text).toContain('• Shoyu');
    expect(text).not.toMatch(/Menu link|evil|Copyright|short/);
    expect(readingMinutes(text)).toBeGreaterThanOrEqual(1);
  });
});

describe('checklists', () => {
  const note = '# Trip\n- [ ] Passport\n- [x] Tickets\n- Bullet\n**Important** stuff';

  it('parses blocks and progress', () => {
    const blocks = parseNote(note);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'check', 'check', 'bullet', 'text']);
    expect(checklistProgress(note)).toEqual({ done: 1, total: 2 });
    expect(checklistProgress('no list')).toBeNull();
  });

  it('toggles items by line', () => {
    const toggled = toggleCheck(note, 1);
    expect(checklistProgress(toggled)).toEqual({ done: 2, total: 2 });
    expect(toggleCheck(note, 0)).toBe(note);
  });

  it('renders bold runs and plain previews', () => {
    expect(boldRuns('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
    expect(plainText(note)).toBe('Trip\n○ Passport\n✓ Tickets\n- Bullet\nImportant stuff');
  });
});

describe('crypto', () => {
  it('round-trips base64 for all lengths', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('encrypts and decrypts text and bytes; rejects tampering and wrong keys', () => {
    const box = new SecretBox(SecretBox.generateKey());
    const sealed = box.encryptText('My bank PIN is 1234 🔐');
    expect(sealed).not.toContain('1234');
    expect(box.decryptText(sealed)).toBe('My bank PIN is 1234 🔐');
    expect(box.encryptText('same')).not.toBe(box.encryptText('same')); // random nonce
    const tampered = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => box.decryptText(tampered)).toThrow(DecryptionError);
    expect(() => new SecretBox(SecretBox.generateKey()).decryptText(sealed)).toThrow(DecryptionError);
    const bytes = Uint8Array.from([1, 2, 3, 250]);
    expect(Array.from(box.decryptBytes(box.encryptBytes(bytes)))).toEqual([1, 2, 3, 250]);
  });

  it('protects backups with a password', async () => {
    const env = await encryptWithPassword('{"hello":"world"}', 'correct horse', 1000);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(env).not.toContain('world');
    await expect(decryptWithPassword(env, 'correct horse')).resolves.toBe('{"hello":"world"}');
    await expect(decryptWithPassword(env, 'wrong')).rejects.toThrow(/Wrong password/);
  });
});

describe('note formatting toolbar', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { applyFormat } = require('../checklist') as typeof import('../checklist');
  it('starts a checklist on an empty note and continues it at the end of a line', () => {
    let r = applyFormat('', { start: 0, end: 0 }, 'check');
    expect(r).toEqual({ text: '- [ ] ', cursor: 6 });
    const typed = `${r.text}Passport`;
    r = applyFormat(typed, { start: typed.length, end: typed.length }, 'check');
    expect(r.text).toBe('- [ ] Passport\n- [ ] ');
    expect(r.cursor).toBe(r.text.length);
  });
  it('toggles the prefix off on an empty list line and wraps bold', () => {
    expect(applyFormat('- [ ] ', { start: 6, end: 6 }, 'check').text).toBe('');
    expect(applyFormat('hello world', { start: 6, end: 11 }, 'bold')).toEqual({ text: 'hello **world**', cursor: 15 });
    expect(applyFormat('Title', { start: 0, end: 0 }, 'heading').text).toBe('# Title');
  });
});
