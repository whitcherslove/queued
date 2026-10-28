import { useState } from 'react';
import type { Title } from '../lib/types';
import { seasonsOf, scopeLabel } from '../lib/tv';

interface Props {
  t: Title; title: string; confirm: string;
  initial?: { from: number | null; to: number | null };
  onCancel: () => void; onDone: (from: number | null, to: number | null) => void;
}

/** Pick what the next journal entry will cover: the full series or a run of seasons. */
export default function ScopeSheet({ t, title, confirm, initial, onCancel, onDone }: Props) {
  const seasons = seasonsOf(t);
  const [full, setFull] = useState(initial ? initial.from == null : seasons.length <= 1);
  const [from, setFrom] = useState<number | null>(initial?.from ?? seasons[0]?.n ?? 1);
  const [to, setTo] = useState<number | null>(initial?.to ?? initial?.from ?? seasons[0]?.n ?? 1);
  const pick = (n: number) => {
    setFull(false);
    if (from == null || to == null || from !== to) { setFrom(n); setTo(n); return; }
    if (n < from) setFrom(n); else setTo(n);
  };
  const inRange = (n: number) => !full && from != null && to != null && n >= from && n <= to;
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="stack-sm"><strong className="sheet-title">{title}</strong><span className="muted small">{t.title}</span></div>
        <button className={'scope-full' + (full ? ' on' : '')} aria-pressed={full} onClick={() => setFull(true)}>
          <strong>Full series</strong><span className="muted small">{scopeLabel(null, null, t).replace('Full series · ', '') || 'All seasons'}</span>
        </button>
        {seasons.length > 1 && <>
          <span className="muted small">…or tap the first and the last season you’ll watch</span>
          <div className="season-chips">
            {seasons.map((s) => (
              <button key={s.n} className={'season-chip' + (inRange(s.n) ? ' on' : '')} aria-pressed={inRange(s.n)} onClick={() => pick(s.n)}>
                <strong>{s.n}</strong><span>{s.air_date ? s.air_date.slice(0, 4) : '—'}</span>
              </button>
            ))}
          </div>
        </>}
        <div className="scope-sum"><span className="muted small">Journal entry</span><strong>{full ? scopeLabel(null, null, t) : scopeLabel(from, to, t)}</strong></div>
        <div className="row nowrap"><button className="btn grow" onClick={onCancel}>Cancel</button><button className="btn primary grow" onClick={() => onDone(full ? null : from, full ? null : to)}>{confirm}</button></div>
      </div>
    </div>
  );
}
