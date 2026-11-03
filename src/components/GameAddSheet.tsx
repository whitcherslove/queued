import { useMemo, useState } from 'react';
import type { Title } from '../lib/types';
import { ALL_PLATFORMS, platformChoices, sectionOf, type IgdbPlatform } from '../lib/platforms';
import { releaseText } from '../lib/logic';
import { Poster } from './Rows';

export type GameAddMode = 'backlog' | 'playing' | 'past';
const SECTION_NAME = { console: 'Console games', pc: 'PC games', retro: 'Retro games' } as const;

/**
 * Adding a game: pick the platform (decides Console / PC / Retro), Co-op, and where it goes —
 * Backlog, Playing now, or "I've played it" (a past playthrough). Unreleased games can only go to Backlog.
 */
export default function GameAddSheet({ t, retro, today, onCancel, onDone }: {
  t: Title; retro: string[]; today: string; onCancel: () => void; onDone: (r: { platform: string; coop: boolean; mode: GameAddMode }) => void;
}) {
  const igdb = ((t.data as { platforms?: IgdbPlatform[] } | null)?.platforms ?? []);
  const choices = useMemo(() => platformChoices(igdb, retro), [igdb, retro]);
  const [platform, setPlatform] = useState<string>(choices[0]?.key ?? 'pc');
  const [other, setOther] = useState(choices.length === 0);
  const [coop, setCoop] = useState(false);
  const unreleased = !!t.release_date && t.release_date > today;
  const list = other ? ALL_PLATFORMS.map((p) => ({ ...p, section: sectionOf(p.key, retro) })) : choices;
  const dest = sectionOf(platform, retro);
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={'Add ' + t.title}>
        <div className="action-head"><Poster t={t} w={40} h={56} /><span className="stack-sm"><strong>{t.title}</strong><span className="muted small">{releaseText(t.release_date, t.year)}</span></span></div>

        <span className="list-group-title">Platform</span>
        <div className="plat-grid" role="radiogroup" aria-label="Platform">
          {list.map((p) => (
            <button key={p.key} role="radio" aria-checked={platform === p.key} className={'chip plat-chip' + (platform === p.key ? ' on' : '')} onClick={() => setPlatform(p.key)}>{p.label}</button>
          ))}
        </div>
        {!other && <button className="link left" onClick={() => setOther(true)}>Other platform…</button>}
        <span className="muted small">Goes to <strong>{SECTION_NAME[dest]}</strong></span>

        <button className="list-row bordered" role="switch" aria-checked={coop} onClick={() => setCoop(!coop)}>
          <span className="li-label">Co-op</span><span className="muted small">played together with someone</span><span className={'switch' + (coop ? ' on-green' : '')}><span /></span>
        </button>

        <div className="choice-buttons">
          <button className="choice primary" onClick={() => onDone({ platform, coop, mode: 'backlog' })}><strong>Add to Backlog</strong><span>Goes to the top of your Backlog</span></button>
          {!unreleased && <button className="choice" onClick={() => onDone({ platform, coop, mode: 'playing' })}><strong>Playing now</strong><span>Straight to Playing</span></button>}
          {!unreleased && <button className="choice" onClick={() => onDone({ platform, coop, mode: 'past' })}><strong>I’ve played it</strong><span>Add a past playthrough: date and rating</span></button>}
          <button className="choice ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Pick / confirm the platform (and co-op) — used by "Start playing" and "Replay". */
export function PlatformSheet({ t, retro, title, confirm, initial, initialCoop, noCoop, onCancel, onDone }: {
  t: Title; retro: string[]; title: string; confirm: string; initial?: string | null; initialCoop?: boolean; noCoop?: boolean;
  onCancel: () => void; onDone: (r: { platform: string; coop: boolean }) => void;
}) {
  const igdb = ((t.data as { platforms?: IgdbPlatform[] } | null)?.platforms ?? []);
  const choices = useMemo(() => platformChoices(igdb, retro), [igdb, retro]);
  const [platform, setPlatform] = useState<string>(initial || choices[0]?.key || 'pc');
  const [other, setOther] = useState(!!initial && !choices.some((c) => c.key === initial));
  const [coop, setCoop] = useState(!!initialCoop);
  const list = other ? ALL_PLATFORMS.map((p) => ({ ...p, section: sectionOf(p.key, retro) })) : choices;
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="stack-sm"><strong className="sheet-title">{title}</strong><span className="muted small">{t.title}</span></div>
        <span className="list-group-title">Platform</span>
        <div className="plat-grid" role="radiogroup" aria-label="Platform">
          {list.map((p) => <button key={p.key} role="radio" aria-checked={platform === p.key} className={'chip plat-chip' + (platform === p.key ? ' on' : '')} onClick={() => setPlatform(p.key)}>{p.label}</button>)}
        </div>
        {!other && <button className="link left" onClick={() => setOther(true)}>Other platform…</button>}
        <span className="muted small">Goes to <strong>{SECTION_NAME[sectionOf(platform, retro)]}</strong></span>
        {!noCoop && <button className="list-row bordered" role="switch" aria-checked={coop} onClick={() => setCoop(!coop)}>
          <span className="li-label">Co-op</span><span className="muted small">played together with someone</span><span className={'switch' + (coop ? ' on-green' : '')}><span /></span>
        </button>}
        <div className="row nowrap"><button className="btn grow" onClick={onCancel}>Cancel</button><button className="btn primary grow" onClick={() => onDone({ platform, coop })}>{confirm}</button></div>
      </div>
    </div>
  );
}
