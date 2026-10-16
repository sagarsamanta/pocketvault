import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME } from '../app-state/dbName';
import type { WidgetData } from './QuickCaptureWidget';

const EMOJI: Record<string, string> = { note: '📝', link: '🔗', image: '🖼️', document: '📄', audio: '🎙️' };

/** Reads the widget's data straight from the database (works from the headless widget task). */
export async function loadWidgetData(): Promise<WidgetData> {
  try {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    const count = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE is_secret = 0'))?.n ?? 0;
    const rows = await db.getAllAsync<{ id: string; type: string; title: string; url: string | null; preview_title: string | null }>(
      'SELECT id, type, title, url, preview_title FROM items WHERE is_secret = 0 ORDER BY is_pinned DESC, updated_at DESC LIMIT 3',
    );
    return {
      count,
      recent: rows.map((r) => ({ id: r.id, emoji: EMOJI[r.type] ?? '•', title: r.title || r.preview_title || r.url || 'Untitled' })),
    };
  } catch {
    return { count: 0, recent: [] };
  }
}
