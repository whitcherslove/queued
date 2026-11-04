import { formatLabel } from '../lib/formats';

/** Small icon of a book format: paper book, e-reader, headphones. */
export default function FormatIcon({ f, size = 15 }: { f: string | null | undefined; size?: number }) {
  if (!f) return null;
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  const icon = f === 'audio'
    ? <svg {...p}><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4.5" height="6.5" rx="1.5" /><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.5" /></svg>
    : f === 'ebook'
      ? <svg {...p}><rect x="5" y="2.5" width="14" height="19" rx="2.5" /><path d="M8.5 7h7M8.5 10.5h7M8.5 14h4.5" /></svg>
      : <svg {...p}><path d="M3 5.5c3-1.3 6-1.3 9 .5 3-1.8 6-1.8 9-.5v13c-3-1.3-6-1.3-9 .5-3-1.8-6-1.8-9-.5z" /><path d="M12 6v13" /></svg>;
  return <span className="fmt-icon" title={formatLabel(f)} role="img" aria-label={formatLabel(f)}>{icon}</span>;
}
