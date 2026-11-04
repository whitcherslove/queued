/** Book formats: what you read in. Works like the platform of a game. */
export type BookFormat = 'paper' | 'ebook' | 'audio';
export const FORMATS: { key: BookFormat; label: string }[] = [
  { key: 'paper', label: 'Paper' },
  { key: 'ebook', label: 'E-book' },
  { key: 'audio', label: 'Audio' }
];
export const formatLabel = (f: string | null | undefined) => FORMATS.find((x) => x.key === f)?.label ?? '';

/** About 1.5 minutes a page; audio uses its own length. Hours, one decimal under 10. */
export function readHours(pages: number | null | undefined, audioMin: number | null | undefined, format: string | null | undefined): number | null {
  const min = format === 'audio' ? audioMin ?? (pages ? pages * 1.5 : null) : pages ? pages * 1.5 : audioMin ?? null;
  if (!min) return null;
  const h = min / 60;
  return h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
}
/** "p. 124 / 412" or "3 h 20 m / 11 h 40 m" for a progress percent. */
export function positionText(pct: number, pages: number | null | undefined, audioMin: number | null | undefined, format: string | null | undefined): string {
  if (format === 'audio' && audioMin) {
    const at = Math.round((audioMin * pct) / 100);
    const hm = (m: number) => (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + (m % 60) + ' m';
    return hm(at) + ' / ' + hm(audioMin);
  }
  if (pages) return 'p. ' + Math.round((pages * pct) / 100) + ' / ' + pages;
  return '';
}

/** "1 h 40 m / 3 h 20 m" from the minute you're at — the exact one, not rounded through a percent. */
export function positionMinutes(at: number, total: number): string {
  const hm = (m: number) => (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + (m % 60) + ' m';
  return hm(Math.round(at)) + ' / ' + hm(Math.round(total));
}
