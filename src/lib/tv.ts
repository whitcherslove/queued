import type { LibItem, Mark, SeasonEps, Title, TvSeason } from './types';

const localDayOf = (iso: string) => { if (iso.length <= 10) return iso; const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

export function seasonsOf(t: Title): TvSeason[] {
  return (((t.data as any)?.seasons ?? []) as TvSeason[]).filter((s) => s.n > 0).sort((a, b) => a.n - b.n);
}

export function isEnded(t: Title): boolean {
  return ['Ended', 'Canceled'].includes((t.data as any)?.status);
}

type PlanLike = Pick<LibItem, 'plan_from' | 'plan_to' | 'plan_seasons'>;
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/** The planned seasons as a list, or null for the full series. */
export function planOf(item: PlanLike): number[] | null {
  if (item.plan_seasons && item.plan_seasons.length) return [...item.plan_seasons].sort((a, b) => a - b);
  if (item.plan_from != null) return range(item.plan_from, item.plan_to ?? item.plan_from);
  return null;
}

/** Seasons a journal entry covers, or null for the full series. */
export function logSeasons(l: { scope?: string; season_from?: number | null; season_to?: number | null; seasons?: number[] | null }): number[] | null {
  if (l.scope === 'show') return null;
  if (l.seasons && l.seasons.length) return [...l.seasons].sort((a, b) => a - b);
  if (l.season_from != null) return range(l.season_from, l.season_to ?? l.season_from);
  return null;
}

/** Seasons covered by the plan: full series = every season. */
export function scopeSeasons(item: PlanLike, t: Title): number[] {
  const all = seasonsOf(t).map((s) => s.n), plan = planOf(item);
  return plan ? all.filter((n) => plan.includes(n)) : all;
}

/** "Season 3", "Seasons 1–3", "Seasons 1, 3", "Full series" */
export function seasonsName(list: number[] | null): string {
  if (!list || !list.length) return 'Full series';
  if (list.length === 1) return 'Season ' + list[0];
  const contiguous = list.every((n, i) => i === 0 || n === list[i - 1] + 1);
  return contiguous ? 'Seasons ' + list[0] + '–' + list[list.length - 1] : 'Seasons ' + list.join(', ');
}

const yr = (d: string | null | undefined) => (d ? d.slice(0, 4) : '');

export function showYears(t: Title): string {
  const first = yr(t.release_date) || (t.year ? String(t.year) : '');
  const last = yr((t.data as any)?.last_air_date);
  if (!isEnded(t)) return first ? first + '–' : '';
  return first && last && last !== first ? first + '–' + last : first;
}

/** "Full series · 1999–2007", "Season 3 · 2026", "Seasons 1–3 · 2023–2025", "Seasons 1, 3 · 2023–2026" */
export function scopeLabel(list: number[] | null, t: Title): string {
  if (!list || !list.length) return 'Full series' + (showYears(t) ? ' · ' + showYears(t) : '');
  const ss = seasonsOf(t), sorted = [...list].sort((x, y) => x - y);
  const a = yr(ss.find((s) => s.n === sorted[0])?.air_date), b = yr(ss.find((s) => s.n === sorted[sorted.length - 1])?.air_date);
  const years = a && b && a !== b ? a + '–' + b : a || b;
  return seasonsName(sorted) + (years ? ' · ' + years : '');
}

export function logScope(list: number[] | null) {
  if (!list || !list.length) return { scope: 'show' as const, season_from: null, season_to: null, seasons: null };
  const s = [...list].sort((a, b) => a - b);
  return { scope: (s.length === 1 ? 'season' : 'seasons') as 'season' | 'seasons', season_from: s[0], season_to: s[s.length - 1], seasons: s };
}

export interface EpRef { season: number; episode: number; name: string; air_date: string | null }
export interface Progress {
  aired: number; seen: number; total: number; pct: number;
  nextEp: EpRef | null; nextFuture: EpRef | null; lastSeen: string | null;
  complete: boolean; caughtUp: boolean; anySeen: boolean;
}

/** Progress over the planned seasons. During a rewatch, marks older than the rewatch start do not count. */
export function progress(item: Pick<LibItem, 'plan_from' | 'plan_to' | 'plan_seasons' | 'run_started_at'> & { rewatch?: boolean }, t: Title, eps: SeasonEps[], marks: Mark[], today = todayIso()): Progress {
  const scope = scopeSeasons(item, t);
  // Only a rewatch starts from scratch; otherwise every mark counts, whenever it was made.
  const since = item.rewatch ? item.run_started_at ?? '' : '';
  const seenSet = new Set(marks.filter((m) => m.watched_at >= since).map((m) => m.season + ':' + m.episode));
  let aired = 0, seen = 0, total = 0, nextEp: EpRef | null = null, nextFuture: EpRef | null = null, lastSeen: string | null = null;
  const known = new Set(eps.map((e) => e.season));
  scope.forEach((sn) => {
    const se = eps.find((e) => e.season === sn);
    (se?.episodes ?? []).forEach((e) => {
      total++;
      const ref = { season: sn, episode: e.n, name: e.name, air_date: e.air_date };
      const isAired = !!e.air_date && e.air_date <= today;
      if (isAired) {
        aired++;
        if (seenSet.has(sn + ':' + e.n)) seen++;
        else if (!nextEp) nextEp = ref;
      } else if (!nextFuture) nextFuture = ref;
    });
  });
  marks.forEach((m) => { if (m.watched_at >= since && scope.includes(m.season) && (!lastSeen || m.watched_at > lastSeen)) lastSeen = m.watched_at; });
  const allKnown = scope.length > 0 && scope.every((n) => known.has(n));
  const fullyAired = total > 0 && aired === total;
  const planEndsInPast = planOf(item) !== null || isEnded(t);
  const complete = allKnown && fullyAired && seen === aired && planEndsInPast;
  return { aired, seen, total, pct: aired ? Math.round((seen / aired) * 100) : 0, nextEp, nextFuture, lastSeen, complete, caughtUp: aired > 0 && seen === aired && !complete, anySeen: seen > 0 };
}

export function epLabel(e: { season: number; episode: number }): string {
  return 'S' + e.season + ' · E' + e.episode;
}

type LogLike = { scope?: string; season_from?: number | null; season_to?: number | null; seasons?: number[] | null; watched_at: string; tier?: string | null };

/**
 * Seasons covered by your journal. A "Full series" entry of an ended show covers every season;
 * of a running show — every season that had aired by then.
 */
export function coveredSeasons(t: Title, logs: LogLike[]): Set<number> {
  const ss = seasonsOf(t), out = new Set<number>();
  logs.forEach((l) => {
    const list = logSeasons(l);
    if (list) list.forEach((n) => out.add(n));
    else ss.forEach((s) => { if (isEnded(t) || (s.air_date && s.air_date <= localDayOf(l.watched_at))) out.add(s.n); });
  });
  return out;
}

/** Highest season covered by your journal. */
export function maxLoggedSeason(t: Title, logs: LogLike[]): number {
  return Math.max(0, ...coveredSeasons(t, logs));
}

/** Seasons that appeared after the ones you've logged (announced or already out). */
export function newSeasons(t: Title, logs: LogLike[]): number[] {
  if (!logs.length) return [];
  const max = maxLoggedSeason(t, logs);
  return seasonsOf(t).filter((s) => s.n > max).map((s) => s.n);
}

export function seasonAir(t: Title, n: number): string | null {
  return seasonsOf(t).find((s) => s.n === n)?.air_date ?? null;
}

type FollowLog = LogLike & { tier?: string | null };
const localDayOfIso = (iso: string) => { if (iso.length <= 10) return iso; const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/**
 * Seasons a followed show waits for in Caught up (empty list = "up to date, no new season yet"), or null if it isn't followed.
 * Followed = has journal entries, not stopped/dropped/being rewatched; ended shows only for a season that premiered after your last entry.
 */
export function followSeasons(i: Pick<LibItem, 'section' | 'status' | 'rewatch' | 'plan_from' | 'plan_to' | 'plan_seasons' | 'title'>, mine: FollowLog[]): number[] | null {
  if (i.section !== 'tv' || i.status === 'playing' || i.status === 'dropped' || i.rewatch || !mine.length) return null;
  const latest = mine.slice().sort((a, b) => b.watched_at.localeCompare(a.watched_at))[0];
  if (latest.tier === 'dropped') return null;
  const covered = coveredSeasons(i.title, mine);
  let list = (i.status === 'backlog' ? planOf(i) ?? [] : newSeasons(i.title, mine)).filter((n) => !covered.has(n));
  if (isEnded(i.title)) { const since = localDayOfIso(latest.watched_at); list = list.filter((n) => { const d = seasonAir(i.title, n); return !!d && d > since; }); return list.length ? list : null; }
  return list;
}

/** Could this show sit in Caught up if you followed it? (running, logged, not rated Dropped) */
export function canFollow(t: Title, mine: FollowLog[]): boolean {
  if (!mine.length) return false;
  const latest = mine.slice().sort((a, b) => b.watched_at.localeCompare(a.watched_at))[0];
  return latest.tier !== 'dropped' && !isEnded(t);
}
