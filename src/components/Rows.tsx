import type { ReactNode } from 'react';
import { metascoreColor } from '../lib/scores';
import type { Title } from '../lib/types';

export function Poster({ t, w, h, children }: { t: Title | { poster_url: string | null; title: string }; w?: number; h?: number; children?: ReactNode }) {
  return (
    <div className="poster" style={w ? { width: w, height: h } : undefined}>
      {t.poster_url ? <img src={t.poster_url} alt="" loading="lazy" /> : <span className="poster-fallback">{t.title}</span>}
      {children}
    </div>
  );
}

export function Metascore({ v, size = 'md' }: { v: number | null; size?: 'sm' | 'md' }) {
  const c = metascoreColor(v);
  return (
    <span className={'mc mc-' + size} style={{ background: c ?? 'var(--surface2)', color: c ? '#17161A' : 'var(--muted)' }} aria-label={'Metascore ' + (v ?? 'not available')}>
      {v ?? '—'}
    </span>
  );
}

export const GripIcon = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
);

export const BookmarkBadge = () => (
  <span className="badge-next" role="img" aria-label="Up next">
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" /></svg>
  </span>
);
