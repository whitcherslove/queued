import type { LibItem, Mark, SeasonEps, Title, TvSeason } from './types';

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function seasonsOf(t: Title): TvSeason[] {
  return (((t.data as any)?.seasons ?? []) as TvSeason[]).filter((s) => s.n > 0).sort((a, b) => a.n - b.n);
}

export function isEnded(t: Title): boolean {
  return ['Ended', 'Canceled'].includes((t.data as any)?.status);
}

/** Seasons covered by the plan: full series = every season, otherwise from..to. */
export function scopeSeasons(item: Pick<LibItem, 'plan_from' | 'plan_to'>, t: Title): number[] {
  const all = seasonsOf(t).map((s) => s.n);
  if (item.plan_from == null) return all;
  const to = item.plan_to ?? item.plan_from;
  return all.filter((n) => n >= item.plan_from! && n <= to);
}

const yr = (d: string | null | undefined) => (d ? d.slice(0, 4) : '');

export function showYears(t: Title): string {
  const first = yr(t.release_date) || (t.year ? String(t.year) : '');
  const last = yr((t.data as any)?.last_air_date);
  if (!isEnded(t)) return first ? first + '–' : '';
  return first && last && last !== first ? first + '–' + last : first;
}

/** "Full series · 1999–2007", "Season 3 · 2026", "Seasons 1–3 · 2023–2025" */
export function scopeLabel(from: number | null | undefined, to: number | null | undefined, t: Title): string {
  if (from == null) return 'Full series' + (showYears(t) ? ' · ' + showYears(t) : '');
  const t2 = to ?? from, ss = seasonsOf(t);
  const a = yr(ss.find((s) => s.n === from)?.air_date), b = yr(ss.find((s) => s.n === t2)?.air_date);
  const years = a && b && a !== b ? a + '–' + b : a || b;
  return (from === t2 ? 'Season ' + from : 'Seasons ' + from + '–' + t2) + (years ? ' · ' + years : '');
}

export function logScope(from: number | null | undefined, to: number | null | undefined): { scope: 'show' | 'season' | 'seasons'; season_from: number | null; season_to: number | null } {
  if (from == null) return { scope: 'show', season_from: null, season_to: null };
  const t2 = to ?? from;
  return { scope: from === t2 ? 'season' : 'seasons', season_from: from, season_to: t2 };
}

export interface EpRef { season: number; episode: number; name: string; air_date: string | null }
export interface Progress {
  aired: number; seen: number; total: number; pct: number;
  nextEp: EpRef | null; nextFuture: EpRef | null; lastSeen: string | null;
  complete: boolean; caughtUp: boolean; anySeen: boolean;
}

/** Progress of the current run over the planned seasons. Marks older than the run start do not count. */
export function progress(item: Pick<LibItem, 'plan_from' | 'plan_to' | 'run_started_at'>, t: Title, eps: SeasonEps[], marks: Mark[], today = todayIso()): Progress {
  const scope = scopeSeasons(item, t);
  const since = item.run_started_at ?? '';
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
  const planEndsInPast = item.plan_from != null || isEnded(t);
  const complete = allKnown && fullyAired && seen === aired && planEndsInPast;
  return { aired, seen, total, pct: aired ? Math.round((seen / aired) * 100) : 0, nextEp, nextFuture, lastSeen, complete, caughtUp: aired > 0 && seen === aired && !complete, anySeen: seen > 0 };
}

export function epLabel(e: { season: number; episode: number }): string {
  return 'S' + e.season + ' · E' + e.episode;
}
