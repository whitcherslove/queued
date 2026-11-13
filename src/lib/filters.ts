import type { LibItem, LogRow } from './types';
import { isEnded } from './tv';

/** List filters (per section, remembered): the same few for every section, each read its own way. */
export interface Filters { tiers: string[]; genres: string[]; decades: string[]; length: string | null; platforms: string[]; formats: string[]; doneWhen: string | null; coop: boolean; ended: boolean; released: boolean }
export const NO_FILTERS: Filters = { tiers: [], genres: [], decades: [], length: null, platforms: [], formats: [], doneWhen: null, coop: false, ended: false, released: false };
export type Kind = 'movie' | 'tv' | 'game' | 'book';

export const DECADES = [{ id: '2020', label: '2020s' }, { id: '2010', label: '2010s' }, { id: '2000', label: '2000s' }, { id: '1990', label: '90s' }, { id: 'old', label: 'Older' }];
export const LENGTHS: Record<Kind, { id: string; label: string }[]> = {
  movie: [{ id: 's', label: '< 1.5 h' }, { id: 'm', label: '1.5–2.5 h' }, { id: 'l', label: '> 2.5 h' }],
  game: [{ id: 's', label: '< 10 h' }, { id: 'm', label: '10–30 h' }, { id: 'l', label: '30 h+' }],
  book: [{ id: 's', label: '< 300 pages' }, { id: 'm', label: '300–600' }, { id: 'l', label: '600+' }],
  tv: [{ id: 's', label: '1 season' }, { id: 'm', label: '2–4 seasons' }, { id: 'l', label: '5+ seasons' }]
};
export const DONE_WHEN = [{ id: 'this', label: 'This year' }, { id: 'last', label: 'Last year' }, { id: 'older', label: 'Earlier' }];

const data = (it: LibItem) => ({ ...((it.title.data as Record<string, unknown> | null) ?? {}), ...((it.overrides as Record<string, unknown> | null) ?? {}) }) as { ttb?: { main?: number | null }; pages?: number | null; seasons?: unknown[] };
const decadeOf = (y: number | null | undefined) => (!y ? null : y >= 2020 ? '2020' : y >= 2010 ? '2010' : y >= 2000 ? '2000' : y >= 1990 ? '1990' : 'old');
function lengthOf(it: LibItem, kind: Kind): string | null {
  const d = data(it);
  const v = kind === 'movie' ? it.title.runtime : kind === 'game' ? d.ttb?.main : kind === 'book' ? d.pages : (d.seasons ?? []).length;
  if (v == null || v === 0) return null;
  const [a, b] = kind === 'movie' ? [90, 150] : kind === 'game' ? [10, 30] : kind === 'book' ? [300, 600] : [1, 4];
  return kind === 'tv' ? (v <= a ? 's' : v <= b ? 'm' : 'l') : (v < a ? 's' : v <= b ? 'm' : 'l');
}

export const activeCount = (f: Filters) =>
  [f.tiers.length, f.genres.length, f.decades.length, f.length ? 1 : 0, f.platforms.length, f.formats.length, f.doneWhen ? 1 : 0, f.coop ? 1 : 0, f.ended ? 1 : 0, f.released ? 1 : 0].filter(Boolean).length;

/** Does a title pass the filters? (the rating and "when finished" ones need a journal entry: see passLog) */
export function passItem(it: LibItem, f: Filters, kind: Kind, today: string): boolean {
  if (f.genres.length && !(it.title.genres ?? []).some((g) => f.genres.includes(g))) return false;
  if (f.decades.length && !f.decades.includes(decadeOf(it.title.year) ?? '-')) return false;
  if (f.length && lengthOf(it, kind) !== f.length) return false;
  if (f.platforms.length && !f.platforms.includes((it as { platform?: string | null }).platform ?? '')) return false;
  if (f.formats.length && !f.formats.includes((it as { format?: string | null }).format ?? '')) return false;
  if (f.coop && !(it as { coop?: boolean }).coop) return false;
  if (f.ended && !isEnded(it.title)) return false;
  if (f.released && !(it.title.release_date ? it.title.release_date <= today : !!it.title.year)) return false;
  return true;
}
export function passLog(l: LogRow, f: Filters, kind: Kind, today: string): boolean {
  if (!passItem(l.library, { ...f, released: false }, kind, today)) return false;
  if (f.tiers.length && !f.tiers.includes(l.tier ?? 'none')) return false;
  if (f.doneWhen) {
    const y = Number(l.watched_at.slice(0, 4)), now = Number(today.slice(0, 4));
    if (f.doneWhen === 'this' && y !== now) return false;
    if (f.doneWhen === 'last' && y !== now - 1) return false;
    if (f.doneWhen === 'older' && y >= now - 1) return false;
  }
  return true;
}
