import { useEffect, useRef, useState } from 'react';
import { appIdFromInput, paceLine, steamCard, steamLink, steamOwned, takeSteam, type SteamCardData } from '../lib/steam';
import { ChevBtn } from './Icons';
import { notify } from '../lib/dialog';
import { useBackLayer } from '../lib/back';

const hrs = (min: number) => (min >= 600 ? Math.round(min / 60) : Math.round(min / 6) / 10) + ' h';
const ago = (iso: string | null) => { if (!iso) return 'never'; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 365 ? Math.round(d / 30) + ' months ago' : new Date(iso).getFullYear() + ''; };
const SteamLogo = () => <img className="plat-logo steam-logo" src="/steam-logo.png" alt="Steam" />;

/**
 * Steam in a game's card (right under the status block): hours (and on Steam Deck), achievements, last played; ↻ refreshes.
 * Unfolded, while you're playing it for the first time: how your pace compares with most players.
 */
export default function SteamCard({ libraryId, status, progress, ttbMain, firstRun, onStart }: {
  libraryId: string; status: string; progress: number | null; ttbMain: number | null | undefined;
  firstRun: boolean;   // Steam hours count every run — the pace line only makes sense on the first playthrough
  onStart: () => void;
}) {
  const [d, setD] = useState<SteamCardData | null>(null);
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const apply = (x: SteamCardData) => {
    if (!alive.current) return;
    setD(x);
    // fresh numbers were being fetched in the background: ask again once
    if (x.refreshing) setTimeout(() => steamCard(libraryId).then((y) => alive.current && setD({ ...y, refreshing: false })).catch(() => undefined), 5000);
  };
  useEffect(() => { takeSteam(libraryId).then(apply).catch(() => setD(null)); }, [libraryId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { setBusy(true); try { apply(await steamCard(libraryId, true)); } catch (e) { notify((e as Error).message); } setBusy(false); };
  const setLink = async (appid: number | null) => { try { await steamLink(libraryId, appid); setLinking(false); setBusy(true); apply(await steamCard(libraryId, true)); } catch (e) { notify((e as Error).message); } setBusy(false); };

  if (!d || !d.connected || d.appid === 0) return null;   // no Steam connected, or "Not on Steam"
  const sheet = linking && <LinkSheet current={d.appid ?? null} onClose={() => setLinking(false)} onPick={setLink} />;
  if (!d.appid || !d.stats) return (
    <>
      <div className="card steam-card link-only">
        <SteamLogo /><span className="grow muted small">{d.appid ? 'Not in your Steam library' : 'Not linked to Steam yet'}</span>
        <button className="btn sm" onClick={() => setLinking(true)}>Link</button>
        <button className="btn sm" onClick={() => setLink(0)}>Not on Steam</button>
      </div>
      {sheet}
    </>
  );
  const s = d.stats, hours = s.playtime_min / 60, pct = s.ach_total ? Math.round((s.ach_done ?? 0) * 100 / s.ach_total) : null;
  const pace = firstRun && status === 'playing' ? paceLine(hours, ttbMain, progress, libraryId) : null;   // only while playing it for the first time
  const nudgeStart = status === 'backlog' && s.playtime_2w_min > 0;
  return (
    <>
      <section className="card steam-card">
        <div className="row nowrap">
          <SteamLogo />
          <button className="link grow steam-linked" onClick={() => setLinking(true)}>{s.name ?? 'Steam game'} ›</button>
          <button className={'icon-btn sm steam-refresh' + (busy || d.refreshing ? ' spinning' : '')} aria-label="Refresh from Steam" disabled={busy} onClick={refresh}>↻</button>
          {(pace || nudgeStart) && <button className="icon-btn sm" aria-label={open ? 'Less' : 'More'} onClick={() => setOpen(!open)}><ChevBtn open={open} size={28} /></button>}
        </div>
        <div className="steam-facts">
          <span><b>{hrs(s.playtime_min)}</b><span className="muted tiny">played{s.playtime_deck_min > 0 ? ' · ' + hrs(s.playtime_deck_min) + ' on Deck' : ''}</span></span>
          {s.ach_total ? <span><b>{s.ach_done}/{s.ach_total}</b><span className="muted tiny">achievements</span><span className="mini-bar"><span style={{ width: (pct ?? 0) + '%' }} /></span></span>
            : s.ach_total == null && s.playtime_min > 0 ? <span><b className="muted">…</b><span className="muted tiny">achievements</span></span> : null}
          <span><b>{ago(s.last_played)}</b><span className="muted tiny">last played</span></span>
        </div>
        {nudgeStart && !open && <span className="steam-nudge-dot" aria-hidden="true" />}
        {open && <div className="stack-sm steam-more">
          {pace && <span className="steam-pace">{pace}<span className="muted tiny"> {Math.round(hours)} h of ~{Math.round(ttbMain ?? 0)} h · progress {Math.round(progress ?? 0)}%</span></span>}
          {nudgeStart && <button className="btn sm primary" onClick={onStart}>You’ve been playing this on Steam — move to Playing</button>}
        </div>}
      </section>
      {sheet}
    </>
  );
}

/** Which Steam game this is: your Steam library, the Steam Store, or a pasted Store link. Full-height, so the keyboard doesn't push it around. */
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
  return (
    <div className="sheet-wrap sheet-top">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet steam-link" role="dialog" aria-label="Link to Steam">
        <div className="row nowrap"><strong className="grow">Which Steam game is it?</strong><button className="link" onClick={onClose}>Close</button></div>
        <input className="text-input" autoFocus placeholder="Search, or paste a Steam Store link" value={q} onChange={(e) => setQ(e.target.value)} />
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
    </div>
  );
}
