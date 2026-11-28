import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { appIdFromInput, paceLine, steamConnected, steamHint, steamLink, steamOwned, steamRefresh, steamResolve, useSteam } from '../lib/steam';
import { ChevBtn } from './Icons';
import { notify } from '../lib/dialog';
import { useBackLayer } from '../lib/back';
import { useVisibleBox } from '../lib/useVisibleBox';

const hrs = (min: number) => (min >= 600 ? Math.round(min / 60) : Math.round(min / 6) / 10) + ' h';
const ago = (iso: string | null) => { if (!iso) return 'Never'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' months ago' : new Date(iso).getFullYear() + ''; };
const SteamLogo = () => <img className="plat-logo steam-logo" src="/steam-logo.png" alt="Steam" />;
export const SteamPerfect = ({ size = 16, off }: { size?: number; off?: boolean }) => <img className={'steam-perfect' + (off ? ' off' : '')} src="/steam-perfect.png" width={size} height={size} alt={off ? '' : '100% achievements'} title={off ? undefined : '100% achievements'} />;
const DECK: Record<string, string> = { verified: 'Verified', playable: 'Playable', unsupported: 'Unsupported', unknown: 'Unknown' };

export interface SteamItem { id: string; status: string; platform?: string | null; steam_appid?: number | null; steam_complete?: boolean; overrides?: unknown; progress?: number | null }

/**
 * Steam in a game's card, right under the status block. Numbers come from what the app already loaded
 * (no waiting); if they're a few hours old, this game is refreshed in the background.
 */
export default function SteamCard({ item, ready, ttbMain, firstRun, lastFinished, onStart, onReplay, onPatch }: {
  item: SteamItem; ready: boolean; ttbMain: number | null | undefined; firstRun: boolean; lastFinished: string | null;
  onStart: () => void; onReplay: () => void; onPatch: (p: Record<string, unknown>) => void;
}) {
  const [appid, setAppid] = useState<number | null | undefined>(item.steam_appid);
  // the full game (loaded right after the card opens) already knows its Steam link — take it
  useEffect(() => { if (item.steam_appid !== undefined && item.steam_appid !== null) setAppid(item.steam_appid); }, [item.steam_appid]);
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const s = useSteam(appid);
  const on = steamConnected();
  const apply = (r: { appid: number; complete: boolean }) => { setAppid(r.appid); onPatch({ steam_appid: r.appid, steam_complete: r.complete }); };

  useEffect(() => {
    if (!on || !ready || asked.current) return;   // wait for the full game: it may already know its Steam link
    if (appid === null || appid === undefined) { asked.current = true; steamResolve(item.id).then(apply).catch(() => setAppid(0)); return; }   // not linked yet
    if (appid > 0 && s && (Date.now() - new Date(s.updated_at).getTime() > 3 * 3600e3 || (s.playtime_min > 0 && !s.ach_checked_at) || (!!s.ach_rarest && s.ach_rarest.desc === undefined) || (!s.deck && !!s.ach_checked_at))) {
      asked.current = true; setBusy(true); steamRefresh(item.id).then(apply).catch(() => undefined).finally(() => setBusy(false));   // quietly, in the background
    }
  }, [appid, s?.updated_at, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const saidNo = (item.overrides as { steam_appid?: number } | null)?.steam_appid === 0;
  if (!on || saidNo) return null;   // no Steam, or you said "Not on Steam"
  const refresh = async () => { setBusy(true); try { apply(await steamRefresh(item.id)); } catch (e) { notify((e as Error).message); } setBusy(false); };
  const setLink = async (a: number | null) => { setLinking(false); setBusy(true);
    const ov = { ...((item.overrides as Record<string, unknown>) ?? {}) }; if (a === null) delete ov.steam_appid; else ov.steam_appid = a;
    try { const r = await steamLink(item.id, a); setAppid(r.appid); onPatch({ steam_appid: r.appid, steam_complete: r.complete, overrides: ov, _local: true }); if (a === 0) notify('Marked “Not on Steam” — undo in Edit details'); } catch (e) { notify((e as Error).message); } setBusy(false); };
  const hintOff = (item.overrides as { steam_hint_off?: string } | null)?.steam_hint_off;
  const notNow = () => onPatch({ overrides: { ...((item.overrides as object) ?? {}), steam_hint_off: new Date().toISOString() } });
  const sheet = linking && <LinkSheet current={appid ?? null} onClose={() => setLinking(false)} onPick={setLink} />;

  // not known yet: a quiet placeholder of the same height, no "Linking…" text
  if (appid === null || appid === undefined) return <div className="card steam-card link-only" aria-busy="true"><SteamLogo /><span className="grow steam-skel" /></div>;
  if (appid === 0) return (
    <>
      <div className="card steam-card link-only">
        <SteamLogo /><span className="grow muted small">Not linked to Steam yet</span>
        <button className="btn sm" onClick={() => setLinking(true)}>Link</button>
        <button className="btn sm" onClick={() => setLink(0)}>Not on Steam</button>
      </div>
      {sheet}
    </>
  );
  if (!s) return (
    <>
      <section className="card steam-card">
        <div className="row nowrap"><SteamLogo /><span className="grow steam-linked">Linked game</span><button className="btn sm" onClick={() => setLinking(true)}>Change</button></div>
        <span className="muted small">Not in your Steam library yet — hours and achievements appear once you own it.</span>
      </section>
      {sheet}
    </>
  );
  const pct = s.ach_total ? Math.round((s.ach_done ?? 0) * 100 / s.ach_total) : null;
  const pace = firstRun && item.status === 'playing' ? paceLine(s.playtime_min / 60, ttbMain, item.progress ?? null, item.id) : null;
  const hint = steamHint(s, item.status, lastFinished, hintOff);
  const showDeck = !!s.deck;   // for every game: maybe you'll want to play it on the Deck later
  const rare = s.ach_rarest;
  const pc = Math.max(0, s.playtime_min - s.playtime_deck_min), deck = s.playtime_deck_min;
  return (
    <>
      <section className={'card steam-card tappable' + (open ? ' open' : '')} role="button" tabIndex={0} aria-expanded={open}
        onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input')) return; setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(!open); }}>
        <div className="row nowrap">
          <SteamLogo />
          <span className="grow steam-linked">{s.name ?? 'Steam game'}</span>
          <button className={'icon-btn sm steam-refresh' + (busy ? ' spinning' : '')} aria-label="Refresh from Steam" disabled={busy} onClick={refresh}>↻</button>
          <button className="icon-btn sm" aria-label={open ? 'Less' : 'More'} onClick={() => setOpen(!open)}><ChevBtn open={open} size={28} /></button>
        </div>
        <div className="steam-facts">
          <span><b>{hrs(s.playtime_min)}</b>
            {pc >= 6 && <span className="muted tiny">{hrs(pc)} on PC</span>}
            {deck >= 6 && <span className="muted tiny">{hrs(deck)} on Deck</span>}</span>
          {s.ach_total ? <span><b>{s.ach_done}/{s.ach_total}{s.ach_done === s.ach_total && <SteamPerfect size={16} />}</b><span className="muted tiny">achievements</span><span className="mini-bar"><span style={{ width: (pct ?? 0) + '%' }} /></span></span>
            : !s.ach_checked_at && s.playtime_min > 0 ? <span><b className="muted">…</b><span className="muted tiny">achievements</span></span> : <span />}
          <span><b>{ago(s.last_played)}</b><span className="muted tiny">last played</span>{s.playtime_2w_min > 0 && <span className="muted tiny">{hrs(s.playtime_2w_min)} · 2 weeks</span>}</span>
        </div>
        {hint && <div className="steam-hint">
          <span className="grow small">{hint === 'start' ? 'You’ve been playing this on Steam' : 'Playing again?'}</span>
          <button className="btn sm primary" onClick={hint === 'start' ? onStart : onReplay}>{hint === 'start' ? 'Move to Playing' : 'Start a replay'}</button>
          <button className="link" onClick={notNow}>Not now</button>
        </div>}
        {open && <div className="stack-sm steam-more">
          {pace && <span className="steam-pace">{pace}<span className="muted tiny"> {Math.round(s.playtime_min / 60)} h of ~{Math.round(ttbMain ?? 0)} h · progress {Math.round(item.progress ?? 0)}%</span></span>}
          {(rare || showDeck) && <div className="steam-tiles">
            {rare && <div className="steam-rare">
              {rare.icon ? <img className="ach-icon" src={rare.icon} alt="" loading="lazy" /> : <span className="ach-icon" />}
              <span className="grow stack-0"><span className="muted tiny">Your rarest achievement{rare.pct != null ? ' · ' + rare.pct + '% of players' : ''}</span>
                <span className="small steam-rare-name">{rare.name}</span>{rare.desc && <span className="muted tiny">{rare.desc}</span>}</span>
            </div>}
            {showDeck && <div className="steam-tile"><img className="ach-icon round" src={`/deck/${s.deck}.png`} alt="" /><span className="muted tiny">Steam Deck</span><span className="tiny steam-tile-name">{DECK[s.deck!]}</span></div>}
          </div>}
          <div className="row nowrap steam-relink"><span className="grow muted tiny">Wrong game?</span><button className="btn sm" onClick={() => setLinking(true)}>Change Steam game</button></div>
        </div>}
      </section>
      {sheet}
    </>
  );
}

/** Which Steam game this is: your Steam library, the Steam Store, or a pasted Store link. Full height, from the top. */
function LinkSheet({ current, onClose, onPick }: { current: number | null; onClose: () => void; onPick: (appid: number | null) => void }) {
  useBackLayer(true, onClose);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState<{ appid: number; name: string; playtime_min: number }[] | null>(null);
  const [store, setStore] = useState<{ appid: number; name: string }[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    setMine(null);
    const t = setTimeout(() => steamOwned(q).then((r) => { setMine(r.games ?? []); setStore((r.store ?? []).filter((x) => !(r.games ?? []).some((g) => g.appid === x.appid))); setErr(''); })
      .catch((e) => { setMine([]); setErr((e as Error).message); }), 300);
    return () => clearTimeout(t);
  }, [q]);
  const pasted = appIdFromInput(q);
  const row = (g: { appid: number; name: string; playtime_min?: number }) => (
    <button key={g.appid} className={'steam-pick' + (g.appid === current ? ' on' : '')} onClick={() => onPick(g.appid)}>
      <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/capsule_sm_120.jpg`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
      <span className="grow">{g.name}</span>{g.playtime_min !== undefined && <span className="muted tiny">{g.playtime_min ? hrs(g.playtime_min) : 'not played'}</span>}
    </button>
  );
  // a centred window that keeps to the visible part of the screen: the keyboard can't push it around
  const box = useVisibleBox();
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o; }; }, []);
  const h = Math.min(560, box.height - 32);
  return createPortal(
    <div className="vv-modal" style={{ top: box.top, height: box.height }}>
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="vv-dialog steam-link" role="dialog" aria-modal="true" aria-label="Link to Steam" style={{ height: h }}>
        <div className="row nowrap"><strong className="grow">Which Steam game is it?</strong><button className="link" onClick={onClose}>Close</button></div>
        <input className="text-input" placeholder="Search, or paste a Steam Store link" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
        <div className="row nowrap"><button className="btn sm grow" onClick={() => onPick(null)}>Automatic</button><button className="btn sm grow" onClick={() => onPick(0)}>Not on Steam</button></div>
        {pasted && <button className="btn primary" onClick={() => onPick(pasted)}>Use Steam app {pasted}</button>}
        <div className="steam-list">
          {mine === null ? <span className="muted small steam-empty">Searching…</span> : <>
            {err && <span className="muted small steam-empty">{err}</span>}
            {mine.length > 0 && <span className="steam-group">Your Steam library</span>}
            {mine.map(row)}
            {store.length > 0 && <span className="steam-group">Steam Store</span>}
            {store.map(row)}
            {!err && !mine.length && !store.length && <span className="muted small steam-empty">{q ? 'Nothing found — try a shorter name, or paste the Store link' : 'Type a name to search'}</span>}
          </>}
        </div>
      </div>
    </div>,
    document.body
  );
}
