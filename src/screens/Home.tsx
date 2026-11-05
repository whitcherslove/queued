import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibItem, LogRow, Mark, SeasonEps } from '../lib/types';
import type { Settings } from '../lib/theme';
import { loadEpisodes, loadEverything, loadMarks, pickTonight } from '../lib/remote';
import { dateParts, merged } from '../lib/logic';
import { epLabel, epRuntime, isEnded, logSeasons, progress, seasonAir, seasonsName, showState, todayIso } from '../lib/tv';
import { applyEpisodeMarks, startWatching } from '../lib/tvActions';
import { TIERS } from '../lib/scores';
import { Poster } from '../components/Rows';
import PlatformIcon from '../components/PlatformIcon';
import FormatIcon from '../components/FormatIcon';
import { readHours } from '../lib/formats';
import { ChevBtn, DuoFriends, DuoTv, IconBack, IconMenu } from '../components/Icons';
const DuoFriendsMini = DuoFriends;
const DuoTvMini = DuoTv;
import ScoreRing from '../components/ScoreRing';
import { Ico } from '../components/Rate';
import { useBackLayer } from '../lib/back';
import { activityFeed, type Activity } from '../lib/friends';
import Avatar from '../components/Avatar';
import MovieCard from './MovieCard';
import ShowCard from './ShowCard';

/** last Home data, so coming back shows it at once while fresh data loads */
let friendsCache: Activity[] | null = null;
let homeCache: { items: LibItem[]; logs: LogRow[]; eps: SeasonEps[]; marks: Mark[] } | null = null;

type Open = { id: string; kind: 'movie' | 'tv' | 'game' | 'book' } | null;
const kindOf = (i: LibItem): 'movie' | 'tv' | 'game' | 'book' => (i.section === 'movies' ? 'movie' : i.section === 'tv' ? 'tv' : i.section === 'books' ? 'book' : 'game');
const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const SEC_COLOR: Record<string, string> = { movies: '#E8714A', tv: '#9A8CF0', console: '#2FB98A', pc: '#4C9BEA', retro: '#E0A43A', books: '#D98B5F' };
const SEC_LABEL: Record<string, string> = { movies: 'Movie', tv: 'Show', console: 'Console', pc: 'PC', retro: 'Retro', books: 'Book' };

/** Home: what's going on now — continue, coming up, recently finished, up next — and a way into Stats. */
export default function Home({ settings, onMenu, onStats, onBack, onFriends }: { settings: Settings; onMenu: () => void; onStats: () => void; onBack?: () => void; onFriends?: () => void }) {
  const [items, setItems] = useState<LibItem[]>(homeCache?.items ?? []);
  const [logs, setLogs] = useState<LogRow[]>(homeCache?.logs ?? []);
  const [eps, setEps] = useState<SeasonEps[]>(homeCache?.eps ?? []);
  const [marks, setMarks] = useState<Mark[]>(homeCache?.marks ?? []);
  const [loading, setLoading] = useState(!homeCache);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useBackLayer(!!open, () => setOpen(null));
  const today = todayIso();

  const load = useCallback(async () => {
    try {
      const all = await loadEverything();
      const its = all.items.map((i) => ({ ...i, title: merged(i.title, i.overrides) }));
      const byId = new Map(its.map((i) => [i.id, i]));
      setItems(its); setLogs(all.logs.map((l) => ({ ...l, library: byId.get(l.library_id) ?? l.library })));
      const watching = its.filter((i) => i.section === 'tv' && i.status === 'playing');
      // never let a failed episode load hide your shows
      const [e, m] = await Promise.all([loadEpisodes(watching.map((i) => i.title_id)).catch(() => []), loadMarks(watching.map((i) => i.id)).catch(() => [])]);
      setEps(e as SeasonEps[]); setMarks(m as Mark[]);
      homeCache = { items: its, logs: all.logs.map((l) => ({ ...l, library: byId.get(l.library_id) ?? l.library })), eps: e as SeasonEps[], marks: m as Mark[] };
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const [fEvents, setFEvents] = useState<Activity[]>(friendsCache ?? []);
  useEffect(() => { activityFeed().then((a) => { const x = a.filter((e) => !e.mine).slice(0, 4); friendsCache = x; setFEvents(x); }).catch(() => undefined); }, []);

  // --- Continue: shows with an episode ready, games in progress
  const STATE_ORDER: Record<string, number> = { progress: 0, newSeason: 1, lastChance: 2, caughtUp: 3 };
  // watched an episode in the last three weeks = you're watching it, whatever its status (e.g. an ended show you're going through)
  const isRecent = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < 21 * 864e5;
  const shows = useMemo(() => items.filter((i) => i.section === 'tv' && i.status !== 'backlog' && i.status !== 'dropped').map((it) => {
    const p = progress(it, it.title, eps.filter((e) => e.title_id === it.title_id), marks.filter((m) => m.library_id === it.id), today);
    const st = showState(it, it.title, logs.filter((l) => l.library.id === it.id) as never, it.status === 'playing' ? p : null, today);
    return { it, p, st };
  }).filter((x) => x.it.status === 'playing' || x.st.state === 'newSeason' || x.st.state === 'lastChance')
    .sort((a, b) => Number(!!b.p?.nextEp) - Number(!!a.p?.nextEp) || STATE_ORDER[a.st.state] - STATE_ORDER[b.st.state] || (b.p?.lastSeen ?? '').localeCompare(a.p?.lastSeen ?? '')), [items, logs, eps, marks, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const games = useMemo(() => items.filter((i) => ['console', 'pc', 'retro', 'books'].includes(i.section) && i.status === 'playing')
    .sort((a, b) => String((b as LibItem & { updated_at?: string }).updated_at ?? b.started_on ?? '').localeCompare(String((a as LibItem & { updated_at?: string }).updated_at ?? a.started_on ?? ''))), [items]);

  // --- Coming up (next 30 days): new episodes, season premieres, releases from Backlog
  const coming = useMemo(() => {
    const limit = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);   // the next three months
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
        out.push({ it, date: it.title.release_date, what: 'Release' });
      }
    });
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 60);
  }, [items, logs, eps, marks, today]);

  const justOut = useMemo(() => {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const out: { it: LibItem; date: string; what: string }[] = [];
    items.forEach((it) => {
      if (it.section === 'tv') {
        if (it.status === 'playing') {
          const p = progress(it, it.title, eps.filter((e) => e.title_id === it.title_id), marks.filter((m) => m.library_id === it.id), today);
          if (p.nextEp?.air_date && p.nextEp.air_date >= since) out.push({ it, date: p.nextEp.air_date, what: 'New episode · ' + epLabel(p.nextEp) });
        } else if (it.status !== 'backlog' && it.status !== 'dropped') {
          const st = showState(it, it.title, logs.filter((l) => l.library.id === it.id), null, today);
          const d = st.state === 'newSeason' && st.seasons.length ? seasonAir(it.title, st.seasons[st.seasons.length - 1]) : null;
          if (d && d >= since && d <= today) out.push({ it, date: d, what: seasonsName([st.seasons[st.seasons.length - 1]]) + ' premiered' });
        }
      } else if (it.status === 'backlog' && it.title.release_date && it.title.release_date >= since && it.title.release_date <= today) {
        out.push({ it, date: it.title.release_date, what: 'Out now' });
      }
    });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [items, logs, eps, marks, today]);
  const outLabel = (date: string) => { const d = Math.round((new Date(today).getTime() - new Date(date).getTime()) / 864e5); return d <= 0 ? 'Out today' : d === 1 ? 'Out yesterday' : 'Out ' + d + ' d ago'; };
  const recent = useMemo(() => logs.slice().sort((a, b) => b.watched_at.localeCompare(a.watched_at)).slice(0, 14), [logs]);
  const upNext = useMemo(() => items.filter((i) => i.status === 'backlog' && i.up_next).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [items]);

  const watchedEp = async (it: LibItem, ep: { season: number; episode: number }) => {
    setBusy(it.id);
    try {
      const mine = logs.filter((l) => l.library.id === it.id).map((l) => ({ id: l.id, watched_at: l.watched_at, tier: l.tier, score: l.score, rewatch: l.rewatch, scope: l.scope, season_from: l.season_from, season_to: l.season_to, seasons: l.seasons }));
      const r = await applyEpisodeMarks(it, it.title, eps.filter((e) => e.title_id === it.title_id), marks, mine as never, [ep], true);
      setMarks(r.marks);
      if (r.finished) await load();
    } finally { setBusy(null); }
  };

  const nowCount = shows.filter((x) => x.it.status === 'playing').length + games.length;
  const dateLine = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const hr = new Date().getHours();
  const greeting = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  // 1) top: the show you're watching now (latest watched first; one with a new episode wins), else the game / book you started last
  const watchingNow = shows.filter((x) => x.it.status === 'playing')
    .sort((a, b) => Number(!!b.p.nextEp) - Number(!!a.p.nextEp) || (b.p.lastSeen ?? '').localeCompare(a.p.lastSeen ?? ''));
  const topShow = watchingNow.find((x) => x.p?.nextEp) ?? watchingNow[0] ?? null;
  const spot = topShow ? { it: topShow.it, show: topShow.p as ReturnType<typeof progress> | null } : games[0] ? { it: games[0], show: null } : null;
  // 2) In progress: everything else you're actually in the middle of (other shows you watch, games, books)
  const showsNow = watchingNow;
  const gamesNow = games.filter((g) => g.section !== 'books');
  const booksNow = games.filter((g) => g.section === 'books');
  /** "4 of 10 left · ~3 h" for a show, "~15 h of 33 h left" for a game, "308 pages left · ~7 h" for a book */
  const extraOf = (it: LibItem, p: ReturnType<typeof progress> | null) => {
    if (p) { const left = Math.max(0, p.aired - p.seen); const hrs = left * (it.title.runtime ?? 30) / 60; return left ? left + (left === 1 ? ' episode left' : ' episodes left') + (hrs >= 1 ? ' · ~' + Math.round(hrs) + ' h' : '') : 'All aired episodes watched'; }
    const g = it as LibItem & { progress?: number | null; format?: string | null; position_at?: number | null };
    const d = it.title.data as { ttb?: { main?: number | null }; pages?: number | null; audio_min?: number | null } | null;
    if (it.section === 'books') {
      const pages = (it.overrides as { pages?: number } | null)?.pages ?? d?.pages ?? null;
      const h = readHours(pages, d?.audio_min, g.format);
      if (pages && g.format !== 'audio') { const at = g.position_at ?? Math.round(((g.progress ?? 0) * pages) / 100); return 'p. ' + at + ' / ' + pages + (h ? ' · ~' + Math.max(0, Math.round(h * (1 - (g.progress ?? 0) / 100))) + ' h left' : ''); }
      return (g.progress ?? 0) + '%' + (h ? ' · ~' + Math.max(0, Math.round(h * (1 - (g.progress ?? 0) / 100))) + ' h left' : '');
    }
    const ttb = ((it.overrides as { ttb_main?: number } | null)?.ttb_main) ?? d?.ttb?.main ?? null;
    return (g.progress ?? 0) + '%' + (ttb ? ' · ~' + Math.max(0, Math.round(ttb * (1 - (g.progress ?? 0) / 100))) + ' h left' : '');
  };
  // 3) Ready to start: shows you've seen before with new seasons out / unwatched seasons of finished shows
  type ReadyRow = { it: LibItem; kind: 'Shows' | 'Movies' | 'Games' | 'Books'; label: string; state: string; text: string; seasons: number[] };
  const ready: ReadyRow[] = useMemo(() => {
    const out: ReadyRow[] = shows.filter((x) => !watchingNow.includes(x) && (x.st.state === 'newSeason' || x.st.state === 'lastChance'))
      .map((x) => ({ it: x.it, kind: 'Shows' as const, label: x.st.state === 'newSeason' ? 'New season' : 'Last chance', state: x.st.state, text: x.st.state === 'newSeason' ? seasonsName(x.st.seasons) + ' is out' : seasonsName(x.st.seasons) + ' left', seasons: x.st.seasons }));
    // out now: in your backlog and already released this year (or within the last ~4 months, so January still shows December's releases)
    const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    items.filter((i) => i.status === 'backlog' && i.section !== 'tv' && i.title.release_date && i.title.release_date <= today && (i.title.release_date.slice(0, 4) === today.slice(0, 4) || i.title.release_date >= since))
      .sort((a, b) => (b.title.release_date ?? '').localeCompare(a.title.release_date ?? ''))
      .forEach((i) => out.push({ it: i, kind: i.section === 'movies' ? 'Movies' : i.section === 'books' ? 'Books' : 'Games', label: 'Out now', state: 'outNow',
        text: 'Released ' + new Date(i.title.release_date!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), seasons: [] }));
    // your Up next goes first (in your order); if something is both pinned and new, it stays once — as Up next
    const kindOfSec = (sec: string): ReadyRow['kind'] => (sec === 'tv' ? 'Shows' : sec === 'movies' ? 'Movies' : sec === 'books' ? 'Books' : 'Games');
    const pinned: ReadyRow[] = items.filter((i) => i.status === 'backlog' && i.up_next).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((i) => { const d = i.title.data as { ttb?: { main?: number | null }; pages?: number | null; seasons?: unknown[] } | null;
        const text = i.section === 'movies' ? (i.title.runtime ? Math.floor(i.title.runtime / 60) + 'h ' + (i.title.runtime % 60) + 'm' : '') : i.section === 'tv' ? (d?.seasons?.length ? d.seasons.length + (d.seasons.length === 1 ? ' season' : ' seasons') : '') : i.section === 'books' ? (d?.pages ? d.pages + ' pages' : '') : (d?.ttb?.main ? Math.round(d.ttb.main) + ' h to beat' : '');
        return { it: i, kind: kindOfSec(i.section), label: 'Up next', state: 'upNext', text, seasons: [] }; });
    return [...pinned, ...out.filter((r) => !pinned.some((p) => p.it.id === r.it.id))];
  }, [shows, watchingNow.length, items, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const [readyOpen, setReadyOpen] = useState(false);
  const [readyKind, setReadyKind] = useState<'All' | ReadyRow['kind']>('All');
  const [readyAll, setReadyAll] = useState(false);
  const [comingAll, setComingAll] = useState(false);
  const [upOpen, setUpOpen] = useState(false);
  const [upAll, setUpAll] = useState(false);
  // folded: one random thing from all of it
  const featured = useMemo(() => { const pinned = ready.filter((r) => r.state === 'upNext'); if (pinned.length) return pinned.slice(0, 2); const rest = ready; return rest.length ? [rest[Math.floor(Math.random() * rest.length)]] : []; }, [ready.length]); // eslint-disable-line react-hooks/exhaustive-deps
  /** "2h 35m" · "33 h to beat" · "432 pages" */
  const lengthOf = (i: LibItem) => {
    const d = i.title.data as { ttb?: { main?: number | null }; pages?: number | null } | null;
    const mine = (i.overrides as { ttb_main?: number; pages?: number } | null) ?? null;
    if (i.section === 'movies') return i.title.runtime ? Math.floor(i.title.runtime / 60) + 'h ' + (i.title.runtime % 60) + 'm' : '';
    if (i.section === 'books') { const pg = mine?.pages ?? d?.pages; return pg ? pg + ' pages' : ''; }
    if (i.section === 'tv') return '';
    const t = mine?.ttb_main ?? d?.ttb?.main; return t ? Math.round(t) + ' h to beat' : '';
  };
  const readyKinds = (['Shows', 'Movies', 'Games', 'Books'] as const).filter((k) => ready.some((r) => r.kind === k));
  const readyList = ready.filter((r) => readyKind === 'All' || r.kind === readyKind);

  // ---- What tonight? — 🎲 random or ✦ AI, from your backlog, with filters that depend on the type
  type Kind = 'Any' | 'Movie' | 'Show' | 'Game' | 'Book';
  const [kind, setKind] = useState<Kind>('Any');
  const [tnOpen, setTnOpen] = useState(false);
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
  /** "today", "yesterday", "3 days ago", "2 weeks ago", "12 Oct" */
  const ago = (iso: string) => {
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const d = Math.round((day(new Date()) - day(new Date(iso))) / 864e5);
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? d + ' days ago' : d < 28 ? Math.floor(d / 7) + (d < 14 ? ' week ago' : ' weeks ago') : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const pickItem = pick ? items.find((i) => i.id === pick.id) ?? null : null;

  const bg = (it: LibItem) => it.title.backdrop_url ?? it.title.poster_url ?? null;
  const progressOf = (it: LibItem, p: ReturnType<typeof progress> | null) => (p ? p.pct : (it as LibItem & { progress?: number | null }).progress ?? 0);
  const subOf = (it: LibItem, p: ReturnType<typeof progress> | null) => {
    const sh = shows.find((x) => x.it.id === it.id);
    if (sh && sh.st.state === 'newSeason') return seasonsName(sh.st.seasons) + ' is out';
    if (sh && sh.st.state === 'lastChance') return seasonsName(sh.st.seasons) + ' left · the show has ended';
    if (sh && !sh.p?.nextEp && (sh.st.state === 'caughtUp' || p)) { const c = coming.find((x) => x.it.id === it.id); return c ? 'Next: ' + c.what + ' · ' + new Date(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : p?.nextFuture?.air_date ? 'Next ep · ' + new Date(p.nextFuture.air_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Caught up · waiting for news'; }
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

        {/* In progress — one panel per kind, each with what's left */}
        {!loading && ([['Shows', showsNow.map((x) => ({ it: x.it, p: x.p as ReturnType<typeof progress> | null }))], ['Games', gamesNow.map((it) => ({ it, p: null }))], ['Books', booksNow.map((it) => ({ it, p: null }))]] as [string, { it: LibItem; p: ReturnType<typeof progress> | null }[]][])
          .filter(([, list]) => list.length > 0).map(([title, list]) => (
          <section key={title} className={'panel kind-' + title.toLowerCase()}>
            <div className="panel-head"><span className="ph-icon">{title === 'Shows' ? <DuoTvMini /> : title === 'Books' ? <FormatIcon f="paper" /> : Ico.play}</span><span>{title === 'Shows' ? 'Watching' : title === 'Games' ? 'Playing' : 'Reading'}</span><span className="count-badge">{list.length}</span></div>
            {list.slice(0, 1).map(({ it, p }) => (
              <div key={it.id} className="spot in-panel" role="button" tabIndex={0} onClick={() => setOpen({ id: it.id, kind: kindOf(it) })} onKeyDown={(e) => { if (e.key === 'Enter') setOpen({ id: it.id, kind: kindOf(it) }); }}>
                {bg(it) && <img className={it.title.backdrop_url ? '' : 'blur'} src={bg(it)!} alt="" />}
                {!it.title.backdrop_url && it.title.poster_url && <img className="spot-book" src={it.title.poster_url} alt="" />}
                <div className="spot-shade" />
                <div className="spot-text">
                  <strong className="spot-title">{it.title.title}</strong>
                  <span className="spot-sub">{p ? subOf(it, p) : <>{it.section === 'books' ? <FormatIcon f={(it as LibItem & { format?: string | null }).format} /> : <PlatformIcon k={(it as LibItem & { platform?: string | null }).platform} size={12} />} {extraOf(it, null).split(' · ').slice(1).join(' · ')}</>}</span>
                  {p && <span className="spot-sub dim">{extraOf(it, p)}</span>}
                  <div className="spot-row">
                    <span className="spot-bar"><i style={{ width: progressOf(it, p) + '%' }} /></span><strong className="spot-pct">{progressOf(it, p)}%</strong>
                    {p?.nextEp && <button className="btn primary spot-watched" disabled={busy === it.id} onClick={(e) => { e.stopPropagation(); watchedEp(it, { season: p.nextEp!.season, episode: p.nextEp!.episode }); }}>{busy === it.id ? '…' : <>{Ico.check}Watched</>}</button>}
                  </div>
                </div>
              </div>
            ))}
            {list.slice(1).map(({ it, p }) => (
              <button key={it.id} className="ticket" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })}>
                <span className="ticket-img">{bg(it) ? <img className={it.title.backdrop_url ? '' : 'blur'} src={bg(it)!} alt="" /> : null}</span>
                <span className="ticket-body">
                  <span className="row-title ellipsis">{it.title.title}</span>
                  <span className="ticket-meta">
                    {it.section === 'books' ? <FormatIcon f={(it as LibItem & { format?: string | null }).format} /> : ['console', 'pc', 'retro'].includes(it.section) ? <PlatformIcon k={(it as LibItem & { platform?: string | null }).platform} size={11} /> : null}
                    {p ? <span className="ellipsis">{p.nextEp ? 'Next: ' + epLabel(p.nextEp) + (p.nextEp.name ? ' — ' + p.nextEp.name : '') : subOf(it, p)}</span>
                      : (() => { const rest = extraOf(it, null).split(' · ').slice(1); return rest.length > 0 ? <span className="left-big">{rest.join(' · ')}</span> : null; })()}
                  </span>
                  {p && <span className="muted tiny ellipsis">{extraOf(it, p)}</span>}
                  <span className="bar-row"><span className="mini-bar wide"><span style={{ width: progressOf(it, p) + '%' }} /></span><strong className="tiny">{progressOf(it, p)}%</strong></span>
                </span>
                {p?.nextEp && <span className="ticket-act" role="button" tabIndex={0} aria-label="Watched" onClick={(e) => { e.stopPropagation(); watchedEp(it, { season: p.nextEp!.season, episode: p.nextEp!.episode }); }}>{busy === it.id ? '…' : Ico.check}</span>}
              </button>
            ))}
          </section>
        ))}

        {/* What tonight? */}
        {!loading && (
          <section className="tonight">
            <button className="tn-head" aria-expanded={tnOpen} onClick={() => setTnOpen(!tnOpen)}><span className="tonight-kicker">✦ What tonight?</span><ChevBtn open={tnOpen} size={28} /></button>
            <div className="seg">{(['Any', 'Movie', 'Show', 'Game', 'Book'] as Kind[]).map((k) => <button key={k} className={tnOpen && kind === k ? 'on' : ''} onClick={() => { setKind(k); setF({}); setPick(null); seen.current = []; setTnOpen(true); }}>{k}</button>)}</div>
            {tnOpen && <>
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
            </>}
          </section>
        )}

        {/* Ready to start: new seasons, last chances, and what just came out from your backlog — folded */}
        {!loading && ready.length > 0 && <section className="panel ready-panel">
          <button className="panel-head as-btn" aria-expanded={readyOpen} onClick={() => setReadyOpen(!readyOpen)}>
            <span className="ph-icon">{Ico.seasons}</span><span>Up next & ready</span><span className="count-badge">{ready.length}</span><ChevBtn open={readyOpen} size={28} />
          </button>
          {readyOpen && readyKinds.length > 0 && <div className="seg">{(['All', ...readyKinds] as ('All' | ReadyRow['kind'])[]).map((k) => <button key={k} className={readyKind === k ? 'on' : ''} onClick={() => { setReadyKind(k); setReadyAll(false); }}>{k}{k !== 'All' ? ' ' + ready.filter((r) => r.kind === k).length : ''}</button>)}</div>}
          {(readyOpen ? (readyAll ? readyList : readyList.slice(0, 6)) : featured).map((x) => (
            <button key={x.it.id} className="ticket" onClick={() => setOpen({ id: x.it.id, kind: kindOf(x.it) })}>
              <span className="ticket-img">{bg(x.it) ? <img className={x.it.title.backdrop_url ? '' : 'blur'} src={bg(x.it)!} alt="" /> : null}</span>
              <span className="ticket-body">
                <span className="row-title ellipsis">{x.it.title.title}</span>
                <span className="ticket-meta">{justOut.some((j) => j.it.id === x.it.id) && <span className="new-dot">New</span>}<span className="state-pill sm" data-state={x.state}>{x.label}</span><span className="ellipsis">{[x.kind.slice(0, -1), x.state === 'upNext' ? '' : x.text, lengthOf(x.it) || (x.state === 'upNext' ? x.text : '')].filter(Boolean).join(' · ')}</span></span>
              </span>
            </button>
          ))}
          {!readyOpen && ready.length > featured.length && <button className="link left" onClick={() => setReadyOpen(true)}>and {ready.length - featured.length} more</button>}
          {readyOpen && !readyAll && readyList.length > 6 && <button className="link left" onClick={() => setReadyAll(true)}>Show all {readyList.length}</button>}
        </section>}

        {/* Recently finished: picture on top, the cover over it, your rating and when */}
        {!loading && recent.length > 0 && <section className="panel">
          <div className="panel-head"><span className="ph-icon">{Ico.check}</span><span>Recently finished</span></div>
          <div className="home-strip">
            {recent.map((l) => { const tr = tierOf(l.tier); const it = l.library; const ss = it.section === 'tv' ? seasonsName(logSeasons(l)) : ''; return (
              <button key={l.id} className="fin-card" onClick={() => setOpen({ id: it.id, kind: kindOf(it) })} aria-label={it.title.title}>
                <span className="fin-img">{bg(it) && <img className={it.title.backdrop_url ? '' : 'blur'} src={bg(it)!} alt="" />}<span className="fin-shade" /><span className="fin-when">{ago(l.watched_at)}</span></span>
                <span className="fin-cover"><Poster t={it.title} w={52} h={76} /></span>
                <span className="fin-body">
                  <span className="row-title ellipsis">{it.title.title}</span>
                  <span className="muted tiny ellipsis">{[SEC_LABEL[it.section], ss].filter(Boolean).join(' · ')}</span>
                  <span className="fin-rate">{tr ? <span className="tier-under" style={{ background: tr.color }}>{tr.label}</span> : <span className="tier-under none">No rating</span>}{l.score != null && <ScoreRing value={l.score} scale={settings.scale ?? 5} size={26} fontSize={10} />}</span>
                </span>
              </button>
            ); })}
          </div>
        </section>}

        {/* Friends: the latest few events */}
        {!loading && fEvents.length > 0 && <section className="panel">
          <div className="panel-head"><span className="ph-icon"><DuoFriendsMini /></span><span>Friends</span>{onFriends && <button className="link" onClick={onFriends}>See all ›</button>}</div>
          {fEvents.map((a) => { const tr = tierOf(a.tier); const who = a.name || (a.handle ? '@' + a.handle : 'Friend');
            const verb = a.kind === 'started' ? (a.section === 'books' ? 'started reading' : a.section === 'tv' || a.section === 'movies' ? 'started watching' : 'started playing')
              : a.kind === 'dropped' ? 'dropped' : a.kind === 'season_rated' ? 'rated ' + (a.seasons_label ?? 'a season') + ' of' : a.kind === 'show_rated' ? 'rated' : a.section === 'books' ? 'finished reading' : a.section === 'movies' ? 'watched' : 'finished';
            return (
              <button key={a.id} className="fr-row" onClick={onFriends}>
                <Avatar url={a.avatar_url} email={a.handle ?? who} size={34} />
                <span className="grow stack-0"><span className="fr-line"><strong>{who}</strong> {verb} <strong>{a.title}</strong></span>
                  <span className="fr-meta">{tr && <span className="tier-under" style={{ background: tr.color }}>{tr.label}</span>}<span className="muted tiny">{ago(a.created_at)}</span></span></span>
                <Poster t={{ title: a.title, poster_url: a.poster_url }} w={34} h={50} />
              </button>
            ); })}
        </section>}

        {/* Coming up: what comes out in the next three months — shows, movies, games, books from your lists */}
        {!loading && (coming.length > 0 || justOut.length > 0) && <section className="panel">
          <div className="panel-head"><span className="ph-icon">{Ico.date}</span><span>Coming up</span><span className="count-badge">{coming.length}</span></div>
          {justOut.length > 0 && <>
            <span className="cu-month just">Just out</span>
            {justOut.map((c) => (
              <button key={'j' + c.it.id + c.date} className="cu-row just" onClick={() => setOpen({ id: c.it.id, kind: kindOf(c.it) })}>
                <span className="cu-date out"><b>{new Date(c.date).getDate()}</b><span>{new Date(c.date).toLocaleDateString('en-GB', { month: 'short' })}</span></span>
                <Poster t={c.it.title} w={34} h={50} />
                <span className="grow"><span className="row-title ellipsis">{c.it.title.title}</span><span className="muted small ellipsis">{SEC_LABEL[c.it.section]} · {c.what}</span></span>
                <span className="cu-in out">{outLabel(c.date)}</span>
              </button>
            ))}
            {coming.length > 0 && <span className="cu-month">Next</span>}
          </>}
          {(comingAll ? coming : coming.slice(0, 5)).map((c, i, arr) => { const d = new Date(c.date); const mon = d.toLocaleDateString('en-GB', { month: 'long' });
            const prevMon = i > 0 ? new Date(arr[i - 1].date).toLocaleDateString('en-GB', { month: 'long' }) : '';
            const days = Math.round((new Date(c.date).getTime() - new Date(today).getTime()) / 864e5);
            return (<div key={c.it.id + c.date} className="stack-0">
              {mon !== prevMon && i > 0 && <span className="cu-month">{mon}</span>}
              <button className="cu-row" onClick={() => setOpen({ id: c.it.id, kind: kindOf(c.it) })}>
                <span className="cu-date"><b>{d.getDate()}</b><span>{d.toLocaleDateString('en-GB', { month: 'short' })}</span></span>
                <Poster t={c.it.title} w={34} h={50} />
                <span className="grow"><span className="row-title ellipsis">{c.it.title.title}</span>
                  <span className="muted small ellipsis">{SEC_LABEL[c.it.section]} · {c.what}</span></span>
                <span className={'cu-in' + (days <= 7 ? ' soon' : '')}>{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'in ' + days + ' d'}</span>
              </button>
            </div>); })}
          {coming.length > 5 && <button className="link left" onClick={() => setComingAll(!comingAll)}>{comingAll ? 'Show less' : 'Show all ' + coming.length}</button>}
        </section>}



        {!loading && !nowCount && !coming.length && !recent.length && !upNext.length && <div className="empty">Add a movie, a show, a game or a book — your activity shows up here.</div>}
      </main>

      {open?.kind === 'tv' && <ShowCard key={open.id} itemId={open.id} initial={items.find((i) => i.id === open.id) ?? null} settings={settings} topPos={0}
        onClose={() => setOpen(null)} onChanged={load} />}
      {open && open.kind !== 'tv' && <MovieCard key={open.id} game={open.kind === 'game'} book={open.kind === 'book'} itemId={open.id} initial={items.find((i) => i.id === open.id) ?? null} settings={settings} backlogCount={0}
        onClose={() => setOpen(null)} onChanged={load} onOpenOther={(id) => { const it = items.find((i) => i.id === id); setOpen({ id, kind: it ? kindOf(it) : open.kind }); }} />}
    </div>
  );
}
