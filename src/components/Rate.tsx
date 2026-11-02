import type { ReactNode } from 'react';
import { PICK_TIERS, displayScore, myScoreColor } from '../lib/scores';
import ScoreRing from './ScoreRing';

/** Rating chips (same look as in Viewings), worst → best, two even rows: 3 on top, 2 below, both rows full width. */
export function RatingTiles({ value, onPick, label = 'Rating' }: { value: string | null; onPick: (id: string | null) => void; label?: string }) {
  const order = [...PICK_TIERS].reverse();
  return (
    <div className="rate-grid" role="radiogroup" aria-label={label}>
      {order.map((t, i) => {
        const on = value === t.id;
        return (
          <button key={t.id} role="radio" aria-checked={on} className={'chip rate-chip' + (i >= 3 ? ' wide' : '')}
            style={on ? { background: t.color, borderColor: t.color, color: '#17161A' } : undefined} onClick={() => onPick(on ? null : t.id)}>
            <span className="dot" style={{ background: on ? '#17161A' : t.color }} />{t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * My score as "− ring +": half-point steps, can't be changed by an accidental swipe.
 * value is stored 0–5; the ring and buttons follow your 5- or 10-point setting.
 */
export function ScoreStepper({ value, scale, onChange, label = 'My score', size = 'md' }: { value: number | null; scale: 5 | 10; onChange: (v: number | null) => void; label?: string; size?: 'md' | 'sm' }) {
  const step = (dir: 1 | -1) => {
    const cur = value ?? (dir > 0 ? 2.5 : 3);              // first tap starts from the middle
    const next = Math.min(5, Math.max(0, Math.round((cur + dir * 0.5) * 2) / 2));
    onChange(next);
  };
  const shown = value === null ? 'no score' : displayScore(value, scale) + ' out of ' + scale;
  return (
    <div className={'stepper ' + size} role="group" aria-label={label}>
      <span className="stepper-label">{label}</span>
      {value !== null && <button className="link" onClick={() => onChange(null)}>Clear</button>}
      <button className="step-btn" aria-label={'Lower ' + label} disabled={value === 0} onClick={() => step(-1)}>−</button>
      <span aria-live="polite" aria-label={shown} style={{ color: myScoreColor(value) ?? undefined }}><ScoreRing value={value} scale={scale} size={size === 'sm' ? 34 : 44} fontSize={size === 'sm' ? 12 : 15} /></span>
      <button className="step-btn" aria-label={'Raise ' + label} disabled={value === 5} onClick={() => step(1)}>+</button>
    </div>
  );
}

/** A row in a grouped list: icon · label · value or control. */
export function ListRow({ icon, label, value, onClick, danger, children }: { icon: ReactNode; label: string; value?: ReactNode; onClick?: () => void; danger?: boolean; children?: ReactNode }) {
  const body = <><span className="li-icon" aria-hidden="true">{icon}</span><span className="li-label">{label}</span>{value !== undefined && <span className="li-value">{value}</span>}{children}</>;
  return onClick
    ? <button className={'list-row' + (danger ? ' danger' : '')} onClick={onClick}>{body}</button>
    : <div className={'list-row' + (danger ? ' danger' : '')}>{body}</div>;
}

/** Floating action bar at the bottom of a card: the one main thing to do, plus an optional side button. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="action-bar" role="toolbar" aria-label="Main action"><div className="action-bar-inner">{children}</div></div>;
}

export const Ico = {
  backlog: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>,
  drop: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  back: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>,
  date: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  rewatch: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>,
  seasons: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5" /><rect x="3" y="10.5" width="18" height="5" rx="1.5" /><path d="M3 19h18" /></svg>,
  play: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  pin: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4.5l4.5 4.5-3 1.5-3.5 3.5.5 4-1.5 1.5-3.5-3.5L4 20M8.5 11.5L12.5 15.5M15 4.5L12 7.5 8.5 7 7 8.5l3.5 3.5" /></svg>
};
