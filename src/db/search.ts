/** Splits user input into word tokens the same way for FTS5 and the LIKE fallback. */
export function tokenizeQuery(input: string): string[] {
  return input
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12);
}

/**
 * Converts free-form user input into a safe FTS5 MATCH expression.
 * Every token becomes a quoted prefix query and tokens are AND-ed, so
 * "rea nat" matches "React Native". Returns null when nothing is searchable.
 */
export function buildFtsQuery(input: string): string | null {
  const tokens = tokenizeQuery(input);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

/** Escapes LIKE wildcards for a `LIKE ? ESCAPE '\'` clause. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
