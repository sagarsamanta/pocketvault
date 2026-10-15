const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/i;

/** Returns the first http(s) URL contained in `text`, without trailing punctuation. */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_REGEX);
  if (!match) return null;
  return match[0].replace(/[),.;:!?\]}]+$/, '');
}

export function isProbablyUrl(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed);
}

/** Adds a scheme to bare domains like "example.com/path" so they can be opened. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function hostnameOf(url: string | null | undefined): string {
  if (!url) return '';
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i);
  return match ? match[1].replace(/^www\./i, '') : '';
}

/** Derives a short title from free text: first non-empty line, trimmed to `max` chars. */
export function deriveTitle(text: string, max = 80): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine;
}

/** Splits a comma/space separated tag string into normalized unique tag names. */
export function parseTagInput(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const name = raw.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 40);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function fileExtension(name: string): string {
  const match = name.match(/\.([a-z0-9]{1,8})$/i);
  return match ? match[1].toLowerCase() : '';
}

/** Makes a string safe to use as a file name on Android. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 120) || 'file';
}

const TEXT_MIME = /^text\/|^application\/(json|xml|csv|x-yaml|yaml|markdown)/i;
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'yaml', 'yml', 'log', 'html', 'htm']);

/** Whether a document's text content can be indexed by reading it as UTF-8. */
export function isTextDocument(mimeType: string, name: string): boolean {
  return TEXT_MIME.test(mimeType) || TEXT_EXT.has(fileExtension(name));
}

export function isImageMime(mimeType: string, name = ''): boolean {
  return /^image\//i.test(mimeType) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp'].includes(fileExtension(name));
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

export function guessMimeType(name: string, fallback = 'application/octet-stream'): string {
  return EXT_TO_MIME[fileExtension(name)] ?? fallback;
}

/** Truncates indexed text so a huge document cannot bloat the database. */
export const MAX_INDEXED_TEXT = 200_000;
export function clampIndexedText(text: string): string {
  return text.length > MAX_INDEXED_TEXT ? text.slice(0, MAX_INDEXED_TEXT) : text;
}
