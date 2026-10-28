import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibItem, LogRow, Mark, SearchHit, SeasonEps, Title } from '../lib/types';
import type { Settings } from '../lib/theme';
import { topPosition, merged, dateParts, matchLibrary, moveBy, moveId, newHits, nextPosition, releaseText, runtimeText, sortLogs, splitBacklog } from '../lib/logic';
import { addToBacklog, deleteLog, ensureTitle, ensureTitleByImdb, loadEpisodes, loadLibrary, loadLogs, loadMarks, refreshEpisodes, removeFromLibrary, resetLogOrder, saveLibraryOrder, saveLogOrder, searchTitles, setUpNext, updateItem } from '../lib/remote';
import ShowCard from './ShowCard';
import ScopeSheet from '../components/ScopeSheet';
import { epLabel, isEnded, logSeasons, planOf, progress, scopeLabel, todayIso } from '../lib/tv';
import { applyEpisodeMarks } from '../lib/tvActions';
import MovieCard from './MovieCard';
import ScoreRing from '../components/ScoreRing';
import { useBackLayer } from '../lib/back';
import { useLongPress } from '../lib/longpress';
import { useDragReorder } from '../lib/drag';
import { GripIcon, Metascore, Poster } from '../components/Rows';
import { IconMenu, IconSearch } from '../components/Icons';
import { TIERS } from '../lib/scores';

/** A running show you've already logged, with its next seasons planned in Backlog: it lives in Watching (Caught up → In progress when they air). */
const isFollowing = (i: LibItem, logs: LogRow[]) => i.section === 'tv' && i.status === 'backlog' && !isEnded(i.title) && planOf(i) !== null && logs.some((l) => l.library.id === i.id);

interface Props { settings: Settings; onSettings: (s: Settings) => void; onMenu: () => void; kind?: 'movie' | 'tv' }
type Tab = 'watched' | 'playing' | 'backlog';

const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const EyePlus = ({ size = 15 }: { size?: number }) => (
  <span className="rew-mark" role="img" aria-label="Rewatch"><svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M12 18c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /><path d="M16 19h6" /><path d="M19 16v6" /></svg></span>
);


export default function Movies({ settings, onSettings, onMenu, kind = 'movie' }: Props) {
  const isTv = kind === 'tv';
  const section = isTv ? 'tv' : 'movies';
  const noun = isTv ? 'show' : 'movie';
  const [tab, setTab] = useState<Tab>('watched');
  const [tvEps, setTvEps] = useState<SeasonEps[]>([]);
  const [tvMarks, setTvMarks] = useState<Mark[]>([]);
  const [scopeAdd, setScopeAdd] = useState<Title | null>(null);
  const warmed = useRef(false);
  const [items, setItems] = useState<LibItem[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [cardTake, setCardTake] = useState(false);
  const [cardSeq, setCardSeq] = useState<string[]>([]);
  const [cardEnter, setCardEnter] = useState<'left' | 'right' | null>(null);
  const [menu, setMenu] = useState<null | { item: LibItem; log: LogRow | null }>(null);
  const [menuConfirm, setMenuConfirm] = useState<null | 'remove' | 'viewing'>(null);
  const currentSeq = () => {
    const ids = q.trim().length >= 2 ? matchLibrary(items, q).map((i) => i.id) : tab === 'watched' ? watched.map((l) => l.library.id) : tab === 'playing' ? watchingRows.prog.concat(watchingRows.caught).map((r) => r.it.id) : splitBacklog(items).next.concat(splitBacklog(items).rest).map((i) => i.id);
    return ids.filter((id, i) => ids.indexOf(id) === i);
  };
  const setSheet = (it: LibItem) => { setCardSeq(currentSeq()); setCardEnter(null); setCardId(it.id); };
  const view = settings.view;

  const refresh = useCallback(async () => {
    try { const [a, b] = await Promise.all([loadLibrary(section), loadLogs(section)]);
      setItems(a.map((i) => ({ ...i, title: merged(i.title, i.overrides) })));
      if (isTv) {
        const followed = a.filter((i) => isFollowing(i, b));
        const playing = a.filter((i) => i.status === 'playing').concat(followed);
        const [e, m] = await Promise.all([loadEpisodes(playing.map((i) => i.title_id)), loadMarks(playing.map((i) => i.id))]);
        setTvEps(e); setTvMarks(m);
        if (!warmed.current) {
          warmed.current = true;
          const running = playing.filter((i) => !isEnded(i.title)).map((i) => i.title.source_id);
          if (running.length) refreshEpisodes(running).then(async () => { setTvEps(await loadEpisodes(playing.map((i) => i.title_id))); });
        }
      }
      setLogs(b.map((l) => ({ ...l, library: { ...l.library, title: merged(l.library.title, l.library.overrides) } }))); setError(''); }
    catch (e) { setError('Couldn’t load your lists. Check your connection and pull to refresh.'); }
    setLoading(false);
  }, [section]);
  useEffect(() => { refresh(); }, [refresh]);

  // live search with debounce
  const seq = useRef(0);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); setSearching(false); return; }
    const my = ++seq.current; setSearching(true);
    const t = setTimeout(async () => {
      try { const r = await searchTitles(s, kind); if (my === seq.current) setHits(r); }
      catch { if (my === seq.current) setHits([]); }
      if (my === seq.current) setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const followIds = useMemo(() => new Set(isTv ? items.filter((i) => isFollowing(i, logs)).map((i) => i.id) : []), [items, logs, isTv]);
  const { next, rest } = useMemo(() => splitBacklog(items.filter((i) => !followIds.has(i.id))), [items, followIds]);
  const watched = useMemo(() => sortLogs(logs), [logs]);
  const libMatches = useMemo(() => matchLibrary(items, q), [items, q]);
  const fresh = useMemo(() => newHits(hits, items), [hits, items]);
  const customOrder = logs.some((l) => l.position !== null);
  const today = todayIso();
  const watchingRows = useMemo(() => {
    const rows = items.filter((i) => i.status === 'playing' || followIds.has(i.id)).map((it) => ({ it, p: progress(it, it.title, tvEps.filter((e) => e.title_id === it.title_id), tvMarks.filter((m) => m.library_id === it.id), today) }));
    const waiting = (r: (typeof rows)[number]) => followIds.has(r.it.id) ? !r.p.nextEp : (!r.p.nextEp && r.p.caughtUp);
    return { prog: rows.filter((r) => !waiting(r)), caught: rows.filter(waiting) };
  }, [items, tvEps, tvMarks, today, followIds]);
  const playingCount = items.filter((i) => i.status === 'playing').length + followIds.size;

  const imdbInQuery = (q.match(/tt\d{6,10}/) ?? [null])[0];
  const addByImdb = async () => {
    if (!imdbInQuery) return;
    setAdding(imdbInQuery);
    try { const t = await ensureTitleByImdb(imdbInQuery, false, kind); if (items.some((i) => i.title_id === t.id)) { setQ(''); } else if (isTv) setScopeAdd(t); else { await addToBacklog(t.id, 'movies', topPosition(items)); setQ(''); await refresh(); } }
    catch { setError('Nothing found for ' + imdbInQuery + '.'); }
    setAdding(null);
  };
  const add = async (h: SearchHit) => {
    setAdding(h.sourceId);
    try { const t = await ensureTitle(kind, h.sourceId); if (isTv) setScopeAdd(t); else { await addToBacklog(t.id, 'movies', topPosition(items)); await refresh(); } }
    catch { setError('Couldn’t add “' + h.title + '”. Try again in a moment.'); }
    setAdding(null);
  };

  const reorderBacklog = async (group: LibItem[], ids: string[]) => {
    const others = group === next ? rest : next;
    const all = group === next ? ids.concat(others.map((i) => i.id)) : next.map((i) => i.id).concat(ids);
    setItems((prev) => prev.map((i) => ({ ...i, position: all.indexOf(i.id) >= 0 ? all.indexOf(i.id) + 1 : i.position })));
    await saveLibraryOrder(all);
  };
  const reorderWatched = async (ids: string[]) => {
    setLogs((prev) => prev.map((l) => ({ ...l, position: ids.indexOf(l.id) + 1 })));
    await saveLogOrder(ids);
  };

  const { drag, handle, look } = useDragReorder((list, id, overId) => {
    if (list === 'w') reorderWatched(moveId(watched.map((l) => l.id), id, overId));
    else { const g = list === 'n' ? next : rest; reorderBacklog(g, moveId(g.map((i) => i.id), id, overId)); }
  });
  const keyMove = (list: string, id: string) => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0; if (!d) return; e.preventDefault();
    if (list === 'w') reorderWatched(moveBy(watched.map((l) => l.id), id, d));
    else { const g = list === 'n' ? next : rest; reorderBacklog(g, moveBy(g.map((i) => i.id), id, d)); }
  };
  const rowState = (list: string, id: string) => {
    const lk = look(list, id);
    return {
      'data-rowid': id, 'data-list': list, style: lk.style,
      className: 'row-card' + (list === 'n' ? ' next' : '') + (lk.dragging ? ' dragging' : '') + (lk.target ? ' drop' : '') + (drag ? ' sorting' : '')
    };
  };
  const grip = (list: string, id: string, name: string) => edit ? (
    <button className="grip" aria-label={'Drag to reorder ' + name + '. Arrow keys also move it.'} {...handle(list, id)} onKeyDown={keyMove(list, id)}><GripIcon /></button>
  ) : null;

  const backlogRow = (it: LibItem, list: string) => (
    <div key={it.id} {...rowState(list, it.id)}>
      <button className="row-main" {...longPress(it.id)} onClick={() => !edit && setSheet(it)}>
        <Poster t={it.title} w={56} h={84}></Poster>
        <span className="row-text">
          <span className="row-title">{it.title.title}</span>
          <span className="row-meta">{isTv ? scopeLabel(planOf(it), it.title) : [releaseText(it.title.release_date, it.title.year), runtimeText(it.title.runtime)].filter(Boolean).join(' · ')}{it.rewatch && <EyePlus />}</span>
          <span className="row-meta"><Metascore v={it.title.metascore} size="sm" /></span>
        </span>
      </button>
      {grip(list, it.id, it.title.title)}
    </div>
  );

  const watchRow = (it: LibItem, p: ReturnType<typeof progress>, caught: boolean) => {
    const isNew = !!(p.nextEp && p.nextEp.air_date && (p.seen > 0 || followIds.has(it.id)) && (Date.now() - new Date(p.nextEp.air_date).getTime()) < 21 * 864e5);
    const firstPlanned = (planOf(it) ?? [])[0];
    const seasonAir = ((it.title.data as { seasons?: { n: number; air_date: string | null }[] })?.seasons ?? []).find((x) => x.n === firstPlanned)?.air_date ?? null;
    const nextDate = p.nextFuture?.air_date ?? (seasonAir && seasonAir > today ? seasonAir : null);
    const d = caught ? (nextDate ? dateParts(nextDate) : null) : followIds.has(it.id) ? (p.nextEp?.air_date ? dateParts(p.nextEp.air_date) : null) : (it.started_on ? dateParts(it.started_on) : null);
    return (
      <div key={it.id} className="row-card" data-rowid={it.id} data-list="p">
        <button className="row-main" {...longPress(it.id)} onClick={() => setSheet(it)}>
          <Poster t={it.title} w={56} h={84} />
          <span className="row-text">
            <span className="row-title">{it.title.title}{isNew && <> <span className="new-pill">NEW</span></>}</span>
            <span className="row-meta">{p.nextEp ? 'Next: ' + epLabel(p.nextEp) : followIds.has(it.id) ? 'Waiting for ' + scopeLabel(planOf(it), it.title).split(' · ')[0] : 'Caught up'}{it.rewatch && <EyePlus />}</span>
            <span className="row-meta"><span className="mini-bar w72"><span style={{ width: p.pct + '%' }} /></span><strong className="tiny">{p.pct}%</strong></span>
          </span>
        </button>
        <span className="date-col"><span className="date-cap">{caught ? 'Next episode' : followIds.has(it.id) ? 'Aired on' : 'Started on'}</span>{d ? <><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}</span></> : <span className="date-big">TBA</span>}</span>
      </div>
    );
  };
  const watchTile = (it: LibItem, p: ReturnType<typeof progress>) => (
    <div key={it.id} className="row-card tile" data-rowid={it.id} data-list="p">
      <button className="tile-main" {...longPress(it.id)} onClick={() => setSheet(it)} aria-label={it.title.title}>
        <Poster t={it.title}>{p.nextEp && <span className="tile-next">{epLabel(p.nextEp).replace(' · ', '')}</span>}</Poster>
        <span className="tile-prog"><span className="mini-bar"><span style={{ width: p.pct + '%' }} /></span><strong className="tiny">{p.pct}%</strong></span>
      </button>
    </div>
  );
  const quickMark = async (it: LibItem) => {
    const mine = tvMarks.filter((m) => m.library_id === it.id), eps = tvEps.filter((e) => e.title_id === it.title_id);
    const p = progress(it, it.title, eps, mine); if (!p.nextEp) return;
    const itemLogs = logs.filter((l) => l.library.id === it.id).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch }));
    try {
      const r = await applyEpisodeMarks(it, it.title, eps, mine, itemLogs, [{ season: p.nextEp.season, episode: p.nextEp.episode }], true);
      setTvMarks((all) => all.filter((m) => m.library_id !== it.id).concat(r.marks.filter((m) => m.library_id === it.id)));
      await refresh();
      if (r.finished) { setCardSeq([it.id]); setCardTake(true); setCardEnter(null); setCardId(it.id); }
    } catch { setError('Couldn’t mark the episode. Try again.'); }
  };

  const watchedRow = (l: LogRow) => {
    const t = l.library.title, tr = tierOf(l.tier), d = dateParts(l.watched_at);
    return (
      <div key={l.id} {...rowState('w', l.id)}>
        <button className="row-main" {...longPress(l.id)} onClick={() => !edit && setSheet(l.library)}>
          <Poster t={t} w={56} h={84}>{settings.posterScore && <span className="poster-ring"><ScoreRing value={l.score} scale={settings.scale} size={24} fontSize={9} /></span>}</Poster>
          <span className="row-text">
            <span className="row-title">{t.title}</span>
            <span className="row-meta">{isTv ? scopeLabel(logSeasons(l), t) : [releaseText(t.release_date, t.year), runtimeText(t.runtime)].filter(Boolean).join(' · ')}{settings.listMetascore && <Metascore v={t.metascore} size="sm" />}</span>
            {tr ? <span className="pill" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span> : isTv && <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Not rated</span>}
          </span>
        </button>
        {edit ? grip('w', l.id, t.title) : (
          <span className="date-col"><span className="date-cap">{isTv ? 'Finished on' : 'Watched on'}</span><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}{l.rewatch && <EyePlus size={13} />}</span></span>
        )}
      </div>
    );
  };

  const tile = (it: LibItem, list: string, onOpen: () => void, key: string, score?: number | null, tier?: string | null, at?: string, rew?: boolean) => {
    const tr = list === 'w' ? tierOf(tier ?? null) : null, d = at ? dateParts(at) : null;
    return (
    <div key={key} {...rowState(list, key)} className={rowState(list, key).className + ' tile'}>
      <button className="tile-main" {...longPress(list === 'w' ? key : it.id)} onClick={() => !edit && onOpen()} aria-label={it.title.title}>
        <Poster t={it.title}>{(settings.listMetascore || list !== 'w') && <span className="tile-mc"><Metascore v={it.title.metascore} size="sm" /></span>}{list === 'w' && settings.posterScore && <span className="poster-ring"><ScoreRing value={score ?? null} scale={settings.scale} size={34} fontSize={12} /></span>}</Poster>
        {tr && <span className="tile-tier" style={{ background: tr.color }}>{tr.label}</span>}
        {d && <span className="tile-date"><span className="tile-date-text">{d.day} {d.mon} <span>{d.year}</span></span>{rew && <EyePlus size={14} />}</span>}
      </button>
      {edit && <button className="grip wide" aria-label={'Drag to reorder ' + it.title.title} {...handle(list, key)} onKeyDown={keyMove(list, key)}><GripIcon /></button>}
    </div>
  ); };

  const searchingMode = q.trim().length >= 2;
  const TABS: Tab[] = isTv ? ['watched', 'playing', 'backlog'] : ['watched', 'backlog'];
  const tabIndex = TABS.indexOf(tab);
  // Swipe between tabs. While the finger moves we write transforms straight to the DOM (no React re-render) so it stays smooth.
  const [anim, setAnim] = useState<'' | 'enter-right' | 'enter-left'>('');
  const lastSwipe = useRef(0);
  const paneRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const segW = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const sw = useRef<{ x: number; y: number; mode: '' | 'h' | 'v'; dx: number; vx: number; lx: number; lt: number } | null>(null);
  const pillAt = (pos: number) => `translateX(calc(${pos} * 100%))`;
  const paint = (dx: number) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const pane = paneRef.current, pill = pillRef.current, w = segW.current?.clientWidth || 360;
      if (pane) { pane.style.transition = 'none'; pane.style.transform = `translate3d(${dx}px,0,0)`; pane.style.opacity = String(1 - Math.min(Math.abs(dx) / 700, 0.3)); }
      if (pill) { pill.style.transition = 'none'; pill.style.transform = pillAt(tabIndex + Math.max(-1, Math.min(1, -dx / w))); }
    });
  };
  const release = (toIndex: number) => {
    cancelAnimationFrame(raf.current);
    const pane = paneRef.current, pill = pillRef.current;
    if (pill) { pill.style.transition = ''; pill.style.transform = pillAt(toIndex); }
    if (pane) {
      pane.style.transition = toIndex === tabIndex ? 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease' : 'none';
      pane.style.transform = ''; pane.style.opacity = '';
    }
  };
  const goTab = (i: number, dir: 'from-right' | 'from-left') => {
    release(i);
    setTab(TABS[i]);
    setAnim(dir === 'from-right' ? 'enter-right' : 'enter-left');
    window.setTimeout(() => setAnim(''), 220);
  };
  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (edit || searchingMode || drag || e.button > 0) return;
      sw.current = { x: e.clientX, y: e.clientY, mode: '', dx: 0, vx: 0, lx: e.clientX, lt: e.timeStamp };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = sw.current; if (!st || drag) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.mode) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { st.mode = 'h'; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } }
        else if (Math.abs(dy) > 14) { st.mode = 'v'; }
      }
      if (st.mode === 'h') {
        const dt = e.timeStamp - st.lt; if (dt > 0) st.vx = 0.7 * st.vx + 0.3 * ((e.clientX - st.lx) / dt);
        st.lx = e.clientX; st.lt = e.timeStamp;
        const atEdge = (dx > 0 && tabIndex === 0) || (dx < 0 && tabIndex === TABS.length - 1);
        st.dx = atEdge ? dx * 0.25 : dx;
        paint(st.dx);
      }
    },
    onPointerUp: () => {
      const st = sw.current; sw.current = null;
      if (!st || st.mode !== 'h') return;
      lastSwipe.current = Date.now();
      const dx = st.dx, flick = Math.abs(st.vx) > 0.4 && Math.abs(dx) > 25;
      if ((dx < -60 || (flick && st.vx < 0)) && tabIndex < TABS.length - 1) goTab(tabIndex + 1, 'from-right');
      else if ((dx > 60 || (flick && st.vx > 0)) && tabIndex > 0) goTab(tabIndex - 1, 'from-left');
      else release(tabIndex);
    },
    onPointerCancel: () => { if (sw.current?.mode === 'h') release(tabIndex); sw.current = null; },
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - lastSwipe.current < 350) { e.preventDefault(); e.stopPropagation(); } }
  };
  const longPress = useLongPress((key) => {
    if (edit) return;
    const lg = logs.find((l) => l.id === key);
    const it = lg ? lg.library : items.find((i) => i.id === key);
    if (it) { setMenuConfirm(null); setMenu({ item: it, log: lg ?? null }); }
  });
  useBackLayer(!!menu, () => setMenu(null));
  useBackLayer(!!cardId, () => { setCardId(null); setCardTake(false); });
  useBackLayer(q.length > 0, () => setQ(''));
  useBackLayer(edit, () => setEdit(false));

  return (
    <div className="app">
      <header className="top">
        <div className="title-row">
          <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>
          <div className="title-block">
            <h1 className="section-title">{isTv ? 'TV Shows' : 'Movies'}</h1>
            <span className="muted small">{isTv ? `${watched.length} logged · ${playingCount} watching · ${next.length + rest.length} in backlog` : `${watched.length} watched · ${next.length + rest.length} in backlog`}</span>
          </div>
          <button className="icon-btn boxed" aria-label={view === 'list' ? 'Show as grid' : 'Show as list'} onClick={() => onSettings({ ...settings, view: view === 'list' ? 'grid' : 'list' })}>
            {view === 'list'
              ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></svg>
              : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>}
          </button>
          <button className={'icon-btn boxed' + (edit ? ' active' : '')} aria-label="Reorder" aria-pressed={edit} onClick={() => setEdit(!edit)}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4v16M8 4L4 8M8 4l4 4M16 20V4M16 20l-4-4M16 20l4-4" /></svg>
          </button>
        </div>
        <div className={'search' + (searchingMode ? ' active' : '')}>
          <IconSearch />
          <label htmlFor="q" className="sr">{`Search your lists or add a ${noun}`}</label>
          <input id="q" type="text" enterKeyHint="search" placeholder={`Search your lists or add a ${noun}`} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          {q && <button className="clear" aria-label="Clear search" onClick={() => setQ('')}>×</button>}
        </div>
        {!searchingMode && (
          <div className="segmented sliding" role="tablist" ref={segW}>
            <span className="seg-pill" ref={pillRef} aria-hidden="true" style={{ width: `calc((100% - 8px) / ${TABS.length})`, transform: pillAt(tabIndex) }} />
            {TABS.map((tb, i) => (
              <button key={tb} role="tab" aria-selected={tab === tb} onClick={() => tab !== tb && goTab(i, i > tabIndex ? 'from-right' : 'from-left')}>
                {tb === 'watched' ? 'Watched' : tb === 'playing' ? 'Watching' : 'Backlog'} <span className="muted">{tb === 'watched' ? watched.length : tb === 'playing' ? playingCount : next.length + rest.length}</span>
              </button>
            ))}
          </div>
        )}
        {edit && !searchingMode && (
          <div className="edit-bar"><span className="muted small">Drag the handles to reorder</span><button className="btn primary sm" onClick={() => setEdit(false)}>Done</button></div>
        )}
      </header>

      <main className="content swipe-area" {...swipeHandlers}>
        <div ref={paneRef} className={'swipe-pane' + (anim ? ' ' + anim : '')}>
        {error && <p className="error" role="alert">{error}</p>}
        {loading ? <p className="muted">Loading…</p> : searchingMode ? (
          <div className="stack">
            <div className="sec-head"><span className="h2">In your lists</span><span className="muted small">{libMatches.length || ''}</span></div>
            {libMatches.length === 0 && <p className="muted small">Not in your lists yet.</p>}
            {(() => {
              const latestFor = (id: string) => logs.filter((l) => l.library.id === id).sort((a, b) => b.watched_at.localeCompare(a.watched_at))[0];
              const rows = libMatches.map((it) => ({ it, lg: it.status !== 'backlog' ? latestFor(it.id) : undefined }));
              return view === 'list'
                ? rows.map(({ it, lg }) => (lg ? watchedRow(lg) : backlogRow(it, 's')))
                : <div className="grid">{rows.map(({ it, lg }) => (lg ? tile(lg.library, 'w', () => setSheet(lg.library), lg.id, lg.score, lg.tier, lg.watched_at, lg.rewatch) : tile(it, it.up_next ? 'n' : 'r', () => setSheet(it), it.id)))}</div>;
            })()}
            <div className="sec-head mt"><span className="h2">{`Add a new ${noun}`}</span><span className="muted small">{searching ? 'Searching…' : fresh.length || ''}</span></div>
            {imdbInQuery && (
              <div className="hit">
                <span className="row-text"><span className="row-title">Add by IMDb ID</span><span className="row-meta">{imdbInQuery} · {`for ${noun}s search can’t find`}</span></span>
                <button className="add-btn" aria-label={'Add ' + imdbInQuery} disabled={adding === imdbInQuery} onClick={addByImdb}>{adding === imdbInQuery ? '…' : '+'}</button>
              </div>
            )}
            {!searching && !imdbInQuery && fresh.length === 0 && <p className="muted small">Nothing new found for “{q.trim()}”. Can’t find it? Paste its IMDb link here.</p>}
            {fresh.map((h) => (
              <div className="hit" key={h.sourceId}>
                <Poster t={{ poster_url: h.posterUrl, title: h.title }} w={46} h={68} />
                <span className="row-text"><span className="row-title">{h.title}</span><span className="row-meta">{releaseText(h.releaseDate, h.year)}</span></span>
                <button className="add-btn" aria-label={'Add ' + h.title + ' to backlog'} disabled={adding === h.sourceId} onClick={() => add(h)}>{adding === h.sourceId ? '…' : '+'}</button>
              </div>
            ))}
          </div>
        ) : tab === 'playing' ? (
          <div className="stack">
            <span className="h2">In progress</span>
            {watchingRows.prog.length === 0 && <div className="empty small-pad">Mark an episode in a show from your Backlog — it moves here.</div>}
            {view === 'list' ? watchingRows.prog.map(({ it, p }) => watchRow(it, p, false)) : <div className="grid">{watchingRows.prog.map(({ it, p }) => watchTile(it, p))}</div>}
            <span className="h2 mt-block">Caught up</span>
            <span className="muted small">Still airing — they jump back to In progress when a new episode is out.</span>
            {watchingRows.caught.length === 0 && <div className="empty small-pad">Nothing here yet.</div>}
            {view === 'list' ? watchingRows.caught.map(({ it, p }) => watchRow(it, p, true)) : <div className="grid">{watchingRows.caught.map(({ it, p }) => watchTile(it, p))}</div>}
          </div>
        ) : tab === 'watched' ? (
          <div className="stack">
            {customOrder && <div className="sec-head"><span className="muted small">Custom order</span><button className="link" onClick={async () => { await resetLogOrder(logs.map((l) => l.id)); refresh(); }}>Sort by date</button></div>}
            {watched.length === 0 && <div className="empty"><p><strong>Nothing watched yet.</strong></p><p className="muted">{isTv ? 'Finished seasons and series land here as journal entries.' : 'Movies you rate land here.'}</p></div>}
            {view === 'list' ? watched.map((l) => watchedRow(l)) : <div className="grid">{watched.map((l) => tile(l.library, 'w', () => setSheet(l.library), l.id, l.score, l.tier, l.watched_at, l.rewatch))}</div>}
          </div>
        ) : (
          <div className="stack">
            <div className="sec-head"><span className="h2">Up next</span><span className="muted small">{next.length || ''}</span></div>
            {next.length === 0 && <div className="empty small-pad">Open something in your Backlog and turn on “Up next” — it’ll show up here.</div>}
            {view === 'list' ? next.map((it) => backlogRow(it, 'n')) : <div className="grid">{next.map((it) => tile(it, 'n', () => setSheet(it), it.id))}</div>}
            <div className="sec-head mt"><span className="h2">Deep backlog</span><span className="muted small">{rest.length}</span></div>
            {rest.length === 0 && <div className="empty small-pad">{`Search above to add ${noun}s.`}</div>}
            {view === 'list' ? rest.map((it) => backlogRow(it, 'r')) : <div className="grid">{rest.map((it) => tile(it, 'r', () => setSheet(it), it.id))}</div>}
          </div>
        )}
        </div>
      </main>

      {menu && (() => {
        const { item, log } = menu; const t = item.title; const isBack = item.status === 'backlog';
        const close = () => setMenu(null);
        const run = (fn: () => Promise<void>) => async () => { try { await fn(); } catch { setError('Something went wrong. Try again.'); } close(); refresh(); };
        const itemLogs = logs.filter((l) => l.library.id === item.id);
        return (
          <div className="sheet-wrap">
            <button className="sheet-scrim" aria-label="Close menu" onClick={close} />
            <div className="sheet action-sheet" role="menu" aria-label={t.title}>
              <div className="action-head">
                <Poster t={t} w={40} h={60} />
                <span className="stack-sm"><strong>{t.title}</strong><span className="muted small">{log ? 'Watched ' + releaseText(log.watched_at.slice(0, 10), null) : isBack ? (item.up_next ? 'Up next' : 'Backlog') : ''}</span></span>
              </div>
              {menuConfirm ? (
                <div className="stack">
                  <span className="small">{menuConfirm === 'remove' ? 'Remove “' + t.title + '” and all its viewings?' : 'Delete this viewing?'}</span>
                  <div className="row nowrap"><button className="btn grow" onClick={() => setMenuConfirm(null)}>Cancel</button>
                    <button className="btn danger-fill grow" onClick={menuConfirm === 'remove'
                      ? run(async () => { await removeFromLibrary(item.id); })
                      : run(async () => { await deleteLog(log!.id); if (itemLogs.length <= 1) await updateItem(item.id, { status: 'backlog' }); })}>Delete</button></div>
                </div>
              ) : (
                <div className="action-list">
                  <button role="menuitem" onClick={() => { close(); setCardTake(false); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>Open</button>
                  {isBack && !isTv && <button role="menuitem" onClick={() => { close(); setCardTake(true); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>Mark as watched…</button>}
                  {isBack && <button role="menuitem" onClick={run(async () => { await setUpNext(item.id, !item.up_next, topPosition(items)); })}>{item.up_next ? 'Remove from Up next' : 'Add to Up next'}</button>}
                  {!isBack && item.status !== 'playing' && <button role="menuitem" onClick={() => { close(); setCardTake(true); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>Change rating…</button>}
                  {!isBack && !isTv && <button role="menuitem" onClick={run(async () => { await updateItem(item.id, { status: 'backlog', rewatch: true, score: null, position: topPosition(items) }); })}>Log a rewatch → Backlog</button>}
                  {item.status !== 'playing' && <button role="menuitem" onClick={() => { close(); setEdit(true); }}>Reorder</button>}
                  {log && <button role="menuitem" className="danger" onClick={() => setMenuConfirm('viewing')}>Delete this viewing</button>}
                  <button role="menuitem" className="danger" onClick={() => setMenuConfirm('remove')}>Remove from my lists</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {scopeAdd && <ScopeSheet t={scopeAdd} title="What will you watch?" confirm="Add to Backlog" onCancel={() => setScopeAdd(null)}
        onDone={async (list) => { const t = scopeAdd; setScopeAdd(null); try { await addToBacklog(t.id, 'tv', topPosition(items), { plan_seasons: list, plan_from: list ? list[0] : null, plan_to: list ? list[list.length - 1] : null, run_started_at: new Date().toISOString() }); refreshEpisodes([t.source_id]); await refresh(); } catch { setError('Couldn’t add “' + t.title + '”.'); } }} />}
      {cardId && isTv && <ShowCard key={cardId} itemId={cardId} openTake={cardTake} enterFrom={cardEnter} settings={settings} topPos={topPosition(items)}
        initial={items.find((i) => i.id === cardId) ?? logs.find((l) => l.library.id === cardId)?.library ?? null}
        initialLogs={logs.filter((l) => l.library.id === cardId).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch, scope: l.scope, season_from: l.season_from, season_to: l.season_to })).sort((a, b) => b.watched_at.localeCompare(a.watched_at))}
        onPrev={cardSeq.indexOf(cardId) > 0 ? () => { setCardEnter('left'); setCardTake(false); setCardId(cardSeq[cardSeq.indexOf(cardId) - 1]); } : null}
        onNext={cardSeq.indexOf(cardId) >= 0 && cardSeq.indexOf(cardId) < cardSeq.length - 1 ? () => { setCardEnter('right'); setCardTake(false); setCardId(cardSeq[cardSeq.indexOf(cardId) + 1]); } : null}
        onClose={() => { setCardId(null); setCardTake(false); }} onChanged={refresh} />}
      {cardId && !isTv && <MovieCard key={cardId} itemId={cardId} openTake={cardTake} enterFrom={cardEnter}
        onPrev={cardSeq.indexOf(cardId) > 0 ? () => { setCardEnter('left'); setCardTake(false); setCardId(cardSeq[cardSeq.indexOf(cardId) - 1]); } : null}
        onNext={cardSeq.indexOf(cardId) >= 0 && cardSeq.indexOf(cardId) < cardSeq.length - 1 ? () => { setCardEnter('right'); setCardTake(false); setCardId(cardSeq[cardSeq.indexOf(cardId) + 1]); } : null} initial={items.find((i) => i.id === cardId) ?? logs.find((l) => l.library.id === cardId)?.library ?? null}
        initialLogs={logs.filter((l) => l.library.id === cardId).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch })).sort((a, b) => b.watched_at.localeCompare(a.watched_at))}
        initialOwned={Object.fromEntries(items.map((i) => [i.title.source_id, { id: i.id, status: i.status, up_next: i.up_next }]))} settings={settings} backlogCount={topPosition(items)} onClose={() => { setCardId(null); setCardTake(false); }} onChanged={refresh} onOpenOther={(id) => setCardId(id)} />}
    </div>
  );
}
