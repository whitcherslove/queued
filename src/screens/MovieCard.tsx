import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMsg, CollectionPart, ItemLog, LibItem, Overrides, Title } from '../lib/types';
import type { Settings } from '../lib/theme';
import { DROPPED_COLOR, PICK_TIERS, TIERS, displayScore, imdbColor, metascoreColor, myScoreColor } from '../lib/scores';
import { needsRefresh, diffOverrides, latestLog, localDay, withLocalDay, longDate, metacriticSearch, merged, money, nextPosition, parseNum, releaseText, runtimeText } from '../lib/logic';
import { shortCountries } from '../lib/logic';
import {
  type Owned, bookImages, ensureBook, findOwnedBooks, estimateProgress, findOwnedGames, gameImages, ensureGame, addToBacklog, askAi, deleteLog, ensureTitle, ensureTitleByImdb, loadImages, uploadCover, findOwnedBySource, insertLog, loadChat, loadItem, loadItemLogs, removeFromLibrary, updateItem, updateLog
} from '../lib/remote';
import ScoreRing from '../components/ScoreRing';
import DateField from '../components/DateField';
import SafeRange from '../components/SafeRange';
import PageScrub from '../components/PageScrub';
import Overview from '../components/Overview';
import { MOVIE_STATE_LABEL, movieState } from '../lib/movie';
import { platformChoices, platformLabel, sectionOf, type IgdbPlatform } from '../lib/platforms';
import { PlatformSheet } from '../components/GameAddSheet';
import ProgressRing from '../components/ProgressRing';
import PlatformIcon from '../components/PlatformIcon';
import FormatIcon from '../components/FormatIcon';
import { FORMATS, formatLabel, positionText, readHours } from '../lib/formats';
import { Ico, ListRow, RatingTiles, ScoreStepper } from '../components/Rate';
import { ChevBtn, IconBack, MoreBtn, ReplayIcon } from '../components/Icons';
import { useBackLayer } from '../lib/back';
import { usePress } from '../lib/press';

interface Props { game?: boolean; book?: boolean; openPast?: boolean; itemId: string; onPrev?: (() => void) | null; onNext?: (() => void) | null; enterFrom?: 'left' | 'right' | null; openTake?: boolean; initial?: LibItem | null; initialLogs?: ItemLog[] | null; initialOwned?: Record<string, Owned>; settings: Settings; onClose: () => void; onChanged: () => void; onOpenOther: (id: string, past?: boolean) => void; backlogCount: number }

const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const EXT = <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M20 4l-9 9" /></svg>;
/** reread (books): a plain circular arrow */
const REREAD = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.9-6.6" /><path d="M21 3.5v5h-5" /></svg>;
/** a book's reference for the books function: 'hc:123' / 'ol:OL1W' / 'gb:abc' */
export const bookRef = (t: { source: string; source_id: string }) => ({ hardcover: 'hc', openlibrary: 'ol', google: 'gb' } as Record<string, string>)[t.source] + ':' + t.source_id;
const EYE_PLUS_SVG = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M12 18c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /><path d="M16 19h6" /><path d="M19 16v6" /></svg>;
const CHIPS = ['Similar movies', 'Fun facts', 'Post-credits scene?', 'Explain the ending'];
const BOOK_CHIPS = ['Similar books', 'Is it worth finishing?', 'Recap so far (no spoilers)', 'About the author'];
const GAME_CHIPS = ['Similar games', 'Is it worth 100%?', 'Tips for a first run', 'How long is it really?'];

export const tierOfId = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
export const EYE_PLUS_ICON = EYE_PLUS_SVG;
export const EXT_ICON = EXT;

const PIN = <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4.5l4.5 4.5-3 1.5-3.5 3.5.5 4-1.5 1.5-3.5-3.5L4 20M8.5 11.5L12.5 15.5M15 4.5L12 7.5 8.5 7 7 8.5l3.5 3.5" /></svg>;

export default function MovieCard({ game, book, openPast, itemId, onPrev, onNext, enterFrom, openTake, initial, initialLogs, initialOwned, settings, onClose, onChanged, onOpenOther, backlogCount }: Props) {
  const [item, setItem] = useState<LibItem | null>(initial ?? null);
  const [logsReady, setLogsReady] = useState(!!initial && !!initialLogs);
  const [full, setFull] = useState(!!initial?.title?.data);
  const [logs, setLogs] = useState<ItemLog[]>(initialLogs ?? []);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [owned, setOwned] = useState<Record<string, Owned>>(initialOwned ?? {});
  const [takeOpen, setTakeOpen] = useState(!!openTake);
  const takePress = usePress(), aiPress = usePress(), seasonsPress = usePress(), statusPress = usePress(), collPress = usePress();
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [justWatched, setJustWatched] = useState(false);
  const [collOpen, setCollOpen] = useState(false);
  const [ownedGames, setOwnedGames] = useState<Record<string, Owned>>({});
  const [franOpen, setFranOpen] = useState(false);
  const [franEdit, setFranEdit] = useState(false);
  const [franShowHidden, setFranShowHidden] = useState(false);
  const franPress = usePress();
  const [addingDlc, setAddingDlc] = useState<string | null>(null);
  // an imported game only has IGDB data — the first time you open it, fetch HLTB / Metacritic / RAWG in the background
  // fresh data on open when it's due (games: also right after a fast add) — in the background, the card doesn't wait
  const oldSeries = !!(book && item && (item.title.data as { series?: unknown; series_v?: number } | null)?.series && (item.title.data as { series_v?: number }).series_v !== 2);
  const needsEnrich = !!item && (oldSeries || !!(game && (item.title.data as { needs_enrich?: boolean } | null)?.needs_enrich) || needsRefresh(item.title as { release_date?: string | null; fetched_at?: string | null }));
  useEffect(() => { if (!needsEnrich || !item) return; (game ? ensureGame(item.title.source_id, !!(item.title.data as { needs_enrich?: boolean } | null)?.needs_enrich) : book ? ensureBook(bookRef(item.title), oldSeries) : item.title.source === 'tmdb' ? ensureTitle('movie', item.title.source_id) : Promise.resolve(null)).then(() => reload()).catch(() => undefined); }, [needsEnrich]); // eslint-disable-line react-hooks/exhaustive-deps
  const [platAsk, setPlatAsk] = useState<'' | 'start' | 'replay'>('');
  const [platPick, setPlatPick] = useState<string | null>(null);   // log id, or 'item'
  const [progAsk, setProgAsk] = useState(false);
  const [progText, setProgText] = useState('');
  const [progBusy, setProgBusy] = useState(false);
  const [progNote, setProgNote] = useState('');
  const [dlcEdit, setDlcEdit] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // which DLCs / main game you already have (games only), once the full game data is here
  const dlcKey = book && item?.title?.data ? JSON.stringify([((item.title.data as { series_books?: { id: string }[] }).series_books ?? []).map((d) => d.id), null]) : game && item?.title?.data ? JSON.stringify([[...((item.title.data as { dlcs?: { id: string }[] }).dlcs ?? []), ...((item.title.data as { franchise_games?: { id: string }[] }).franchise_games ?? [])].map((d) => d.id), (item.title.data as { parent?: { id: string } | null }).parent?.id ?? null]) : '';
  useEffect(() => {
    if (!dlcKey) return;
    const [ids, parent] = JSON.parse(dlcKey) as [string[], string | null];
    const all = parent ? [...ids, parent] : ids;
    if (all.length) (book ? findOwnedBooks(all) : findOwnedGames(all)).then(setOwnedGames).catch(() => undefined);
  }, [dlcKey]);
  const [aiOpen, setAiOpen] = useState(false);
  const [ovOpen, setOvOpen] = useState(false);
  const [quick, setQuick] = useState<null | 'metascore' | 'imdb_rating'>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [delView, setDelView] = useState<string | null>(null);
  const [editLog, setEditLog] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(!!openPast);
  const [addPart, setAddPart] = useState<CollectionPart | null>(null);
  const [preview, setPreview] = useState<number | null | undefined>(undefined);
  const swipeEl = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const swRef = useRef<{ x: number; y: number; mode: '' | 'h' | 'v'; dx: number; vx: number; lx: number; lt: number } | null>(null);
  const lastSwipe = useRef(0);
  const paint = (dx: number) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { const el = swipeEl.current; if (!el) return; el.style.transition = 'none'; el.style.transform = `translate3d(${dx}px,0,0)`; el.style.opacity = String(1 - Math.min(Math.abs(dx) / 800, 0.25)); });
  };
  const snapBack = () => { cancelAnimationFrame(raf.current); const el = swipeEl.current; if (!el) return; el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease'; el.style.transform = ''; el.style.opacity = ''; };
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button > 0 || (e.target as HTMLElement).closest('input, textarea, .chips.scroll, .bd-grid, .pp-grid, .cands, .chat-log, .no-swipe')) return;
      swRef.current = { x: e.clientX, y: e.clientY, mode: '', dx: 0, vx: 0, lx: e.clientX, lt: e.timeStamp };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const st = swRef.current; if (!st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.mode) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { st.mode = 'h'; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } }
        else if (Math.abs(dy) > 14) { st.mode = 'v'; return; }
      }
      if (st.mode === 'h') {
        const dt = e.timeStamp - st.lt; if (dt > 0) st.vx = 0.7 * st.vx + 0.3 * ((e.clientX - st.lx) / dt);
        st.lx = e.clientX; st.lt = e.timeStamp;
        const edge = (dx > 0 && !onPrev) || (dx < 0 && !onNext); st.dx = edge ? dx * 0.2 : dx; paint(st.dx);
      }
    },
    onPointerUp: () => {
      const st = swRef.current; swRef.current = null;
      if (!st || st.mode !== 'h') return;
      lastSwipe.current = Date.now();
      const dx = st.dx, flick = Math.abs(st.vx) > 0.4 && Math.abs(dx) > 25;
      if ((dx < -60 || (flick && st.vx < 0)) && onNext) onNext();
      else if ((dx > 60 || (flick && st.vx > 0)) && onPrev) onPrev();
      else snapBack();
    },
    onPointerCancel: () => { if (swRef.current?.mode === 'h') snapBack(); swRef.current = null; },
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - lastSwipe.current < 350) { e.preventDefault(); e.stopPropagation(); } }
  };
  const [error, setError] = useState('');
  const scale = settings.scale;
  useBackLayer(editOpen, () => setEditOpen(false));
  useBackLayer(!!quick, () => setQuick(null));
  useBackLayer(pastOpen, () => setPastOpen(false));
  useBackLayer(!!addPart, () => setAddPart(null));
  const firstFor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const [it, lg, ch] = await Promise.all([loadItem(itemId), loadItemLogs(itemId), loadChat(itemId)]);
    setItem(it); setLogs(lg); setChat(ch); setLogsReady(true); setFull(true);
    if (firstFor.current !== it.id) { firstFor.current = it.id; setTakeOpen(!!openTake); }
    const parts = ((it.title.data as any)?.collection?.parts ?? []) as CollectionPart[];
    setOwned(await findOwnedBySource(parts.map((p) => p.sourceId), 'movies'));
  }, [itemId]);
  useEffect(() => { reload().catch(() => setError(game ? 'Couldn’t load this game.' : book ? 'Couldn’t load this book.' : 'Couldn’t load this movie.')); }, [reload]);

  const t = useMemo(() => (item ? merged(item.title, item.overrides) : null), [item]);
  const last = latestLog(logs);
  const done = item ? item.status === 'done' || item.status === 'dropped' : false;
  const planned = item?.status === 'backlog';
  // My take = the rating of your latest viewing (also while a rewatch waits in Backlog)
  const score = last ? last.score : null;

  if (!item || !t) return <div className="card-screen"><div className="card-loading">{error || 'Loading…'}</div></div>;

  const changed = async () => { await reload(); onChanged(); };
  const guard = (fn: () => Promise<void>) => async () => { try { setError(''); await fn(); await changed(); } catch { setError('Something went wrong. Try again.'); } };

  // Ratings only change your latest viewing. Viewings are created by Watched / Watched before / Drop, deleted only in Viewings.
  const pickTier = (id: string) => { if (!last) return; const l = last, v = l.tier === id ? null : id; optimistic(() => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, tier: v } : x))), () => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, tier: l.tier } : x))), () => updateLog(l.id, { tier: v })); };
  const setScore = (v: number | null) => { setPreview(undefined); if (!last) return; const l = last; optimistic(() => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, score: v } : x))), () => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, score: l.score } : x))), () => updateLog(l.id, { score: v })); };

  const setDate = (d: string) => guard(async () => {
    if (!last || !d) return;
    await updateLog(last.id, { watched_at: withLocalDay(last.watched_at, d) });
  })();

  // the Rewatch switch in My take is about your latest viewing (was it a rewatch?)
  const rewOn = !!last?.rewatch;
  // Switches flip instantly; saving happens in the background and rolls back if it fails.
  const optimistic = (apply: () => void, revert: () => void, save: () => Promise<void>) => {
    apply();
    save().then(() => onChanged()).catch(() => { revert(); setError('Couldn’t save. Try again.'); });
  };
  const toggleRew = () => { if (!last) return; const l = last, v = !l.rewatch; optimistic(() => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, rewatch: v } : x))), () => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, rewatch: !v } : x))), () => updateLog(l.id, { rewatch: v })); };
  const planRewatch = async () => { await updateItem(item.id, { status: 'backlog', rewatch: true, position: backlogCount }); };
  const cancelRewatch = async () => { await updateItem(item.id, { status: 'done', rewatch: false, up_next: false }); };
  const logRewatch = guard(async () => { if (planned && logs.length) await cancelRewatch(); else if (game) setPlatAsk('replay'); else await planRewatch(); });
  const EYE_PLUS = game ? <ReplayIcon size={18} /> : book ? REREAD : EYE_PLUS_SVG;
  // games use the same card with their own words: Finished / Playing / Replay / Playthroughs / Played before
  const W = book
    ? { done: 'Read', doneOn: 'Finished on', rewatch: 'Reread', viewings: 'Readings', before: 'Read before', viewing: 'reading', notYet: 'Not read yet', just: 'Just finished · rate it', list: 'Read' }
    : game
    ? { done: 'Finished', doneOn: 'Finished on', rewatch: 'Replay', viewings: 'Playthroughs', before: 'Played before', viewing: 'playthrough', notYet: 'Not played yet', just: 'Just finished · rate it', list: 'Finished' }
    : { done: 'Watched', doneOn: 'Watched on', rewatch: 'Rewatch', viewings: 'Viewings', before: 'Watched before', viewing: 'viewing', notYet: 'Not watched yet', just: 'Just watched · rate it', list: 'Watched' };
  const gItem = item as typeof item & { platform?: string | null; coop?: boolean; progress?: number | null };
  const isPlaying = (game || book) && item.status === 'playing';
  // books: progress in pages (or minutes for audio) when we know the length
  const bData = (book ? t.data : null) as { pages?: number | null; audio_min?: number | null; series?: { name: string } | null; series_books?: { ref: string; id: string; name: string; position: number | null; year: number | null }[]; rating?: number | null; ratings?: number | null; url?: string | null } | null;
  const bItem = item as typeof item & { format?: string | null; position_at?: number | null };
  const myPages = (item.overrides as { pages?: number | null } | null)?.pages ?? null;
  const myAudio = (item.overrides as { audio_min?: number | null } | null)?.audio_min ?? null;
  const pagesN = myPages ?? bData?.pages ?? null, audioN = myAudio ?? bData?.audio_min ?? null;
  const unitMax = book ? (bItem.format === 'audio' ? audioN : pagesN) : null;
  const unitPos = unitMax ? (bItem.position_at ?? Math.round(((gItem.progress ?? 0) * unitMax) / 100)) : null;
  const setUnit = (v: number, save: boolean) => {
    const pos = Math.max(0, Math.min(unitMax ?? 0, v)); const pct = unitMax ? Math.round((pos / unitMax) * 100) : 0;
    setItem({ ...item, position_at: pos, progress: pct } as never);
    if (save) updateItem(item.id, { position_at: pos, progress: pct } as never).then(onChanged).catch(() => undefined);
  };
  // the platform you play / played on (latest playthrough unless it's in Backlog or Playing)
  const heroPlat: string | null = game ? ((item.status === 'backlog' || item.status === 'playing' ? gItem.platform : (last as (typeof last) & { platform?: string | null } | null)?.platform ?? gItem.platform) ?? null) : null;
  const mState = isPlaying ? ('playing' as const) : movieState(item, t, planned ? null : last);
  const inBacklog = item.status === 'backlog';
  const canWatchNow = inBacklog && movieState(item, t, null) !== 'comingSoon';
  const rel = t.release_date;
  const mSub = (() => {
    switch (mState) {
      case 'upNext': return 'Pinned to the top of your Backlog';
      case 'comingSoon': return 'Out on ' + (rel ? longDate(rel) : 'a date TBA');
      case 'outNow': return 'Released on ' + (rel ? longDate(rel) : 'this year');
      case 'backlog': return item.rewatch ? W.rewatch + ' planned' : 'In your Backlog';
      case 'watched': return W.doneOn + ' ' + (last ? longDate(last.watched_at) : '');
      case 'playing': { const t2 = [book ? '' : platformLabel(gItem.platform), item.started_on ? 'started on ' + longDate(item.started_on) : ''].filter(Boolean).join(' · '); return t2 ? t2[0].toUpperCase() + t2.slice(1) : ''; }
      case 'didntFinish': return 'Didn’t finish · stopped on ' + (last ? longDate(last.watched_at) : '');
      default: return 'Hidden from your lists · search still finds it';
    }
  })();
  /** games: platform + co-op rows — on the latest playthrough, or (not played yet) on the game itself; a new platform can move it to another section */
  const platOptions = platformChoices(((t.data as { platforms?: IgdbPlatform[] } | null)?.platforms ?? []), settings.retroPlatforms ?? undefined);
  // games: Platform and Co-op rows — on the latest playthrough, or (not played yet) on the game itself; a new platform can move it to another section
  const gameRow = (which: 'platform' | 'coop', l: (typeof logs)[number] | null) => {
    const lp = l as (typeof logs)[number] & { platform?: string | null; coop?: boolean } | null;
    const cur = (lp ? lp.platform : null) ?? gItem.platform ?? '';
    const coopOn = lp ? !!lp.coop : !!gItem.coop;
    if (which === 'platform') return (
      <ListRow icon={Ico.seasons} label="Platform" onClick={() => setPlatPick(lp ? lp.id : 'item')}>
        <span className="li-value plat-value"><PlatformIcon k={cur} size={14} />{cur ? platformLabel(cur) : 'Pick'} ›</span>
      </ListRow>
    );
    return <ListRow icon={Ico.coop} label="Co-op" onClick={guard(async () => { if (lp) await updateLog(lp.id, { coop: !coopOn } as never); else await updateItem(item.id, { coop: !coopOn } as never); })}><span className={'switch' + (coopOn ? ' on-green' : '')}><span /></span></ListRow>;
  };
  const sectionOfKey = (k: string) => sectionOf(k, settings.retroPlatforms ?? undefined);
  /** books: the format of the latest reading (or of the book you haven't read yet) */
  /** books: how many pages (or minutes of audio) — your number wins; the progress bar counts in these */
  const lengthRow = () => {
    const audio = bItem.format === 'audio';
    const cur = audio ? audioN : pagesN;
    const save = (v: number | null) => {
      const ov = { ...(item.overrides ?? {}), [audio ? 'audio_min' : 'pages']: v };
      const pos = bItem.position_at != null && v ? Math.min(bItem.position_at, v) : bItem.position_at;
      setItem({ ...item, overrides: ov, position_at: pos, progress: v && pos != null ? Math.round((pos / v) * 100) : gItem.progress } as never);
      updateItem(item.id, { overrides: ov, position_at: pos, ...(v && pos != null ? { progress: Math.round((pos / v) * 100) } : {}) } as never).then(onChanged).catch(() => setError('Couldn’t save. Try again.'));
    };
    return (
      <ListRow icon={<FormatIcon f={bItem.format ?? 'paper'} size={18} />} label={audio ? 'Length, minutes' : 'Pages'}>
        <input className="num-input" type="number" inputMode="numeric" min={1} aria-label={audio ? 'Length in minutes' : 'Number of pages'} defaultValue={cur ?? ''} key={String(cur)}
          placeholder={audio ? 'min' : 'pages'} onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (e.target.value === '' ) { if (cur !== null && (audio ? myAudio : myPages) !== null) save(null); } else if (v > 0 && v !== cur) save(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </ListRow>
    );
  };
  const formatRow = (l: (typeof logs)[number] | null) => {
    const lf = l as (typeof logs)[number] & { format?: string | null } | null;
    const cur = (lf ? lf.format : null) ?? bItem.format ?? 'paper';
    return (
      <ListRow icon={<FormatIcon f={cur} size={18} />} label="Format">
        <span className="fmt-seg" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => <button key={f.key} role="radio" aria-checked={cur === f.key} className={cur === f.key ? 'on' : ''}
            onClick={() => guard(async () => { if (lf) await updateLog(lf.id, { format: f.key } as never); else await updateItem(item.id, { format: f.key, position_at: null } as never); })()}>{f.label}</button>)}
        </span>
      </ListRow>
    );
  };
  // DLC & expansions of a game (or the main game of a DLC) — owned ones open, the rest can be added with the same platform
  const gameDlcs = (game ? ((t.data as { dlcs?: { id: string; name: string; kind: string; cover: string | null; release_date: string | null }[] } | null)?.dlcs ?? []) : []);
  const franHidden: string[] = ((item.overrides as { franchise_hidden?: string[] } | null)?.franchise_hidden ?? []);
  const setFranHidden = (list: string[]) => { const ov = { ...(item.overrides ?? {}), franchise_hidden: list }; setItem({ ...item, overrides: ov } as never); updateItem(item.id, { overrides: ov } as never).catch(() => setError('Couldn’t save. Try again.')); };
  const franchiseGames = book
    ? (bData?.series_books ?? []).map((b) => ({ id: b.id, name: (b.position ? '#' + b.position + ' ' : '') + b.name, kind: 'game', release_date: b.year ? b.year + '-01-01' : null }))
    : (game ? ((t.data as { franchise_games?: { id: string; name: string; kind: string; release_date: string | null }[] } | null)?.franchise_games ?? []) : []);
  const gameParent = game ? ((t.data as { parent?: { id: string; name: string } | null } | null)?.parent ?? null) : null;
  const addDlc = async (igdbId: string) => {
    setAddingDlc(igdbId);
    if (book) {
      try { const bt = await ensureBook('hc:' + igdbId); const newId = await addToBacklog(bt.id, 'books' as never, backlogCount, { format: bItem.format ?? 'paper' } as never); setOwnedGames((o) => ({ ...o, [igdbId]: { id: newId, status: 'backlog', up_next: false } })); onChanged(); }
      catch { setError('Couldn’t add it. Try again in a moment.'); }
      setAddingDlc(null); return;
    }
    try {
      const dt = await ensureGame(igdbId);
      const plat = gItem.platform ?? null;
      const newId = await addToBacklog(dt.id, (plat ? sectionOf(plat, settings.retroPlatforms ?? undefined) : item.section) as never, backlogCount, { platform: plat, coop: false });
      setOwnedGames((o) => ({ ...o, [igdbId]: { id: newId, status: 'backlog', up_next: false } }));
      onChanged();
    } catch { setError('Couldn’t add it. Try again in a moment.'); }
    setAddingDlc(null);
  };
  // DLC entries you've hidden (IGDB sometimes lists odd things) — kept in your own edits, not in the shared data
  const dlcHidden: string[] = ((item.overrides as { dlc_hidden?: string[] } | null)?.dlc_hidden ?? []);
  const setDlcHidden = (list: string[]) => { const ov = { ...(item.overrides ?? {}), dlc_hidden: list }; setItem({ ...item, overrides: ov } as never); updateItem(item.id, { overrides: ov } as never).catch(() => setError('Couldn’t save. Try again.')); };
  /** games: Backlog → Playing on the chosen platform */
  // the platform was picked when adding — start right away; ask only if the game has no platform yet
  const startPlaying = () => (book
    ? guard(async () => { await updateItem(item.id, { status: 'playing', progress: 0, position_at: 0, started_on: localDay(new Date().toISOString()), run_started_at: new Date().toISOString(), up_next: false } as never); })()
    : gItem.platform ? confirmPlatform('start', gItem.platform, !!gItem.coop) : setPlatAsk('start'));
  /** after the platform sheet: start playing now, or plan a replay in Backlog — the platform decides the section */
  const confirmPlatform = (mode: 'start' | 'replay', platform: string, coop: boolean) => guard(async () => {
    const section = sectionOf(platform, settings.retroPlatforms ?? undefined);
    if (mode === 'start') await updateItem(item.id, { status: 'playing', platform, coop, section, progress: 0, started_on: localDay(new Date().toISOString()), run_started_at: new Date().toISOString(), up_next: false } as never);
    else await updateItem(item.id, { status: 'backlog', rewatch: true, platform, coop, section, progress: null, position: backlogCount } as never);
  })();
  /** "Watched": logs the viewing with today's date (it shows up in Watched) and opens My take to rate it */
  const watchedIt = guard(async () => {
    // a rewatch starts from what you thought last time — adjust it if your opinion changed
    await insertLog(item.id, { watched_at: new Date().toISOString(), tier: item.rewatch ? last?.tier ?? null : null, score: item.rewatch ? last?.score ?? null : null, rewatch: !!item.rewatch, ...(game ? { platform: gItem.platform ?? null, coop: !!gItem.coop } : {}), ...(book ? { format: bItem.format ?? null } : {}) } as never);
    await updateItem(item.id, { status: 'done', up_next: false, rewatch: false });
    setJustWatched(true); setTakeOpen(true);
    window.setTimeout(() => document.getElementById('my-take')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  });
  /** Rating a movie you haven't logged yet = "I watched it today" with that rating */
  const rateFirst = (patch: { tier?: string; score?: number }) => guard(async () => {
    await insertLog(item.id, { watched_at: new Date().toISOString(), tier: patch.tier ?? null, score: patch.score ?? null, rewatch: !!item.rewatch });
    await updateItem(item.id, { status: 'done', up_next: false, rewatch: false });
    setJustWatched(true);
  })();
  const markDidntFinish = guard(async () => { await insertLog(item.id, { dropped: true, tier: null, score: null, rewatch: !!item.rewatch, watched_at: new Date().toISOString() }); await updateItem(item.id, { status: 'done', up_next: false, rewatch: false }); });
  const toggleDidntFinish = () => { if (!last) return; const l = last, v = !l.dropped; optimistic(() => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, dropped: v } : x))), () => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, dropped: !v } : x))), () => updateLog(l.id, { dropped: v })); };
  const toggleNext = () => { const v = !item.up_next; optimistic(() => setItem({ ...item, up_next: v }), () => setItem({ ...item, up_next: !v }), () => updateItem(item.id, { up_next: v, position: backlogCount })); };

  const send = async (text: string) => {
    const q = text.trim(); if (!q) return;
    setDraft('');
    setChat((c) => c.concat([{ id: 'u' + Date.now(), role: 'user', content: q, created_at: '' }, { id: 'p' + Date.now(), role: 'model', content: 'Thinking…', created_at: '', pending: true }]));
    try { await askAi(item.id, q); setChat(await loadChat(item.id)); }
    catch (e) { setChat((c) => c.map((m) => (m.pending ? { ...m, pending: false, content: 'Couldn’t get an answer: ' + ((e as Error).message || 'try again in a moment.') } : m))); }
  };

  const data = (item.title.data ?? {}) as any;
  const coll = data.collection as { name: string; parts: CollectionPart[] } | null;
  const cast = ((data.cast ?? []) as { name: string }[]).slice(0, 4).map((c) => c.name);
  const ttbRaw = (data.ttb ?? null) as { quick: number | null; main: number | null; full: number | null } | null;
  const ttbMine = (item.overrides as { ttb_main?: number } | null)?.ttb_main;
  const ttb = ttbMine ? { quick: null, main: ttbMine, full: ttbRaw?.full ?? null } : ttbRaw;
  const hrs = (h: number | null | undefined) => (h ? (h >= 10 ? Math.round(h) : h) + ' h' : '');
  const facts = (game ? [
    ['Developer', (data.developers ?? []).join(', ')], ['Publisher', (data.publishers ?? []).join(', ')],
    ['Platforms', ((data.platforms ?? []) as IgdbPlatform[]).map((p) => p.abbr || p.name).join(' · ')],
    ['Modes', (data.modes ?? []).join(', ')], ['Franchise', data.franchise ?? ''],
    ['Story', hrs(ttb?.main)], ['Main + extras', hrs((ttb as { plus?: number | null } | null)?.plus)], ['Quick', hrs(ttb?.quick)], ['100%', hrs(ttb?.full)],
    ['Times from', ttbMine ? 'you' : (ttbRaw as { source?: string } | null)?.source === 'hltb' ? 'HowLongToBeat' : ttbRaw ? 'IGDB' : '']
  ] : book ? [
    [t.directors.length > 1 ? 'Authors' : 'Author', t.directors.join(', ')], ['Pages', pagesN ? String(pagesN) : ''],
    ['Audiobook', bData?.audio_min ? Math.floor(bData.audio_min / 60) + ' h ' + (bData.audio_min % 60) + ' m' : ''],
    ['Series', bData?.series ? bData.series.name + ((bData.series as { position?: number | null }).position ? ' #' + (bData.series as { position?: number | null }).position : '') : ''],
    ['First published', t.year ? String(t.year) : ''], ['Ratings', bData?.ratings ? String(bData.ratings) : '']
  ] : [
    ['Country', shortCountries(data.countries)], ['Language', (data.language ?? '').toUpperCase()],
    ['Budget', money(data.budget)], ['Box office', money(data.revenue)]
  ]) as [string, string][];
  const factsShown = facts.filter(([, v]) => v);
  // the exact Metacritic page when we know it, otherwise a search
  const mcUrl = ((t.data as { mc_url?: string | null } | null)?.mc_url) || metacriticSearch(t.title, game ? 'game' : 'movie');
  const imdbUrl = t.imdb_id ? 'https://www.imdb.com/title/' + t.imdb_id + '/' : 'https://www.imdb.com/find/?q=' + encodeURIComponent(t.title);
  const tr = tierOf(last?.tier ?? null);
  const origTr = tierOf(last?.tier ?? null);
  const shownScore = planned ? (item.score ?? last?.score ?? null) : score;
  const ov = t.overview ?? '';

  const tile = (kind: 'metascore' | 'imdb_rating') => {
    const v = t[kind]; const c = kind === 'metascore' ? metascoreColor(v, !!game) : imdbColor(v);
    const label = kind === 'metascore' ? 'Metascore' : 'IMDb';
    const sq = <span className="sq" style={{ background: c ?? 'var(--surface2)', color: c ? '#17161A' : 'var(--muted)' }}>{v ?? '—'}</span>;
    return v === null || v === undefined
      ? <button className="tile3" onClick={() => setQuick(kind)} aria-label={'Add ' + label}>{sq}<span className="muted small">Add {label} ✎</span></button>
      : <a className="tile3" href={kind === 'metascore' ? mcUrl : imdbUrl} target="_blank" rel="noopener" aria-label={'Open on ' + (kind === 'metascore' ? 'Metacritic' : 'IMDb')}>{sq}<span className="muted small">{label} {EXT}</span></a>;
  };

  return (
    <div className={'card-screen' + (enterFrom ? ' enter-' + enterFrom : '')} {...swipe}>
      <div ref={swipeEl} className="card-swipe">
      <div className={'hero' + (!t.backdrop_url && t.poster_url ? ' hero-cover' : '')}>
        {t.backdrop_url && <img src={t.backdrop_url} alt="" />}
        {/* no background (books, some games): the cover blurred as the background + the cover itself, like a book on a table */}
        {!t.backdrop_url && t.poster_url && <><img className="hero-blur" src={t.poster_url} alt="" /><img className="hero-book" src={t.poster_url} alt="" /></>}
        <div className="hero-shade" />
        <button className="hero-btn left" aria-label="Back" onClick={onClose}><IconBack /></button>
        <button className="hero-btn right" aria-label="Edit details" onClick={() => setEditOpen(true)}>
          <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
        </button>
        <div className="hero-text">
          <h2>{t.title}</h2>
          <div className="row">{[releaseText(t.release_date, t.year), runtimeText(t.runtime)].filter(Boolean).map((c) => <span key={c} className="hero-chip">{c}</span>)}
            {game && heroPlat && <span className="hero-chip hero-plat"><PlatformIcon k={heroPlat} size={14} /></span>}</div>
          {t.directors.length > 0 && <span className="hero-sub">{t.directors.join(', ')}</span>}
          {last?.dropped && (done || planned) && !origTr && <span className="hero-tier" style={{ background: DROPPED_COLOR, color: '#fff' }}>Dropped</span>}{origTr && (done || planned) && (() => { const tr = origTr; return <span className="hero-tier" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span>; })()}
        </div>
      </div>

      <div className="card-body">
        {error && <p className="error" role="alert">{error}</p>}
        {ov && <Overview text={ov} />}

        <div className="tiles3">
          {book ? (
            <a className="tile3" href={bData?.url ?? '#'} target="_blank" rel="noopener"><span className="ttb-big">{bData?.rating ? (Math.round(bData.rating * 10) / 10).toFixed(1) + '★' : '—'}</span><span className="muted small">Rating{bData?.url ? ' ↗' : ''}</span></a>
          ) : game && t.metascore == null && typeof data.critics === 'number'
            ? <a className="tile3" href={mcUrl} target="_blank" rel="noopener"><span className="sq" style={{ background: metascoreColor(data.critics, true) ?? 'var(--surface2)', color: '#17161A' }}>{data.critics}</span><span className="muted small">Critics ↗</span></a>
            : tile('metascore')}
          {book
            ? <div className="tile3"><span className="ttb-big">{(() => { const h = ttbMine ?? readHours(pagesN, audioN, bItem.format); return h ? hrs(h) : '—'; })()}</span><span className="muted small">{bItem.format === 'audio' ? 'Listening time' : 'Time to read'}</span></div>
            : game
            ? (() => { const hid = (ttbRaw as { hltb_id?: number } | null)?.hltb_id; const inner = <><span className="ttb-big">{ttb?.main ? hrs(ttb.main) : '—'}</span><span className="muted small">Time to beat ↗</span></>;
                return <a className="tile3" href={hid ? 'https://howlongtobeat.com/game/' + hid : 'https://howlongtobeat.com/?q=' + encodeURIComponent(t.title)} target="_blank" rel="noopener">{inner}</a>; })()
            : tile('imdb_rating')}
          {isPlaying
            ? <div className="tile3"><ProgressRing pct={gItem.progress ?? 0} text={(gItem.progress ?? 0) + '%'} /><span className="muted small">Progress</span></div>
            : <button className="tile3" onClick={() => setTakeOpen(true)} aria-label="Change my take">
                <ScoreRing value={shownScore} scale={scale} size={48} fontSize={17} />
                <span className="muted small">My score</span>
              </button>}
        </div>


        {/* State card: where the movie is + what you can do with that state */}
        <section id="my-take" className={'card state-card' + (statusPress.pressed ? ' pressed' : '')} data-state={mState}>
          {(() => {
            const head = <>
              <span className="state-pill" data-state={mState}>{book && mState === 'watched' ? 'Read' : book && mState === 'playing' ? 'Reading' : game && mState === 'watched' ? 'Finished' : MOVIE_STATE_LABEL[mState]}</span>
              <span className="state-title">{mState === 'dropped' ? 'Not in your lists' : mSub}</span>
              {book && bItem.format && <span className="plat-line"><span>{inBacklog ? 'In' : isPlaying ? 'Reading in' : 'Read in'}</span><FormatIcon f={bItem.format} /><span>{formatLabel(bItem.format)}</span></span>}
              {game && (() => { const lp = (last as (typeof last) & { platform?: string | null; coop?: boolean } | null); const pl = (inBacklog || isPlaying ? gItem.platform : lp?.platform ?? gItem.platform); const co = inBacklog || isPlaying ? gItem.coop : lp?.coop;
                return pl ? <span className="plat-line"><span>{inBacklog ? 'On' : isPlaying ? 'Playing on' : 'Played on'}</span><PlatformIcon k={pl} size={16} />{co && <span className="coop-icon" role="img" aria-label="Co-op">{Ico.coop}</span>}</span> : null; })()}
              {inBacklog && t.runtime ? <span className="small muted">{runtimeText(t.runtime)}{item.rewatch ? ' · ' + W.rewatch.toLowerCase() : ''}</span> : null}
            </>;
            // the whole card folds/unfolds from here (also when there's nothing but My take to open)
            return <button className="state-head" aria-expanded={takeOpen} {...statusPress.bind} onClick={() => { setTakeOpen(!takeOpen); setConfirmDrop(false); }}><span className="state-head-text">{head}</span><ChevBtn open={takeOpen} /></button>;
          })()}
          {isPlaying && (
            <div className="prog-row">
              {unitMax ? <>
                {/* the bar moves in percent (smooth); − + move one page (or 5 minutes); the page is kept underneath */}
                <PageScrub label={bItem.format === 'audio' ? 'Minutes listened' : 'Page'} max={unitMax} value={unitPos ?? 0}
                  onInput={(v) => setUnit(v, false)} onCommit={(v) => setUnit(v, true)} />
                <button className="step-btn" aria-label={bItem.format === 'audio' ? 'Back 5 minutes' : 'Previous page'} disabled={(unitPos ?? 0) <= 0} onClick={() => setUnit((unitPos ?? 0) - (bItem.format === 'audio' ? 5 : 1), true)}>−</button>
                <strong className="prog-num">{gItem.progress ?? 0}%</strong>
                <button className="step-btn" aria-label={bItem.format === 'audio' ? 'Forward 5 minutes' : 'Next page'} disabled={(unitPos ?? 0) >= unitMax} onClick={() => setUnit((unitPos ?? 0) + (bItem.format === 'audio' ? 5 : 1), true)}>+</button>
              </> : <>
              <SafeRange className="range" label="Progress" value={gItem.progress ?? 0}
                onInput={(v) => setItem({ ...item, progress: v } as never)}
                onCommit={(v) => { updateItem(item.id, { progress: v } as never).then(onChanged).catch(() => undefined); }} />
              {/* fine-tune by 1% — easier than hitting an exact spot on the slider with a finger */}
              <button className="step-btn" aria-label="Progress minus 1%" disabled={(gItem.progress ?? 0) <= 0} onClick={() => { const v = Math.max(0, (gItem.progress ?? 0) - 1); setItem({ ...item, progress: v } as never); updateItem(item.id, { progress: v } as never).then(onChanged).catch(() => undefined); }}>−</button>
              <strong className="prog-num">{gItem.progress ?? 0}%</strong>
              <button className="step-btn" aria-label="Progress plus 1%" disabled={(gItem.progress ?? 0) >= 100} onClick={() => { const v = Math.min(100, (gItem.progress ?? 0) + 1); setItem({ ...item, progress: v } as never); updateItem(item.id, { progress: v } as never).then(onChanged).catch(() => undefined); }}>+</button>
              </>}
              <button className={'ai-round' + (progAsk ? ' on' : '')} aria-label={progAsk ? 'Close Ask AI' : 'Ask AI where you are'} aria-expanded={progAsk} onClick={() => { setProgAsk(!progAsk); setProgNote(''); }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity=".7" /></svg></button>
            </div>
          )}
          {isPlaying && unitMax ? <span className="muted small">{positionText(gItem.progress ?? 0, pagesN, audioN, bItem.format)}</span> : null}
          {isPlaying && progAsk && (
            <div className="prog-ask">
              <input className="text-input" autoFocus placeholder="Where are you? e.g. “just beat the second boss”" value={progText} onChange={(e) => setProgText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click(); }} />
              <button className="btn primary sm" disabled={!progText.trim() || progBusy} onClick={async () => {
                setProgBusy(true); setProgNote('');
                try { const r = await estimateProgress(item.id, progText.trim()); setItem({ ...item, progress: r.progress } as never); setProgNote(r.progress + '% — ' + r.note); setProgText(''); onChanged(); }
                catch (e) { setProgNote((e as Error).message || 'Couldn’t estimate. Try again.'); }
                setProgBusy(false);
              }}>{progBusy ? '…' : 'Set'}</button>
              {progNote && <span className="muted small wide">{progNote}</span>}
            </div>
          )}
          {isPlaying && (
            <div className="state-actions">
              <button className="btn primary" onClick={watchedIt}>{Ico.check}Finished</button>
            </div>
          )}
          {inBacklog && (
            <div className="state-actions">
              {canWatchNow && (book
                ? <button className="btn primary" onClick={startPlaying}>{Ico.play}Start reading</button>
                : game
                ? <button className="btn primary" onClick={startPlaying}>{Ico.play}Start playing</button>
                : <button className="btn primary" onClick={watchedIt}>{Ico.check}Watched</button>)}
              <button className={'btn' + (item.up_next ? ' pin-on' : '')} aria-pressed={item.up_next} onClick={toggleNext}>{Ico.pin}{item.up_next ? 'Up next ✓' : 'Up next'}</button>
            </div>
          )}

          {/* My take lives in the same card: folded = one line with your rating, unfolded = rating, score, rewatch, date */}
          <div className="take-divider" />
          {!takeOpen ? (
            <button className="take-line" {...statusPress.bind} onClick={() => setTakeOpen(true)} aria-expanded="false">
              <span className="take-line-label">My take</span>
              {!logsReady ? null : !last ? <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{W.notYet}</span> : tr ? <span className="pill" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span> : <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{W.notYet}</span>}
              {rewOn && <span className="rew-icon" role="img" aria-label="Rewatch">{EYE_PLUS}</span>}
              {score !== null && <ScoreRing value={score} scale={scale} size={30} fontSize={11} />}
            </button>
          ) : (
            <div className="take-body">
              <span className="take-line-label">My take</span>
              {last ? <>
                {justWatched && <span className="just-finished">{W.just}</span>}
                <span className="muted small">{'Your rating of the ' + W.viewing + ' on ' + longDate(last.watched_at) + (planned ? ' · a ' + W.rewatch.toLowerCase() + ' is planned' : '')}</span>
                <RatingTiles value={last.tier} onPick={(v) => pickTier(v ?? last.tier ?? '')} />
                <ScoreStepper value={score} scale={scale} onChange={(v) => setScore(v)} />
                <div className="list-group">
                  <ListRow icon={Ico.date} label={W.doneOn}><DateField label={W.doneOn} value={localDay(last.watched_at)} onChange={(d) => setDate(d)} /></ListRow>
                  {game && gameRow('platform', last)}
                  {book && formatRow(last)}
                  {book && lengthRow()}
                  <ListRow icon={game ? <ReplayIcon size={18} /> : Ico.rewatch} label={W.rewatch} onClick={toggleRew}><span className={'switch' + (rewOn ? ' on-green' : '')}><span /></span></ListRow>
                  {game && gameRow('coop', last)}
                </div>
              </> : <>
                {/* Not watched yet: everything is here; rating it logs a viewing with today's date (change it after) */}
                <span className="muted small">{book ? 'Not read yet — rating it marks it as read today.' : game ? 'Not played yet — rating it marks it as finished today.' : 'Not watched yet — rating it marks it as watched today.'}</span>
                <RatingTiles value={null} onPick={(v) => { if (v) rateFirst({ tier: v }); }} />
                <ScoreStepper value={null} scale={scale} onChange={(v) => { if (v !== null) rateFirst({ score: v }); }} />
                <div className="list-group">
                  {game && gameRow('platform', null)}
                  {book && formatRow(null)}
                  {book && lengthRow()}
                  <ListRow icon={game ? <ReplayIcon size={18} /> : Ico.rewatch} label={W.rewatch} onClick={() => { const v = !item.rewatch; optimistic(() => setItem({ ...item, rewatch: v }), () => setItem({ ...item, rewatch: !v }), () => updateItem(item.id, { rewatch: v })); }}><span className={'switch' + (item.rewatch ? ' on-green' : '')}><span /></span></ListRow>
                  {game && gameRow('coop', null)}
                </div>
              </>}
            </div>
          )}
          {takeOpen && (canWatchNow || mState === 'dropped') && (confirmDrop ? (
            <div className="quiet-row"><span className="small grow">{book ? 'Started it but didn’t finish? It goes to Read marked Dropped.' : game ? 'Started it but didn’t finish? It goes to Finished marked Dropped.' : 'Started it but didn’t finish? It goes to Watched marked Dropped.'}</span>
              <button className="link" onClick={() => setConfirmDrop(false)}>Cancel</button><button className="link danger" onClick={() => { setConfirmDrop(false); markDidntFinish(); }}>Drop</button></div>
          ) : (
            <div className="quiet-row">
              {canWatchNow && <button className="link" onClick={() => setPastOpen(true)}>{W.before}</button>}
              {mState === 'dropped' && <button className="link" onClick={guard(async () => { await updateItem(item.id, { status: logs.length ? 'done' : 'backlog', position: backlogCount }); })}>Bring back</button>}
              {canWatchNow && <button className="link danger end" onClick={() => setConfirmDrop(true)}>Drop</button>}
            </div>
          ))}
        </section>


        {/* Lower part (details, collection, viewings, AI) appears in one piece once the full card is loaded */}
        {!full ? <div className="card-wait" aria-live="polite"><span className="spinner" aria-hidden="true" /><span className="sr">Loading</span></div> : (
        <div className="card-lower shown">
        <section className="card stack">
          <span className="h2">Details</span>
          {t.genres.length > 0 && <div className="stack-sm"><span className="muted small">Genres</span><div className="row">{t.genres.map((g) => <span key={g} className="pill" style={{ background: 'var(--surface2)' }}>{g}</span>)}</div></div>}
          {game ? <>
            {/* games: tidy groups instead of a free-form grid */}
            {ttb && (ttb.main || ttb.full) && (
              <div className="stack-sm">
                <span className="muted small">Time to beat{factsShown.find(([k]) => k === 'Times from') ? ' · ' + factsShown.find(([k]) => k === 'Times from')![1] : ''}</span>
                <div className="ttb-row">
                  {([['Story', ttb.main], ['Main + extras', (ttb as { plus?: number | null }).plus], ['Quick', ttb.quick], ['100%', ttb.full]] as [string, number | null | undefined][])
                    .filter(([, v]) => v).map(([k, v]) => <div key={k} className="ttb-cell"><strong>{hrs(v)}</strong><span className="muted tiny">{k}</span></div>)}
                </div>
              </div>
            )}
            {((data.platforms ?? []) as IgdbPlatform[]).length > 0 && (
              <div className="stack-sm"><span className="muted small">Platforms</span>
                <div className="row wrap">{((data.platforms ?? []) as IgdbPlatform[]).map((p) => <span key={p.id} className="pill" style={{ background: 'var(--surface2)' }}>{p.abbr || p.name}</span>)}</div></div>
            )}
            <div className="facts">{factsShown.filter(([k]) => ['Developer', 'Publisher', 'Modes', 'Franchise'].includes(k)).map(([k, v], i, arr) =>
              <div key={k} className={v.length > 26 || (i === arr.length - 1 && arr.length % 2 === 1) ? 'wide' : ''}><span className="muted small">{k}</span><strong>{v}</strong></div>)}</div>
          </> : (
            <div className="facts">{factsShown.map(([k, v], i, arr) =>
              <div key={k} className={v.length > 26 || (i === arr.length - 1 && arr.length % 2 === 1) ? 'wide' : ''}><span className="muted small">{k}</span><strong>{v}</strong></div>)}</div>
          )}
          {!game && cast.length > 0 && <div className="stack-sm top-line"><span className="muted small">Starring</span><strong>{cast.join(', ')}</strong></div>}
        </section>

        {(game || book) && franchiseGames.length > 0 && (
          <section className={'card stack-sm' + (franPress.pressed ? ' pressed' : '')}>
            <button className="take-head" aria-expanded={franOpen} {...franPress.bind} onClick={() => setFranOpen(!franOpen)}>
              <span className="h2 grow">More {book ? (bData?.series ? 'in ' + bData.series.name : 'in the series') : (data.franchise as string | null) ? 'in ' + data.franchise : 'in the series'}</span>
              <span className="count-badge">{franchiseGames.length - franHidden.length}</span><ChevBtn open={franOpen} />
            </button>
            {franOpen && <div className="stack-sm">
              <div className="row nowrap">
                <button className="link" onClick={() => setFranEdit(!franEdit)}>{franEdit ? 'Done' : 'Edit list'}</button>
                {franHidden.length > 0 && <button className="link" onClick={() => setFranShowHidden(!franShowHidden)}>{franShowHidden ? 'Hide hidden' : 'Show hidden (' + franHidden.length + ')'}</button>}
              </div>
              {franchiseGames.filter((d) => franShowHidden || franEdit || !franHidden.includes(d.id)).map((d) => {
                const o = ownedGames[d.id];
                const hidden = franHidden.includes(d.id);
                if (franEdit) return (
                  <div key={d.id} className={'coll-row' + (hidden ? ' faded' : '')}>
                    <span className="coll-title">{d.name} <span className="muted">{d.release_date ? d.release_date.slice(0, 4) : ''}</span></span>
                    <button className="link" onClick={() => setFranHidden(hidden ? franHidden.filter((x) => x !== d.id) : [...franHidden, d.id])}>{hidden ? 'Show' : 'Hide'}</button>
                  </div>
                );
                return (
                  <div key={d.id} className={'coll-row' + (hidden ? ' faded' : '')}>
                    <button className="coll-title" disabled={!o} onClick={() => o && onOpenOther(o.id)}>{d.name}{d.kind !== 'game' && <> <span className="type-pill">{d.kind[0].toUpperCase() + d.kind.slice(1)}</span></>} <span className="muted">{d.release_date ? d.release_date.slice(0, 4) : ''}</span></button>
                    {o ? <span className={'pill status' + (o.status === 'backlog' ? '' : ' accent')}>{o.status === 'backlog' ? (o.up_next ? 'Up next' : 'Backlog') : o.status === 'playing' ? 'Playing' : o.status === 'dropped' ? 'Dropped' : 'Finished'}</span>
                      : <button className="add-btn" aria-label={'Add ' + d.name} disabled={addingDlc === d.id} onClick={() => addDlc(d.id)}>{addingDlc === d.id ? '…' : '+'}</button>}
                  </div>
                );
              })}
            </div>}
          </section>
        )}

        {game && (gameDlcs.length > 0 || gameParent) && (
          <section className={'card stack-sm' + (collPress.pressed ? ' pressed' : '')}>
            <button className="take-head" aria-expanded={collOpen} {...collPress.bind} onClick={() => setCollOpen(!collOpen)}>
              <span className="h2 grow">{gameParent ? 'Main game' : 'DLC & expansions'}</span>
              {!gameParent && <span className="count-badge">{gameDlcs.length - dlcHidden.length}</span>}<ChevBtn open={collOpen} />
            </button>
            {collOpen && <div className="stack-sm">
              {!gameParent && <div className="row nowrap">
                <button className="link" onClick={() => setDlcEdit(!dlcEdit)}>{dlcEdit ? 'Done' : 'Edit list'}</button>
                {dlcHidden.length > 0 && <button className="link" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Hide hidden' : 'Show hidden (' + dlcHidden.length + ')'}</button>}
              </div>}
              {(gameParent ? [{ id: gameParent.id, name: gameParent.name, kind: 'game', cover: null, release_date: null }] : gameDlcs.filter((d) => showHidden || !dlcHidden.includes(d.id))).map((d) => {
                const o = ownedGames[d.id];
                const hidden = dlcHidden.includes(d.id);
                if (dlcEdit && !gameParent) return (
                  <div key={d.id} className={'coll-row' + (hidden ? ' faded' : '')}>
                    <span className="coll-title">{d.name}</span>
                    <button className="link" onClick={() => setDlcHidden(hidden ? dlcHidden.filter((x) => x !== d.id) : [...dlcHidden, d.id])}>{hidden ? 'Show' : 'Hide'}</button>
                  </div>
                );
                return (
                  <div key={d.id} className={'coll-row' + (hidden ? ' faded' : '')}>
                    <button className="coll-title" disabled={!o} onClick={() => o && onOpenOther(o.id)}>{d.name}{d.kind !== 'game' && <> <span className="type-pill">{d.kind === 'dlc' ? 'DLC' : d.kind === 'expansion' ? 'Expansion' : 'Standalone'}</span></>} <span className="muted">{d.release_date ? d.release_date.slice(0, 4) : ''}</span></button>
                    {o ? <span className={'pill status' + (o.status === 'backlog' ? '' : ' accent')}>{o.status === 'backlog' ? (o.up_next ? 'Up next' : 'Backlog') : o.status === 'playing' ? 'Playing' : o.status === 'dropped' ? 'Dropped' : 'Finished'}</span>
                      : <button className="add-btn" aria-label={'Add ' + d.name} disabled={addingDlc === d.id} onClick={() => addDlc(d.id)}>{addingDlc === d.id ? '…' : '+'}</button>}
                  </div>
                );
              })}
            </div>}
          </section>
        )}

        {!game && coll && coll.parts?.length > 1 && (
          <section className={'card stack-sm' + (collPress.pressed ? ' pressed' : '')}>
            <button className="take-head" aria-expanded={collOpen} {...collPress.bind} onClick={() => setCollOpen(!collOpen)}><span className="h2 grow">{coll.name}</span><span className="muted small">{coll.parts.findIndex((p) => p.sourceId === item.title.source_id) + 1} of</span><span className="count-badge">{coll.parts.length}</span><ChevBtn open={collOpen} /></button>
            {collOpen && <div className="stack-sm">{coll.parts.map((p, i) => {
              const o = owned[p.sourceId]; const isCur = p.sourceId === item.title.source_id;
              const st = isCur ? 'This movie' : o ? (o.status === 'backlog' ? (o.up_next ? 'Up next' : 'Backlog') : o.dropped ? 'Dropped' : 'Watched') : '';
              return (
                <div key={p.sourceId} className={'coll-row' + (isCur ? ' cur' : '')}>
                  <span className="coll-n">{i + 1}</span>
                  <button className="coll-title" disabled={!o || isCur} onClick={() => o && onOpenOther(o.id)}>{p.title} <span className="muted">{p.year}</span></button>
                  {!o && <button className="add-btn sm" aria-label={'Add ' + p.title} onClick={() => setAddPart(p)}>+</button>}
                  {(() => {
                    // watched: show your rating — the tier label, the score ring, or both
                    const seen = !isCur && o && (o.status === 'done' || o.status === 'dropped');
                    const tr2 = seen ? tierOf(o!.tier ?? null) : null, sc2 = seen ? o!.score ?? null : null;
                    if (seen && (tr2 || sc2 !== null)) return (
                      <span className="coll-rate">
                        {tr2 && <span className="pill" style={{ background: tr2.color, color: '#17161A' }}>{tr2.label}</span>}
                        {sc2 !== null && <ScoreRing value={sc2} scale={scale} size={28} fontSize={10} />}
                      </span>
                    );
                    return st ? <span className={'pill status' + (st === 'Watched' ? ' accent' : isCur ? ' outline' : '')}>{st}</span> : null;
                  })()}
                </div>
              );
            })}</div>}
          </section>
        )}

        {(logs.length > 0 || item.status === 'backlog' || isPlaying) && (
          <section className="card stack-sm">
            <div className="sec-head wrap"><span className="h2">{W.viewings} <span className="muted small normal">{logs.length}</span></span>
            <div className="act-chips">
              {!(t.release_date && t.release_date > localDay(new Date().toISOString())) && <button className="act-chip" onClick={() => setPastOpen(true)}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>{W.before}</button>}
              {logs.length > 0 && <button className={'act-chip' + (planned ? ' on' : '')} aria-pressed={planned} onClick={logRewatch}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12V9a3 3 0 0 1 3-3h13l-3-3M20 12v3a3 3 0 0 1-3 3H4l3 3" /></svg>{planned ? W.rewatch + ' planned' : W.rewatch}</button>}
            </div></div>
            {/* Top row = where the movie is now, like on shows: a first viewing or a rewatch waiting in Backlog */}
            {isPlaying && (
              <div className="view-row">
                <span className="grow small strong view-line">{book ? 'Now: reading' : 'Now: playing'}{book ? <FormatIcon f={bItem.format} size={13} /> : gItem.platform && <PlatformIcon k={gItem.platform} size={13} />}{gItem.coop && <span className="coop-icon" role="img" aria-label="Co-op">{Ico.coop}</span>}{item.started_on ? <span className="muted normal">since {longDate(item.started_on)}</span> : null}</span>
                <span className="state-pill" data-state="playing">{book ? 'Reading' : 'Playing'}</span>
              </div>
            )}
            {planned && (
              <div className="view-row">
                <span className="grow small strong">{logs.length ? 'Planned: ' + W.rewatch.toLowerCase() : 'Planned: first ' + W.viewing}</span>
                {logs.length > 0 && <span className="rew-icon" role="img" aria-label="Rewatch">{EYE_PLUS}</span>}
                <span className="state-pill" data-state={mState}>{book && mState === 'watched' ? 'Read' : book && mState === 'playing' ? 'Reading' : game && mState === 'watched' ? 'Finished' : MOVIE_STATE_LABEL[mState]}</span>
                {logs.length > 0 && <button className="del-x" aria-label="Cancel the planned rewatch" onClick={logRewatch}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
              </div>
            )}
            {logs.map((l, i) => {
              const x = tierOf(l.tier);
              return delView === l.id ? (
                <div key={l.id} className="view-row"><span className="grow small strong">Delete the {longDate(l.watched_at)} {game ? 'playthrough' : book ? 'reading' : 'viewing'}?</span>
                  <button className="btn sm" onClick={() => setDelView(null)}>Cancel</button>
                  <button className="btn sm danger-fill" onClick={guard(async () => { await deleteLog(l.id); const rem = logs.filter((y) => y.id !== l.id); if (!planned) await updateItem(item.id, { status: rem.length ? (latestLog(rem)!.tier === 'dropped' ? 'dropped' : 'done') : 'backlog' }); setDelView(null); })}>Delete</button></div>
              ) : (
                <div key={l.id} className="view-wrap">
                <div className="view-row">
                  <button className="view-date grow" aria-expanded={editLog === l.id} onClick={() => setEditLog(editLog === l.id ? null : l.id)}>
                    <span className="small strong view-line">{longDate(l.watched_at)}{game && <PlatformIcon k={(l as typeof l & { platform?: string | null }).platform ?? gItem.platform} size={13} />}{book && <FormatIcon f={(l as typeof l & { format?: string | null }).format ?? bItem.format} size={13} />}{game && (l as typeof l & { coop?: boolean }).coop && <span className="coop-icon" role="img" aria-label="Co-op">{Ico.coop}</span>}{i === 0 && !planned && <span className="accent-text normal">Latest</span>}</span>
                    
                    <span className="muted tiny">{editLog === l.id ? 'Done' : 'Edit'}</span>
                  </button>
                  <button className={'rew-toggle' + (l.rewatch ? ' on' : '')} aria-pressed={l.rewatch} aria-label={l.rewatch ? 'Marked as ' + W.rewatch.toLowerCase() + ' — tap to unmark' : 'Mark this ' + W.viewing + ' as a ' + W.rewatch.toLowerCase()} onClick={guard(async () => { await updateLog(l.id, { rewatch: !l.rewatch }); })}>{EYE_PLUS}</button>
                  {l.dropped ? <span className="pill" style={{ background: DROPPED_COLOR, color: '#fff' }}>Dropped</span> : x && <span className="pill" style={{ background: x.color, color: '#17161A' }}>{x.label}</span>}
                  <ScoreRing value={l.score} scale={scale} size={32} fontSize={12} />
                  <button className="del-x" aria-label="Delete this viewing" onClick={() => setDelView(l.id)}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
                </div>
                {editLog === l.id && (
                  <div className="view-edit">
                    <RatingTiles value={l.tier} onPick={(v) => guard(async () => { await updateLog(l.id, { tier: v }); })()} />
                    <div className="score-row">
                      <ScoreStepper size="sm" label="Score" value={l.score} scale={scale} onChange={(st) => { setLogs((ls) => ls.map((y) => (y.id === l.id ? { ...y, score: st } : y))); updateLog(l.id, { score: st }).then(onChanged); }} />
                    </div>
                    <div className="score-row">
                      <label htmlFor={'vd-' + l.id} className="small strong">{W.doneOn}</label>
                      <DateField id={'vd-' + l.id} label={W.doneOn} value={localDay(l.watched_at)} onChange={(d) => guard(async () => { await updateLog(l.id, { watched_at: withLocalDay(l.watched_at, d) }); })()} />
                    </div>
                  </div>
                )}
                </div>
              );
            })}
          </section>
        )}

        <section className={'card ai' + (aiPress.pressed ? ' pressed' : '')}>
          <button className="ai-head" {...aiPress.bind} onClick={() => setAiOpen(!aiOpen)} aria-expanded={aiOpen}>
            <span className="accent-text" aria-hidden="true">✦</span><span className="h2">Ask AI</span>
            <span className="muted small ellipsis grow">{chat.length ? `${chat.filter((m) => m.role === 'user').length} questions · ${chat[chat.length - 1].content}` : (book ? 'Themes, the author, what to read next' : game ? 'Trivia, secrets, what to play next' : 'Trivia, endings, what to watch next')}</span>
            <ChevBtn open={aiOpen} />
          </button>
          {aiOpen && (
            <div className="stack">
              <div className="chat-log" role="log" aria-live="polite">
                {chat.length === 0 && <span className="muted small chat-empty">Ask anything about {t.title}.</span>}
                {chat.slice().reverse().map((m) => <div key={m.id} className={'bubble ' + m.role + (m.pending ? ' pending' : '')}>{m.content}</div>)}
              </div>
              <div className="chips scroll">{(book ? BOOK_CHIPS : game ? GAME_CHIPS : CHIPS).map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div>
              <div className="row nowrap">
                <label htmlFor="ai" className="sr">{book ? 'Ask about this book' : game ? 'Ask about this game' : 'Ask about this movie'}</label>
                <input id="ai" className="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(draft); } }} placeholder={book ? 'Ask about this book…' : game ? 'Ask about this game…' : 'Ask about this movie…'} />
                <button className="send" aria-label="Send" onClick={() => send(draft)}>→</button>
              </div>
            </div>
          )}
        </section>
        </div>)}
      </div>

      </div>
      {addPart && (
        <div className="sheet-wrap">
          <button className="sheet-scrim" aria-label="Close" onClick={() => setAddPart(null)} />
          <div className="sheet action-sheet" role="dialog" aria-label={'Add ' + addPart.title}>
            <div className="action-head"><span className="poster" style={{ width: 40, height: 60 }}>{addPart.posterUrl && <img src={addPart.posterUrl} alt="" />}</span><span className="stack-sm"><strong>{addPart.title}</strong><span className="muted small">{addPart.year}</span></span></div>
            <div className="choice-buttons">
              <button className="choice primary" onClick={() => { const pp = addPart; setAddPart(null); guard(async () => { const tt = await ensureTitle('movie', pp.sourceId); await addToBacklog(tt.id, 'movies', backlogCount); })(); }}>
                <strong>Add to Backlog</strong><span>Goes to the top of your Backlog</span></button>
              <button className="choice" onClick={async () => { const pp = addPart; setAddPart(null);
                try { const tt = await ensureTitle('movie', pp.sourceId); const id = await addToBacklog(tt.id, 'movies', backlogCount); onChanged(); onOpenOther(id, true); } catch { setError('Couldn’t add “' + pp.title + '”.'); } }}>
                <strong>I’ve seen it</strong><span>Add a past viewing: date and rating</span></button>
              <button className="choice ghost" onClick={() => setAddPart(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {platPick && item && <PlatformSheet t={t} retro={settings.retroPlatforms ?? []} title="Platform" confirm="Save" noCoop
        initial={platPick === 'item' ? gItem.platform : ((logs.find((x) => x.id === platPick) as { platform?: string | null } | undefined)?.platform ?? gItem.platform)}
        onCancel={() => setPlatPick(null)}
        onDone={({ platform }) => { const id = platPick; setPlatPick(null); guard(async () => {
          if (id === 'item') await updateItem(item.id, { platform, section: sectionOfKey(platform) } as never);
          else await updateLog(id!, { platform } as never);
        })(); }} />}
      {platAsk && item && <PlatformSheet t={t} retro={settings.retroPlatforms ?? []} title={platAsk === 'start' ? 'Start playing' : 'Replay'} confirm={platAsk === 'start' ? 'Start playing' : 'Add to Backlog'}
        initial={gItem.platform} initialCoop={platAsk === 'start' ? !!gItem.coop : false} onCancel={() => setPlatAsk('')}
        onDone={({ platform, coop }) => { const m = platAsk as 'start' | 'replay'; setPlatAsk(''); confirmPlatform(m, platform, coop); }} />}
      {pastOpen && <PastMovieSheet t={t} scale={scale} game={game} book={book} onCancel={() => setPastOpen(false)}
        onSave={(at, tier, sc) => { setPastOpen(false); guard(async () => {
          await insertLog(item.id, { watched_at: at, tier, score: sc, rewatch: false });
          // a backlog movie you'd already seen counts as watched now (unless it's a planned rewatch)
          if (item.status === 'backlog' && !item.rewatch) await updateItem(item.id, { status: 'done', up_next: false });
        })(); }} />}
      {quick && <QuickNumber media={game ? 'game' : 'movie'} kind={quick} title={t.title} titleRow={item.title} item={item} onClose={() => setQuick(null)} onSaved={async () => { setQuick(null); await changed(); }} />}
      {editOpen && <EditDetails kind={book ? 'book' : game ? 'game' : 'movie'} item={item} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await changed(); }}
        onDeleted={async () => { await removeFromLibrary(item.id); onChanged(); onClose(); }} />}
    </div>
  );
}

export function QuickNumber({ media = 'movie', kind, title, item, onClose, onSaved }: { media?: 'movie' | 'tv' | 'game'; kind: 'metascore' | 'imdb_rating'; title: string; titleRow: Title; item: LibItem; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState('');
  const max = kind === 'metascore' ? 100 : 10, step = kind === 'metascore' ? 1 : 0.1;
  const p = parseNum(v, max, step);
  const c = p.ok && p.n !== null ? (kind === 'metascore' ? metascoreColor(p.n, media === 'game') : imdbColor(+p.n.toFixed(1))) : null;
  const look = kind === 'metascore' ? metacriticSearch(title, media) : 'https://www.imdb.com/find/?q=' + encodeURIComponent(title);
  const save = async () => { if (!p.ok) return; await updateItem(item.id, { overrides: { ...item.overrides, [kind]: p.n === null ? null : kind === 'imdb_rating' ? +p.n.toFixed(1) : p.n } }); onSaved(); };
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label={kind === 'metascore' ? 'Metascore' : 'IMDb rating'}>
        <span className="h2">{kind === 'metascore' ? 'Metascore' : 'IMDb rating'}</span>
        <a className="btn primary wide" href={look} target="_blank" rel="noopener">Look it up on {kind === 'metascore' ? 'Metacritic' : 'IMDb'} ↗</a>
        <span className="sq big" style={{ background: c ?? 'var(--surface2)', color: c ? '#17161A' : 'var(--muted)' }}>{p.ok && p.n !== null ? (kind === 'imdb_rating' ? p.n.toFixed(1) : p.n) : '—'}</span>
        <label htmlFor="qn" className="sr">Value</label>
        <input id="qn" className={'num-input' + (p.ok ? '' : ' bad')} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); }} placeholder={kind === 'metascore' ? '0–100' : '0.0–10'} />
        <span className={'small' + (p.ok ? ' muted' : ' error')}>{p.ok ? 'From 0 to ' + max : 'Enter a number from 0 to ' + max}</span>
        <div className="row nowrap wide"><button className="btn grow" onClick={onClose}>Cancel</button><button className="btn primary grow" onClick={save} disabled={!p.ok}>Save</button></div>
      </div>
    </div>
  );
}

export function EditDetails({ item, onClose, onSaved, onDeleted, kind = 'movie' }: { item: LibItem; onClose: () => void; onSaved: () => void; onDeleted: () => void; kind?: 'movie' | 'tv' | 'game' | 'book' }) {
  const m = merged(item.title, item.overrides);
  const [f, setF] = useState({
    title: m.title, release_date: m.release_date ?? '', runtime: m.runtime ? String(m.runtime) : '', directors: m.directors.join(', '),
    genres: m.genres.join(', '), metascore: m.metascore === null ? '' : String(m.metascore), imdb_rating: m.imdb_rating === null ? '' : String(m.imdb_rating),
    ttb_main: String((item.overrides as { ttb_main?: number } | null)?.ttb_main ?? '')
  });
  const [backdrop, setBackdrop] = useState<string | null>(m.backdrop_url);
  const [poster, setPoster] = useState<string | null>(m.poster_url);
  const [pics, setPics] = useState<null | { backdrops: { thumb: string; full: string }[]; posters: { thumb: string; full: string }[] }>(null);
  const [picker, setPicker] = useState<'' | 'poster' | 'backdrop'>('');
  const [uploading, setUploading] = useState<'' | 'poster' | 'backdrop'>('');
  const tmdbStatus = String((item.title.data as { status?: string } | null)?.status ?? '');
  const [showStatus, setShowStatus] = useState<string>((item.overrides as { status?: string })?.status ?? '');
  const endedNow = ['Ended', 'Canceled'].includes(showStatus || tmdbStatus);
  const isTmdb = item.title.source === 'tmdb' || kind === 'game' || kind === 'book';   // games pick from IGDB / RAWG, books from their editions
  const openPicker = async (k: 'poster' | 'backdrop') => {
    setPicker(picker === k ? '' : k);
    if (pics) return;
    if (kind === 'game') {
      // box art for the platform you play on first (TheGamesDB / SteamGridDB), then IGDB; backgrounds RAWG first, then IGDB
      const g = await gameImages(item.title.id).catch(() => ({ posters: [], backdrops: [] }));
      setPics({ posters: g.posters.map((x) => ({ thumb: x.url, full: x.url, label: x.label })), backdrops: g.backdrops.map((x) => ({ thumb: x.url, full: x.url, label: x.label })) } as never);
    } else if (kind === 'book') {
      // covers of the book's editions (yours first: the original title you searched for is used to find them)
      const b = await bookImages(bookRef(item.title), (item.overrides as { title?: string } | null)?.title ?? item.title.title, item.title.directors?.[0] ?? '', item.title.title).catch(() => ({ posters: [], backdrops: [] }));
      setPics({ posters: b.posters.map((x) => ({ thumb: x.url, full: x.url, label: x.label })), backdrops: [] } as never);
    } else setPics(await loadImages(item.title.source_id, kind));
  };
  const upload = (k: 'poster' | 'backdrop') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setUploading(k); setNote('');
    try { const url = await uploadCover(file, k); if (k === 'poster') setPoster(url); else setBackdrop(url); }
    catch { setNote('Couldn’t upload the image. Try a smaller file.'); }
    setUploading('');
  };
  const imageBlock = (k: 'poster' | 'backdrop') => {
    const cur = k === 'poster' ? poster : backdrop, def = k === 'poster' ? item.title.poster_url : item.title.backdrop_url;
    const set = k === 'poster' ? setPoster : setBackdrop, list = pics ? (k === 'poster' ? pics.posters : pics.backdrops) : null;
    return (
      <div className="stack-sm">
        <span className="muted small strong">{k === 'poster' ? (kind === 'book' ? 'Cover' : 'Poster') : 'Background'}</span>
        <div className={k === 'poster' ? 'pp-preview' : 'bd-preview'}>{cur ? <img src={cur} alt="" /> : <span className="muted small">None</span>}</div>
        <div className="row">
          {isTmdb && <button className="btn sm" aria-expanded={picker === k} onClick={() => openPicker(k)}>{k === 'poster' ? (kind === 'book' ? 'Choose a different cover' : 'Choose a different poster') : 'Choose a different background'}</button>}
          <label className="btn sm file-btn">{uploading === k ? 'Uploading…' : 'Upload from device'}<input type="file" accept="image/*" onChange={upload(k)} /></label>
          {cur !== def && <button className="btn sm" onClick={() => set(def)}>Reset</button>}
        </div>
        {picker === k && (!list
          ? <span className="muted small">Loading images…</span>
          : list.length === 0 ? <span className="muted small">No other images found.</span>
          : <div className={k === 'poster' ? 'pp-grid' : 'bd-grid'}>{list.map((b) => (
              <button key={b.full} className={'bd-pick' + (cur === b.full ? ' on' : '')} aria-pressed={cur === b.full} aria-label={'Use this ' + (k === 'poster' ? 'poster' : 'background')} onClick={() => set(b.full)}><img src={b.thumb} alt="" loading="lazy" /></button>
            ))}</div>)}
      </div>
    );
  };
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const numOrNull = (s: string, max: number) => { const p = parseNum(s, max, max === 100 ? 1 : 0.1); return p.ok ? (p.n === null ? null : max === 10 ? +p.n.toFixed(1) : p.n) : undefined; };

  const save = async () => {
    const ms = numOrNull(f.metascore, 100), im = numOrNull(f.imdb_rating, 10), rt = f.runtime.trim() ? parseInt(f.runtime, 10) : null;
    if (ms === undefined || im === undefined || (f.release_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.release_date))) { setNote('Check the highlighted values: dates as YYYY-MM-DD, Metascore 0–100, IMDb 0–10.'); return; }
    const edited: Overrides = { title: f.title.trim() || item.title.title, release_date: f.release_date || null, runtime: Number.isFinite(rt as number) ? rt : null, directors: list(f.directors), genres: list(f.genres), metascore: ms, imdb_rating: im, backdrop_url: backdrop, poster_url: poster, ...(kind === 'tv' && showStatus ? { status: showStatus } : {}) };
    const keep = (item.overrides ?? {}) as { dlc_hidden?: string[] };
    const ttbN = Number(String(f.ttb_main).replace(',', '.'));
    setBusy(true); await updateItem(item.id, { overrides: { ...diffOverrides(item.title, edited), ...(kind === 'tv' && showStatus && showStatus !== tmdbStatus ? { status: showStatus } : {}),
      ...(kind === 'game' && keep.dlc_hidden ? { dlc_hidden: keep.dlc_hidden } : {}), ...(kind === 'game' && (keep as { franchise_hidden?: string[] }).franchise_hidden ? { franchise_hidden: (keep as { franchise_hidden?: string[] }).franchise_hidden } : {}), ...((kind === 'game' || kind === 'book') && f.ttb_main && ttbN > 0 ? { ttb_main: Math.round(ttbN * 10) / 10 } : {}) } as never }); setBusy(false); onSaved();
  };
  const refresh = async () => { setBusy(true); try { if (kind === 'game') await ensureGame(item.title.source_id, true); else if (kind === 'book') await ensureBook(bookRef(item.title), true); else if (item.title.source === 'imdb') await ensureTitleByImdb(item.title.source_id, true); else await ensureTitle(kind, item.title.source_id, true); setNote('Info updated. Your own edits are kept.'); } catch { setNote('Couldn’t update right now. Try again later.'); } setBusy(false); };
  const clearEdits = async () => { await updateItem(item.id, { overrides: {} }); onSaved(); };

  const field = (k: keyof typeof f, label: string, mode: 'text' | 'numeric' | 'decimal', ph: string) => (
    <div className="stack-sm" key={k}><label htmlFor={'ed-' + k} className="muted small strong">{label}</label>
      <input id={'ed-' + k} className="text-input" inputMode={mode} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <div className="edit-screen" role="dialog" aria-label="Edit details">
      <div className="edit-head"><button className="link" onClick={onClose}>Cancel</button><span className="h2">Edit details</span><button className="btn primary sm" onClick={save} disabled={busy}>Save</button></div>
      <div className="card-body">
        <button className="btn wide" onClick={refresh} disabled={busy}>↻ Update the info</button>
        {note && <p className="muted small">{note}</p>}
        {imageBlock('poster')}
        {kind !== 'book' && imageBlock('backdrop')}
        {kind === 'tv' && (
          <button className="switch-row flat" role="switch" aria-checked={endedNow} onClick={() => setShowStatus(endedNow ? 'Returning Series' : 'Ended')}>
            <span className="stack-sm grow"><strong>The show has ended</strong><span className="muted small">{'TMDB says: ' + (tmdbStatus || 'unknown') + '. Turn on if it’s actually over — it then leaves Caught up / Up to date.'}</span></span>
            <span className={'switch' + (endedNow ? ' on' : '')}><span /></span>
          </button>
        )}
        {field('title', 'Title', 'text', 'Title')}
        {field('release_date', kind === 'tv' ? 'First aired (YYYY-MM-DD)' : 'Release date (YYYY-MM-DD)', 'numeric', '2019-11-22')}
        {kind !== 'game' && kind !== 'book' && field('runtime', kind === 'tv' ? 'Episode runtime, minutes' : 'Runtime, minutes', 'numeric', '103')}
        {field('directors', kind === 'tv' ? 'Created by' : kind === 'game' ? 'Developer' : kind === 'book' ? 'Author' : 'Director', 'text', 'Name, Name')}
        {field('genres', 'Genres', 'text', 'Drama, Comedy')}
        {kind !== 'book' && field('metascore', 'Metascore (0–100)', 'numeric', '64')}
        {kind !== 'game' && kind !== 'book' && field('imdb_rating', 'IMDb (0–10)', 'decimal', '6.8')}
        {kind === 'game' && field('ttb_main' as never, 'Time to beat, hours (your own — leave empty for IGDB)', 'decimal', '35')}
        {kind === 'book' && field('ttb_main' as never, 'Time to read, hours (your own — leave empty to count by pages)', 'decimal', '9')}
        {Object.keys(item.overrides ?? {}).length > 0 && <button className="link left" onClick={clearEdits}>Clear my edits</button>}
        {confirm
          ? <div className="row"><span className="small">Delete “{m.title}” and its viewings?</span><button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button><button className="btn sm danger-fill" onClick={onDeleted}>Delete</button></div>
          : <button className="btn danger" onClick={() => setConfirm(true)}>{kind === 'tv' ? 'Delete show' : kind === 'game' ? 'Delete game' : kind === 'book' ? 'Delete book' : 'Delete movie'}</button>}
      </div>
    </div>
  );
}

/** "Add past": a viewing from before you started tracking. Default date = release date. */
function PastMovieSheet({ t, scale, game, book, onCancel, onSave }: { t: Title; scale: 5 | 10; game?: boolean; book?: boolean; onCancel: () => void; onSave: (at: string, tier: string | null, score: number | null) => void }) {
  const def = t.release_date ?? (t.year ? t.year + '-12-31' : null);
  const [day, setDay] = useState<string>(def ?? localDay(new Date().toISOString()));
  const touched = useRef(false);
  useEffect(() => { if (!touched.current && def) setDay(def); }, [def]);
  const [tier, setTier] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  return (
    <div className="sheet-wrap">
      <button className="sheet-scrim" aria-label="Close" onClick={onCancel} />
      <div className="sheet" role="dialog" aria-label={book ? 'Past reading' : game ? 'Past playthrough' : 'Past viewing'}>
        <div className="stack-sm"><strong className="sheet-title">{t.title}</strong><span className="muted small">{book ? 'A reading from before you started tracking' : game ? 'A playthrough from before you started tracking' : 'A viewing from before you started tracking'}</span></div>
        <div className="score-row"><label htmlFor="past-day" className="strong">{game || book ? 'Finished on' : 'Watched on'}</label><DateField id="past-day" label={game || book ? 'Finished on' : 'Watched on'} value={day} onChange={(d) => { touched.current = true; setDay(d); }} /></div>
        <span className="muted small">{'Don’t remember? Keep the release date — the entry still lands in the right place in ' + (book ? 'Read' : game ? 'Finished' : 'Watched') + '.'}</span>
        <RatingTiles value={tier} onPick={setTier} />
        <ScoreStepper size="sm" label="Score" value={score} scale={scale} onChange={setScore} />
        <div className="row nowrap"><button className="btn grow" onClick={onCancel}>Cancel</button><button className="btn primary grow" onClick={() => onSave(new Date(day + 'T20:00:00').toISOString(), tier, score)}>{book ? 'Add to Read' : game ? 'Add to Finished' : 'Add to Watched'}</button></div>
      </div>
    </div>
  );
}
