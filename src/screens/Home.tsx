import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibItem, LogRow, Mark, SeasonEps } from '../lib/types';
import type { Settings } from '../lib/theme';
import { loadEpisodes, loadEverything, loadMarks, pickTonight } from '../lib/remote';
import { dateParts, merged } from '../lib/logic';
import { epLabel, epRuntime, logSeasons, progress, seasonAir, seasonsName, showState, todayIso } from '../lib/tv';
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
  }).filter((x) => x.p.nextEp).sort((a, b) => (b.p.lastSeen ?? '').localeCompare(a.p.lastSeen ?? '')), [items, eps, marks, today]);
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
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = new Date().getHours();
  const greeting = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  // ---- spotlight: the show with an episode ready that you watched last, otherwise the game / book you started last
  const spot = shows[0] ? { it: shows[0].it, show: shows[0].p } : games[0] ? { it: games[0], show: null } : null;
  const shelf = [...shows.slice(spot?.show ? 1 : 0).map((x) => ({ it: x.it, show: x.p })), ...games.filter((g) => g.id !== spot?.it.id).map((it) => ({ it, show: null }))];

  // ---- week strip: the next 7 days with what comes out
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); const k = d.toISOString().slice(0, 10);
    return { k, wd: d.toLocaleDateString('en-GB', { weekday: 'short' }), day: d.getDate(), ev: coming.filter((c) => c.date === k) }; }), [coming]);
  const [day, setDay] = useState<string | null>(null);
  const selDay = day ?? week.find((d) => d.ev.length)?.k ?? week[0].k;
  const dayEvents = week.find((d) => d.k === selDay)?.ev ?? [];
  const later = coming.filter((c) => c.date > week[6].k).slice(0, 3);

  // ---- tonight
  const [tTime, setTTime] = useState('2 h'); const [tMood, setTMood] = useState('Light'); const [tWhat, setTWhat] = useState('Anything');
  const [pick, setPick] = useState<{ id: string; why: string } | null>(null); const [picking, setPicking] = useState(false); const [pickErr, setPickErr] = useState('');
  const skip = useRef<string[]>([]);
  const askTonight = async (again = false) => {
    if (!again) skip.current = [];
    else if (pick) skip.current.push(pick.id);
    setPicking(true); setPickErr('');
    const want = { Movie: 'movies', Show: 'tv', Game: 'game', Book: 'books' } as Record<string, string>;
    const cands = items.filter((i) => i.status === 'backlog' && (!i.title.release_date || i.title.release_date <= today))
      .filter((i) => tWhat === 'Anything' || (want[tWhat] === 'game' ? ['console', 'pc', 'retro'].includes(i.section) : i.section === want[tWhat]))
      .map((i) => { const d = i.title.data as { ttb?: { main?: number | null }; pages?: number | null } | null;
        return { id: i.id, kind: SEC_LABEL[i.section], title: i.title.title, year: i.title.year, genres: (i.title.genres ?? []).slice(0, 3), minutes: i.title.runtime ?? null,
          hoursToBeat: d?.ttb?.main ?? null, pages: d?.pages ?? null, metascore: i.title.metascore ?? null, upNext: i.up_next }; });
    const liked = logs.filter((l) => l.tier === 'ten' || l.tier === 'awesome').slice(-40).map((l) => ({ title: l.library.title.title, kind: SEC_LABEL[l.library.section], rating: l.tier }));
    try { setPick(await pickTonight(`I have ${tTime}, in the mood for something ${tMood.toLowerCase()}${tWhat !== 'Anything' ? ', a ' + tWhat.toLowerCase() : ''}.`, cands, liked, skip.current)); }
    catch (e) { setPickErr((e as Error).message || 'Couldn’t pick — try again.'); }
    setPicking(false);
  };
  const pickItem = pick ? items.find((i) => i.id === pick.id) ?? null : null;

  const bg = (it: LibItem) => it.title.backdrop_url ?? it.title.poster_url ?? null;
  const progressOf = (it: LibItem, p: ReturnType<typeof progress> | null) => (p ? p.pct : (it as LibItem & { progress?: number | null }).progress ?? 0);
  const subOf = (it: LibItem, p: ReturnType<typeof progress> | null) => {
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

        {/* week strip */}
        {!loading && (
          <section className="home-sec">
            <div className="week" role="tablist" aria-label="This week">
              {week.map((d) => (
                <button key={d.k} role="tab" aria-selected={d.k === selDay} className={'wk' + (d.k === selDay ? ' on' : '') + (d.k === week[0].k ? ' today' : '')} onClick={() => setDay(d.k)}>
                  <span className="wk-wd">{d.wd}</span><b>{d.day}</b>
                  <span className="wk-dots">{d.ev.slice(0, 3).map((e, i) => <i key={i} style={{ background: SEC_COLOR[e.it.section] }} />)}</span>
                </button>
              ))}
            </div>
            {dayEvents.length ? dayEvents.map((c) => (
              <button key={c.it.id + c.date} className="home-item" onClick={() => setOpen({ id: c.it.id, kind: kindOf(c.it) })}>
                <Poster t={c.it.title} w={34} h={50} />
                <span className="grow"><span className="row-title">{c.it.title.title}</span><span className="muted small">{c.what}</span></span>
              </button>
            )) : <span className="muted small">{later.length ? 'Nothing that day. Next: ' + later.map((c) => c.it.title.title + ' (' + dateParts(c.date).day + ' ' + dateParts(c.date).mon + ')').join(', ') : 'Nothing coming out this week.'}</span>}
          </section>
        )}

        {/* tonight */}
        {!loading && (
          <section className="tonight">
            <span className="tonight-kicker">✦ Tonight</span>
            {!pick ? <>
              <div className="tn-chips">{['1 h', '2 h', 'All evening'].map((x) => <button key={x} className={'chip' + (tTime === x ? ' on' : '')} onClick={() => setTTime(x)}>{x}</button>)}</div>
              <div className="tn-chips">{['Light', 'Intense', 'Smart', 'Cozy'].map((x) => <button key={x} className={'chip' + (tMood === x ? ' on' : '')} onClick={() => setTMood(x)}>{x}</button>)}</div>
              <div className="tn-chips">{['Anything', 'Movie', 'Show', 'Game', 'Book'].map((x) => <button key={x} className={'chip' + (tWhat === x ? ' on' : '')} onClick={() => setTWhat(x)}>{x}</button>)}</div>
              <button className="btn primary" disabled={picking} onClick={() => askTonight(false)}>{picking ? 'Thinking…' : 'Pick something for me'}</button>
            </> : <>
              {pickItem && <button className="home-item tn-pick" onClick={() => setOpen({ id: pickItem.id, kind: kindOf(pickItem) })}>
                <Poster t={pickItem.title} w={52} h={76} />
                <span className="grow"><span className="row-title">{pickItem.title.title}</span><span className="muted small">{SEC_LABEL[pickItem.section]}{pickItem.title.year ? ' · ' + pickItem.title.year : ''}</span></span>
              </button>}
              <span className="small">{pick.why}</span>
              <div className="row nowrap"><button className="btn grow" disabled={picking} onClick={() => askTonight(true)}>{picking ? 'Thinking…' : 'Another idea'}</button><button className="btn grow" onClick={() => setPick(null)}>Change</button></div>
            </>}
            {pickErr && <span className="muted small">{pickErr}</span>}
          </section>
        )}

        {/* in progress shelf */}
        {!loading && shelf.length > 0 && <section className="home-sec">
          <h2 className="home-h"><span>In progress</span></h2>
          <div className="home-strip">
            {shelf.map(({ it, show }) => (
              <button key={it.id} className="shelf-card" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })}>
                <span className="shelf-img">{bg(it) && <img className={it.title.backdrop_url ? '' : 'blur'} src={bg(it)!} alt="" />}
                  <span className="shelf-icon">{it.section === 'books' ? <FormatIcon f={(it as LibItem & { format?: string | null }).format} /> : ['console', 'pc', 'retro'].includes(it.section) ? <PlatformIcon k={(it as LibItem & { platform?: string | null }).platform} /> : null}</span></span>
                <span className="shelf-body"><span className="row-title ellipsis">{it.title.title}</span>
                  <span className="mini-bar wide"><span style={{ width: progressOf(it, show) + '%' }} /></span>
                  <span className="muted tiny ellipsis">{show?.nextEp ? 'Next: ' + epLabel(show.nextEp) : subOf(it, show)}</span></span>
              </button>
            ))}
          </div>
        </section>}

        {!loading && recent.length > 0 && <section className="home-sec">
          <h2 className="home-h"><span>Recently finished</span></h2>
          <div className="home-strip">
            {recent.map((l) => { const tr = tierOf(l.tier); const ss = l.library.section === 'tv' ? seasonsName(logSeasons(l)) : ''; return (
              <button key={l.id} className="home-poster" onClick={() => setOpen({ id: l.library.id, kind: kindOf(l.library) })} aria-label={l.library.title.title}>
                <span className="poster-wrap"><Poster t={l.library.title} w={92} h={136} />{tr ? <span className="tile-tier on-poster" style={{ background: tr.color }}>{tr.label}</span> : null}</span>
                {ss && <span className="tiny muted ellipsis">{ss}</span>}
              </button>
            ); })}
          </div>
        </section>}

        {!loading && upNext.length > 0 && <section className="home-sec">
          <h2 className="home-h"><span>Up next</span></h2>
          <div className="home-strip">
            {upNext.map((it) => (
              <button key={it.id} className="home-poster" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })} aria-label={it.title.title}>
                <Poster t={it.title} w={92} h={136} /><span className="tiny ellipsis">{it.title.title}</span>
              </button>
            ))}
          </div>
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
