/** Which sections sit in the bottom bar (in what order) and which in the side menu. Saved in your settings. */
export type NavId = 'home' | 'movies' | 'tv' | 'console' | 'pc' | 'retro' | 'books' | 'stats';
export const ALL_NAV: NavId[] = ['home', 'movies', 'tv', 'console', 'pc', 'books', 'stats', 'retro'];
export const NAV_LABEL: Record<NavId, string> = { home: 'Home', movies: 'Movies', tv: 'TV Shows', console: 'Console games', pc: 'PC games', retro: 'Retro games', books: 'Books', stats: 'Stats' };
export const DEFAULT_NAV = { bar: ['home', 'movies', 'tv', 'console', 'pc'] as NavId[], side: ['books', 'stats', 'retro'] as NavId[] };
export const BAR_MAX = 5, BAR_MIN = 2;

/** Clean up a saved layout: known ids only, nothing twice, anything new goes to the side menu, bar between 2 and 5. */
export function normNav(n?: { bar?: string[]; side?: string[] } | null): { bar: NavId[]; side: NavId[] } {
  const ok = (x: string): x is NavId => (ALL_NAV as string[]).includes(x);
  const bar = [...new Set((n?.bar ?? DEFAULT_NAV.bar).filter(ok))].slice(0, BAR_MAX);
  const side = [...new Set((n?.side ?? DEFAULT_NAV.side).filter(ok))].filter((x) => !bar.includes(x));
  ALL_NAV.forEach((x) => { if (!bar.includes(x) && !side.includes(x)) side.push(x); });
  while (bar.length < BAR_MIN && side.length) bar.push(side.shift()!);
  return { bar, side };
}
