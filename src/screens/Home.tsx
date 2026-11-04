import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibItem, LogRow, Mark, SeasonEps } from '../lib/types';
import type { Settings } from '../lib/theme';
import { loadEpisodes, loadEverything, loadMarks, pickTonight } from '../lib/remote';
import { dateParts, merged } from '../lib/logic';
import { epLabel, epRuntime, isEnded, logSeasons, progress, seasonAir, seasonsName, showState, todayIso } from '../lib/tv';
import { applyEpisodeMarks } from '../lib/tvActions';
import { TIERS } from '../lib/scores';
import { Poster } from '../components/Rows';
import PlatformIcon from '../components/PlatformIcon';
import FormatIcon from '../components/FormatIcon';
import { readHours } from '../lib/formats';
import { IconBack, IconMenu } from '../components/Icons';
import { Ico } from '../components/Rate';
import MovieCard from './MovieCard';
import ShowCard from './ShowCard';

type Open = { id: string; kind: 'movie' | 'tv' | 'game' | 'book' } | null;
const kindOf = (i: LibItem): 'movie' | 'tv' | 'game' | 'book' => (i.section === 'movies' ? 'movie' : i.section === 'tv' ? 'tv' : i.section === 'books' ? 'book' : 'game');
const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const SEC_COLOR: Record<string, string> = { movies: '#E8714A', tv: '#9A8CF0', console: '#2FB98A', pc: '#4C9BEA', retro: '#E0A43A', books: '#D98B5F' };
const SEC_LABEL: Record<string, string> = { movies: 'Movie', tv: 'Show', console: 'Console', pc: 'PC', retro: 'Retro', books: 'Book' };

/** Home: what's going on now — continue, coming up, recently finished, up next — and a way into Stats. */
export default function Home({ settings, onMenu, onStats, onBack }: { settings: Settings; onMenu: () => void; onStats: () => void; onBack?: () => void }) {
  const [items, setItems] = useState<LibItem[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [eps, setEps] = useState<SeasonEps[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const all = await loadEverything();
      const its = all.items.map((i) => ({ ...i, title: merged(i.title, i.overrides) }));
      const byId = new Map(its.map((i) => [i.id, i]));
      setItems(its); setLogs(all.logs.map((l) => ({ ...l, library: byId.get(l.library_id) ?? l.library })));
      const watching = its.filter((i) => i.section === 'tv' && i.status === 'playing');
      const [e, m] = await Promise.all([loadEpisodes(watching.map((i) => i.title_id)), loadMarks(watching.map((i) => i.id))]);
      setEps(e); setMarks(m);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // --- Continue: shows with an episode ready, games in progress
  const shows = useMemo(() => items.filter((i) => i.section === 'tv' && i.status === 'playing').map((it) => {
    const p = progress(it, it.title, eps.filter((e) => e.title_id === it.title_id), marks.filter((m) => m.library_id === it.id), today);
    return { it, p };
  }).sort((a, b) => Number(!!b.p.nextEp) - Number(!!a.p.nextEp) || (b.p.lastSeen ?? '').localeCompare(a.p.lastSeen ?? '')), [items, eps, marks, today]);
  const games = useMemo(() => items.filter((i) => ['console', 'pc', 'retro', 'books'].includes(i.section) && i.status === 'playing')
    .sort((a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? '')), [items]);

  // --- Coming up (next 30 days): new episodes, season premieres, releases from Backlog
  const coming = useMemo(() => {
    const limit = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);   // the week strip shows 7 days; the rest is 'next'
    const out: { it: LibItem; date: string; what: string }[] = [];
    items.forEach((it) => {
      if (it.section === 'tv') {
        if (it.status === 'playing') {
          const p = progress(it, it.title, eps.filter((e) => e.title_id === it.title_id), marks.filter((m) => m.library_id === it.id), today);
          if (!p.nextEp && p.nextFuture?.air_date && p.nextFuture.air_date <= limit) out.push({ it, date: p.nextFuture.air_date, what: epLabel(p.nextFuture) });
        } else {
          const st = showState(it, it.title, logs.filter((l) => l.library.id === it.id), null, today);
          if ((st.state === 'caughtUp' || st.state === 'newSeason') && st.seasons.length) {
            const d = seasonAir(it.title, st.seasons[0]);
            if (d && d >= today && d <= limit) out.push({ it, date: d, what: seasonsName([st.seasons[0]]) + ' premiere' });
          }
        }
      } else if (it.status === 'backlog' && it.title.release_date && it.title.release_date >= today && it.title.release_date <= limit) {
        out.push({ it, date: it.title.release_date, what: it.section === 'movies' ? 'Release' : 'Release · ' + SEC_LABEL[it.section] });
      }
    });
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
  }, [items, logs, eps, marks, today]);

  const recent = useMemo(() => logs.slice().sort((a, b) => b.watched_at.localeCompare(a.watched_at)).slice(0, 14), [logs]);
  const upNext = useMemo(() => items.filter((i) => i.status === 'backlog' && i.up_next).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).slice(0, 10), [items]);

  const watchedEp = async (it: LibItem, ep: { season: number; episode: number }) => {
    setBusy(it.id);
    try {
      const mine = logs.filter((l) => l.library.id === it.id).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch, scope: l.scope, season_from: l.season_from, season_to: l.season_to, seasons: l.seasons }));
      const r = await applyEpisodeMarks(it, it.title, eps.filter((e) => e.title_id === it.title_id), marks, mine as never, [ep], true);
      setMarks(r.marks);
      if (r.finished) await load();
    } finally { setBusy(null); }
  };

  const nowCount = shows.length + games.length;
  const readyShows = shows.filter((x) => x.p.nextEp);
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = new Date().getHours();
  const greeting = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  // ---- spotlight: the show with an episode ready that you watched last, otherwise the game / book you started last
  const spot = readyShows[0] ? { it: readyShows[0].it, show: readyShows[0].p } : games[0] ? { it: games[0], show: null } : null;
  const shelf = [...shows.filter((x) => x.it.id !== spot?.it.id).map((x) => ({ it: x.it, show: x.p as ReturnType<typeof progress> | null })), ...games.filter((g) => g.id !== spot?.it.id).map((it) => ({ it, show: null }))];

  // ---- What tonight? — 🎲 random or ✦ AI, from your backlog, with filters that depend on the type
  type Kind = 'Any' | 'Movie' | 'Show' | 'Game' | 'Book';
  const [kind, setKind] = useState<Kind>('Any');
  const [f, setF] = useState<Record<string, string>>({});
  const [mood, setMood] = useState('');
  const [pick, setPick] = useState<{ id: string; why: string } | null>(null); const [picking, setPicking] = useState(false); const [pickErr, setPickErr] = useState('');
  const seen = useRef<string[]>([]);
  const toggle = (k: string, v: string) => { setF((o) => ({ ...o, [k]: o[k] === v ? '' : v })); setPick(null); seen.current = []; };
  const SEC_OF: Record<Kind, (i: LibItem) => boolean> = {
    Any: () => true, Movie: (i) => i.section === 'movies', Show: (i) => i.section === 'tv', Game: (i) => ['console', 'pc', 'retro'].includes(i.section), Book: (i) => i.section === 'books'
  };
  const backlog = items.filter((i) => i.status === 'backlog' && (!i.title.release_date || i.title.release_date <= today) && SEC_OF[kind](i));
  const dataOf = (i: LibItem) => (i.title.data ?? {}) as { ttb?: { main?: number | null }; pages?: number | null; seasons?: unknown[]; status?: string; modes?: string[]; series?: unknown };
  const topGenres = useMemo(() => { const m = new Map<string, number>(); backlog.forEach((i) => (i.title.genres ?? []).forEach((g) => m.set(g, (m.get(g) ?? 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g); }, [backlog.length, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const platforms = [...new Set(backlog.map((i) => (i as LibItem & { platform?: string | null }).platform).filter(Boolean) as string[])];
  const filtered = backlog.filter((i) => {
    const d = dataOf(i); const rt = i.title.runtime ?? 0; const ttb = d.ttb?.main ?? 0; const pages = d.pages ?? 0;
    if (f.genre && !(i.title.genres ?? []).includes(f.genre)) return false;
    if (f.upnext && !i.up_next) return false;
    if (kind === 'Movie') {
      if (f.len === 'short' && !(rt && rt < 90)) return false; if (f.len === 'mid' && !(rt >= 90 && rt <= 120)) return false; if (f.len === 'long' && !(rt > 120)) return false;
      if (f.meta && !((i.title.metascore ?? 0) >= 70)) return false; if (f.old && !((i.title.year ?? 9999) < 2000)) return false;
    }
    if (kind === 'Show') {
      const n = d.seasons?.length ?? 0;
      if (f.ep === 'short' && !(rt && rt <= 30)) return false; if (f.ep === 'long' && !(rt > 30)) return false;
      if (f.size === 'mini' && !(n === 1)) return false; if (f.size === 'few' && !(n >= 1 && n <= 2)) return false; if (f.size === 'long' && !(n >= 3)) return false;
      if (f.status === 'ended' && !isEnded(i.title)) return false; if (f.status === 'running' && isEnded(i.title)) return false;
    }
    if (kind === 'Game') {
      if (f.plat && (i as LibItem & { platform?: string | null }).platform !== f.plat) return false;
      if (f.ttb === 'short' && !(ttb && ttb < 10)) return false; if (f.ttb === 'mid' && !(ttb >= 10 && ttb <= 30)) return false; if (f.ttb === 'long' && !(ttb > 30)) return false;
      if (f.coop && !((d.modes ?? []).some((m) => /co-?op|multiplayer/i.test(m)) || (i as LibItem & { coop?: boolean }).coop)) return false;
    }
    if (kind === 'Book') {
      const ov = (i.overrides as { pages?: number } | null)?.pages ?? pages;
      if (f.pages === 'short' && !(ov && ov < 300)) return false; if (f.pages === 'mid' && !(ov >= 300 && ov <= 500)) return false; if (f.pages === 'long' && !(ov > 500)) return false;
      if (f.fmt && (i as LibItem & { format?: string | null }).format !== f.fmt) return false;
      if (f.lang === 'ru' && !/[а-яё]/i.test(i.title.title)) return false; if (f.lang === 'en' && /[а-яё]/i.test(i.title.title)) return false;
      if (f.series === 'series' && !d.series) return false; if (f.series === 'single' && d.series) return false;
    }
    return true;
  });
  const random = () => {
    const pool = filtered.filter((i) => !seen.current.includes(i.id));
    const list = pool.length ? pool : filtered;
    if (!list.length) { setPickErr('Nothing in your backlog fits these filters.'); setPick(null); return; }
    if (!pool.length) seen.current = [];
    const bag = list.flatMap((i) => (i.up_next ? [i, i, i] : [i]));   // Up next is three times as likely
    const it = bag[Math.floor(Math.random() * bag.length)];
    seen.current.push(it.id); setPickErr(''); setPick({ id: it.id, why: '' });
  };
  const askAI = async () => {
    setPicking(true); setPickErr('');
    const cands = filtered.map((i) => { const d = dataOf(i); return { id: i.id, kind: SEC_LABEL[i.section], title: i.title.title, year: i.title.year, genres: (i.title.genres ?? []).slice(0, 3), minutes: i.title.runtime ?? null, hoursToBeat: d.ttb?.main ?? null, pages: d.pages ?? null, metascore: i.title.metascore ?? null, upNext: i.up_next }; });
    const liked = logs.filter((l) => l.tier === 'ten' || l.tier === 'awesome').slice(-40).map((l) => ({ title: l.library.title.title, kind: SEC_LABEL[l.library.section], rating: l.tier }));
    try { const r = await pickTonight(`Something for tonight${kind !== 'Any' ? ' — a ' + kind.toLowerCase() : ''}${mood ? ', in the mood for something ' + mood.toLowerCase() : ''}.`, cands, liked, seen.current); seen.current.push(r.id); setPick(r); }
    catch (e) { setPickErr((e as Error).message || 'Couldn’t pick — try again.'); }
    setPicking(false);
  };
  const pickItem = pick ? items.find((i) => i.id === pick.id) ?? null : null;

  const bg = (it: LibItem) => it.title.backdrop_url ?? it.title.poster_url ?? null;
  const progressOf = (it: LibItem, p: ReturnType<typeof progress> | null) => (p ? p.pct : (it as LibItem & { progress?: number | null }).progress ?? 0);
  const subOf = (it: LibItem, p: ReturnType<typeof progress> | null) => {
    if (p && !p.nextEp) { const c = coming.find((x) => x.it.id === it.id); return c ? 'Next: ' + c.what + ' · ' + new Date(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : p.nextFuture?.air_date ? 'Next ep · ' + new Date(p.nextFuture.air_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Caught up · waiting for news'; }
    if (p?.nextEp) return 'Next: ' + epLabel(p.nextEp) + (p.nextEp.name ? ' — ' + p.nextEp.name : '') + (p.nextEp.runtime ? ' · ' + epRuntime(p.nextEp.runtime) : '');
    const g = it as LibItem & { progress?: number | null; format?: string | null };
    const bd = it.title.data as { ttb?: { main?: number | null }; pages?: number | null; audio_min?: number | null } | null;
    const isBook = it.section === 'books';
    const ttb = ((it.overrides as { ttb_main?: number } | null)?.ttb_main) ?? (isBook ? readHours((it.overrides as { pages?: number } | null)?.pages ?? bd?.pages, bd?.audio_min, g.format) : bd?.ttb?.main ?? null);
    const left = ttb ? Math.max(0, Math.round(ttb * (1 - (g.progress ?? 0) / 100))) : null;
    return (g.progress ?? 0) + '%' + (left !== null ? ' · ~' + left + ' h left' : '');
  };
  const verb = (it: LibItem) => (it.section === 'tv' ? 'Continue watching' : it.section === 'books' ? 'Continue reading' : 'Continue playing');

  return (
    <div className="app section-in">
      <header className="top">
        <div className="title-row">
          {onBack ? <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button> : <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>}
          <div className="title-block">
            <h1 className="section-title">{greeting}</h1>
            <span className="muted small">{dateLine}{nowCount ? ' · ' + nowCount + ' in progress' : ''}</span>
          </div>
        </div>
      </header>

      <main className="content home">
        {loading && <div className="card-wait"><span className="spinner" aria-hidden="true" /><span className="sr">Loading</span></div>}

        {/* spotlight */}
        {!loading && spot && (
          <div className="spot" role="button" tabIndex={0} onClick={() => setOpen({ id: spot.it.id, kind: kindOf(spot.it) })} onKeyDown={(e) => { if (e.key === 'Enter') setOpen({ id: spot.it.id, kind: kindOf(spot.it) }); }}>
            {bg(spot.it) && <img className={spot.it.title.backdrop_url ? '' : 'blur'} src={bg(spot.it)!} alt="" />}
            <div className="spot-shade" />
            <div className="spot-text">
              <span className="spot-kicker">{verb(spot.it)}</span>
              <strong className="spot-title">{spot.it.title.title}</strong>
              <span className="spot-sub">{subOf(spot.it, spot.show)}</span>
              <div className="spot-row">
                {spot.show?.nextEp && <button className="spot-btn" disabled={busy === spot.it.id} onClick={(e) => { e.stopPropagation(); watchedEp(spot.it, { season: spot.show!.nextEp!.season, episode: spot.show!.nextEp!.episode }); }}>{busy === spot.it.id ? '…' : <>{Ico.check}Watched</>}</button>}
                <span className="spot-bar"><i style={{ width: progressOf(spot.it, spot.show) + '%' }} /></span>
              </div>
            </div>
          </div>
        )}

        {/* What tonight? */}
        {!loading && (
          <section className="tonight">
            <span className="tonight-kicker">What tonight?</span>
            <div className="seg">{(['Any', 'Movie', 'Show', 'Game', 'Book'] as Kind[]).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setF({}); setPick(null); seen.current = []; }}>{k}</button>)}</div>
            {kind === 'Movie' && <><div className="tn-row"><span className="muted tiny">Length</span><div className="tn-chips"><button className={'chip' + (f.len === 'short' ? ' on' : '')} onClick={() => toggle('len', 'short')}>{'< 90 min'}</button><button className={'chip' + (f.len === 'mid' ? ' on' : '')} onClick={() => toggle('len', 'mid')}>90–120</button><button className={'chip' + (f.len === 'long' ? ' on' : '')} onClick={() => toggle('len', 'long')}>2 h +</button></div></div><div className="tn-chips"><button className={'chip' + (f.meta === '1' ? ' on' : '')} onClick={() => toggle('meta', '1')}>Metascore 70+</button><button className={'chip' + (f.old === '1' ? ' on' : '')} onClick={() => toggle('old', '1')}>Before 2000</button></div></>}
            {kind === 'Show' && <><div className="tn-row"><span className="muted tiny">Episode</span><div className="tn-chips"><button className={'chip' + (f.ep === 'short' ? ' on' : '')} onClick={() => toggle('ep', 'short')}>≤ 30 min</button><button className={'chip' + (f.ep === 'long' ? ' on' : '')} onClick={() => toggle('ep', 'long')}>Longer</button></div></div><div className="tn-row"><span className="muted tiny">Size</span><div className="tn-chips"><button className={'chip' + (f.size === 'mini' ? ' on' : '')} onClick={() => toggle('size', 'mini')}>Miniseries</button><button className={'chip' + (f.size === 'few' ? ' on' : '')} onClick={() => toggle('size', 'few')}>1–2 seasons</button><button className={'chip' + (f.size === 'long' ? ' on' : '')} onClick={() => toggle('size', 'long')}>3+ seasons</button></div></div><div className="tn-row"><span className="muted tiny">Status</span><div className="tn-chips"><button className={'chip' + (f.status === 'ended' ? ' on' : '')} onClick={() => toggle('status', 'ended')}>Ended</button><button className={'chip' + (f.status === 'running' ? ' on' : '')} onClick={() => toggle('status', 'running')}>Still running</button></div></div></>}
            {kind === 'Game' && <>
              {platforms.length > 1 && <div className="tn-row"><span className="muted tiny">Platform</span><div className="tn-chips">{platforms.map((p) => <button key={p} className={'chip' + (f.plat === p ? ' on' : '')} onClick={() => toggle('plat', p)}><PlatformIcon k={p} size={12} /></button>)}</div></div>}
              <div className="tn-row"><span className="muted tiny">Time to beat</span><div className="tn-chips"><button className={'chip' + (f.ttb === 'short' ? ' on' : '')} onClick={() => toggle('ttb', 'short')}>{'< 10 h'}</button><button className={'chip' + (f.ttb === 'mid' ? ' on' : '')} onClick={() => toggle('ttb', 'mid')}>10–30 h</button><button className={'chip' + (f.ttb === 'long' ? ' on' : '')} onClick={() => toggle('ttb', 'long')}>30 h +</button></div></div><div className="tn-chips"><button className={'chip' + (f.coop === '1' ? ' on' : '')} onClick={() => toggle('coop', '1')}>Co-op</button></div></>}
            {kind === 'Book' && <><div className="tn-row"><span className="muted tiny">Length</span><div className="tn-chips"><button className={'chip' + (f.pages === 'short' ? ' on' : '')} onClick={() => toggle('pages', 'short')}>{'< 300 p.'}</button><button className={'chip' + (f.pages === 'mid' ? ' on' : '')} onClick={() => toggle('pages', 'mid')}>300–500</button><button className={'chip' + (f.pages === 'long' ? ' on' : '')} onClick={() => toggle('pages', 'long')}>500 +</button></div></div><div className="tn-row"><span className="muted tiny">Format</span><div className="tn-chips"><button className={'chip' + (f.fmt === 'paper' ? ' on' : '')} onClick={() => toggle('fmt', 'paper')}>Paper</button><button className={'chip' + (f.fmt === 'ebook' ? ' on' : '')} onClick={() => toggle('fmt', 'ebook')}>E-book</button><button className={'chip' + (f.fmt === 'audio' ? ' on' : '')} onClick={() => toggle('fmt', 'audio')}>Audio</button></div></div><div className="tn-row"><span className="muted tiny">Language</span><div className="tn-chips"><button className={'chip' + (f.lang === 'ru' ? ' on' : '')} onClick={() => toggle('lang', 'ru')}>Русские</button><button className={'chip' + (f.lang === 'en' ? ' on' : '')} onClick={() => toggle('lang', 'en')}>English</button></div></div><div className="tn-row"><span className="muted tiny">Kind</span><div className="tn-chips"><button className={'chip' + (f.series === 'single' ? ' on' : '')} onClick={() => toggle('series', 'single')}>Standalone</button><button className={'chip' + (f.series === 'series' ? ' on' : '')} onClick={() => toggle('series', 'series')}>Series</button></div></div></>}
            {topGenres.length > 0 && <div className="tn-row"><span className="muted tiny">Genre</span><div className="tn-chips">{topGenres.map((g) => <button key={g} className={'chip' + (f.genre === g ? ' on' : '')} onClick={() => toggle('genre', g)}>{g}</button>)}</div></div>}
            <div className="tn-chips"><button className={'chip' + (f.upnext === '1' ? ' on' : '')} onClick={() => toggle('upnext', '1')}>Up next only</button></div>
            <div className="tn-row"><span className="muted tiny">Mood (for the AI)</span><div className="tn-chips">{['Light', 'Intense', 'Smart', 'Cozy'].map((m) => <button key={m} className={'chip' + (mood === m ? ' on' : '')} onClick={() => setMood(mood === m ? '' : m)}>{m}</button>)}</div></div>
            <span className="muted tiny">{filtered.length} in your backlog fit</span>
            <div className="row nowrap">
              <button className="btn grow" disabled={!filtered.length} onClick={random}>🎲 {pick && !pick.why ? 'Again' : 'Random'}</button>
              <button className="btn primary grow" disabled={picking || !filtered.length} onClick={askAI}>{picking ? 'Thinking…' : '✦ Ask AI'}</button>
            </div>
            {pickItem && <button className="home-item tn-pick" onClick={() => setOpen({ id: pickItem.id, kind: kindOf(pickItem) })}>
              <Poster t={pickItem.title} w={52} h={76} />
              <span className="grow"><span className="row-title">{pickItem.title.title}</span><span className="muted small">{SEC_LABEL[pickItem.section]}{pickItem.title.year ? ' · ' + pickItem.title.year : ''}{pickItem.up_next ? ' · Up next' : ''}</span>{pick?.why && <span className="small tn-why">{pick.why}</span>}</span>
            </button>}
            {pickErr && <span className="muted small">{pickErr}</span>}
          </section>
        )}

        {/* In progress: wide tickets */}
        {!loading && shelf.length > 0 && <section className="panel">
          <div className="panel-head"><span>In progress</span><span className="count-badge">{shelf.length}</span></div>
          {shelf.map(({ it, show }) => (
            <button key={it.id} className="ticket" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })}>
              <span className="ticket-img">{bg(it) && <img className={it.title.backdrop_url ? '' : 'blur'} src={bg(it)!} alt="" />}
                <span className="shelf-icon">{it.section === 'books' ? <FormatIcon f={(it as LibItem & { format?: string | null }).format} /> : ['console', 'pc', 'retro'].includes(it.section) ? <PlatformIcon k={(it as LibItem & { platform?: string | null }).platform} /> : null}</span></span>
              <span className="ticket-body"><span className="row-title ellipsis">{it.title.title}</span>
                <span className="muted tiny ellipsis">{subOf(it, show)}</span>
                <span className="mini-bar wide"><span style={{ width: progressOf(it, show) + '%' }} /></span></span>
              {show?.nextEp && <span className="ticket-act" role="button" tabIndex={0} aria-label="Watched" onClick={(e) => { e.stopPropagation(); watchedEp(it, { season: show.nextEp!.season, episode: show.nextEp!.episode }); }}>{busy === it.id ? '…' : Ico.check}</span>}
            </button>
          ))}
        </section>}

        {/* Recently finished: posters, your rating centred under each */}
        {!loading && recent.length > 0 && <section className="panel">
          <div className="panel-head"><span>Recently finished</span></div>
          <div className="home-strip">
            {recent.map((l) => { const tr = tierOf(l.tier); const ss = l.library.section === 'tv' ? seasonsName(logSeasons(l)) : ''; return (
              <button key={l.id} className="home-poster centered" onClick={() => setOpen({ id: l.library.id, kind: kindOf(l.library) })} aria-label={l.library.title.title}>
                <Poster t={l.library.title} w={88} h={130} />
                {tr ? <span className="tier-under" style={{ background: tr.color }}>{tr.label}</span> : <span className="tier-under none">—</span>}
                {ss && <span className="tiny muted ellipsis">{ss}</span>}
              </button>
            ); })}
          </div>
        </section>}

        {/* Up next: pink panel, rows */}
        {!loading && upNext.length > 0 && <section className="panel upnext-panel">
          <div className="panel-head"><span>Up next</span><span className="count-badge pink">{upNext.length}</span></div>
          {upNext.map((it) => { const d = it.title.data as { ttb?: { main?: number | null }; pages?: number | null } | null;
            const meta = it.section === 'movies' ? (it.title.runtime ? Math.floor(it.title.runtime / 60) + 'h ' + (it.title.runtime % 60) + 'm' : '') : it.section === 'tv' ? ((d as { seasons?: unknown[] } | null)?.seasons?.length ? (d as { seasons: unknown[] }).seasons.length + ' seasons' : '') : it.section === 'books' ? (d?.pages ? d.pages + ' pages' : '') : (d?.ttb?.main ? Math.round(d.ttb.main) + ' h' : '');
            return (
              <button key={it.id} className="home-item flat" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })}>
                <Poster t={it.title} w={34} h={50} />
                <span className="grow"><span className="row-title">{it.title.title}</span><span className="muted small">{['console', 'pc', 'retro'].includes(it.section) ? <PlatformIcon k={(it as LibItem & { platform?: string | null }).platform} /> : SEC_LABEL[it.section]}{meta ? ' · ' + meta : ''}</span></span>
                <span aria-hidden="true" className="muted">›</span>
              </button>
            ); })}
        </section>}

        {!loading && <button className="card home-stats" onClick={onStats}>
          <span className="grow"><strong>Your stats</strong><span className="muted small">What you watched, played and read, ratings, activity</span></span><span aria-hidden="true">›</span>
        </button>}

        {!loading && !nowCount && !coming.length && !recent.length && !upNext.length && <div className="empty">Add a movie, a show, a game or a book — your activity shows up here.</div>}
      </main>

      {open?.kind === 'tv' && <ShowCard key={open.id} itemId={open.id} initial={items.find((i) => i.id === open.id) ?? null} settings={settings} topPos={0}
        onClose={() => setOpen(null)} onChanged={load} />}
      {open && open.kind !== 'tv' && <MovieCard key={open.id} game={open.kind === 'game'} book={open.kind === 'book'} itemId={open.id} initial={items.find((i) => i.id === open.id) ?? null} settings={settings} backlogCount={0}
        onClose={() => setOpen(null)} onChanged={load} onOpenOther={(id) => { const it = items.find((i) => i.id === id); setOpen({ id, kind: it ? kindOf(it) : open.kind }); }} />}
    </div>
  );
}
