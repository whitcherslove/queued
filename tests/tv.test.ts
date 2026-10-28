import { describe, expect, it } from 'vitest';
import { coveredSeasons, logScope, maxLoggedSeason, newSeasons, planOf, progress, scopeLabel, scopeSeasons, seasonsName, showYears } from '../src/lib/tv';
import type { Mark, SeasonEps, Title } from '../src/lib/types';

const show = (status: string, seasons: [number, string, number][], extra: Record<string, unknown> = {}): Title => ({
  id: 't', kind: 'tv', source: 'tmdb', source_id: '1', imdb_id: null, title: 'Show', release_date: seasons[0]?.[1] ?? null, year: 2020, runtime: 50,
  directors: [], genres: [], overview: null, poster_url: null, backdrop_url: null, metascore: null, imdb_rating: null,
  data: { status, seasons: seasons.map(([n, d, c]) => ({ n, name: 'Season ' + n, air_date: d, episode_count: c })), ...extra }
});
const eps = (season: number, dates: string[]): SeasonEps => ({ title_id: 't', season, name: null, air_date: dates[0], episodes: dates.map((d, i) => ({ n: i + 1, name: 'Ep ' + (i + 1), air_date: d })) });
const mark = (season: number, episode: number, at = '2026-10-20T20:00:00Z'): Mark => ({ library_id: 'l', season, episode, watched_at: at });

describe('tv labels', () => {
  const t = show('Ended', [[1, '1999-01-10', 2], [2, '2000-01-16', 2], [3, '2001-03-04', 2]], { last_air_date: '2007-06-10' });
  it('scopes and labels', () => {
    expect(scopeSeasons({ plan_from: null, plan_to: null }, t)).toEqual([1, 2, 3]);
    expect(scopeSeasons({ plan_from: 2, plan_to: 3 }, t)).toEqual([2, 3]);
    expect(scopeSeasons({ plan_seasons: [1, 3] }, t)).toEqual([1, 3]);
    expect(planOf({ plan_seasons: [3, 1] })).toEqual([1, 3]);
    expect(showYears(t)).toBe('1999–2007');
    expect(scopeLabel(null, t)).toBe('Full series · 1999–2007');
    expect(scopeLabel([3], t)).toBe('Season 3 · 2001');
    expect(scopeLabel([1, 2], t)).toBe('Seasons 1–2 · 1999–2000');
    expect(scopeLabel([3, 1], t)).toBe('Seasons 1, 3 · 1999–2001');
    expect(seasonsName([1, 2, 4])).toBe('Seasons 1, 2, 4');
    expect(logScope([2])).toEqual({ scope: 'season', season_from: 2, season_to: 2, seasons: [2] });
    expect(logScope(null).scope).toBe('show');
    expect(showYears(show('Returning Series', [[1, '2022-02-04', 1]]))).toBe('2022–');
  });
});

describe('tv progress', () => {
  it('runs through a planned season to completion', () => {
    const t = show('Returning Series', [[1, '2023-05-05', 2], [2, '2024-11-15', 2], [3, '2026-09-04', 3]]);
    const e = [eps(1, ['2023-05-05', '2023-05-12']), eps(2, ['2024-11-15', '2024-11-22']), eps(3, ['2026-09-04', '2026-09-11', '2026-12-01'])];
    const plan = { plan_from: 2, plan_to: 2, run_started_at: '2026-10-01T00:00:00Z' };
    let p = progress(plan, t, e, [mark(2, 1)], '2026-10-28');
    expect(p.seen).toBe(1); expect(p.nextEp?.episode).toBe(2); expect(p.complete).toBe(false);
    p = progress(plan, t, e, [mark(2, 1), mark(2, 2)], '2026-10-28');
    expect(p.complete).toBe(true);
    // marks from an earlier run do not count
    p = progress(plan, t, e, [mark(2, 1, '2025-01-01T00:00:00Z')], '2026-10-28');
    expect(p.seen).toBe(0);
    // a season that hasn't fully aired is caught up, not complete
    const p3 = progress({ plan_seasons: [3], run_started_at: null }, t, e, [mark(3, 1), mark(3, 2)], '2026-10-28');
    const p13 = progress({ plan_seasons: [1, 3], run_started_at: null }, t, e, [mark(1, 1), mark(1, 2)], '2026-10-28');
    expect(p13.nextEp?.season).toBe(3);
    expect(p3.complete).toBe(false); expect(p3.caughtUp).toBe(true); expect(p3.nextFuture?.episode).toBe(3);
  });
  it('full series completes only when the show has ended', () => {
    const e = [eps(1, ['2019-05-06', '2019-05-13'])];
    const all = [mark(1, 1), mark(1, 2)];
    expect(progress({ plan_from: null, plan_to: null, run_started_at: null }, show('Ended', [[1, '2019-05-06', 2]]), e, all, '2026-10-28').complete).toBe(true);
    const running = progress({ plan_from: null, plan_to: null, run_started_at: null }, show('Returning Series', [[1, '2019-05-06', 2]]), e, all, '2026-10-28');
    expect(running.complete).toBe(false); expect(running.caughtUp).toBe(true);
  });
});

describe('new seasons', () => {
  it('finds seasons after the logged ones', () => {
    const t = show('Returning Series', [[1, '2022-02-04', 8], [2, '2023-12-15', 8], [3, '2025-02-20', 8], [4, '2027-01-01', 8]]);
    expect(newSeasons(t, [{ scope: 'seasons', seasons: [1, 2, 3], watched_at: '2025-04-03T20:00:00Z' }])).toEqual([4]);
    expect(maxLoggedSeason(t, [{ scope: 'show', watched_at: '2024-01-30T20:00:00Z' }])).toBe(2);
    expect(newSeasons(t, [])).toEqual([]);
  });
});

describe('covered seasons', () => {
  it('a full-series entry of an ended show covers everything', () => {
    const t = show('Ended', [[1, '2019-01-01', 5], [2, '2020-01-01', 5], [3, '2021-06-01', 5]]);
    expect([...coveredSeasons(t, [{ scope: 'show', watched_at: '2021-01-01T20:00:00Z' }])]).toEqual([1, 2, 3]);
    const r = show('Returning Series', [[1, '2019-01-01', 5], [2, '2020-01-01', 5], [3, '2021-06-01', 5]]);
    expect([...coveredSeasons(r, [{ scope: 'show', watched_at: '2021-01-01T20:00:00Z' }])]).toEqual([1, 2]);
  });
});
