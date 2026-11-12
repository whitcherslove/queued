import { describe, expect, it } from 'vitest';
import { mergeSpecials } from '../src/lib/tv';
const eps = [
  { title_id: 't', season: 1, name: 'S1', air_date: '2001-07-09', episodes: [{ n: 1, name: 'a', air_date: '2001-07-09' }, { n: 6, name: 'f', air_date: '2001-08-13' }] },
  { title_id: 't', season: 2, name: 'S2', air_date: '2002-09-30', episodes: [{ n: 1, name: 'a', air_date: '2002-09-30' }, { n: 6, name: 'f', air_date: '2002-11-04' }] },
  { title_id: 't', season: 0, name: 'Specials', air_date: null, episodes: [{ n: 1, name: 'Xmas 1', air_date: '2003-12-26' }, { n: 2, name: 'Xmas 2', air_date: '2003-12-27' }, { n: 7, name: 'Bonus', air_date: '2004-01-01' }] }
];
describe('specials', () => {
  it('picked specials go after the season they aired after; the rest are left out', () => {
    const m = mergeSpecials(eps, [1, 2]);
    expect(m.map((s) => s.season)).toEqual([1, 2]);
    expect(m[1].episodes.map((e) => (e.s === 0 ? 'sp' + e.n : e.n))).toEqual([1, 6, 'sp1', 'sp2']);
    expect(mergeSpecials(eps, []).flatMap((s) => s.episodes).some((e) => e.s === 0)).toBe(false);
  });
});
