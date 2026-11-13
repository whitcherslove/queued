import { useState } from 'react';
import type { HomeLayout, Settings } from '../lib/theme';
import { useBackLayer } from '../lib/back';

const BLOCKS: { id: string; label: string; hint: string }[] = [
  { id: 'progress', label: 'In progress', hint: 'What you’re watching, playing and reading' },
  { id: 'tonight', label: 'Tonight’s pick', hint: 'Random or AI pick from your lists' },
  { id: 'ready', label: 'Up next & ready', hint: 'Pinned, new seasons, out now' },
  { id: 'recent', label: 'Recently finished', hint: 'With your ratings' },
  { id: 'friends', label: 'Friends', hint: 'The latest from Activity' },
  { id: 'coming', label: 'Coming up', hint: 'Premieres and releases from your lists' },
  { id: 'stats', label: 'This year', hint: 'Your stats in one line' }
];
const DEFAULT: HomeLayout = { order: BLOCKS.map((b) => b.id), hidden: [], friends: 4, kinds: ['Shows', 'Games', 'Books'], horizon: 180 };

/** Edit Home: which blocks, in what order, and a few options. Saved in your profile. */
export default function HomeEditor({ settings, onSettings, onClose }: { settings: Settings; onSettings: (s: Settings) => void; onClose: () => void }) {
  useBackLayer(true, onClose);
  const h0 = settings.home ?? DEFAULT;
  const [h, setH] = useState<HomeLayout>({ ...DEFAULT, ...h0, order: [...(h0.order ?? []).filter((x) => BLOCKS.some((b) => b.id === x)), ...BLOCKS.map((b) => b.id).filter((x) => !(h0.order ?? []).includes(x))] });
  const save = (n: HomeLayout) => { setH(n); onSettings({ ...settings, home: n }); };
  const move = (i: number, d: -1 | 1) => { const o = [...h.order]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; save({ ...h, order: o }); };
  const opt = <K extends keyof HomeLayout>(k: K, v: HomeLayout[K]) => save({ ...h, [k]: v });
  const seg = (vals: [number, string][], cur: number, set: (v: number) => void) => (
    <div className="f-row">{vals.map(([v, l]) => <button key={v} className={'f-chip' + (cur === v ? ' on' : '')} onClick={() => set(v)}>{l}</button>)}</div>
  );
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet home-editor" role="dialog" aria-label="Edit Home">
        <div className="row nowrap"><strong className="grow">Edit Home</strong><button className="link" onClick={() => save(DEFAULT)}>Reset to default</button></div>
        <span className="muted small">Turn blocks on or off and move them with the arrows. Invites and requests always stay on top.</span>
        <div className="he-list">
          {h.order.map((id, i) => {
            const b = BLOCKS.find((x) => x.id === id)!; const on = !h.hidden.includes(id);
            return (
              <div key={id} className={'he-row' + (on ? '' : ' off')}>
                <span className="he-arrows"><button aria-label={'Move ' + b.label + ' up'} disabled={i === 0} onClick={() => move(i, -1)}>▲</button><button aria-label={'Move ' + b.label + ' down'} disabled={i === h.order.length - 1} onClick={() => move(i, 1)}>▼</button></span>
                <span className="grow stack-0"><strong className="small">{b.label}</strong><span className="muted tiny">{b.hint}</span>
                  {on && id === 'friends' && seg([[2, '2'], [4, '4'], [6, '6']], h.friends ?? 4, (v) => opt('friends', v))}
                  {on && id === 'coming' && seg([[31, 'A month'], [92, '3 months'], [180, 'Half a year']], h.horizon ?? 180, (v) => opt('horizon', v))}
                  {on && id === 'progress' && <div className="f-row">{['Shows', 'Games', 'Books'].map((k) => { const sel = (h.kinds ?? []).includes(k);
                    return <button key={k} className={'f-chip' + (sel ? ' on' : '')} onClick={() => opt('kinds', sel ? (h.kinds ?? []).filter((x) => x !== k) : [...(h.kinds ?? []), k])}>{k === 'Shows' ? 'Watching' : k === 'Games' ? 'Playing' : 'Reading'}</button>; })}</div>}
                </span>
                <button className="switch-btn" role="switch" aria-checked={on} aria-label={b.label} onClick={() => opt('hidden', on ? [...h.hidden, id] : h.hidden.filter((x) => x !== id))}><span className={'switch' + (on ? ' on' : '')}><span /></span></button>
              </div>
            );
          })}
        </div>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
