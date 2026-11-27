import { useEffect, useState } from 'react';
import { appIdFromInput, paceLine, steamCard, steamLink, steamOwned, type SteamCardData } from '../lib/steam';
import { ChevBtn } from './Icons';
import { notify } from '../lib/dialog';
import { useBackLayer } from '../lib/back';

const hrs = (min: number) => (min >= 600 ? Math.round(min / 60) : Math.round(min / 6) / 10) + ' h';
const ago = (iso: string | null) => { if (!iso) return 'never'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' months ago' : new Date(iso).getFullYear() + ''; };

/**
 * Steam in a game's card (right under the status block): hours (and on Steam Deck), achievements, last played.
 * Unfolded: how your pace compares with most players, and a nudge to update progress or move it to Playing.
 */
export default function SteamCard({ libraryId, status, progress, ttbMain, firstRun, onStart }: {
  libraryId: string; status: string; progress: number | null; ttbMain: number | null | undefined;
  firstRun: boolean;   // Steam hours count every run — the pace line only makes sense on the first playthrough
  onStart: () => void;
}) {
  const [d, setD] = useState<SteamCardData | null>(null);
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const load = (force = false) => steamCard(libraryId, force).then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, [libraryId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !d.connected) return null;                   // no Steam profile connected — nothing here
  if (d.appid === 0) return null;                        // "Not on Steam"
  if (!d.appid || !d.stats) return (
    <>
      <button className="card steam-card link-only" onClick={() => setLinking(true)}>
        <span className="steam-mark">STEAM</span><span className="grow muted small">{d.appid ? 'Not in your Steam library' : 'Not linked to Steam yet'}</span><span className="link">Link to Steam</span>
      </button>
      {linking && <LinkSheet libraryId={libraryId} onClose={() => setLinking(false)} onDone={() => { setLinking(false); load(true); }} />}
    </>
  );
  const s = d.stats, hours = s.playtime_min / 60, pct = s.ach_total ? Math.round((s.ach_done ?? 0) * 100 / s.ach_total) : null;
  const pace = firstRun ? paceLine(hours, ttbMain, progress, libraryId) : null;
  const nudgeStart = (status === 'backlog') && s.playtime_2w_min > 0;
  return (
    <>
      <section className="card steam-card">
        <div className="row nowrap">
          <span className="steam-mark">STEAM</span>
          <button className="link grow steam-linked" onClick={() => setLinking(true)}>{s.name ?? 'Steam game'} ›</button>
          {(pace || nudgeStart) && <button className="icon-btn sm" aria-label={open ? 'Less' : 'More'} onClick={() => setOpen(!open)}><ChevBtn open={open} size={28} /></button>}
        </div>
        <div className="steam-facts">
          <span><b>{hrs(s.playtime_min)}</b><span className="muted tiny">played{s.playtime_deck_min > 0 ? ' · ' + hrs(s.playtime_deck_min) + ' on Deck' : ''}</span></span>
          {s.ach_total ? <span><b>{s.ach_done}/{s.ach_total}</b><span className="muted tiny">achievements</span><span className="mini-bar"><span style={{ width: (pct ?? 0) + '%' }} /></span></span> : null}
          <span><b>{ago(s.last_played)}</b><span className="muted tiny">last played</span></span>
        </div>
        {nudgeStart && !open && <span className="steam-nudge-dot" aria-hidden="true" />}
        {open && <div className="stack-sm steam-more">
          {pace && <span className="steam-pace">{pace}<span className="muted tiny"> {Math.round(hours)} h of ~{Math.round(ttbMain ?? 0)} h · progress {Math.round(progress ?? 0)}%</span></span>}
          {nudgeStart && <button className="btn sm primary" onClick={onStart}>You’ve been playing this on Steam — move to Playing</button>}
        </div>}
      </section>
      {linking && <LinkSheet libraryId={libraryId} current={d.appid} onClose={() => setLinking(false)} onDone={() => { setLinking(false); load(true); }} />}
    </>
  );
}

/** Which Steam game this is: pick from your Steam library, paste a Store link, or say it's not on Steam. */
function LinkSheet({ libraryId, current, onClose, onDone }: { libraryId: string; current?: number | null; onClose: () => void; onDone: () => void }) {
  useBackLayer(true, onClose);
  const [q, setQ] = useState('');
  const [list, setList] = useState<{ appid: number; name: string; playtime_min: number }[]>([]);
  useEffect(() => { const t = setTimeout(() => steamOwned(q).then((r) => setList(r.games ?? [])).catch(() => undefined), 250); return () => clearTimeout(t); }, [q]);
  const pick = async (appid: number | null) => { try { await steamLink(libraryId, appid); onDone(); } catch (e) { notify((e as Error).message); } };
  const pasted = appIdFromInput(q);
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet steam-link" role="dialog" aria-label="Link to Steam">
        <strong>Which Steam game is it?</strong>
        <input className="text-input" placeholder="Search your Steam games or paste a Store link" value={q} onChange={(e) => setQ(e.target.value)} />
        {pasted && <button className="btn primary" onClick={() => pick(pasted)}>Use Steam app {pasted}</button>}
        <div className="steam-list">{list.map((g) => (
          <button key={g.appid} className={'steam-pick' + (g.appid === current ? ' on' : '')} onClick={() => pick(g.appid)}>
            <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_sm_120.jpg`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
            <span className="grow">{g.name}</span><span className="muted tiny">{g.playtime_min ? hrs(g.playtime_min) : 'not played'}</span>
          </button>
        ))}</div>
        <div className="row nowrap"><button className="btn grow" onClick={() => pick(null)}>Automatic</button><button className="btn grow" onClick={() => pick(0)}>Not on Steam</button></div>
      </div>
    </div>
  );
}
