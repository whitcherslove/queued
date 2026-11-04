import { describe, expect, it } from 'vitest';
import { normNav } from '../src/lib/nav';
describe('navigation layout', () => {
  it('defaults', () => { expect(normNav(null).bar).toEqual(['home', 'movies', 'tv', 'console', 'pc']); });
  it('cleans up', () => {
    const n = normNav({ bar: ['books', 'books', 'x', 'movies'], side: ['movies', 'stats'] });
    expect(n.bar).toEqual(['books', 'movies']);
    expect(n.side.slice(0, 1)).toEqual(['stats']);
    expect([...n.bar, ...n.side].sort()).toEqual(['books', 'console', 'home', 'movies', 'pc', 'retro', 'stats', 'tv']);
  });
  it('keeps at least two in the bar', () => { expect(normNav({ bar: [], side: [] }).bar.length).toBe(2); });
});
