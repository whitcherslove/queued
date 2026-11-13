import { useEffect, useMemo, useState } from 'react';
import type { LibItem, LogRow } from '../lib/types';
import type { Settings } from '../lib/theme';
import { loadEverything, loadMarkDates } from '../lib/remote';
import { cardLogs, merged } from '../lib/logic';
import { logSeasons, seasonsName } from '../lib/tv';
import { TIERS } from '../lib/scores';
import { ChevBtn, IconBack, IconMenu, ReplayIcon } from '../components/Icons';
import { Poster } from '../components/Rows';
import PlatformIcon from '../components/PlatformIcon';
import ShowCard from './ShowCard';
import MovieCard from './MovieCard';
import { EyePlus } from './Movies';
import { useBackLayer } from '../lib/back';
import ScoreRing from '../components/ScoreRing';

const SECTIONS = [
  { id: 'movies', label: 'Movies' }, { id: 'tv', label: 'TV Shows' }, { id: 'console', label: 'Console games' },
  { id: 'pc', label: 'PC games' }, { id: 'retro', label: 'Retro games' }, { id: 'books', label: 'Books' }
];
const GAMES = ['console', 'pc', 'retro'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KIND_COLOR: Record<string, string> = { movies: '#FFAC96', tv: '#B3A3FF', console: '#5CDED2', pc: '#A6D8FF', retro: '#F2D58A', books: '#F4A7C3' };
const tierOf = (id: string | null) => TIERS.find((t) => t.id === id);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const dayKey = (iso: string) => iso.slice(0, 10);

/** Stats: pick a period, then Overview (numbers, charts, records), Journal (everything finished) or Games (the games journal). */
export default function Stats({ onBack, onMenu, settings }: { onBack?: () => void; onMenu?: () => void; settings?: Settings }) {
  const [items, setItems] = useState<LibItem[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [marks, setMarks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | null>(new Date().getFullYear());
  const [month, setMonth] = useState<number | null>(null);
  const [tab, setTab] = useState<'overview' | 'journal' | 'games'>('overview');
  const [replays, setReplays] = useState(false);
  const [card, setCard] = useState<LibItem | null>(null);
  const scale = settings?.scale ?? 5;
  useBackLayer(!!card, () => setCard(null));
  const [shut, setShut] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('queued.stats.shut') ?? '[]')); } catch { return new Set(); } });
  const toggleGroup = (k: string) => { const n = new Set(shut); if (n.has(k)) n.delete(k); else n.add(k); setShut(n); try { localStorage.setItem('queued.stats.shut', JSON.stringify([...n])); } catch { /* full */ } };
  const groupHead = (k: string, label: string, n: number) => (
    <button className="w-head" aria-expanded={!shut.has(k)} onClick={() => toggleGroup(k)}>
      <span className="h2">{label}</span><span className="w-count">{n}</span><span className="grow" /><ChevBtn open={!shut.has(k)} size={30} />
    </button>
  );   // Back from a card returns to Stats

  useEffect(() => {
    (async () => {
      try {
        const all = await loadEverything();
        const its = all.items.map((i) => ({ ...i, title: merged(i.title, i.overrides) }));
        const byId = new Map(its.map((i) => [i.id, i]));
        setItems(its); setLogs(all.logs.filter((l) => !l.dropped).map((l) => ({ ...l, library: byId.get(l.library_id) ?? l.library })));
        setMarks(await loadMarkDates('2000-01-01T00:00:00Z'));
      } finally { setLoading(false); }
    })();
  }, []);

  const years = useMemo(() => { const m = new Map<number, number>(); logs.forEach((l) => { const y = Number(l.watched_at.slice(0, 4)); m.set(y, (m.get(y) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => b[0] - a[0]); }, [logs]);
  const inYear = useMemo(() => (year ? logs.filter((l) => Number(l.watched_at.slice(0, 4)) === year) : logs), [logs, year]);
  const monthCounts = useMemo(() => { const c = Array(12).fill(0); inYear.forEach((l) => c[new Date(l.watched_at).getMonth()]++); return c; }, [inYear]);
  const period = useMemo(() => (month === null ? inYear : inYear.filter((l) => new Date(l.watched_at).getMonth() === month)).slice().sort((a, b) => b.watched_at.localeCompare(a.watched_at)), [inYear, month]);
  const periodLabel = year ? (month !== null ? MONTHS[month] + ' ' + year : String(year)) : 'All time';
  const inPeriod = (iso: string) => (!year || Number(iso.slice(0, 4)) === year) && (month === null || new Date(iso).getMonth() === month);

  // ---------- numbers ----------
  const scored = period.filter((l) => l.score != null);
  const avg = scored.length ? scored.reduce((s, l) => s + Number(l.score), 0) / scored.length : null;
  const shown = (v: number) => (scale === 10 ? (Math.round(v * 4) / 2).toFixed(1) : (Math.round(v * 10) / 10).toFixed(1));
  const episodes = marks.filter(inPeriod).length;
  const hours = useMemo(() => {
    const h: Record<string, number> = { movies: 0, tv: 0, games: 0, books: 0 };
    period.forEach((l) => {
      const t = l.library.title, d = (t.data ?? {}) as { ttb?: { main?: number | null }; pages?: number | null };
      if (l.library.section === 'movies') h.movies += (t.runtime ?? 110) / 60;
      else if (GAMES.includes(l.library.section)) h.games += d.ttb?.main ?? 0;
      else if (l.library.section === 'books') h.books += ((d.pages ?? 300) * 1.5) / 60;
    });
    h.tv = (episodes * 40) / 60;
    return h;
  }, [period, episodes]);
  const totalHours = Math.round(hours.movies + hours.tv + hours.games + hours.books);
  const tierCounts = TIERS.filter((t) => t.id !== 'dropped').map((t) => ({ ...t, n: period.filter((l) => l.tier === t.id).length }));
  const tierTotal = tierCounts.reduce((s, t) => s + t.n, 0);
  const top = period.filter((l) => l.tier === 'ten');
  // bars: months of the year (or years for All time), split by kind
  const bars = useMemo(() => {
    const keys = year ? MONTHS.map((_, i) => i) : years.map(([y]) => y).reverse();
    return keys.map((k) => {
      const list = year ? inYear.filter((l) => new Date(l.watched_at).getMonth() === k) : logs.filter((l) => Number(l.watched_at.slice(0, 4)) === k);
      const by: Record<string, number> = {}; list.forEach((l) => { by[l.library.section] = (by[l.library.section] ?? 0) + 1; });
      return { label: year ? MONTHS[k as number].slice(0, 1) : String(k).slice(2), full: year ? MONTHS[k as number] : String(k), total: list.length, by, k };
    });
  }, [year, inYear, logs, years]);
  const maxBar = Math.max(1, ...bars.map((b) => b.total));
  // tastes
  const genreScores = useMemo(() => {
    const m = new Map<string, { n: number; s: number }>();
    period.filter((l) => l.score != null).forEach((l) => (l.library.title.genres ?? []).forEach((g) => { const x = m.get(g) ?? { n: 0, s: 0 }; x.n++; x.s += Number(l.score); m.set(g, x); }));
    return [...m.entries()].filter(([, x]) => x.n >= 3).map(([g, x]) => ({ g, avg: x.s / x.n, n: x.n })).sort((a, b) => b.avg - a.avg).slice(0, 5);
  }, [period]);
  const platforms = useMemo(() => { const m = new Map<string, number>(); period.filter((l) => GAMES.includes(l.library.section)).forEach((l) => { const p = (l as { platform?: string | null }).platform ?? (l.library as { platform?: string | null }).platform; if (p) m.set(p, (m.get(p) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6); }, [period]);
  const decades = useMemo(() => { const m = new Map<string, number>(); period.forEach((l) => { const y = l.library.title.year; if (y) { const d = Math.floor(y / 10) * 10 + 's'; m.set(d, (m.get(d) ?? 0) + 1); } }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5); }, [period]);
  // records
  const records = useMemo(() => {
    const days = [...new Set([...period.map((l) => dayKey(l.watched_at)), ...marks.filter(inPeriod).map(dayKey)])].sort();
    let best = 0, run = 0, prev = '';
    days.forEach((d) => { const p = new Date(d); p.setDate(p.getDate() - 1); run = prev === dayKey(p.toISOString()) ? run + 1 : 1; best = Math.max(best, run); prev = d; });
    const busiest = [...bars].sort((a, b) => b.total - a.total)[0];
    return { streak: best, busiest: busiest && busiest.total ? busiest.full + ' · ' + busiest.total : '—', active: days.length };
  }, [period, marks, bars]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    const text = `My ${periodLabel} in Queued: ${period.length} finished · ~${totalHours} h${avg != null ? ' · average ' + shown(avg) + '/' + scale : ''}` + (top.length ? `\n10 out of 10: ${top.slice(0, 5).map((l) => l.library.title.title).join(', ')}` : '');
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); alert('Copied — paste it anywhere.'); } } catch { /* cancelled */ }
  };

  // ---------- rows ----------
  const name = (l: LogRow) => l.library.title.title + (l.library.section === 'tv' && l.scope !== 'item' ? ': ' + seasonsName(logSeasons(l)) : '');
  const rate = (l: LogRow) => { const t = tierOf(l.tier); return t ? <span className="tier-under" style={{ background: t.color }}>{t.label}</span> : <span className="muted tiny">No rating</span>; };
  const row = (l: LogRow) => (
    <button key={l.id} className="st-row" onClick={() => setCard(l.library)}>
      <Poster t={{ title: l.library.title.title, poster_url: l.library.title.poster_url }} w={34} h={50} />
      <span className="grow stack-0"><span className="st-title">{name(l)}{l.rewatch && (GAMES.includes(l.library.section) ? <span className="rew-mini" role="img" aria-label="Replay"><ReplayIcon size={13} /></span> : <EyePlus size={13} />)}</span><span className="muted tiny">{fmtDate(l.watched_at)}</span></span>
      <span className="st-rate">{rate(l)}{l.score != null && <ScoreRing value={Number(l.score)} scale={scale} size={30} fontSize={11} />}</span>
    </button>
  );
  const gameRow = (l: LogRow) => {
    const plat = (l as { platform?: string | null }).platform ?? (l.library as { platform?: string | null }).platform;
    return (
      <button key={l.id} className="st-row game" onClick={() => setCard(l.library)}>
        <Poster t={{ title: l.library.title.title, poster_url: l.library.title.poster_url }} w={34} h={50} />
        <span className="grow stack-0 st-main"><span className="st-title">{l.library.title.title}{l.rewatch && <span className="rew-mini" role="img" aria-label="Replay"><ReplayIcon size={13} /></span>}</span>
          <span className="st-ref muted tiny">{plat ? <PlatformIcon k={plat} size={10} /> : <span />}<span className="st-year">{l.library.title.year ?? ''}</span><span>{fmtDate(l.watched_at)}</span></span></span>
        <span className="st-rate">{rate(l)}{l.score != null && <ScoreRing value={Number(l.score)} scale={scale} size={30} fontSize={11} />}</span>
      </button>
    );
  };
  const gamesLogs = period.filter((l) => GAMES.includes(l.library.section));
  const gamesShown = gamesLogs.filter((l) => !!l.rewatch === replays);

  return (
    <div className="screen stats">
      <header className="top"><div className="title-row">
        {onBack ? <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button> : <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>}
        <div className="title-block"><h1 className="section-title">Stats</h1></div>
        <button className="icon-btn boxed" aria-label="Share" onClick={share}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg></button>
      </div>
        <div className="st-chips">
          <button className={'f-chip' + (year === null ? ' on' : '')} onClick={() => { setYear(null); setMonth(null); }}>All <span className="muted tiny">{logs.length}</span></button>
          {years.map(([y, n]) => <button key={y} className={'f-chip' + (year === y ? ' on' : '')} onClick={() => { setYear(y); setMonth(null); }}>{y} <span className="muted tiny">{n}</span></button>)}
        </div>
        {year !== null && <div className="st-chips months">
          <button className={'f-chip' + (month === null ? ' on' : '')} onClick={() => setMonth(null)}>Whole year</button>
          {MONTHS.map((m, i) => monthCounts[i] > 0 && <button key={m} className={'f-chip' + (month === i ? ' on' : '')} onClick={() => setMonth(i)}>{m} <span className="muted tiny">{monthCounts[i]}</span></button>)}
        </div>}
        <div className="seg" role="tablist">
          {(['overview', 'journal', 'games'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'overview' ? 'Overview' : t === 'journal' ? 'Journal' : 'Games'}</button>)}
        </div>
      </header>

      <main className="content stack">
        {loading ? <div className="card-wait"><span className="spinner" aria-hidden="true" /></div> : <>

        {tab === 'overview' && <>
          <section className="panel st-hero">
            <span className="muted small">{periodLabel}</span>
            <div className="st-big"><span><b>{period.length}</b> finished</span><span><b>~{totalHours}</b> h</span>{avg != null && <span><b>{shown(avg)}</b> avg /{scale}</span>}</div>
            <div className="st-kinds">{SECTIONS.map((s) => { const n = period.filter((l) => l.library.section === s.id).length; return n ? <span key={s.id}><i style={{ background: KIND_COLOR[s.id] }} />{s.label} {n}</span> : null; })}</div>
          </section>

          {tierTotal > 0 && <section className="panel"><div className="panel-head"><span>Ratings</span></div>
            <div className="st-tierbar">{tierCounts.filter((t) => t.n).map((t) => <span key={t.id} style={{ flex: t.n, background: t.color }} title={t.label + ' ' + t.n} />)}</div>
            <div className="st-legend">{tierCounts.filter((t) => t.n).map((t) => <span key={t.id}><i style={{ background: t.color }} />{t.label} <b>{t.n}</b></span>)}</div>
          </section>}

          <section className="panel"><div className="panel-head"><span>{year ? 'By month' : 'By year'}</span></div>
            <div className="st-bars">{bars.map((b) => (
              <button key={b.full} className={'st-bar' + (year && month === b.k ? ' on' : '')} onClick={() => { if (year) setMonth(month === b.k ? null : (b.k as number)); else { setYear(b.k as number); setMonth(null); } }} aria-label={b.full + ' · ' + b.total}>
                <span className="st-stack" style={{ height: (b.total / maxBar) * 100 + '%' }}>{SECTIONS.map((s) => b.by[s.id] ? <i key={s.id} style={{ flex: b.by[s.id], background: KIND_COLOR[s.id] }} /> : null)}</span>
                <span className="muted tiny">{b.label}</span>
              </button>))}</div>
          </section>

          {top.length > 0 && <section className="panel"><div className="panel-head"><span>10 out of 10</span><span className="count-badge">{top.length}</span></div>
            <div className="home-strip">{top.map((l) => <button key={l.id} className="home-poster" onClick={() => setCard(l.library)}><Poster t={{ title: l.library.title.title, poster_url: l.library.title.poster_url }} w={74} h={108} /></button>)}</div>
          </section>}

          <section className="panel"><div className="panel-head"><span>Time</span></div>
            <div className="adm-grid">
              {[['Movies', hours.movies], ['TV Shows', hours.tv], ['Games', hours.games], ['Books', hours.books]].map(([l, v]) => <div key={l as string} className="adm-stat"><span className="adm-num">~{Math.round(v as number)} h</span><span className="muted tiny">{l}{l === 'TV Shows' ? ` · ${episodes} episodes` : ''}</span></div>)}
            </div>
            <span className="muted tiny">Estimates: films by runtime, episodes ~40 min, games by HowLongToBeat, books ~1.5 min a page.</span>
          </section>

          {(genreScores.length > 0 || platforms.length > 0 || decades.length > 0) && <section className="panel"><div className="panel-head"><span>Taste</span></div>
            {genreScores.length > 0 && <div className="st-list"><span className="muted tiny">Genres you rate highest</span>{genreScores.map((g) => <span key={g.g} className="st-li"><span className="grow">{g.g}</span><span className="muted tiny">{g.n}</span><b>{shown(g.avg)}</b></span>)}</div>}
            {platforms.length > 0 && <div className="st-list"><span className="muted tiny">Platforms</span><div className="f-row">{platforms.map(([k, n]) => <span key={k} className="f-chip"><PlatformIcon k={k} size={11} /> {n}</span>)}</div></div>}
            {decades.length > 0 && <div className="st-list"><span className="muted tiny">Decades</span><div className="f-row">{decades.map(([d, n]) => <span key={d} className="f-chip">{d} <b>{n}</b></span>)}</div></div>}
          </section>}

          <section className="panel"><div className="panel-head"><span>Records</span></div>
            <div className="adm-grid">
              <div className="adm-stat"><span className="adm-num">{records.streak}</span><span className="muted tiny">days in a row</span></div>
              <div className="adm-stat"><span className="adm-num">{records.active}</span><span className="muted tiny">active days</span></div>
              <div className="adm-stat" style={{ gridColumn: 'span 2' }}><span className="adm-num small-num">{records.busiest}</span><span className="muted tiny">busiest {year ? 'month' : 'year'}</span></div>
            </div>
          </section>
        </>}

        {tab === 'journal' && (period.length === 0 ? <div className="empty small-pad">Nothing finished in {periodLabel}.</div> : SECTIONS.map((s) => {
          const list = period.filter((l) => l.library.section === s.id);
          return list.length ? <section key={s.id} className="panel st-group">{groupHead('j-' + s.id, s.label, list.length)}{!shut.has('j-' + s.id) && list.map(row)}</section> : null;
        }))}

        {tab === 'games' && <>
          <div className="seg small">
            <button className={!replays ? 'on' : ''} onClick={() => setReplays(false)}>New · {gamesLogs.filter((l) => !l.rewatch).length}</button>
            <button className={replays ? 'on' : ''} onClick={() => setReplays(true)}>Replayed · {gamesLogs.filter((l) => l.rewatch).length}</button>
          </div>
          {gamesShown.length === 0 ? <div className="empty small-pad">No games {replays ? 'replayed' : 'finished'} in {periodLabel}.</div> : GAMES.map((g) => {
            const list = gamesShown.filter((l) => l.library.section === g);
            return list.length ? <section key={g} className="panel st-group">{groupHead('g-' + g, SECTIONS.find((x) => x.id === g)!.label, list.length)}
              {!shut.has('g-' + g) && <><div className="st-thead"><span /><span>Title</span><span>Platform</span><span>Year</span><span>Finished</span><span>Rating</span></div>
              {list.map(gameRow)}</>}</section> : null;
          })}
        </>}
        </>}
      </main>

      {card && settings && (card.section === 'tv'
        ? <ShowCard key={card.id} itemId={card.id} initial={card} settings={settings} topPos={0} onClose={() => setCard(null)} onChanged={() => undefined} />
        : <MovieCard key={card.id} game={GAMES.includes(card.section)} book={card.section === 'books'} itemId={card.id} initial={card} initialLogs={cardLogs(logs, card.id)} settings={settings} backlogCount={0} onClose={() => setCard(null)} onChanged={() => undefined} onOpenOther={() => undefined} />)}
    </div>
  );
}
