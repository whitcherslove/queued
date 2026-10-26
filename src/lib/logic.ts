import type { LibItem, LogRow, SearchHit } from './types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function releaseText(iso: string | null, year: number | null): string {
  if (!iso) return year ? String(year) : '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}

export function runtimeText(min: number | null): string {
  if (!min) return '';
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function dateParts(iso: string): { day: number; mon: string; year: string } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
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
  if (s.length < 2) return [];
  return items.filter((i) => i.title.title.toLowerCase().includes(s) || i.title.directors.some((d) => d.toLowerCase().includes(s)));
}

export function newHits(hits: SearchHit[], items: LibItem[]): SearchHit[] {
  const owned = new Set(items.map((i) => i.title.source_id));
  return hits.filter((h) => !owned.has(h.sourceId));
}

export function nextPosition(items: LibItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
}
