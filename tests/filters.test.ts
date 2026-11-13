import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeCount, passItem, passLog } from '../src/lib/filters';
const item = (o: Record<string, unknown>) => ({ id: 'i', status: 'backlog', platform: 'ps5', coop: true, title: { title: 'X', year: 2015, genres: ['Action'], runtime: 100, release_date: '2015-05-01', data: { ttb: { main: 12 } } }, ...o }) as never;
describe('filters', () => {
  it('genre, decade, length, platform, co-op', () => {
    const f = { ...NO_FILTERS, genres: ['Action'], decades: ['2010'], length: 'm', platforms: ['ps5'], coop: true };
    expect(activeCount(f)).toBe(5);
    expect(passItem(item({}), f, 'game', '2026-11-13')).toBe(true);
    expect(passItem(item({ platform: 'pc' }), f, 'game', '2026-11-13')).toBe(false);
    expect(passItem(item({}), { ...NO_FILTERS, length: 's' }, 'movie', '2026-11-13')).toBe(false);   // 100 min is 1.5–2.5 h
  });
  it('rating and "finished this year" read the journal entry', () => {
    const log = { watched_at: '2026-03-01T10:00:00Z', tier: 'ten', library: item({}) } as never;
    expect(passLog(log, { ...NO_FILTERS, tiers: ['ten'], doneWhen: 'this' }, 'movie', '2026-11-13')).toBe(true);
    expect(passLog(log, { ...NO_FILTERS, doneWhen: 'last' }, 'movie', '2026-11-13')).toBe(false);
  });
});
