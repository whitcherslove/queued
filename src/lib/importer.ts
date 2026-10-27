import { supabase } from './supabase';

export interface ImportRow {
  email: string; title: string; year: number | null; imdbId: string | null; rating: string | null; score: number | null;
  watchedAt: string | null; rewatch: boolean; metascore: number | null; imdb: number | null; ask: string | null; answer: string | null; order: number;
}
export interface ImportGroup { key: string; sourceId?: string; imdbId: string | null; title: string; year: number | null; rows: ImportRow[] }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const numOrNull = (v: unknown) => { const n = parseFloat(str(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const toDate = (v: unknown): Date | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const s = str(v); if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
};

export function normalizeRow(r: Record<string, unknown>, order: number): ImportRow | null {
  const title = str(r['Movie']); if (!title) return null;
  const rel = toDate(r['Release date']);
  const yearFromText = str(r['Release date']).match(/(\d{4})/);
  const watched = toDate(r['Watch date']);
  const rw = str(r['Rewatch:'] ?? r['Rewatch']).toLowerCase();
  const id = str(r['imdb ID']);
  return {
    email: str(r['UserEmail']).toLowerCase(), title,
    year: rel ? rel.getFullYear() : yearFromText ? +yearFromText[1] : null,
    imdbId: /^tt\d{6,10}$/.test(id) ? id : null,
    rating: str(r['My rating']) || null,
    score: numOrNull(r['Letterboxd']),
    watchedAt: watched ? watched.toISOString() : null,
    rewatch: rw === '1' || rw === 'true' || rw === 'yes',
    metascore: numOrNull(r['Metacritic']), imdb: numOrNull(r['IMDb']),
    ask: str(r['Ask Slavka AI']) || null, answer: str(r['Slavka AI Answer']) || null, order
  };
}

export function groupRows(rows: ImportRow[]): ImportGroup[] {
  const map = new Map<string, ImportGroup>();
  rows.forEach((r) => {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (r.year ?? '');
    const g = map.get(key) ?? { key, imdbId: r.imdbId, title: r.title, year: r.year, rows: [] };
    if (!g.imdbId && r.imdbId) g.imdbId = r.imdbId;
    g.rows.push(r); map.set(key, g);
  });
  return [...map.values()];
}

export async function parseFile(file: File): Promise<ImportRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames.find((n) => /movie/i.test(n)) ?? wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return json.map((r, i) => normalizeRow(r, i)).filter((r): r is ImportRow => !!r);
}

export interface ImportResult { ok: number; review: number; errors: string[] }

export async function importGroups(groups: ImportGroup[], onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const out: ImportResult = { ok: 0, review: 0, errors: [] };
  const size = 6;
  for (let i = 0; i < groups.length; i += size) {
    const batch = groups.slice(i, i + size);
    const { data, error } = await supabase.functions.invoke('import', { body: { action: 'movies', groups: batch } });
    if (error) { out.errors.push(String(error.message ?? error)); }
    else (data?.results ?? []).forEach((r: any) => { if (r.status === 'ok') out.ok++; else if (r.status === 'review') out.review++; else out.errors.push(r.message ?? 'error'); });
    onProgress?.(Math.min(i + size, groups.length), groups.length);
  }
  return out;
}

export async function storePending(rows: ImportRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await supabase.functions.invoke('import', { body: { action: 'pending', rows } });
  if (error) throw error;
  return data?.stored ?? 0;
}

export async function claimPending(): Promise<ImportRow[]> {
  const { data, error } = await supabase.functions.invoke('import', { body: { action: 'claim' } });
  if (error) return [];
  return (data?.rows ?? []) as ImportRow[];
}

export interface ReviewItem { id: string; payload: ImportGroup; candidates: { sourceId: string; title: string; year: number | null; posterUrl: string | null }[] }

export async function loadReviews(): Promise<ReviewItem[]> {
  const { data } = await supabase.from('import_reviews').select('id, payload, candidates').order('created_at');
  return (data ?? []) as ReviewItem[];
}

/** Accepts a TMDB link/id or an IMDb link/id typed by the user. */
export function parseManualId(input: string): { sourceId?: string; imdbId?: string } | null {
  const s = input.trim();
  const imdb = s.match(/tt\d{6,10}/); if (imdb) return { imdbId: imdb[0] };
  const tmdb = s.match(/themoviedb\.org\/movie\/(\d+)/) || s.match(/^(\d{1,8})$/); if (tmdb) return { sourceId: tmdb[1] };
  return null;
}

export async function resolveReviewManual(item: ReviewItem, ref: { sourceId?: string; imdbId?: string }): Promise<boolean> {
  const g = { ...item.payload, sourceId: ref.sourceId, imdbId: ref.imdbId ?? item.payload.imdbId };
  if (!ref.sourceId) delete (g as any).sourceId;
  const res = await importGroups([g]);
  if (res.ok > 0) { await supabase.from('import_reviews').delete().eq('id', item.id); return true; }
  return false;
}

export async function resolveReview(item: ReviewItem, sourceId: string | null): Promise<void> {
  if (sourceId) await importGroups([{ ...item.payload, sourceId }]);
  await supabase.from('import_reviews').delete().eq('id', item.id);
}
