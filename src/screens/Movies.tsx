import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Section, LibItem, LogRow, Mark, SearchHit, SeasonEps, Title } from '../lib/types';
import type { Settings } from '../lib/theme';
import { localDay, needsRefresh, topPosition, merged, dateParts, matchLibrary, moveBy, moveId, newHits, nextPosition, releaseText, runtimeText, sortLogs, splitBacklog } from '../lib/logic';
import { bookRefFromLink, ensureBook, searchBooks, ensureGame, gameIdBySlug, gameImages, searchGames, addToBacklog, deleteLog, ensureTitle, ensureTitleByImdb, loadEpisodes, loadLibrary, loadLogs, loadMarks, loadShowTitles, refreshEpisodes, removeFromLibrary, resetLogOrder, saveLibraryOrder, saveLogOrder, searchTitles, setUpNext, updateItem } from '../lib/remote';
import ShowCard, { prefetchShowCard } from './ShowCard';
import ScopeSheet from '../components/ScopeSheet';
import { epLabel, epRuntime, isEnded, logSeasons, planOf, progress, scopeLabel, seasonAir, seasonsName, showState, todayIso, type ShowState } from '../lib/tv';
import { bringBack, dropShow, moveToBacklog, startWatching } from '../lib/tvActions';
import MovieCard from './MovieCard';
import ScoreRing from '../components/ScoreRing';
import { useBackLayer } from '../lib/back';
import { useLongPress } from '../lib/longpress';
import { useDragReorder } from '../lib/drag';
import { GripIcon, Metascore, Poster } from '../components/Rows';
import { ChevBtn, IconBack, IconMenu, IconSearch, ReplayIcon } from '../components/Icons';
import { DROPPED_COLOR, TIERS } from '../lib/scores';
import { movieState } from '../lib/movie';
import GameAddSheet, { type GameAddMode } from '../components/GameAddSheet';
import PlatformIcon from '../components/PlatformIcon';
import FormatIcon from '../components/FormatIcon';
import BookAddSheet from '../components/BookAddSheet';
import { readHours } from '../lib/formats';
import { DEFAULT_RETRO, keyOfIgdb, platformLabel, sectionOf, type GameSection, type IgdbPlatform } from '../lib/platforms';

type GameItem = LibItem & { platform?: string | null; coop?: boolean };
type GameLog = LogRow & { platform?: string | null; coop?: boolean };
const CoopIcon = () => <span className="coop-icon" role="img" aria-label="Co-op"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.6" /><path d="M15.5 14.2A4.6 4.6 0 0 1 21 18.5" /></svg></span>;

/** games, second line in lists: release date · time to beat (yours, then HLTB / IGDB) */
const gameMeta = (it: LibItem) => {
  const ttb = ((it.overrides as { ttb_main?: number } | null)?.ttb_main) ?? ((it.title.data as { ttb?: { main?: number | null } } | null)?.ttb?.main ?? null);
  return [releaseText(it.title.release_date, it.title.year), ttb ? (ttb >= 10 ? Math.round(ttb) : ttb) + ' h' : ''].filter(Boolean).join(' · ');
};

/** books: the readers' rating from Hardcover (0–5), coloured like the other score badges */
const BookRating = ({ t }: { t: Title }) => {
  const r = (t.data as { rating?: number | null } | null)?.rating;
  if (!r) return <span className="mc mc-sm" style={{ background: 'var(--surface2)', color: 'var(--muted)' }} aria-label="No rating">—</span>;
  const v = Math.round(r * 10) / 10;
  const c = v >= 4 ? '#39C316' : v >= 3.3 ? '#F6B26B' : '#DE3C49';
  return <span className="mc mc-sm book-rt" style={{ background: c, color: '#17161A' }} aria-label={'Readers’ rating ' + v + ' out of 5'}>{v.toFixed(1)}★</span>;
};
type BookItem = LibItem & { format?: string | null; progress?: number | null };
/** books, second line in lists: author · year · reading time */
const bookMeta = (it: LibItem) => {
  const d = it.title.data as { pages?: number | null; audio_min?: number | null } | null;
  const mine = (it.overrides as { ttb_main?: number } | null)?.ttb_main;
  const ov = it.overrides as { pages?: number | null; audio_min?: number | null } | null;
  const h = mine ?? readHours(ov?.pages ?? d?.pages, ov?.audio_min ?? d?.audio_min, (it as BookItem).format);
  return [it.title.directors?.[0], it.title.year ? String(it.title.year) : '', h ? (h >= 10 ? Math.round(h) : h) + ' h' : ''].filter(Boolean).join(' · ');
};

type Row = { it: LibItem; p: ReturnType<typeof progress>; state: ShowState; seasons: number[]; when: string | null; last: string | null };
const WATCHING: { key: ShowState; title: string; hint: string }[] = [
  { key: 'progress', title: 'In progress', hint: 'Shows you’re watching with an episode ready' },
  { key: 'newSeason', title: 'New season out', hint: 'A season you haven’t started is out — start it or put it in Backlog' },
  { key: 'lastChance', title: 'Last chance', hint: 'Ended shows with seasons you haven’t watched' },
  { key: 'caughtUp', title: 'Caught up', hint: 'Waiting for the next episode or season' }
];
/** Collapsed sections are remembered on the device. */
const readCollapsed = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem('queued.collapsed') || '{}'); } catch { return {}; } };

/**
 * Lists stay in memory between section switches: going back to Movies or TV Shows shows the last lists instantly,
 * and fresh data replaces them quietly a moment later.
 */
const listCache = new Map<string, { items: LibItem[]; logs: LogRow[]; eps: SeasonEps[]; marks: Mark[]; tab: Tab }>();

interface Props { settings: Settings; onSettings: (s: Settings) => void; onMenu: () => void; kind?: 'movie' | 'tv' | 'game' | 'book'; gameSection?: GameSection; onBack?: () => void }
type Tab = 'watched' | 'playing' | 'backlog';

const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const EyePlus = ({ size = 15 }: { size?: number }) => (
  <span className="rew-mark" role="img" aria-label="Rewatch"><svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M12 18c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /><path d="M16 19h6" /><path d="M19 16v6" /></svg></span>
);


export default function Movies({ settings, onSettings, onMenu, onBack, kind = 'movie', gameSection = 'console' }: Props) {
  const isTv = kind === 'tv';
  const isGame = kind === 'game';
  const isBook = kind === 'book';
  const isPlay = isGame || isBook;   // games and books: Finished · Playing/Reading · Backlog, progress, a format/platform
  // replay mark: the eye for movies and shows, a gamepad in a circular arrow for games
  const RewIcon = ({ size = 15 }: { size?: number }) => (isGame ? <span className="rew-mini" role="img" aria-label="Replay"><ReplayIcon size={size} /></span> : <EyePlus size={size} />);
  // games: one list per section (Console / PC / Retro); finished playthroughs show in the section of the platform you played on
  const section: Section = isGame ? gameSection : isBook ? 'books' : isTv ? 'tv' : 'movies';
  const noun = isTv ? 'show' : isGame ? 'game' : isBook ? 'book' : 'movie';
  const retro = settings.retroPlatforms ?? DEFAULT_RETRO;
  const cached = listCache.get(section);
  // your tab order and the tab a section opens on (Profile → Tabs)
  const tabPref = settings.tabs ?? { order: ['watched', 'playing', 'backlog'], def: 'watched' };
  const hasPlaying = isTv || isGame || isBook;
  const firstTab = (tabPref.def === 'playing' && !hasPlaying ? tabPref.order.find((x) => x !== 'playing') ?? 'watched' : tabPref.def) as Tab;
  const [tab, setTab] = useState<Tab>(cached?.tab ?? firstTab);
  const [tvEps, setTvEps] = useState<SeasonEps[]>(cached?.eps ?? []);
  const [tvMarks, setTvMarks] = useState<Mark[]>(cached?.marks ?? []);
  const [scopeAdd, setScopeAdd] = useState<Title | null>(null);
  const [addChoice, setAddChoice] = useState<Title | null>(null);
  const [gameAdd, setGameAdd] = useState<Title | null>(null);
  const [bookAdd, setBookAdd] = useState<{ t: Title; shown: string; alt?: string | null } | null>(null);
  const bookAlt = useRef(new Map<string, { alt: string | null }>());   // search result → its Russian twin (for author and description)
  const [allGames, setAllGames] = useState<LibItem[]>([]);
  const [cardPast, setCardPast] = useState(false);
  const warmed = useRef(false);
  const [items, setItems] = useState<LibItem[]>(cached?.items ?? []);
  const [logs, setLogs] = useState<LogRow[]>(cached?.logs ?? []);
  const [loading, setLoading] = useState(!cached);
  useEffect(() => { listCache.set(section, { items, logs, eps: tvEps, marks: tvMarks, tab }); }, [section, items, logs, tvEps, tvMarks, tab]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (!notice) return; const tm = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(tm); }, [notice]);
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
    const ids = q.trim().length >= 1 ? matchLibrary(isGame ? allGames : items, q).map((i) => i.id) : tab === 'watched' ? watched.map((l) => l.library.id) : tab === 'playing' ? (['progress', 'newSeason', 'lastChance', 'caughtUp', 'upToDate'] as ShowState[]).flatMap((k) => watchingRows[k].map((r) => r.it.id)) : splitBacklog(items).next.concat(splitBacklog(items).rest).map((i) => i.id);
    return ids.filter((id, i) => ids.indexOf(id) === i);
  };
  const setSheet = (it: LibItem) => { setCardSeq(currentSeq()); setCardEnter(null); setCardPast(false); setCardId(it.id); };
  const view = settings.view;

  const refresh = useCallback(async () => {
    try {
      const libP = isGame ? Promise.all((['console', 'pc', 'retro'] as const).map((sct) => loadLibrary(sct))).then((x) => x.flat()) : loadLibrary(section);
      // shows: episodes and marks of the ones you're watching load in parallel with the journal
      const tvP = isTv ? libP.then((raw) => { const pl = raw.filter((i) => i.status === 'playing'); return Promise.all([loadEpisodes(pl.map((i) => i.title_id)), loadMarks(pl.map((i) => i.id))] as const); }) : null;
      const logP = isGame ? Promise.all((['console', 'pc', 'retro'] as const).map((sct) => loadLogs(sct))).then((x) => x.flat()) : loadLogs(section);
      const [raw, lite] = await Promise.all([libP, logP]);
      const a = raw.map((i) => ({ ...i, title: merged(i.title, i.overrides) }));
      const byId = new Map(a.map((i) => [i.id, i]));
      // journal rows come without a copy of the title — attach the library item we already have
      const b = lite.filter((l) => byId.has(l.library_id)).map((l) => ({ ...l, library: byId.get(l.library_id)! })) as LogRow[];
      if (isGame) {
        const mine = b.filter((l) => sectionOf((l as LogRow & { platform?: string | null }).platform ?? (l.library as LibItem & { platform?: string | null }).platform ?? '', retro) === gameSection);
        setItems(a.filter((i) => i.section === gameSection)); setAllGames(a); setLogs(mine); setError('');
      } else { setItems(a); setLogs(b); setError(''); }
      if (isTv) {
        // episodes and marks are only needed for shows you're actually watching
        const [e, m] = await tvP!;
        setTvEps(e); setTvMarks(m);
        warmShows(a, b);
      }
    }
    catch (e) { setError('Couldn’t load your lists. Check your connection and pull to refresh.'); }
    setLoading(false);
  }, [section]);
  useEffect(() => { refresh(); }, [refresh]);

  /** Once a day per device and section: refresh up to 15 movies / games whose data is due (upcoming and new ones first). */
  const dailyRefresh = useRef(false);
  useEffect(() => {
    if (isTv || dailyRefresh.current || !items.length) return;
    dailyRefresh.current = true;
    const KEY = 'queued.refreshedAt.' + section;
    let last = 0; try { last = Number(localStorage.getItem(KEY) || 0); } catch { /* private mode */ }
    if (Date.now() - last < 20 * 3600e3) return;
    const due = items.filter((i) => needsRefresh(i.title as { release_date?: string | null; fetched_at?: string | null }) && (isPlay || i.title.source === 'tmdb'))
      .sort((a, b) => (b.title.release_date ?? '9999').localeCompare(a.title.release_date ?? '9999')).slice(0, 15);
    (async () => {
      for (const i of due) await (isGame ? ensureGame(i.title.source_id) : isBook ? ensureBook(({ hardcover: 'hc', openlibrary: 'ol', google: 'gb' } as Record<string, string>)[i.title.source] + ':' + i.title.source_id) : ensureTitle('movie', i.title.source_id)).catch(() => undefined);
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
      if (due.length) refresh();
    })();
  }, [items, isTv, isGame, section]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Once a day per device: ask TMDB about running shows (new seasons, new episodes) in the background,
   * then update just those rows — no full reload.
   */
  const warmShows = (a: LibItem[], b: LogRow[]) => {
    if (warmed.current) return;
    warmed.current = true;
    const KEY = 'queued.tvRefreshedAt';
    let last = 0; try { last = Number(localStorage.getItem(KEY) || 0); } catch { /* private mode */ }
    if (Date.now() - last < 20 * 3600e3) return;
    const logged = new Set(b.map((l) => l.library_id));
    const running = a.filter((i) => !isEnded(i.title) && (i.status === 'playing' || logged.has(i.id))).map((i) => i.title.source_id).filter((x) => !x.startsWith('tt'));
    if (!running.length) return;
    (async () => {
      for (let k = 0; k < running.length; k += 10) await refreshEpisodes(running.slice(k, k + 10));
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
      const fresh = new Map((await loadShowTitles(running)).map((t) => [t.source_id, t]));
      const patch = (i: LibItem) => (fresh.has(i.title.source_id) ? { ...i, title: merged({ ...i.title, ...fresh.get(i.title.source_id)! }, i.overrides) } : i);
      setItems((prev) => prev.map(patch));
      setLogs((prev) => prev.map((l) => ({ ...l, library: patch(l.library) })));
      const playingNow = a.filter((i) => i.status === 'playing');
      setTvEps(await loadEpisodes(playingNow.map((i) => i.title_id)));
    })().catch(() => undefined);
  };

  // live search with debounce
  const seq = useRef(0);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 1) { setHits([]); setSearching(false); return; }
    const my = ++seq.current; setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = isGame ? await searchGames(s)
          : isBook ? (await searchBooks(s)).map((b) => { bookAlt.current.set(b.ref, { alt: b.altRef ?? null }); return { sourceId: b.ref, title: b.displayTitle ?? b.title, year: b.year, releaseDate: null, posterUrl: b.cover, platforms: (b.displayAuthors ?? b.authors).slice(0, 2), type: undefined, parent: b.series }; })
          : await searchTitles(s, kind as 'movie' | 'tv');
        if (my === seq.current) setHits(r);
      }
      catch { if (my === seq.current) setHits([]); }
      if (my === seq.current) setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const { next, rest } = useMemo(() => splitBacklog(items), [items]);
  const watched = useMemo(() => sortLogs(logs), [logs]);
  // games: search all your games (Console, PC and Retro), not only this section
  const libMatches = useMemo(() => matchLibrary(isGame ? allGames : items, q), [items, allGames, isGame, q]);
  const fresh = useMemo(() => newHits(hits, items), [hits, items]);
  const customOrder = logs.some((l) => l.position !== null);
  const today = todayIso();
  // TV: every show gets exactly one state (see showState); Watching is split into sections by it
  const watchingRows = useMemo(() => {
    const out: Record<ShowState, Row[]> = { progress: [], newSeason: [], lastChance: [], caughtUp: [], upToDate: [], backlog: [], upNext: [], dropped: [], finished: [] };
    if (!isTv) return out;
    items.forEach((it) => {
      const mine = logs.filter((l) => l.library.id === it.id);
      const p = progress(it, it.title, tvEps.filter((e) => e.title_id === it.title_id), tvMarks.filter((m) => m.library_id === it.id), today);
      const { state, seasons } = showState(it, it.title, mine, it.status === 'playing' ? p : null, today);
      const when = it.status === 'playing' ? p.nextFuture?.air_date ?? null : seasons.length ? seasonAir(it.title, seasons[0]) : null;
      out[state].push({ it, p, state, seasons, when, last: mine.map((l) => l.watched_at).sort().pop() ?? null });
    });
    out.progress.sort((a, b) => (b.p.lastSeen ?? b.it.started_on ?? '').localeCompare(a.p.lastSeen ?? a.it.started_on ?? ''));
    out.newSeason.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
    out.lastChance.sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''));
    // soonest first, then announced without a date (A–Z)
    out.caughtUp.sort((a, b) => (a.when && b.when ? a.when.localeCompare(b.when) : a.when ? -1 : b.when ? 1 : a.it.title.title.localeCompare(b.it.title.title)));
    out.upToDate.sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''));
    return out;
  }, [items, logs, tvEps, tvMarks, today, isTv]);
  const playingCount = watchingRows.progress.length + watchingRows.newSeason.length + watchingRows.lastChance.length + watchingRows.caughtUp.length + watchingRows.upToDate.length;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const toggleSection = (k: string) => setCollapsed((c) => { const n = { ...c, [k]: !(c[k] ?? k === 'upToDate') }; try { localStorage.setItem('queued.collapsed', JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const isCollapsed = (k: string) => collapsed[k] ?? k === 'upToDate';

  /** A movie that isn't out yet can only go to Backlog — add it straight away, no choice sheet. */
  const offerAdd = async (t: Title) => {
    if (!isTv && t.release_date && t.release_date > today) { await addToBacklog(t.id, 'movies', topPosition(items)); await refresh(); return; }
    setAddChoice(t);
  };
  /**
   * After adding a game: put the box art of the chosen platform on it (in the background).
   * Console / Retro: TheGamesDB box for that platform; PC: SteamGridDB cover. Otherwise the IGDB cover stays.
   */
  const pickBoxArt = (t: Title, libId: string, platform: string, dest: string) => {
    const igdbPlats = ((t.data as { platforms?: IgdbPlatform[] } | null)?.platforms ?? []);
    // TheGamesDB names some platforms differently from IGDB
    const TGDB: Record<string, string> = { 'psvr2-ps5': 'Playstation 5', 'xbox-series': 'Xbox Series X', snes: 'Super Nintendo (SNES)', nes: 'Nintendo Entertainment System (NES)', genesis: 'Sega Genesis', 'master-system': 'Sega Master System', gb: 'Nintendo Game Boy', gbc: 'Nintendo Game Boy Color', ds: 'Nintendo DS', '3ds': 'Nintendo 3DS', turbografx: 'TurboGrafx 16', 'neo-geo': 'Neo Geo' };
    const base = TGDB[platform] ?? (platform === 'steam-deck' || platform === 'psvr2-pc' ? 'PC' : igdbPlats.find((p) => keyOfIgdb(p) === platform)?.name ?? platformLabel(platform));
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '').replace('microsoftwindows', '');
    gameImages(t.id, base).then(async ({ posters }) => {
      const pick = dest === 'pc'
        ? posters.find((x) => x.label === 'SteamGridDB')
        : posters.find((x) => x.label.startsWith('TheGamesDB') && norm(x.label).endsWith(norm(base)));
      if (!pick) return;
      await updateItem(libId, { overrides: { poster_url: pick.url } } as never);
      refresh();
    }).catch(() => undefined);
  };
  const imdbInQuery = isPlay ? null : (q.match(/tt\d{6,10}/) ?? [null])[0];
  // books: a link to Hardcover / Open Library / Google Books adds exactly that book
  const bookLinkInQuery = isBook && /(hardcover\.app\/books\/|openlibrary\.org\/works\/|books\.google\.)/i.test(q) ? q.trim() : null;
  // games: an IGDB page link (igdb.com/games/portal-revolution) adds that exact game
  const igdbSlugInQuery = isGame ? (q.match(/igdb\.com\/games\/([a-z0-9-]+)/i)?.[1] ?? null) : null;
  const addByIgdb = async () => {
    if (!igdbSlugInQuery) return;
    setAdding(igdbSlugInQuery);
    try {
      const id = await gameIdBySlug(igdbSlugInQuery);
      if (!id) { setError('Couldn’t find that IGDB page. Check the link.'); return; }
      const t = await ensureGame(id, false, true);
      if (items.some((i) => i.title_id === t.id)) setQ(''); else setGameAdd(t);
    } catch { setError('Couldn’t add it. Try again in a moment.'); }
    finally { setAdding(null); }
  };
  const addByImdb = async () => {
    if (!imdbInQuery) return;
    setAdding(imdbInQuery);
    try { const t = await ensureTitleByImdb(imdbInQuery, false, kind as 'movie' | 'tv'); if (items.some((i) => i.title_id === t.id)) { setQ(''); } else await offerAdd(t); }
    catch { setError('Nothing found for ' + imdbInQuery + '.'); }
    setAdding(null);
  };
  const add = async (h: SearchHit) => {
    setAdding(h.sourceId);
    try {
      if (isGame) { const t = await ensureGame(h.sourceId, false, true); if (items.some((i) => i.title_id === t.id)) setQ(''); else setGameAdd(t); }
      else if (isBook) { const t = await ensureBook(h.sourceId); if (!items.some((i) => i.title_id === t.id)) setBookAdd({ t, shown: h.title, alt: bookAlt.current.get(h.sourceId)?.alt ?? null }); }
      else { const t = await ensureTitle(kind as 'movie' | 'tv', h.sourceId); await offerAdd(t); }
    }
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
      <button className="row-main" {...longPress(it.id)} onPointerDown={() => { if (isTv) prefetchShowCard(it.id, it.title_id); }} onClick={() => !edit && setSheet(it)}>
        <Poster t={it.title} w={56} h={84}></Poster>
        <span className="row-text">
          <span className="row-title">{it.title.title}</span>
          <span className="row-meta">{it.status === 'dropped' && <span className="pill" style={{ background: DROPPED_COLOR, color: '#fff' }}>Dropped</span>}{isGame ? <><PlatformIcon k={(it as GameItem).platform} /><span className="dot-sep">·</span>{gameMeta(it)}</> : isBook ? <><FormatIcon f={(it as BookItem).format} /><span className="dot-sep">·</span>{bookMeta(it)}</> : isTv ? scopeLabel(planOf(it), it.title) : [releaseText(it.title.release_date, it.title.year), runtimeText(it.title.runtime)].filter(Boolean).join(' · ')}{isGame && (it as GameItem).coop && <CoopIcon />}{it.rewatch && <RewIcon />}</span>
          <span className="row-meta">{isBook ? <BookRating t={it.title} /> : <Metascore v={it.title.metascore} size="sm" game={isGame} />}</span>
        </span>
      </button>
      {!edit && (() => {
        // movies: release date; shows: the last aired episode (or the premiere if it hasn't started)
        const lastAired = isTv ? ((it.title.data as { last_air_date?: string | null } | null)?.last_air_date ?? null) : null;
        const rel = it.title.release_date;
        const [cap, when] = isTv
          ? (rel && rel > today ? ['Premieres on', rel] : ['Last aired on', lastAired ?? rel])
          : (rel && rel > today ? ['Out on', rel] : ['Released on', rel]);
        const d = when ? dateParts(when) : null;
        return <span className="date-col"><span className="date-cap">{cap}</span>{d ? <><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}</span></> : <span className="date-big">TBA</span>}</span>;
      })()}
      {grip(list, it.id, it.title.title)}
    </div>
  );

  /** One row in Watching — what it says depends on the show's state. */
  const stateLine = (r: Row): { line: string; cap: string; date: string | null; isNew: boolean; bar: boolean } => {
    const { it, p, state, seasons, when } = r;
    const fresh = !!when && when <= today && Date.now() - new Date(when).getTime() < 30 * 864e5;
    switch (state) {
      case 'progress': return { line: 'Next: ' + epLabel(p.nextEp!) + (p.nextEp!.name ? ' — ' + p.nextEp!.name : '') + (p.nextEp!.runtime ? ' · ' + epRuntime(p.nextEp!.runtime) : ''), cap: 'Started on', date: it.started_on ?? null, isNew: !!(p.nextEp?.air_date && p.seen > 0 && Date.now() - new Date(p.nextEp.air_date).getTime() < 21 * 864e5), bar: true };
      case 'newSeason': return { line: seasonsName(seasons) + (fresh ? ' · out now' : ' · available'), cap: 'Premiered on', date: when, isNew: fresh, bar: false };
      case 'lastChance': return { line: seasonsName(seasons) + ' · not watched yet', cap: 'Last watched', date: r.last, isNew: false, bar: false };
      case 'caughtUp': return it.status === 'playing'
        ? { line: 'Caught up' + (p.nextFuture ? ' · next ' + epLabel(p.nextFuture) : ''), cap: 'Next episode', date: when, isNew: false, bar: true }
        : { line: seasonsName(seasons) + (when ? ' · coming' : ' · announced'), cap: 'Premieres on', date: when, isNew: false, bar: false };
      default: return { line: 'Up to date · no new season yet', cap: 'Last watched', date: r.last, isNew: false, bar: false };
    }
  };
  const watchRow = (r: Row) => {
    const { it, p } = r, s2 = stateLine(r), d = s2.date ? dateParts(s2.date) : null;
    return (
      <div key={it.id} className="row-card" data-rowid={it.id} data-list="p">
        <button className="row-main" {...longPress(it.id)} onClick={() => setSheet(it)}>
          <Poster t={it.title} w={56} h={84} />
          <span className="row-text">
            <span className="row-title">{it.title.title}{s2.isNew && <> <span className="new-pill">NEW</span></>}</span>
            <span className="row-meta">{s2.line}{it.rewatch && <RewIcon />}</span>
            {s2.bar && <span className="row-meta"><span className="mini-bar w72"><span style={{ width: p.pct + '%' }} /></span><strong className="tiny">{p.pct}%</strong></span>}
          </span>
        </button>
        <span className="date-col"><span className="date-cap">{s2.cap}</span>{d ? <><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}</span></> : <span className="date-big">TBA</span>}</span>
      </div>
    );
  };
  const watchTile = (r: Row) => {
    const { it, p } = r, s2 = stateLine(r);
    return (
      <div key={it.id} className="row-card tile" data-rowid={it.id} data-list="p">
        <button className="tile-main" {...longPress(it.id)} onClick={() => setSheet(it)} aria-label={it.title.title}>
          <Poster t={it.title}>{r.state === 'progress' && p.nextEp ? <span className="tile-next">{epLabel(p.nextEp).replace(' · ', '')}</span> : r.seasons.length > 0 && <span className="tile-next">{'S' + r.seasons[0]}{s2.isNew ? ' · new' : ''}</span>}</Poster>
          {s2.bar ? <span className="tile-prog"><span className="mini-bar"><span style={{ width: p.pct + '%' }} /></span><strong className="tiny">{p.pct}%</strong></span>
            : <span className="tiny muted">{s2.date ? releaseText(s2.date, null) : r.state === 'upToDate' ? 'Up to date' : 'Announced'}</span>}
        </button>
      </div>
    );
  };
  const wSection = (key: ShowState | 'upToDate', title: string, hint: string, rows: Row[]) => {
    const shut = isCollapsed(key);
    return (
      <section key={key} className="w-section">
        <button className="w-head" aria-expanded={!shut} onClick={() => toggleSection(key)}>
          <span className="h2">{title}</span><span className="w-count">{rows.length}</span><span className="grow" />
          <ChevBtn open={!shut} size={30} />
        </button>
        {!shut && <>
          <span className="muted small">{hint}</span>
          {view === 'list' ? rows.map(watchRow) : <div className="grid">{rows.map(watchTile)}</div>}
        </>}
      </section>
    );
  };

  const shownRating = (l: LogRow): [number | null, string | null] => {
    return [l.score, l.tier];
  };
  const watchedRow = (l: LogRow) => {
    // every entry keeps its own rating: one season = that season's rating; several seasons = your overall rating when you finished
    const lTier = l.tier, lScore = l.score;
    const t = l.library.title, tr = tierOf(lTier), d = dateParts(l.watched_at);
    return (
      <div key={l.id} {...rowState('w', l.id)}>
        <button className="row-main" {...longPress(l.id)} onClick={() => !edit && setSheet(l.library)}>
          <Poster t={t} w={56} h={84}>{settings.posterScore && <span className="poster-ring"><ScoreRing value={lScore} scale={settings.scale} size={24} fontSize={9} /></span>}</Poster>
          <span className="row-text">
            <span className="row-title">{t.title}</span>
            <span className="row-meta">{isGame ? <><PlatformIcon k={(l as GameLog).platform ?? (l.library as GameItem).platform} /><span className="dot-sep">·</span>{gameMeta(l.library)}</> : isBook ? <><FormatIcon f={(l as GameLog & { format?: string | null }).format ?? (l.library as BookItem).format} /><span className="dot-sep">·</span>{bookMeta(l.library)}</> : isTv ? scopeLabel(logSeasons(l), t) : [releaseText(t.release_date, t.year), runtimeText(t.runtime)].filter(Boolean).join(' · ')}{isGame && (l as GameLog).coop && <CoopIcon />}{settings.listMetascore && <Metascore v={t.metascore} size="sm" game={isGame} />}</span>
            {l.dropped ? <span className="pill" style={{ background: DROPPED_COLOR, color: '#fff' }}>Dropped{tr ? ' · ' + tr.label : ''}</span> : tr ? <span className="pill" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span> : isTv && <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Not rated</span>}
          </span>
        </button>
        {edit ? grip('w', l.id, t.title) : (
          <span className="date-col"><span className="date-cap">{isTv || isPlay ? 'Finished on' : 'Watched on'}</span><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}{l.rewatch && <RewIcon size={13} />}</span></span>
        )}
      </div>
    );
  };

  const tile = (it: LibItem, list: string, onOpen: () => void, key: string, score?: number | null, tier?: string | null, at?: string, rew?: boolean, dropped?: boolean) => {
    const tr = list === 'w' ? tierOf(tier ?? null) : null, d = at ? dateParts(at) : null;
    return (
    <div key={key} {...rowState(list, key)} className={rowState(list, key).className + ' tile'}>
      <button className="tile-main" {...longPress(list === 'w' ? key : it.id)} onClick={() => !edit && onOpen()} aria-label={it.title.title}>
        <Poster t={it.title}>{(settings.listMetascore || list !== 'w') && <span className="tile-mc">{isBook ? <BookRating t={it.title} /> : <Metascore v={it.title.metascore} size="sm" game={isGame} />}</span>}{list === 'w' && settings.posterScore && <span className="poster-ring"><ScoreRing value={score ?? null} scale={settings.scale} size={34} fontSize={12} /></span>}</Poster>
        {dropped ? <span className="tile-tier" style={{ background: DROPPED_COLOR, color: '#fff' }}>Dropped</span> : tr && <span className="tile-tier" style={{ background: tr.color }}>{tr.label}</span>}
        {d && <span className="tile-date"><span className="tile-date-text">{d.day} {d.mon} <span>{d.year}</span></span>{rew && <RewIcon size={14} />}</span>}
      </button>
      {edit && <button className="grip wide" aria-label={'Drag to reorder ' + it.title.title} {...handle(list, key)} onKeyDown={keyMove(list, key)}><GripIcon /></button>}
    </div>
  ); };

  const searchingMode = q.trim().length >= 1;
  const TABS: Tab[] = (tabPref.order.filter((x) => x === 'watched' || x === 'backlog' || (x === 'playing' && (isTv || isPlay))) as Tab[]);
  const gamePlaying = useMemo(() => (isPlay ? items.filter((i) => i.status === 'playing').sort((a, b) => (b.started_on ?? '').localeCompare(a.started_on ?? '')) : []), [items, isPlay]);
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
  useBackLayer(!!addChoice, () => setAddChoice(null));
  useBackLayer(!!cardId, () => { setCardId(null); setCardTake(false); });
  useBackLayer(q.length > 0, () => setQ(''));
  useBackLayer(edit, () => setEdit(false));

  return (
    <div className="app section-in">
      <header className="top">
        <div className="title-row">
          {onBack
            ? <button className="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
            : <button className="icon-btn" aria-label="Open menu" onClick={onMenu}><IconMenu /></button>}
          <div className="title-block">
            <h1 className="section-title">{isGame ? { console: 'Console games', pc: 'PC games', retro: 'Retro games' }[gameSection] : isBook ? 'Books' : isTv ? 'TV Shows' : 'Movies'}</h1>
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
                {tb === 'watched' ? (isBook ? 'Read' : isGame ? 'Finished' : 'Watched') : tb === 'playing' ? (isBook ? 'Reading' : isGame ? 'Playing' : 'Watching') : 'Backlog'} <span className="muted">{tb === 'watched' ? watched.length : tb === 'playing' ? (isPlay ? gamePlaying.length : playingCount) : next.length + rest.length}</span>
              </button>
            ))}
          </div>
        )}
        {edit && !searchingMode && (
          <div className="edit-bar"><span className="muted small">Drag the handles to reorder</span><button className="btn primary sm" onClick={() => setEdit(false)}>Done</button></div>
        )}
      </header>

      <main className="content swipe-area" {...swipeHandlers}
        onPointerDownCapture={(e) => {
          // shows: start loading the card the moment a row is touched, so it opens complete
          if (!isTv) return;
          const id = (e.target as HTMLElement).closest('[data-rowid]')?.getAttribute('data-rowid'); if (!id) return;
          const it = items.find((i) => i.id === id) ?? logs.find((l) => l.id === id)?.library;
          if (it) prefetchShowCard(it.id, it.title_id);
        }}>
        <div ref={paneRef} className={'swipe-pane' + (anim ? ' ' + anim : '')}>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {loading ? <p className="muted">Loading…</p> : searchingMode ? (
          <div className="stack">
            <div className="sec-head"><span className="h2">In your lists</span><span className="muted small">{libMatches.length || ''}</span></div>
            {libMatches.length === 0 && <p className="muted small">Not in your lists yet.</p>}
            {(() => {
              const latestFor = (id: string) => logs.filter((l) => l.library.id === id).sort((a, b) => b.watched_at.localeCompare(a.watched_at))[0];
              const rows = libMatches.map((it) => ({ it, lg: it.status !== 'backlog' ? latestFor(it.id) : undefined }));
              return view === 'list'
                ? rows.map(({ it, lg }) => (lg ? watchedRow(lg) : backlogRow(it, 's')))
                : <div className="grid">{rows.map(({ it, lg }) => (lg ? tile(lg.library, 'w', () => setSheet(lg.library), lg.id, ...shownRating(lg), lg.watched_at, lg.rewatch, lg.dropped) : tile(it, it.up_next ? 'n' : 'r', () => setSheet(it), it.id)))}</div>;
            })()}
            <div className="sec-head mt"><span className="h2">{`Add a new ${noun}`}</span><span className="muted small">{searching ? 'Searching…' : fresh.length || ''}</span></div>
            {imdbInQuery && (
              <div className="hit">
                <span className="row-text"><span className="row-title">Add by IMDb ID</span><span className="row-meta">{imdbInQuery} · {`for ${noun}s search can’t find`}</span></span>
                <button className="add-btn" aria-label={'Add ' + imdbInQuery} disabled={adding === imdbInQuery} onClick={addByImdb}>{adding === imdbInQuery ? '…' : '+'}</button>
              </div>
            )}
            {igdbSlugInQuery && (
              <div className="hit">
                <span className="row-text"><span className="row-title">Add from IGDB link</span><span className="row-meta">{igdbSlugInQuery}</span></span>
                <button className="add-btn" aria-label={'Add ' + igdbSlugInQuery} disabled={adding === igdbSlugInQuery} onClick={addByIgdb}>{adding === igdbSlugInQuery ? '…' : '+'}</button>
              </div>
            )}
            {bookLinkInQuery && (
              <div className="hit">
                <span className="row-text"><span className="row-title">Add from link</span><span className="row-meta ellipsis">{bookLinkInQuery}</span></span>
                <button className="add-btn" aria-label="Add this book" disabled={adding === 'link'} onClick={async () => {
                  setAdding('link');
                  try { const ref = await bookRefFromLink(bookLinkInQuery); if (!ref) { setError('Couldn’t read that link.'); return; } const t = await ensureBook(ref); setBookAdd({ t, shown: t.title }); }
                  catch { setError('Couldn’t add it. Try again in a moment.'); } finally { setAdding(null); }
                }}>{adding === 'link' ? '…' : '+'}</button>
              </div>
            )}
            {!searching && !imdbInQuery && !igdbSlugInQuery && !bookLinkInQuery && fresh.length === 0 && isBook && <p className="muted small">Nothing new found for “{q.trim()}”. Try the author’s name, or paste a link from Hardcover, Open Library or Google Books.</p>}
            {!searching && !imdbInQuery && !igdbSlugInQuery && !isBook && fresh.length === 0 && <p className="muted small">Nothing new found for “{q.trim()}”. {isGame ? 'Try another spelling, or paste its IGDB link (igdb.com/games/…).' : 'Can’t find it? Paste its IMDb link here.'}</p>}
            {fresh.map((h) => (
              <div className="hit" key={h.sourceId}>
                <Poster t={{ poster_url: h.posterUrl, title: h.title }} w={46} h={68} />
                <span className="row-text"><span className="row-title">{h.title}{h.type && h.type !== 'game' && <> <span className="type-pill">{h.type === 'dlc' ? 'DLC' : h.type === 'standalone' ? 'Standalone' : h.type[0].toUpperCase() + h.type.slice(1)}</span></>}</span>
                  <span className="row-meta">{releaseText(h.releaseDate, h.year)}{h.parent ? ' · for ' + h.parent : ''}</span>
                  {h.platforms && h.platforms.length > 0 && <span className="row-meta tiny muted">{h.platforms.slice(0, 6).join(' · ')}{h.platforms.length > 6 ? ' …' : ''}</span>}</span>
                <button className="add-btn" aria-label={'Add ' + h.title + ' to backlog'} disabled={adding === h.sourceId} onClick={() => add(h)}>{adding === h.sourceId ? '…' : '+'}</button>
              </div>
            ))}
          </div>
        ) : tab === 'playing' && isPlay ? (
          <div className="stack">
            {gamePlaying.length === 0 && <div className="empty small-pad">{isBook ? 'Start a book from your Backlog — it shows up here.' : 'Start a game from your Backlog — it shows up here.'}</div>}
            {view === 'list' ? gamePlaying.map((it) => {
              const d = it.started_on ? dateParts(it.started_on) : null;
              return (
                <div key={it.id} className="row-card" data-rowid={it.id} data-list="p">
                  <button className="row-main" {...longPress(it.id)} onClick={() => setSheet(it)}>
                    <Poster t={it.title} w={56} h={84} />
                    <span className="row-text">
                      <span className="row-title">{it.title.title}</span>
                      <span className="row-meta">{isBook ? <><FormatIcon f={(it as BookItem).format} /><span className="dot-sep">·</span>{bookMeta(it)}</> : <><PlatformIcon k={(it as GameItem).platform} /><span className="dot-sep">·</span>{gameMeta(it)}</>}{(it as GameItem).coop && <CoopIcon />}{it.rewatch && <RewIcon />}</span>
                      <span className="row-meta"><span className="mini-bar w72"><span style={{ width: ((it as GameItem & { progress?: number | null }).progress ?? 0) + '%' }} /></span><strong className="tiny">{(it as GameItem & { progress?: number | null }).progress ?? 0}%</strong></span>
                    </span>
                  </button>
                  <span className="date-col"><span className="date-cap">Started on</span>{d ? <><span className="date-big">{d.day} {d.mon}</span><span className="date-year">{d.year}</span></> : <span className="date-big">—</span>}</span>
                </div>
              );
            }) : <div className="grid">{gamePlaying.map((it) => tile(it, 'p', () => setSheet(it), it.id))}</div>}
          </div>
        ) : tab === 'playing' ? (
          <div className="stack">
            {playingCount === 0 && <div className="empty small-pad">Start a show from your Backlog, or mark an episode — it shows up here.</div>}
            {WATCHING.filter((w) => watchingRows[w.key].length > 0).map((w) => wSection(w.key, w.title, w.hint, watchingRows[w.key]))}
            {watchingRows.upToDate.length > 0 && wSection('upToDate', 'Up to date', 'Still running, all watched, nothing announced yet', watchingRows.upToDate)}
          </div>
        ) : tab === 'watched' ? (
          <div className="stack">
            {customOrder && <div className="sec-head"><span className="muted small">Custom order</span><button className="link" onClick={async () => { await resetLogOrder(logs.map((l) => l.id)); refresh(); }}>Sort by date</button></div>}
            {watched.length === 0 && <div className="empty"><p><strong>Nothing watched yet.</strong></p><p className="muted">{isTv ? 'Finished seasons and series land here as journal entries.' : 'Movies you rate land here.'}</p></div>}
            {view === 'list' ? watched.map((l) => watchedRow(l)) : <div className="grid">{watched.map((l) => tile(l.library, 'w', () => setSheet(l.library), l.id, ...shownRating(l), l.watched_at, l.rewatch, l.dropped))}</div>}
          </div>
        ) : (
          <div className="stack">
            {(() => {
              const outNow = isTv ? [] : rest.filter((it) => movieState(it, it.title, null, today) === 'outNow').sort((x, y) => (y.title.release_date ?? '').localeCompare(x.title.release_date ?? ''));
              const soon = isTv ? [] : rest.filter((it) => movieState(it, it.title, null, today) === 'comingSoon').sort((x, y) => (x.title.release_date ?? '').localeCompare(y.title.release_date ?? ''));
              const deep = rest.filter((it) => !outNow.includes(it) && !soon.includes(it));
              const block = (key: string, title: string, hint: string, list: LibItem[], code: string, empty?: string) => {
                const shut = isCollapsed('b-' + key);
                if (!list.length && !empty) return null;
                return (
                  <section key={key} className="w-section">
                    <button className="w-head" aria-expanded={!shut} onClick={() => toggleSection('b-' + key)}>
                      <span className="h2">{title}</span><span className={'w-count' + (key === 'next' ? ' upnext' : '')}>{list.length}</span><span className="grow" /><ChevBtn open={!shut} size={30} />
                    </button>
                    {!shut && <>
                      {hint && <span className="muted small">{hint}</span>}
                      {!list.length && empty && <div className="empty small-pad">{empty}</div>}
                      {view === 'list' ? list.map((it) => backlogRow(it, code)) : <div className="grid">{list.map((it) => tile(it, code, () => setSheet(it), it.id))}</div>}
                    </>}
                  </section>
                );
              };
              return <>
                {block('next', 'Up next', '', next, 'n', `Pin a ${noun} as Up next — it shows up here.`)}
                {block('out', 'Out now', 'Released this year', outNow, 'o')}
                {block('soon', 'Coming soon', 'Not released yet — soonest first', soon, 's')}
                {block('deep', 'Deep backlog', '', deep, 'r', `Search above to add ${noun}s.`)}
              </>;
            })()}
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
                <span className="stack-sm"><strong>{t.title}</strong><span className="muted small">{log ? 'Watched ' + releaseText(log.watched_at, null) : isBack ? (item.up_next ? 'Up next' : 'Backlog') : ''}</span></span>
              </div>
              {menuConfirm ? (
                <div className="stack">
                  <span className="small">{menuConfirm === 'remove' ? 'Remove “' + t.title + '” and all its ' + (isGame ? 'playthroughs' : isBook ? 'readings' : 'viewings') + '?' : (isGame ? 'Delete this playthrough?' : isBook ? 'Delete this reading?' : 'Delete this viewing?')}</span>
                  <div className="row nowrap"><button className="btn grow" onClick={() => setMenuConfirm(null)}>Cancel</button>
                    <button className="btn danger-fill grow" onClick={menuConfirm === 'remove'
                      ? run(async () => { await removeFromLibrary(item.id); })
                      : run(async () => { await deleteLog(log!.id); if (itemLogs.length <= 1) await updateItem(item.id, { status: 'backlog' }); })}>Delete</button></div>
                </div>
              ) : (
                <div className="action-list">
                  <button role="menuitem" onClick={() => { close(); setCardTake(false); setCardPast(false); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>Open</button>
                  {isBack && !isTv && <button role="menuitem" onClick={() => { close(); setCardTake(true); setCardPast(false); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>{isGame ? 'Start playing…' : isBook ? 'Start reading…' : 'Mark as watched…'}</button>}
                  {isBack && <button role="menuitem" onClick={run(async () => { await setUpNext(item.id, !item.up_next, topPosition(items)); })}>{item.up_next ? 'Remove from Up next' : 'Add to Up next'}</button>}
                  {isPlay && item.status === 'playing' && <button role="menuitem" onClick={() => { close(); setCardTake(false); setCardPast(false); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>Finished…</button>}
                  {!isBack && item.status !== 'playing' && <button role="menuitem" onClick={() => { close(); setCardTake(true); setCardPast(false); setCardSeq(currentSeq()); setCardEnter(null); setCardId(item.id); }}>Change rating…</button>}
                  {!isBack && !isTv && <button role="menuitem" onClick={run(async () => { await updateItem(item.id, { status: 'backlog', rewatch: true, score: null, position: topPosition(items) }); })}>{isGame ? 'Replay → Backlog' : isBook ? 'Reread → Backlog' : 'Log a rewatch → Backlog'}</button>}
                  {isTv && (() => {
                    const mine = logs.filter((l) => l.library.id === item.id);
                    const st = showState(item, item.title, mine, item.status === 'playing' ? progress(item, item.title, tvEps.filter((e) => e.title_id === item.title_id), tvMarks.filter((m) => m.library_id === item.id), today) : null, today);
                    const ss = st.seasons.length ? st.seasons : planOf(item);
                    return <>
                      {item.status !== 'playing' && item.status !== 'dropped' && st.state !== 'finished' && st.state !== 'upToDate' && <button role="menuitem" className="start-item" onClick={run(async () => { await startWatching(item, ss); })}>▶ Start watching</button>}
                      {item.status !== 'backlog' && item.status !== 'dropped' && st.state !== 'finished' && st.state !== 'upToDate' && <button role="menuitem" onClick={run(async () => { await moveToBacklog(item, ss, topPosition(items)); })}>Move to Backlog</button>}
                      {item.status !== 'dropped' && st.state !== 'finished' && <button role="menuitem" onClick={run(async () => { await dropShow(item); })}>Drop</button>}
                      {item.status === 'dropped' && <button role="menuitem" onClick={run(async () => { await bringBack(item, mine.length > 0, topPosition(items)); })}>Bring back</button>}
                    </>;
                  })()}
                  {isBack && <button role="menuitem" onClick={() => { close(); setEdit(true); }}>Reorder</button>}
                  {log && <button role="menuitem" className="danger" onClick={() => setMenuConfirm('viewing')}>{isGame ? 'Delete this playthrough' : isBook ? 'Delete this reading' : 'Delete this viewing'}</button>}
                  <button role="menuitem" className="danger" onClick={() => setMenuConfirm('remove')}>Remove from my lists</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {addChoice && (
        <div className="sheet-wrap">
          <button className="sheet-scrim" aria-label="Close" onClick={() => setAddChoice(null)} />
          <div className="sheet action-sheet" role="dialog" aria-label={'Add ' + addChoice.title}>
            <div className="action-head"><Poster t={addChoice} w={40} h={60} /><span className="stack-sm"><strong>{addChoice.title}</strong><span className="muted small">{addChoice.year ?? ''}</span></span></div>
            <div className="choice-buttons">
              <button className="choice primary" onClick={async () => { const t = addChoice; setAddChoice(null); if (isTv) { setScopeAdd(t); return; } try { await addToBacklog(t.id, 'movies', topPosition(items)); await refresh(); } catch { setError('Couldn’t add “' + t.title + '”.'); } }}>
                <strong>Add to Backlog</strong><span>{isTv ? 'Then pick the seasons you’ll watch' : 'Goes to the top of your Backlog'}</span></button>
              {!(addChoice.release_date && addChoice.release_date > today) && <button className="choice" onClick={async () => { const t = addChoice; setAddChoice(null);
                try { const id = await addToBacklog(t.id, section, topPosition(items), isTv ? { run_started_at: new Date().toISOString() } : {}); await refresh(); setQ(''); setCardSeq([id]); setCardTake(false); setCardEnter(null); setCardPast(true); setCardId(id); }
                catch { setError('Couldn’t add “' + t.title + '”.'); } }}>
                <strong>I’ve seen it</strong><span>{isTv ? 'Add a past viewing: seasons, date, rating' : 'Add a past viewing: date and rating'}</span></button>}
              <button className="choice ghost" onClick={() => setAddChoice(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {bookAdd && <BookAddSheet t={bookAdd.t} shown={bookAdd.shown} today={today} onCancel={() => setBookAdd(null)} onDone={async ({ format, mode }) => {
        const { t, shown, alt } = bookAdd; setBookAdd(null);
        try {
          // searched in Russian: title, author and description in Russian (from the Russian edition), the rest (pages, series) from the main source
          const ov: Record<string, unknown> = {};
          if (shown && shown !== t.title) ov.title = shown;
          if (alt) {
            const ru = await ensureBook(alt, false, true).catch(() => null);
            if (ru?.directors?.length && /[а-яё]/i.test(ru.directors[0])) ov.directors = ru.directors;
          }
          // (no automatic translation — Edit details has «Описание по-русски» if you want it)
          const extra = Object.keys(ov).length ? { overrides: ov } : {};
          const id = await addToBacklog(t.id, 'books', topPosition(items), { format, ...extra, ...(mode === 'playing' ? { status: 'playing', started_on: today, run_started_at: new Date().toISOString(), progress: 0 } : {}) } as never);
          await refresh();
          if (mode === 'past') { setCardSeq([id]); setCardTake(false); setCardEnter(null); setCardPast(true); setCardId(id); }
        } catch { setError('Couldn’t add “' + t.title + '”.'); }
      }} />}
      {gameAdd && <GameAddSheet t={gameAdd} retro={retro} today={today} prefer={gameSection} onCancel={() => setGameAdd(null)} onDone={async ({ platform, coop, mode }) => {
        const t = gameAdd; setGameAdd(null);
        const dest = sectionOf(platform, retro);
        try {
          const id = await addToBacklog(t.id, dest, topPosition(items), { platform, coop, ...(mode === 'playing' ? { status: 'playing', started_on: today, run_started_at: new Date().toISOString() } : {}) });
          await refresh();
          // time to beat (HLTB), Metascore and background arrive a few seconds later — no waiting on the add
          if ((t.data as { needs_enrich?: boolean } | null)?.needs_enrich) ensureGame(t.source_id, true).then(() => refresh()).catch(() => undefined);
          if (dest !== gameSection) setNotice('Added to ' + { console: 'Console games', pc: 'PC games', retro: 'Retro games' }[dest] + '.');
          if (mode === 'past') { setCardSeq([id]); setCardTake(false); setCardEnter(null); setCardPast(true); setCardId(id); }
        } catch { setError('Couldn’t add “' + t.title + '”.'); }
      }} />}
      {scopeAdd && <ScopeSheet t={scopeAdd} title="What will you watch?" confirm="Add to Backlog" onCancel={() => setScopeAdd(null)}
        onDone={async (list) => { const t = scopeAdd; setScopeAdd(null); try { await addToBacklog(t.id, 'tv', topPosition(items), { plan_seasons: list, plan_from: list ? list[0] : null, plan_to: list ? list[list.length - 1] : null, run_started_at: new Date().toISOString() }); refreshEpisodes([t.source_id]); await refresh(); } catch { setError('Couldn’t add “' + t.title + '”.'); } }} />}
      {cardId && isTv && <ShowCard key={cardId} openPast={cardPast} itemId={cardId} openTake={cardTake} enterFrom={cardEnter} settings={settings} topPos={topPosition(items)}
        initial={items.find((i) => i.id === cardId) ?? logs.find((l) => l.library.id === cardId)?.library ?? null}
        initialLogs={logs.filter((l) => l.library.id === cardId).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch, scope: l.scope, season_from: l.season_from, season_to: l.season_to })).sort((a, b) => b.watched_at.localeCompare(a.watched_at))}
        onPrev={cardSeq.indexOf(cardId) > 0 ? () => { setCardEnter('left'); setCardTake(false); setCardPast(false); setCardId(cardSeq[cardSeq.indexOf(cardId) - 1]); } : null}
        onNext={cardSeq.indexOf(cardId) >= 0 && cardSeq.indexOf(cardId) < cardSeq.length - 1 ? () => { setCardEnter('right'); setCardTake(false); setCardPast(false); setCardId(cardSeq[cardSeq.indexOf(cardId) + 1]); } : null}
        onClose={() => { setCardId(null); setCardTake(false); setCardPast(false); }} onChanged={refresh} />}
      {cardId && !isTv && <MovieCard key={cardId} game={isGame} book={isBook} openPast={cardPast} itemId={cardId} openTake={cardTake} enterFrom={cardEnter}
        onPrev={cardSeq.indexOf(cardId) > 0 ? () => { setCardEnter('left'); setCardTake(false); setCardPast(false); setCardId(cardSeq[cardSeq.indexOf(cardId) - 1]); } : null}
        onNext={cardSeq.indexOf(cardId) >= 0 && cardSeq.indexOf(cardId) < cardSeq.length - 1 ? () => { setCardEnter('right'); setCardTake(false); setCardPast(false); setCardId(cardSeq[cardSeq.indexOf(cardId) + 1]); } : null} initial={items.find((i) => i.id === cardId) ?? logs.find((l) => l.library.id === cardId)?.library ?? null}
        initialLogs={logs.filter((l) => l.library.id === cardId).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch })).sort((a, b) => b.watched_at.localeCompare(a.watched_at))}
        initialOwned={Object.fromEntries(items.map((i) => { const lg = logs.filter((l) => l.library.id === i.id).sort((a, b) => b.watched_at.localeCompare(a.watched_at))[0]; return [i.title.source_id, { id: i.id, status: i.status, up_next: i.up_next, tier: lg?.tier ?? null, score: lg?.score ?? null }]; }))} settings={settings} backlogCount={topPosition(items)} onClose={() => { setCardId(null); setCardTake(false); setCardPast(false); }} onChanged={refresh} onOpenOther={(id, past) => { setCardPast(!!past); setCardTake(false); setCardId(id); }} />}
    </div>
  );
}
