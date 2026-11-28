import { useState } from 'react';
import type { Title } from '../lib/types';
import { isEnded, scopeLabel, seasonsOf, todayIso } from '../lib/tv';

interface Props {
  t: Title; title: string; confirm: string;
  initial?: number[] | null;
  onCancel: () => void; onDone: (seasons: number[] | null) => void;
}

/** Pick what the next journal entry will cover: the full series or any set of seasons. */
export default function ScopeSheet({ t, title, confirm, initial, onCancel, onDone }: Props) {
  const seasons = seasonsOf(t);
  // a season with nothing out yet can't be picked — it isn't watchable; it'll show up as "New season out" when it airs
  const isOut = (s: { air_date?: string | null }) => !!s.air_date && s.air_date <= todayIso();
  const outNums = seasons.filter(isOut).map((s) => s.n);
  const [picked, setPicked] = useState<number[]>((initial && initial.length ? initial : isEnded(t) ? [] : outNums).filter((n) => outNums.includes(n)));
  const ended = isEnded(t);
  const full = ended && picked.length === 0;
  const nothing = !ended && picked.length === 0;
  const toggle = (n: number) => { if (!outNums.includes(n)) return; setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.concat(n).sort((a, b) => a - b))); };
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="stack-sm"><strong className="sheet-title">{title}</strong><span className="muted small">{t.title}</span></div>
        {ended
          ? <button className={'scope-full' + (full ? ' on' : '')} aria-pressed={full} onClick={() => setPicked([])}>
              <strong>Full series</strong><span className="muted small">{scopeLabel(null, t).replace(/^Full series · ?/, '') || 'All seasons'}</span>
            </button>
          : <span className="muted small">The show is still running, so pick its seasons. “Full series” becomes available once it ends.</span>}
        {(seasons.length > 1 || !ended) && <>
          <span className="muted small">{ended ? '…or tap the seasons you’ll watch' : 'Tap the seasons'}</span>
          <div className="season-chips">
            {seasons.map((s) => {
              const on = picked.includes(s.n);
              // a season that hasn't started airing: greyed with its date, can't be picked
              const later = !isOut(s);
              return (
                <button key={s.n} className={'season-chip' + (on ? ' on' : '') + (later ? ' later' : '')} aria-pressed={on} disabled={later} aria-label={'Season ' + s.n + (later ? ', not out yet' : '')} onClick={() => toggle(s.n)}>
                  <strong>{s.n}</strong><span>{later ? (s.air_date ? 'from ' + new Date(s.air_date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'not out') : s.air_date!.slice(0, 4)}</span>
                </button>
              );
            })}
          </div>
        </>}
        {seasons.some((x) => !isOut(x)) && <span className="muted tiny">Greyed seasons aren’t out yet — they’ll show up as “New season out” when they air.</span>}
        <div className="scope-sum"><span className="muted small">Journal entry</span><strong>{nothing ? 'Pick at least one season' : scopeLabel(full ? null : picked, t)}</strong></div>
        <div className="row nowrap"><button className="btn grow" onClick={onCancel}>Cancel</button><button className="btn primary grow" disabled={nothing} onClick={() => onDone(full ? null : picked)}>{confirm}</button></div>
      </div>
    </div>
  );
}
