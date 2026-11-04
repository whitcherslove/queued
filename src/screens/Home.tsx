import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LibItem, LogRow, Mark, SeasonEps } from '../lib/types';
import type { Settings } from '../lib/theme';
import { loadEpisodes, loadEverything, loadMarks } from '../lib/remote';
import { dateParts, merged } from '../lib/logic';
import { epLabel, epRuntime, logSeasons, progress, seasonAir, seasonsName, showState, todayIso } from '../lib/tv';
import { applyEpisodeMarks } from '../lib/tvActions';
import { TIERS } from '../lib/scores';
import { Poster } from '../components/Rows';
import PlatformIcon from '../components/PlatformIcon';
import FormatIcon from '../components/FormatIcon';
import { readHours } from '../lib/formats';
import { IconMenu } from '../components/Icons';
import { Ico } from '../components/Rate';
import MovieCard from './MovieCard';
import ShowCard from './ShowCard';

type Open = { id: string; kind: 'movie' | 'tv' | 'game' | 'book' } | null;
const kindOf = (i: LibItem): 'movie' | 'tv' | 'game' | 'book' => (i.section === 'movies' ? 'movie' : i.section === 'tv' ? 'tv' : i.section === 'books' ? 'book' : 'game');
const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const SEC_LABEL: Record<string, string> = { movies: 'Movie', tv: 'Show', console: 'Console', pc: 'PC', retro: 'Retro', books: 'Book' };

/** Home: what's going on now — continue, coming up, recently finished, up next — and a way into Stats. */
export default function Home({ settings, onMenu, onStats }: { settings: Settings; onMenu: () => void; onStats: () => void }) {
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
    const limit = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
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
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
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

  return (
    <div className="app section-in">
      <header className="top">
        <div className="title-row">
          <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>
          <div className="title-block">
            <h1 className="section-title">{greeting}</h1>
            <span className="muted small">{dateLine}{nowCount ? ' · ' + nowCount + ' in progress' : ''}</span>
          </div>
        </div>
      </header>

      <main className="content home">
        {loading && <div className="card-wait"><span className="spinner" aria-hidden="true" /><span className="sr">Loading</span></div>}

        {!loading && nowCount > 0 && <section className="home-sec">
          <h2 className="home-h">{Ico.play}<span>Continue</span></h2>
          {shows.map(({ it, p }) => (
            <div key={it.id} className="row-card">
              <button className="row-main" onClick={() => setOpen({ id: it.id, kind: 'tv' })}>
                <Poster t={it.title} w={46} h={68} />
                <span className="row-text"><span className="row-title">{it.title.title}</span>
                  <span className="row-meta">Next: {epLabel(p.nextEp!)}{p.nextEp!.name ? ' — ' + p.nextEp!.name : ''}{p.nextEp!.runtime ? ' · ' + epRuntime(p.nextEp!.runtime) : ''}</span></span>
              </button>
              <button className="btn primary sm home-act" disabled={busy === it.id} onClick={() => watchedEp(it, { season: p.nextEp!.season, episode: p.nextEp!.episode })}>{busy === it.id ? '…' : <>{Ico.check}Watched</>}</button>
            </div>
          ))}
          {games.map((it) => {
            const g = it as LibItem & { platform?: string | null; progress?: number | null };
            const pct = g.progress ?? 0;
            const isBook = it.section === 'books';
            const bd = it.title.data as { ttb?: { main?: number | null }; pages?: number | null; audio_min?: number | null } | null;
            const ttb = ((it.overrides as { ttb_main?: number } | null)?.ttb_main) ?? (isBook ? readHours(bd?.pages, bd?.audio_min, (it as LibItem & { format?: string | null }).format) : bd?.ttb?.main ?? null);
            const left = ttb ? Math.max(0, Math.round(ttb * (1 - pct / 100))) : null;
            return (
              <div key={it.id} className="row-card">
                <button className="row-main" onClick={() => setOpen({ id: it.id, kind: isBook ? 'book' : 'game' })}>
                  <Poster t={it.title} w={46} h={68} />
                  <span className="row-text"><span className="row-title">{it.title.title}</span>
                    <span className="row-meta">{isBook ? <FormatIcon f={(it as LibItem & { format?: string | null }).format} /> : <PlatformIcon k={g.platform} />}<span className="dot-sep">·</span>{pct}%{left !== null ? ' · ~' + left + ' h left' : ''}</span>
                    <span className="row-meta"><span className="mini-bar"><span style={{ width: pct + '%' }} /></span></span></span>
                </button>
              </div>
            );
          })}
        </section>}

        {!loading && coming.length > 0 && <section className="home-sec">
          <h2 className="home-h">{Ico.date}<span>Coming up</span></h2>
          <div className="home-list">
            {coming.map((c) => { const d = dateParts(c.date); return (
              <button key={c.it.id + c.date} className="home-item" onClick={() => setOpen({ id: c.it.id, kind: kindOf(c.it) })}>
                <span className="home-date"><b>{d.day}</b><span>{d.mon}</span></span>
                <span className="grow"><span className="row-title">{c.it.title.title}</span><span className="muted small">{c.what}</span></span>
              </button>
            ); })}
          </div>
        </section>}

        {!loading && recent.length > 0 && <section className="home-sec">
          <h2 className="home-h">{Ico.check}<span>Recently finished</span></h2>
          <div className="home-strip">
            {recent.map((l) => { const tr = tierOf(l.tier); const ss = l.library.section === 'tv' ? seasonsName(logSeasons(l)) : ''; return (
              <button key={l.id} className="home-poster" onClick={() => setOpen({ id: l.library.id, kind: kindOf(l.library) })} aria-label={l.library.title.title}>
                <Poster t={l.library.title} w={88} h={130} />
                {tr ? <span className="tile-tier" style={{ background: tr.color }}>{tr.label}</span> : null}
                {ss && <span className="tiny muted ellipsis">{ss}</span>}
              </button>
            ); })}
          </div>
        </section>}

        {!loading && upNext.length > 0 && <section className="home-sec">
          <h2 className="home-h">{Ico.pin}<span>Up next</span></h2>
          {upNext.map((it) => (
            <button key={it.id} className="home-item" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })}>
              <Poster t={it.title} w={34} h={50} />
              <span className="grow"><span className="row-title">{it.title.title}</span></span>
              {it.section === 'books' ? <FormatIcon f={(it as LibItem & { format?: string | null }).format} /> : ['console', 'pc', 'retro'].includes(it.section) ? <PlatformIcon k={(it as LibItem & { platform?: string | null }).platform} /> : <span className="muted small">{SEC_LABEL[it.section]}</span>}
            </button>
          ))}
        </section>}

        {!loading && <button className="card home-stats" onClick={onStats}>
          <span className="grow"><strong>Your stats</strong><span className="muted small">What you watched and played, ratings, activity</span></span><span aria-hidden="true">›</span>
        </button>}

        {!loading && !nowCount && !coming.length && !recent.length && !upNext.length && <div className="empty">Add a movie, a show or a game — your activity shows up here.</div>}
      </main>

      {open?.kind === 'tv' && <ShowCard key={open.id} itemId={open.id} initial={items.find((i) => i.id === open.id) ?? null} settings={settings} topPos={0}
        onClose={() => setOpen(null)} onChanged={load} />}
      {open && open.kind !== 'tv' && <MovieCard key={open.id} game={open.kind === 'game'} book={open.kind === 'book'} itemId={open.id} initial={items.find((i) => i.id === open.id) ?? null} settings={settings} backlogCount={0}
        onClose={() => setOpen(null)} onChanged={load} onOpenOther={(id) => { const it = items.find((i) => i.id === id); setOpen({ id, kind: it ? kindOf(it) : open.kind }); }} />}
    </div>
  );
}
