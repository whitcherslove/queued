import { useEffect, useMemo, useState } from 'react';
import type { LibItem, LogRow } from '../lib/types';
import { loadEverything, loadMarkDates } from '../lib/remote';
import { merged } from '../lib/logic';
import { logSeasons } from '../lib/tv';
import { TIERS } from '../lib/scores';
import { platformLabel } from '../lib/platforms';
import { IconBack, IconMenu } from '../components/Icons';
import { Poster } from '../components/Rows';

type Period = 'year' | 'month' | 'all';
const GAMES = ['console', 'pc', 'retro'];
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Stats: how much you watched and played, your ratings and when you were active. */
export default function Stats({ onBack, onMenu }: { onBack?: () => void; onMenu?: () => void }) {
  const [items, setItems] = useState<LibItem[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [marks, setMarks] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>('year');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const all = await loadEverything();
        const its = all.items.map((i) => ({ ...i, title: merged(i.title, i.overrides) }));
        const byId = new Map(its.map((i) => [i.id, i]));
        setItems(its); setLogs(all.logs.map((l) => ({ ...l, library: byId.get(l.library_id) ?? l.library })));
        setMarks(await loadMarkDates(new Date(Date.now() - 400 * 864e5).toISOString()));
      } finally { setLoading(false); }
    })();
  }, []);

  const now = new Date();
  const from = period === 'year' ? new Date(now.getFullYear(), 0, 1).toISOString() : period === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString() : '0000';
  const inP = (iso: string) => iso >= from;
  const pl = useMemo(() => logs.filter((l) => inP(l.watched_at)), [logs, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const movies = pl.filter((l) => l.library.section === 'movies' && !l.dropped);
  const tvLogs = pl.filter((l) => l.library.section === 'tv' && !l.dropped);
  const games = pl.filter((l) => GAMES.includes(l.library.section) && !l.dropped);
  const books = pl.filter((l) => l.library.section === 'books' && !l.dropped);
  const pages = books.reduce((n, l) => n + ((l.library.title.data as { pages?: number | null } | null)?.pages ?? 0), 0);
  const seasons = tvLogs.reduce((n, l) => n + Math.max(1, logSeasons(l)?.length ?? 0), 0);
  const episodes = period === 'all' ? null : marks.filter(inP).length;   // episode dates are loaded for ~the last year
  const hours = games.reduce((h, l) => {
    const t = l.library.title.data as { ttb?: { main?: number | null } } | null;
    return h + (((l.library.overrides as { ttb_main?: number } | null)?.ttb_main) ?? t?.ttb?.main ?? 0);
  }, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonth = (sec: (l: LogRow) => boolean) => logs.filter((l) => l.watched_at >= monthStart && sec(l) && !l.dropped).length;

  // activity calendar: last 26 weeks, one cell per day (journal entries + episodes)
  const heat = useMemo(() => {
    const counts = new Map<string, number>();
    logs.forEach((l) => { const k = dayKey(l.watched_at); counts.set(k, (counts.get(k) ?? 0) + 1); });
    marks.forEach((m) => { const k = dayKey(m); counts.set(k, (counts.get(k) ?? 0) + 1); });
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(start.getDate() - (25 * 7 + ((end.getDay() + 6) % 7)));   // Monday, 26 weeks back
    const days: { k: string; n: number; wd: number }[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push({ k: dayKey(d.toISOString()), n: counts.get(dayKey(d.toISOString())) ?? 0, wd: d.getDay() });
    // longest streak and favourite weekday over the same window
    let best = 0, cur = 0; const wd = [0, 0, 0, 0, 0, 0, 0];
    days.forEach((d) => { if (d.n) { cur++; best = Math.max(best, cur); wd[d.wd] += d.n; } else cur = 0; });
    const top = wd.indexOf(Math.max(...wd));
    return { days, best, topDay: Math.max(...wd) ? WD[top] : null };
  }, [logs, marks]);
  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

  const dist = TIERS.filter((t) => t.id !== 'dropped').slice().reverse().map((t) => ({ t, n: pl.filter((l) => l.tier === t.id).length }));
  const maxN = Math.max(1, ...dist.map((d) => d.n));
  const top = pl.filter((l) => l.tier === 'ten' || (l.score ?? 0) >= 4.5).sort((a, b) => (b.score ?? (b.tier === 'ten' ? 5 : 0)) - (a.score ?? (a.tier === 'ten' ? 5 : 0))).slice(0, 6);
  const mode = (arr: string[]) => { const m = new Map<string, number>(); arr.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const topPlatform = mode(games.map((l) => (l as LogRow & { platform?: string | null }).platform ?? (l.library as LibItem & { platform?: string | null }).platform ?? '').filter(Boolean));
  const topGenre = mode(pl.flatMap((l) => l.library.title.genres ?? []));
  const backlog = items.filter((i) => i.status === 'backlog').length;

  return (
    <div className="app section-in">
      <header className="top">
        <div className="title-row">
          {onBack ? <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button> : <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>}
          <div className="title-block">
            <h1 className="section-title">Stats</h1>
            <span className="muted small">{period === 'year' ? 'This year' : period === 'month' ? 'This month' : 'All time'}</span>
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="Period">
          {(['year', 'month', 'all'] as Period[]).map((p) => <button key={p} role="tab" aria-selected={period === p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p === 'year' ? 'This year' : p === 'month' ? 'This month' : 'All time'}</button>)}
        </div>
      </header>

      <main className="content home">
        {loading ? <div className="card-wait"><span className="spinner" aria-hidden="true" /></div> : <>
          <div className="stat-grid">
            <div className="stat"><span className="muted small">Movies</span><b>{movies.length}</b><span className="muted tiny">{period !== 'month' ? '+' + thisMonth((l) => l.library.section === 'movies') + ' this month' : 'watched'}</span></div>
            <div className="stat"><span className="muted small">{episodes === null ? 'Seasons' : 'Episodes'}</span><b>{episodes ?? seasons}</b><span className="muted tiny">{episodes === null ? 'finished' : seasons + (seasons === 1 ? ' season' : ' seasons')}</span></div>
            <div className="stat"><span className="muted small">Games</span><b>{games.length}</b><span className="muted tiny">{hours ? '~' + Math.round(hours) + ' h' : 'finished'}</span></div>
            {(books.length > 0 || items.some((i) => i.section === 'books')) && <div className="stat"><span className="muted small">Books</span><b>{books.length}</b><span className="muted tiny">{pages ? pages.toLocaleString('en-GB') + ' pages' : 'read'}</span></div>}
          </div>

          <section className="card stack-sm">
            <h2 className="h2">Activity</h2>
            <div className="heat" role="img" aria-label={'Activity over the last 26 weeks. Longest streak ' + heat.best + ' days.'}>
              {heat.days.map((d) => <i key={d.k} className={'h' + level(d.n)} title={d.k + ': ' + d.n} />)}
            </div>
            <span className="muted small">Longest streak {heat.best} {heat.best === 1 ? 'day' : 'days'}{heat.topDay ? ' · most active: ' + heat.topDay : ''}</span>
          </section>

          <section className="card stack-sm">
            <h2 className="h2">Your ratings</h2>
            <div className="dist">
              {dist.map(({ t, n }) => (
                <div key={t.id} className="dist-col">
                  <span className="tiny strong">{n || ''}</span>
                  <span className="dist-bar" style={{ height: Math.max(4, (n / maxN) * 90) + 'px', background: t.color }} />
                  <span className="tiny muted dist-label">{t.label}</span>
                </div>
              ))}
            </div>
          </section>

          {top.length > 0 && <section className="card stack-sm">
            <h2 className="h2">Top {period === 'year' ? 'this year' : period === 'month' ? 'this month' : 'of all time'}</h2>
            <div className="home-strip">{top.map((l) => <span key={l.id} className="home-poster"><Poster t={l.library.title} w={80} h={118} /><span className="tiny ellipsis">{l.library.title.title}</span></span>)}</div>
          </section>}

          <div className="row wrap">
            {topPlatform && <span className="pill" style={{ background: 'var(--surface2)' }}>Most played: {platformLabel(topPlatform)}</span>}
            {topGenre && <span className="pill" style={{ background: 'var(--surface2)' }}>Top genre: {topGenre}</span>}
            <span className="pill" style={{ background: 'var(--surface2)' }}>In your backlogs: {backlog}</span>
          </div>
        </>}
      </main>
    </div>
  );
}
