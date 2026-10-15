import { buildFtsQuery } from '../../db/search';
import {
  deriveTitle,
  extractUrl,
  formatBytes,
  guessMimeType,
  hostnameOf,
  isProbablyUrl,
  isTextDocument,
  normalizeUrl,
  parseTagInput,
  sanitizeFileName,
} from '../text';
import { newId } from '../id';

describe('text helpers', () => {
  it('extracts URLs from shared text', () => {
    expect(extractUrl('Look at this https://example.com/a?b=1.')).toBe('https://example.com/a?b=1');
    expect(extractUrl('(see https://x.dev/path)')).toBe('https://x.dev/path');
    expect(extractUrl('no link here')).toBeNull();
    expect(extractUrl(null)).toBeNull();
  });

  it('detects and normalizes URLs', () => {
    expect(isProbablyUrl(' https://a.b/c ')).toBe(true);
    expect(isProbablyUrl('hello https://a.b')).toBe(false);
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('mailto:me@x.com')).toBe('mailto:me@x.com');
    expect(normalizeUrl('  ')).toBe('');
    expect(hostnameOf('https://www.github.com/expo')).toBe('github.com');
    expect(hostnameOf(null)).toBe('');
  });

  it('derives titles', () => {
    expect(deriveTitle('\n\n  First line \nsecond')).toBe('First line');
    expect(deriveTitle('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    expect(deriveTitle('   ')).toBe('');
  });

  it('parses tags', () => {
    expect(parseTagInput('#work, Work , home,, ,  side   project')).toEqual(['work', 'home', 'side project']);
  });

  it('formats sizes and file names', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(sanitizeFileName('a/b:c?.txt')).toBe('a_b_c_.txt');
    expect(sanitizeFileName('')).toBe('file');
    expect(guessMimeType('doc.PDF')).toBe('application/pdf');
    expect(isTextDocument('application/octet-stream', 'notes.md')).toBe(true);
    expect(isTextDocument('application/pdf', 'a.pdf')).toBe(false);
  });

  it('builds safe FTS queries', () => {
    expect(buildFtsQuery('React  native')).toBe('"React"* "native"*');
    expect(buildFtsQuery('a "b" OR (c)')).toBe('"a"* "b"* "OR"* "c"*');
    expect(buildFtsQuery(' -- ')).toBeNull();
  });

  it('creates unique v4 ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
    expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
