import { supabase } from './supabase';

export interface ImportRow {
  email: string; title: string; year: number | null; imdbId: string | null; rating: string | null; score: number | null;
  watchedAt: string | null; rewatch: boolean; metascore: number | null; imdb: number | null; ask: string | null; answer: string | null; order: number;
}
export interface ImportGroup { key: string; kind?: 'movie' | 'tv'; sourceId?: string; imdbId: string | null; title: string; year: number | null; rows: ImportRow[] }

// ---------- TV sheet ----------
export interface TvCell { n: number; value: string; date: string | null }
export interface TvImportRow { email: string; title: string; year: number | null; rating: string | null; score: number | null; finishAt: string | null; rewatch: boolean; seasons: TvCell[]; metascore: number | null; imdb: number | null; ask: string | null; answer: string | null; order: number }
export interface TvGroup { key: string; kind: 'tv'; sourceId?: string; imdbId?: string | null; title: string; year: number | null; rows: TvImportRow[]; manual?: boolean }

export function normalizeTvRow(r: Record<string, unknown>, order: number): TvImportRow | null {
  const title = str(r['TV Show']); if (!title) return null;
  const y = str(r['Release date']).match(/(\d{4})/);
  const seasons: TvCell[] = [];
  for (let n = 1; n <= 60; n++) {
    const v = str(r['Season ' + n]); if (!v) continue;
    const d = toDate(r['Season ' + n + ' date']);
    seasons.push({ n, value: v, date: d ? d.toISOString() : null });
  }
  const fin = toDate(r['Finish date']);
  const rw = str(r['Rewatch']).toLowerCase();
  return {
    email: str(r['UserEmail']).toLowerCase(), title, year: y ? +y[1] : null, rating: str(r['My rating']) || null,
    score: numOrNull(r['My score']), finishAt: fin ? fin.toISOString() : null, rewatch: rw === '1' || rw === 'true' || rw === 'yes', seasons,
    metascore: numOrNull(r['Metacritic']), imdb: numOrNull(r['IMDB'] ?? r['IMDb']), ask: str(r['Ask Slavka AI']) || null, answer: str(r['Slavka AI Answer']) || null, order
  };
}

export function groupTvRows(rows: TvImportRow[]): TvGroup[] {
  const map = new Map<string, TvGroup>();
  rows.forEach((r) => {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (r.year ?? '');
    const g = map.get(key) ?? { key, kind: 'tv' as const, title: r.title, year: r.year, rows: [] };
    g.rows.push(r); map.set(key, g);
  });
  return [...map.values()];
}

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

// ---------- games (Console Games / Steam Games sheets) ----------
export interface GameImportRow { email: string; title: string; year: number | null; type: 'game' | 'dlc'; platform: string; rating: string | null; score: number | null; finishAt: string | null; coop: boolean; replay: boolean; progress: number | null; metascore: number | null; ask: string | null; answer: string | null; order: number }
export interface GameGroup { key: string; kind: 'game'; sourceId?: string; title: string; year: number | null; type: 'game' | 'dlc'; rows: GameImportRow[]; manual?: boolean }

/** AppSheet platform names → ours. The Steam sheet's "PS VR2" is the headset on PC. */
const PLATFORM_MAP: Record<string, string> = {
  'playstation 5': 'ps5', 'playstation 4': 'ps4', 'playstation 3': 'ps3', 'playstation 2': 'ps2', 'playstation': 'ps1', 'playstation vita': 'vita', 'playstation portable': 'psp',
  'playstation vr': 'psvr', 'playstation vr2': 'psvr2-ps5', 'xbox series x': 'xbox-series', 'xbox series s': 'xbox-series', 'xbox series x|s': 'xbox-series', 'xbox one': 'xbox-one', 'xbox 360': 'xbox-360', 'xbox': 'xbox',
  'nes': 'nes', 'snes': 'snes', 'sega genesis': 'genesis', 'sega mega drive': 'genesis', 'game boy': 'gb', 'game boy color': 'gbc', 'game boy advance': 'gba', 'nintendo 64': 'n64',
  'nintendo wii': 'wii', 'wii': 'wii', 'wii u': 'wii-u', 'nintendo switch': 'switch', 'switch': 'switch', 'nintendo ds': 'ds', 'nintendo 3ds': '3ds', 'gamecube': 'gamecube', 'nintendo gamecube': 'gamecube',
  'sega saturn': 'saturn', 'dreamcast': 'dreamcast', 'steam deck': 'steam-deck', 'pc': 'pc', 'ps vr2': 'psvr2-pc'
};
export function normalizeGameRow(r: Record<string, unknown>, order: number, sheet: 'console' | 'steam'): GameImportRow | null {
  const titleKey = Object.keys(r).find((k) => /games/i.test(k)) ?? Object.keys(r)[0];
  const title = str(r[titleKey]); if (!title) return null;
  const rel = r['Release date'];
  const y = rel instanceof Date ? rel.getFullYear() : Number(str(rel).match(/(\d{4})/)?.[1]) || null;
  const raw = str(r['Platform']).toLowerCase();
  const platform = PLATFORM_MAP[raw] ?? (raw === 'ps vr2' && sheet === 'console' ? 'psvr2-ps5' : raw ? raw.replace(/[^a-z0-9]+/g, '-') : sheet === 'steam' ? 'pc' : 'ps5');
  const fin = toDate(r['Finish date']);
  const yes = (v: unknown) => { const x = str(v).toLowerCase(); return x === '1' || x === 'true' || x === 'yes'; };
  return {
    email: str(r['UserEmail']).toLowerCase(), title, year: y, type: str(r['Type']).toLowerCase() === 'dlc' ? 'dlc' : 'game', platform,
    rating: str(r['My rating']) || null, score: numOrNull(r['My score']), finishAt: fin ? fin.toISOString() : null,
    coop: yes(r['Co-op']), replay: yes(r['Replay']), progress: numOrNull(r['Completion %']), metascore: numOrNull(r['Metacritic']),
    ask: str(r['Ask Slavka AI']) || null, answer: str(r['Slavka AI Answer']) || null, order
  };
}
export function groupGameRows(rows: GameImportRow[]): GameGroup[] {
  const map = new Map<string, GameGroup>();
  rows.forEach((r) => {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + r.type;
    const g = map.get(key) ?? { key, kind: 'game' as const, title: r.title, year: r.year, type: r.type, rows: [] };
    g.rows.push(r); map.set(key, g);
  });
  return [...map.values()];
}

export type Parsed = { kind: 'movie'; rows: ImportRow[] } | { kind: 'tv'; rows: TvImportRow[] } | { kind: 'game'; rows: GameImportRow[] };

/** What a file contains: one kind per sheet type found (a full AppSheet export has all three). */
export async function parseFileAll(file: File): Promise<Parsed[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null });
  const out: Parsed[] = [];
  const movieSheet = wb.SheetNames.find((n) => /^movies?$/i.test(n.trim()));
  const tvSheet = wb.SheetNames.find((n) => /^tv shows?$/i.test(n.trim()));
  const consoleSheet = wb.SheetNames.find((n) => /console games/i.test(n));
  const steamSheet = wb.SheetNames.find((n) => /steam games|pc games/i.test(n));
  if (consoleSheet || steamSheet) {
    const rows: GameImportRow[] = [];
    if (consoleSheet) sheet(consoleSheet).forEach((r, i) => { const x = normalizeGameRow(r, i, 'console'); if (x) rows.push(x); });
    if (steamSheet) sheet(steamSheet).forEach((r, i) => { const x = normalizeGameRow(r, 10000 + i, 'steam'); if (x) rows.push(x); });
    out.push({ kind: 'game', rows });
  }
  if (tvSheet) out.push({ kind: 'tv', rows: sheet(tvSheet).map((r, i) => normalizeTvRow(r, i)).filter((r): r is TvImportRow => !!r) });
  if (movieSheet) out.push({ kind: 'movie', rows: sheet(movieSheet).map((r, i) => normalizeRow(r, i)).filter((r): r is ImportRow => !!r) });
  if (!out.length) {
    // a single exported sheet (older files)
    const json = sheet(wb.SheetNames.find((n) => /movie|tv|show/i.test(n)) ?? wb.SheetNames[0]);
    if (json.length && 'TV Show' in json[0]) out.push({ kind: 'tv', rows: json.map((r, i) => normalizeTvRow(r, i)).filter((r): r is TvImportRow => !!r) });
    else out.push({ kind: 'movie', rows: json.map((r, i) => normalizeRow(r, i)).filter((r): r is ImportRow => !!r) });
  }
  return out;
}
export async function parseFile(file: File): Promise<Parsed> { return (await parseFileAll(file))[0]; }

export interface ImportResult { ok: number; review: number; errors: string[] }

export async function importGroups(groups: (ImportGroup | TvGroup | GameGroup)[], onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const out: ImportResult = { ok: 0, review: 0, errors: [] };
  const tv = groups.length > 0 && groups[0].kind === 'tv';
  const games = groups.length > 0 && groups[0].kind === 'game';
  const size = tv ? 2 : games ? 4 : 6;
  for (let i = 0; i < groups.length; i += size) {
    const batch = groups.slice(i, i + size);
    const { data, error } = await supabase.functions.invoke('import', { body: { action: games ? 'games' : tv ? 'tv' : 'movies', groups: batch } });
    if (error) { out.errors.push(String(error.message ?? error)); }
    else (data?.results ?? []).forEach((r: any) => { if (r.status === 'ok') out.ok++; else if (r.status === 'review') out.review++; else out.errors.push(r.message ?? 'error'); });
    onProgress?.(Math.min(i + size, groups.length), groups.length);
  }
  return out;
}

export async function storePending(rows: (ImportRow | TvImportRow | GameImportRow)[], section: 'movies' | 'tv' | 'games' = 'movies'): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await supabase.functions.invoke('import', { body: { action: 'pending', rows, section } });
  if (error) throw error;
  return data?.stored ?? 0;
}

/** Tell the server the claimed rows are imported, so it can forget them. */
export async function ackPending(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabase.functions.invoke('import', { body: { action: 'ack', ids } });
}

export async function claimPending(): Promise<{ ids: string[]; movies: ImportRow[]; tv: TvImportRow[]; games: GameImportRow[] }> {
  const { data, error } = await supabase.functions.invoke('import', { body: { action: 'claim' } });
  if (error) return { ids: [], movies: [], tv: [], games: [] };
  return { ids: (data?.ids ?? []) as string[], movies: (data?.rows ?? []) as ImportRow[], tv: (data?.tvRows ?? []) as TvImportRow[], games: (data?.gameRows ?? []) as GameImportRow[] };
}

export interface ReviewItem { id: string; section?: string; payload: ImportGroup | TvGroup | GameGroup; candidates: { sourceId: string; title: string; year: number | null; posterUrl: string | null }[] }

export async function loadReviews(): Promise<ReviewItem[]> {
  const { data } = await supabase.from('import_reviews').select('id, section, payload, candidates').order('created_at');
  return (data ?? []) as ReviewItem[];
}

/** Accepts a TMDB link/id or an IMDb link/id typed by the user. */
export function parseManualId(input: string): { sourceId?: string; imdbId?: string } | null {
  const s = input.trim();
  const imdb = s.match(/tt\d{6,10}/); if (imdb) return { imdbId: imdb[0] };
  const tmdb = s.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/) || s.match(/^(\d{1,8})$/); if (tmdb) return { sourceId: tmdb[1] };
  return null;
}

export async function resolveReviewManual(item: ReviewItem, ref: { sourceId?: string; imdbId?: string }): Promise<boolean> {
  const g = { ...item.payload, sourceId: ref.sourceId, imdbId: ref.imdbId ?? (item.payload as ImportGroup).imdbId, manual: true } as ImportGroup | TvGroup | GameGroup;
  if (!ref.sourceId) delete (g as any).sourceId;
  const res = await importGroups([g]);
  if (res.ok > 0) { await supabase.from('import_reviews').delete().eq('id', item.id); return true; }
  return false;
}

export async function resolveReview(item: ReviewItem, sourceId: string | null): Promise<void> {
  if (sourceId) await importGroups([{ ...item.payload, sourceId } as ImportGroup | TvGroup | GameGroup]);
  await supabase.from('import_reviews').delete().eq('id', item.id);
}
