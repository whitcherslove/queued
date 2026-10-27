import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibItem, LogRow, SearchHit } from '../lib/types';
import type { Settings } from '../lib/theme';
import { merged, dateParts, matchLibrary, moveBy, moveId, newHits, nextPosition, releaseText, runtimeText, sortLogs, splitBacklog } from '../lib/logic';
import { addToBacklog, ensureTitle, loadLibrary, loadLogs, resetLogOrder, saveLibraryOrder, saveLogOrder, searchTitles } from '../lib/remote';
import MovieCard from './MovieCard';
import ScoreRing from '../components/ScoreRing';
import { useBackLayer } from '../lib/back';
import { useDragReorder } from '../lib/drag';
import { BookmarkBadge, GripIcon, Metascore, Poster } from '../components/Rows';
import { IconMenu, IconSearch } from '../components/Icons';
import { TIERS } from '../lib/scores';

interface Props { settings: Settings; onSettings: (s: Settings) => void; onMenu: () => void }

const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const EyePlus = ({ size = 15 }: { size?: number }) => (
  <span className="rew-mark" role="img" aria-label="Rewatch"><svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M12 18c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /><path d="M16 19h6" /><path d="M19 16v6" /></svg></span>
);


export default function Movies({ settings, onSettings, onMenu }: Props) {
  const [tab, setTab] = useState<'watched' | 'backlog'>('watched');
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
  const setSheet = (it: LibItem) => setCardId(it.id);
  const view = settings.view;

  const refresh = useCallback(async () => {
    try { const [a, b] = await Promise.all([loadLibrary('movies'), loadLogs('movies')]);
      setItems(a.map((i) => ({ ...i, title: merged(i.title, i.overrides) })));
      setLogs(b.map((l) => ({ ...l, library: { ...l.library, title: merged(l.library.title, l.library.overrides) } }))); setError(''); }
    catch (e) { setError('Couldn’t load your lists. Check your connection and pull to refresh.'); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // live search with debounce
  const seq = useRef(0);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); setSearching(false); return; }
    const my = ++seq.current; setSearching(true);
    const t = setTimeout(async () => {
      try { const r = await searchTitles(s, 'movie'); if (my === seq.current) setHits(r); }
      catch { if (my === seq.current) setHits([]); }
      if (my === seq.current) setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const { next, rest } = useMemo(() => splitBacklog(items), [items]);
  const watched = useMemo(() => sortLogs(logs), [logs]);
  const libMatches = useMemo(() => matchLibrary(items, q), [items, q]);
  const fresh = useMemo(() => newHits(hits, items), [hits, items]);
  const customOrder = logs.some((l) => l.position !== null);

  const add = async (h: SearchHit) => {
    setAdding(h.sourceId);
    try { const t = await ensureTitle('movie', h.sourceId); await addToBacklog(t.id, 'movies', nextPosition(items)); await refresh(); }
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

  const { drag, handle } = useDragReorder((list, id, overId) => {
    if (list === 'w') reorderWatched(moveId(watched.map((l) => l.id), id, overId));
    else { const g = list === 'n' ? next : rest; reorderBacklog(g, moveId(g.map((i) => i.id), id, overId)); }
  });
  const keyMove = (list: string, id: string) => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0; if (!d) return; e.preventDefault();
    if (list === 'w') reorderWatched(moveBy(watched.map((l) => l.id), id, d));
    else { const g = list === 'n' ? next : rest; reorderBacklog(g, moveBy(g.map((i) => i.id), id, d)); }
  };
  const rowState = (list: string, id: string) => ({
    'data-rowid': id, 'data-list': list,
    className: 'row-card' + (list === 'n' ? ' next' : '') + (drag?.id === id ? ' dragging' : '') + (drag && drag.over === id && drag.id !== id && drag.list === list ? ' drop' : '')
  });
  const grip = (list: string, id: string, name: string) => edit ? (
    <button className="grip" aria-label={'Drag to reorder ' + name + '. Arrow keys also move it.'} {...handle(list, id)} onKeyDown={keyMove(list, id)}><GripIcon /></button>
  ) : null;

  const backlogRow = (it: LibItem, list: string) => (
    <div key={it.id} {...rowState(list, it.id)}>
      <button className="row-main" onClick={() => !edit && setSheet(it)}>
        <Poster t={it.title} w={56} h={84}>{list === 'n' && <BookmarkBadge />}</Poster>
        <span className="row-text">
          <span className="row-title">{it.title.title}</span>
          <span className="row-meta">{[releaseText(it.title.release_date, it.title.year), runtimeText(it.title.runtime)].filter(Boolean).join(' · ')}<Metascore v={it.title.metascore} size="sm" /></span>
        </span>
      </button>
      {grip(list, it.id, it.title.title)}
    </div>
  );

  const watchedRow = (l: LogRow) => {
    const t = l.library.title, tr = tierOf(l.tier), d = dateParts(l.watched_at);
    return (
      <div key={l.id} {...rowState('w', l.id)}>
        <button className="row-main" onClick={() => !edit && setSheet(l.library)}>
          <Poster t={t} w={56} h={84}><span className="poster-ring"><ScoreRing value={l.score} scale={settings.scale} size={24} fontSize={9} /></span></Poster>
          <span className="row-text">
            <span className="row-title">{t.title}</span>
            <span className="row-meta">{[releaseText(t.release_date, t.year), runtimeText(t.runtime)].filter(Boolean).join(' · ')}<Metascore v={t.metascore} size="sm" />{l.rewatch && <EyePlus />}</span>
            {tr && <span className="pill" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span>}
          </span>
        </button>
        {edit ? grip('w', l.id, t.title) : (
          <span className="date-col"><span className="date-cap">Watched on</span><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}</span></span>
        )}
      </div>
    );
  };

  const tile = (it: LibItem, list: string, onOpen: () => void, key: string, score?: number | null, tier?: string | null, at?: string, rew?: boolean) => {
    const tr = list === 'w' ? tierOf(tier ?? null) : null, d = at ? dateParts(at) : null;
    return (
    <div key={key} {...rowState(list, key)} className={rowState(list, key).className + ' tile'}>
      <button className="tile-main" onClick={() => !edit && onOpen()} aria-label={it.title.title}>
        <Poster t={it.title}>{list === 'n' && <BookmarkBadge />}<span className="tile-mc"><Metascore v={it.title.metascore} size="sm" /></span>{list === 'w' && <span className="poster-ring"><ScoreRing value={score ?? null} scale={settings.scale} size={34} fontSize={12} /></span>}</Poster>
        {tr && <span className="tile-tier" style={{ background: tr.color }}>{tr.label}</span>}
        {d && <span className="tile-date"><span className="tile-date-text">{d.day} {d.mon} <span>{d.year}</span></span>{rew && <EyePlus size={14} />}</span>}
      </button>
      {edit && <button className="grip wide" aria-label={'Drag to reorder ' + it.title.title} {...handle(list, key)} onKeyDown={keyMove(list, key)}><GripIcon /></button>}
    </div>
  ); };

  const searchingMode = q.trim().length >= 2;
  useBackLayer(q.length > 0, () => setQ(''));
  useBackLayer(edit, () => setEdit(false));

  return (
    <div className="app">
      <header className="top">
        <div className="title-row">
          <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>
          <div className="title-block">
            <h1 className="section-title">Movies</h1>
            <span className="muted small">{watched.length} watched · {next.length + rest.length} in backlog</span>
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
          <label htmlFor="q" className="sr">Search your lists or add a movie</label>
          <input id="q" type="text" enterKeyHint="search" placeholder="Search your lists or add a movie" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          {q && <button className="clear" aria-label="Clear search" onClick={() => setQ('')}>×</button>}
        </div>
        {!searchingMode && (
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'watched'} className={tab === 'watched' ? 'on' : ''} onClick={() => setTab('watched')}>Watched <span className="muted">{watched.length}</span></button>
            <button role="tab" aria-selected={tab === 'backlog'} className={tab === 'backlog' ? 'on' : ''} onClick={() => setTab('backlog')}>Backlog <span className="muted">{next.length + rest.length}</span></button>
          </div>
        )}
        {edit && !searchingMode && (
          <div className="edit-bar"><span className="muted small">Drag the handles to reorder</span><button className="btn primary sm" onClick={() => setEdit(false)}>Done</button></div>
        )}
      </header>

      <main className="content">
        {error && <p className="error" role="alert">{error}</p>}
        {loading ? <p className="muted">Loading…</p> : searchingMode ? (
          <div className="stack">
            <div className="sec-head"><span className="h2">In your lists</span><span className="muted small">{libMatches.length || ''}</span></div>
            {libMatches.length === 0 && <p className="muted small">Not in your lists yet.</p>}
            {libMatches.map((it) => backlogRow(it, 's'))}
            <div className="sec-head mt"><span className="h2">Add from TMDB</span><span className="muted small">{searching ? 'Searching…' : fresh.length || ''}</span></div>
            {!searching && fresh.length === 0 && <p className="muted small">Nothing new found for “{q.trim()}”.</p>}
            {fresh.map((h) => (
              <div className="hit" key={h.sourceId}>
                <Poster t={{ poster_url: h.posterUrl, title: h.title }} w={46} h={68} />
                <span className="row-text"><span className="row-title">{h.title}</span><span className="row-meta">{releaseText(h.releaseDate, h.year)}</span></span>
                <button className="add-btn" aria-label={'Add ' + h.title + ' to backlog'} disabled={adding === h.sourceId} onClick={() => add(h)}>{adding === h.sourceId ? '…' : '+'}</button>
              </div>
            ))}
          </div>
        ) : tab === 'watched' ? (
          <div className="stack">
            {customOrder && <div className="sec-head"><span className="muted small">Custom order</span><button className="link" onClick={async () => { await resetLogOrder(logs.map((l) => l.id)); refresh(); }}>Sort by date</button></div>}
            {watched.length === 0 && <div className="empty"><p><strong>Nothing watched yet.</strong></p><p className="muted">Movies you rate land here. Rating arrives with the movie card in the next update.</p></div>}
            {view === 'list' ? watched.map((l) => watchedRow(l)) : <div className="grid">{watched.map((l) => tile(l.library, 'w', () => setSheet(l.library), l.id, l.score, l.tier, l.watched_at, l.rewatch))}</div>}
          </div>
        ) : (
          <div className="stack">
            <div className="sec-head"><span className="h2">Up next</span><span className="muted small">{next.length || ''}</span></div>
            {next.length === 0 && <div className="empty small-pad">Open something in your Backlog and turn on “Up next” — it’ll show up here.</div>}
            {view === 'list' ? next.map((it) => backlogRow(it, 'n')) : <div className="grid">{next.map((it) => tile(it, 'n', () => setSheet(it), it.id))}</div>}
            <div className="sec-head mt"><span className="h2">Deep backlog</span><span className="muted small">{rest.length}</span></div>
            {rest.length === 0 && <div className="empty small-pad">Search above to add movies.</div>}
            {view === 'list' ? rest.map((it) => backlogRow(it, 'r')) : <div className="grid">{rest.map((it) => tile(it, 'r', () => setSheet(it), it.id))}</div>}
          </div>
        )}
      </main>

      {cardId && <MovieCard key={cardId} itemId={cardId} initial={items.find((i) => i.id === cardId) ?? logs.find((l) => l.library.id === cardId)?.library ?? null}
        initialLogs={logs.filter((l) => l.library.id === cardId).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch })).sort((a, b) => b.watched_at.localeCompare(a.watched_at))}
        initialOwned={Object.fromEntries(items.map((i) => [i.title.source_id, { id: i.id, status: i.status, up_next: i.up_next }]))} settings={settings} backlogCount={items.length} onClose={() => setCardId(null)} onChanged={refresh} onOpenOther={(id) => setCardId(id)} />}
    </div>
  );
}
