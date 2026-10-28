import { describe, expect, it } from 'vitest';
import { matchLibrary, moveBy, moveId, newHits, nextPosition, releaseText, runtimeText, sortLogs, splitBacklog, topPosition } from '../src/lib/logic';
import type { LibItem, LogRow } from '../src/lib/types';

const title = (id: string, name: string, extra: Partial<LibItem['title']> = {}) => ({
  id: 't' + id, kind: 'movie' as const, source: 'tmdb', source_id: 's' + id, imdb_id: null, title: name, release_date: null, year: null, runtime: null,
  directors: [], genres: [], overview: null, poster_url: null, backdrop_url: null, metascore: null, imdb_rating: null, data: {}, ...extra
});
const lib = (id: string, name: string, pos: number, upNext = false): LibItem => ({ id, title_id: 't' + id, section: 'movies', status: 'backlog', up_next: upNext, position: pos, tier: null, score: null, overrides: {}, title: title(id, name) });

describe('formatting', () => {
  it('release date and runtime', () => {
    expect(releaseText('2019-11-22', 2019)).toBe('22 Nov 2019');
    expect(releaseText(null, 2010)).toBe('2010');
    expect(runtimeText(103)).toBe('1h 43m');
    expect(runtimeText(null)).toBe('');
  });
});

describe('ordering', () => {
  it('moves ids', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });
  it('splits backlog into up next and the rest by position', () => {
    const r = splitBacklog([lib('1', 'A', 3), lib('2', 'B', 1, true), lib('3', 'C', 2)]);
    expect(r.next.map((i) => i.id)).toEqual(['2']);
    expect(r.rest.map((i) => i.id)).toEqual(['3', '1']);
    expect(nextPosition([lib('1', 'A', 3), lib('2', 'B', 7)])).toBe(8);
    expect(topPosition([lib('1', 'A', 3), lib('2', 'B', 7)])).toBe(2);
    expect(topPosition([])).toBe(0);
  });
  it('sorts logs by date unless a custom order exists', () => {
    const l = (id: string, d: string, p: number | null) => ({ id, watched_at: d, position: p } as LogRow);
    expect(sortLogs([l('a', '2026-01-01', null), l('b', '2026-05-01', null)]).map((x) => x.id)).toEqual(['b', 'a']);
    expect(sortLogs([l('a', '2026-01-01', 1), l('b', '2026-05-01', 2)]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('search', () => {
  it('matches your lists and hides owned TMDB hits', () => {
    const items = [lib('1', 'Frozen', 1), lib('2', 'Frozen II', 2)];
    expect(matchLibrary(items, 'froz').length).toBe(2);
    expect(matchLibrary(items, 'v').length).toBe(0);
    expect(matchLibrary(items, '').length).toBe(0);
    const hits = [{ sourceId: 's1', title: 'Frozen', year: 2013, releaseDate: null, posterUrl: null }, { sourceId: 's9', title: 'Frozen Fever', year: 2015, releaseDate: null, posterUrl: null }];
    expect(newHits(hits, items).map((h) => h.sourceId)).toEqual(['s9']);
  });
});

import { diffOverrides, latestLog, merged, money, parseNum, longDate } from '../src/lib/logic';
describe('card helpers', () => {
  const base = title('1', 'Frozen', { metascore: 75, genres: ['Animation'] });
  it('applies and diffs overrides', () => {
    expect(merged(base, { metascore: 80 }).metascore).toBe(80);
    expect(diffOverrides(base, { title: 'Frozen', metascore: 75, genres: ['Animation'] })).toEqual({});
    expect(diffOverrides(base, { title: 'Frozen!', metascore: 75 })).toEqual({ title: 'Frozen!' });
  });
  it('picks the latest log', () => {
    expect(latestLog([{ id: 'a', watched_at: '2026-01-01', tier: null, score: null, rewatch: false }, { id: 'b', watched_at: '2026-03-01', tier: null, score: null, rewatch: true }])?.id).toBe('b');
    expect(latestLog([])).toBeNull();
  });
  it('formats money and dates, parses numbers', () => {
    expect(money(150000000)).toBe('$150M');
    expect(money(1280000000)).toBe('$1.28B');
    expect(money(0)).toBe('');
    expect(longDate('2026-10-17T20:00:00Z')).toBe('October 17, 2026');
    expect(parseNum('6,8', 10, 0.1).n).toBeCloseTo(6.8);
    expect(parseNum('120', 100, 1).ok).toBe(false);
    expect(parseNum('', 100, 1)).toEqual({ ok: true, n: null });
  });
});

import { localDay as ld, withLocalDay as wld } from '../src/lib/logic';
describe('local dates', () => {
  it('moves a timestamp to another local day and reads it back', () => {
    const iso = new Date(2026, 9, 28, 1, 30).toISOString();   // 01:30 local — may be the previous day in UTC
    expect(ld(iso)).toBe('2026-10-28');
    const moved = wld(iso, '2026-10-05');
    expect(ld(moved)).toBe('2026-10-05');
    expect(new Date(moved).getHours()).toBe(1);
    expect(ld('2026-10-05')).toBe('2026-10-05');
  });
});

import { metacriticSearch } from '../src/lib/logic';
describe('metacritic', () => {
  it('builds search links per category', () => {
    expect(metacriticSearch('mario', 'movie')).toBe('https://www.metacritic.com/search/mario?category=2');
    expect(metacriticSearch('mario', 'tv')).toBe('https://www.metacritic.com/search/mario?category=1');
    expect(metacriticSearch('mario', 'game')).toBe('https://www.metacritic.com/search/mario?category=13');
    expect(metacriticSearch('The Bear', 'tv')).toBe('https://www.metacritic.com/search/The%20Bear?category=1');
  });
});
