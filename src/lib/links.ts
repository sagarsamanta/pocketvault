/** Normalizes a URL so the same page saved twice can be detected as a duplicate. */
export function canonicalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!m) return input.trim().toLowerCase() || null;
  const host = m[2].toLowerCase().replace(/^www\./, '').replace(/:(80|443)$/, '');
  const path = (m[3] || '/').replace(/\/+$/, '') || '';
  const params = (m[4] ?? '')
    .slice(1)
    .split('&')
    .filter((p) => p && !/^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|si|ref|ref_src)=/i.test(p))
    .sort();
  return `${host}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

export interface PageMetadata {
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  faviconUrl: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all);
}

/** Resolves a possibly relative URL against the page URL. */
export function resolveUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  const h = decodeEntities(href.trim());
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith('//')) return `${base.match(/^(https?):/i)?.[1] ?? 'https'}:${h}`;
  const origin = base.match(/^(https?:\/\/[^/?#]+)/i)?.[1];
  if (!origin) return null;
  if (h.startsWith('/')) return origin + h;
  const dir = base.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/');
  return dir.startsWith('http') ? dir + h : `${origin}/${h}`;
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i');
    const m = html.match(re1) ?? html.match(re2);
    if (m && m[1].trim()) return decodeEntities(m[1].trim());
  }
  return null;
}

/** Extracts Open Graph / Twitter / HTML metadata from a page. */
export function parseHtmlMetadata(html: string, pageUrl: string): PageMetadata {
  const head = html.slice(0, 200_000);
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = metaContent(head, ['og:title', 'twitter:title']) ?? (titleTag ? decodeEntities(titleTag.replace(/\s+/g, ' ').trim()) : null);
  const iconHref =
    head.match(/<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
    head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["']/i)?.[1] ??
    '/favicon.ico';
  return {
    title: title ? title.slice(0, 200) : null,
    description: metaContent(head, ['og:description', 'twitter:description', 'description'])?.slice(0, 400) ?? null,
    siteName: metaContent(head, ['og:site_name', 'application-name'])?.slice(0, 80) ?? null,
    imageUrl: resolveUrl(metaContent(head, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']), pageUrl),
    faviconUrl: resolveUrl(iconHref, pageUrl),
  };
}

/**
 * A small "reader mode": keeps the text of paragraphs and headings from the main
 * content area, dropping navigation, scripts and boilerplate.
 */
export function extractReadableText(html: string, maxChars = 60_000): string {
  let body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 500) body = main[2];
  const blocks: string[] = [];
  for (const m of body.matchAll(/<(h[1-3]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = decodeEntities(m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!text) continue;
    const isHeading = /^h/i.test(m[1]);
    if (!isHeading && text.length < 40 && m[1].toLowerCase() !== 'li') continue;
    blocks.push(isHeading ? `## ${text}` : m[1].toLowerCase() === 'li' ? `• ${text}` : text);
  }
  const out = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n');
  return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
}

/** Estimated reading time in minutes (~220 words per minute). */
export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
