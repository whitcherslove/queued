import type { ItemLog, LibItem, LogRow, Overrides, SearchHit, Title } from './types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar day in the phone's time zone ("2026-10-28"); plain dates pass through unchanged. */
export function localDay(iso: string): string {
  if (iso.length <= 10) return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Same moment-of-day, moved to another local calendar day; returns an ISO timestamp. */
export function withLocalDay(iso: string, day: string): string {
  const d = new Date(iso), [y, m, dd] = day.split('-').map(Number);
  const base = isNaN(d.getTime()) ? new Date(y, m - 1, dd, 20, 0) : new Date(y, m - 1, dd, d.getHours(), d.getMinutes(), d.getSeconds());
  return base.toISOString();
}

export function releaseText(iso: string | null, year: number | null): string {
  if (!iso) return year ? String(year) : '';
  const [y, m, d] = localDay(iso).split('-').map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}

export function runtimeText(min: number | null): string {
  if (!min) return '';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function dateParts(iso: string): { day: number; mon: string; year: string } {
  const [y, m, d] = localDay(iso).split('-').map(Number);
  return { day: d, mon: MON[m - 1], year: String(y) };
}

/** Move an id to the index of another id inside an ordered list. */
export function moveId(ids: string[], id: string, toId: string): string[] {
  const from = ids.indexOf(id), to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return ids.slice();
  const a = ids.slice(); a.splice(from, 1); a.splice(to, 0, id); return a;
}

export function moveBy(ids: string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id), to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids.slice();
  const a = ids.slice(); a.splice(from, 1); a.splice(to, 0, id); return a;
}

export function splitBacklog(items: LibItem[]): { next: LibItem[]; rest: LibItem[] } {
  const back = items.filter((i) => i.status === 'backlog').sort((a, b) => a.position - b.position);
  return { next: back.filter((i) => i.up_next), rest: back.filter((i) => !i.up_next) };
}

/** Watched list: newest first unless the user set a custom order. */
export function sortLogs(logs: LogRow[]): LogRow[] {
  const custom = logs.some((l) => l.position !== null);
  return logs.slice().sort((a, b) => custom ? (a.position ?? 0) - (b.position ?? 0) : b.watched_at.localeCompare(a.watched_at));
}

export function matchLibrary(items: LibItem[], q: string): LibItem[] {
  const s = q.trim().toLowerCase();
  if (s.length < 1) return [];
  return items.filter((i) => i.title.title.toLowerCase().includes(s) || i.title.directors.some((d) => d.toLowerCase().includes(s)));
}

export function newHits(hits: SearchHit[], items: LibItem[]): SearchHit[] {
  const owned = new Set(items.map((i) => i.title.source_id));
  return hits.filter((h) => !owned.has(h.sourceId));
}

export function nextPosition(items: LibItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
}

/** Title with the user's own edits applied on top of the cached data. */
export function merged(t: Title, o: Overrides | null | undefined): Title {
  const { status, ...rest } = (o ?? {}) as Overrides;
  const out = { ...t, ...rest } as Title;
  // your own "has ended / still running" wins over TMDB (some shows are never updated there)
  if (status) out.data = { ...(t.data ?? {}), status };
  return out;
}

/** Only keep fields that differ from the source data. */
export function diffOverrides(base: Title, edited: Overrides): Overrides {
  const out: Overrides = {};
  (Object.keys(edited) as (keyof Overrides)[]).forEach((k) => {
    const a = JSON.stringify(edited[k] ?? null), b = JSON.stringify((base as any)[k] ?? null);
    if (a !== b) (out as any)[k] = edited[k];
  });
  return out;
}

export function latestLog(logs: ItemLog[]): ItemLog | null {
  return logs.reduce<ItemLog | null>((m, l) => (!m || l.watched_at > m.watched_at ? l : m), null);
}

/** Metacritic search, e.g. https://www.metacritic.com/search/mario?category=2 (2 movies, 1 TV shows, 13 games). */
export function metacriticSearch(title: string, kind: 'movie' | 'tv' | 'game'): string {
  const category = kind === 'tv' ? 1 : kind === 'game' ? 13 : 2;
  return 'https://www.metacritic.com/search/' + encodeURIComponent(title) + '?category=' + category;
}

export function money(v: unknown): string {
  const n = Number(v);
  if (!n) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (n >= 1e6) return '$' + Math.round(n / 1e6) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + n;
}

export function longDate(iso: string): string {
  const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, m, d] = localDay(iso).split('-').map(Number);
  return `${MONL[m - 1]} ${d}, ${y}`;
}

export function parseNum(v: string, max: number, step: number): { ok: boolean; n: number | null } {
  const s = v.trim().replace(',', '.');
  if (!s) return { ok: true, n: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false, n: null };
  return { ok: true, n: Math.round(n / step) * step };
}

/** New backlog entries go to the very top. */
export function topPosition(items: LibItem[]): number {
  return items.length ? Math.min(...items.map((i) => i.position)) - 1 : 0;
}

/** Short country names: "United States of America" / "US" → "USA", "United Kingdom" / "GB" → "UK" (movies come as names, shows as codes). */
const COUNTRY: Record<string, string> = {
  'united states of america': 'USA', 'united states': 'USA', us: 'USA', usa: 'USA',
  'united kingdom': 'UK', 'great britain': 'UK', gb: 'UK', uk: 'UK',
  'russian federation': 'Russia', ru: 'Russia', 'korea, republic of': 'South Korea', 'south korea': 'South Korea', kr: 'South Korea',
  'united arab emirates': 'UAE', ae: 'UAE', 'czech republic': 'Czechia', cz: 'Czechia', 'new zealand': 'New Zealand', nz: 'New Zealand',
  ca: 'Canada', au: 'Australia', fr: 'France', de: 'Germany', jp: 'Japan', es: 'Spain', it: 'Italy', ie: 'Ireland', dk: 'Denmark', se: 'Sweden', no: 'Norway', mx: 'Mexico', br: 'Brazil', in: 'India', cn: 'China', be: 'Belgium', nl: 'Netherlands', pl: 'Poland', ua: 'Ukraine', il: 'Israel', tr: 'Turkey', za: 'South Africa', ar: 'Argentina', fi: 'Finland', at: 'Austria', ch: 'Switzerland', hu: 'Hungary', is: 'Iceland', tw: 'Taiwan', hk: 'Hong Kong'
};
export function shortCountries(list: string[] | null | undefined): string {
  return (list ?? []).map((c) => COUNTRY[String(c).trim().toLowerCase()] ?? c).join(', ');
}
