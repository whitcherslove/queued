import { describe, expect, it } from 'vitest';
import { groupRows, normalizeRow } from '../src/lib/importer';

describe('AppSheet import', () => {
  it('normalizes a row', () => {
    const r = normalizeRow({ Movie: 'Frozen', 'Release date': new Date(2013, 10, 27), 'My rating': 'This is fine', Letterboxd: 3, 'Watch date': new Date(2026, 9, 17, 20, 59), 'Rewatch:': 1, 'imdb ID': 'tt2294629', UserEmail: 'Me@Mail.com', Metacritic: 75, IMDb: 7.4 }, 0)!;
    expect(r.year).toBe(2013); expect(r.imdbId).toBe('tt2294629'); expect(r.rewatch).toBe(true); expect(r.email).toBe('me@mail.com'); expect(r.score).toBe(3);
    expect(r.watchedAt).not.toBeNull();
  });
  it('parses AppSheet text dates and ignores empty titles', () => {
    expect(normalizeRow({ Movie: 'X', 'Watch date': '17/10/2026 22:56:00' }, 0)!.watchedAt).toBe(new Date(2026, 9, 17, 22, 56).toISOString());
    expect(normalizeRow({ Movie: '' }, 0)).toBeNull();
  });
  it('groups repeated movies by IMDb id or title + year', () => {
    const a = normalizeRow({ Movie: 'Scream 2', 'Release date': new Date(1997, 11, 12), 'My rating': 'This is fine' }, 0)!;
    const b = normalizeRow({ Movie: 'Scream 2', 'Release date': new Date(1997, 11, 12), 'My rating': 'This is fine' }, 1)!;
    const c = normalizeRow({ Movie: 'Frozen', 'imdb ID': 'tt2294629' }, 2)!;
    const g = groupRows([a, b, c]);
    expect(g.length).toBe(2);
    expect(g.find((x) => x.title === 'Scream 2')!.rows.length).toBe(2);
  });
});
