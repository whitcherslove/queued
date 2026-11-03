import { useState } from 'react';
import { useBackLayer } from '../lib/back';

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
const pretty = (v: string) => { const [y, m, d] = v.split('-').map(Number); return `${d} ${MON[m - 1].slice(0, 3)} ${y}`; };

/** A date you tap to change: opens a calendar sheet (instead of the phone's system picker). */
export default function DateField({ value, onChange, label, id }: { value: string; onChange: (day: string) => void; label: string; id?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id={id} type="button" className="date-btn" aria-label={label + ': ' + (value ? pretty(value) : 'not set')} onClick={() => setOpen(true)}>
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        {value ? pretty(value) : 'Pick a date'}
      </button>
      {open && <DateSheet value={value || todayIso()} label={label} onClose={() => setOpen(false)} onPick={(d) => { setOpen(false); if (d !== value) onChange(d); }} />}
    </>
  );
}

function DateSheet({ value, label, onClose, onPick }: { value: string; label: string; onClose: () => void; onPick: (d: string) => void }) {
  useBackLayer(true, onClose);
  const [y0, m0] = value.split('-').map(Number);
  const [view, setView] = useState({ y: y0, m: m0 - 1 });
  const [sel, setSel] = useState(value);
  const [years, setYears] = useState(false);
  const first = (new Date(view.y, view.m, 1).getDay() + 6) % 7;           // Monday-first
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const today = todayIso();
  const step = (d: number) => setView((v) => { const m = v.m + d; return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }; });
  const yearList = Array.from({ length: 60 }, (_, i) => new Date().getFullYear() + 1 - i);
  const quick = (d: Date) => { const s = iso(d.getFullYear(), d.getMonth(), d.getDate()); setSel(s); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  return (
    <div className="modal-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="date-modal" role="dialog" aria-modal="true" aria-label={label}>
        <div className="stack-sm"><strong className="sheet-title">{label}</strong><span className="muted small">{pretty(sel)}</span></div>
        <div className="cal-head">
          <button className="cal-nav" aria-label="Previous month" onClick={() => step(-1)}>‹</button>
          <button className="cal-title" aria-expanded={years} onClick={() => setYears(!years)}>{MON[view.m]} {view.y} ▾</button>
          <button className="cal-nav" aria-label="Next month" onClick={() => step(1)}>›</button>
        </div>
        {years ? (
          <div className="cal-years">{yearList.map((y) => <button key={y} className={'cal-year' + (y === view.y ? ' on' : '')} onClick={() => { setView({ y, m: view.m }); setYears(false); }}>{y}</button>)}</div>
        ) : (
          <div className="cal-grid" role="grid">
            {WD.map((w) => <span key={w} className="cal-wd">{w}</span>)}
            {Array.from({ length: first }, (_, i) => <span key={'e' + i} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = iso(view.y, view.m, i + 1);
              return <button key={d} role="gridcell" aria-selected={d === sel} className={'cal-day' + (d === sel ? ' on' : '') + (d === today ? ' today' : '')} onClick={() => setSel(d)}>{i + 1}</button>;
            })}
          </div>
        )}
        <div className="cal-quick">
          <button className="chip" onClick={() => quick(new Date())}>Today</button>
          <button className="chip" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); quick(d); }}>Yesterday</button>
        </div>
        <div className="row nowrap"><button className="btn grow" onClick={onClose}>Cancel</button><button className="btn primary grow" onClick={() => onPick(sel)}>Done</button></div>
      </div>
    </div>
  );
}
