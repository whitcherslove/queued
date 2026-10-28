import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMsg, ItemLog, LibItem, Mark, SeasonEps, SeasonRating } from '../lib/types';
import type { Settings } from '../lib/theme';
import { TIERS, displayScore, imdbColor, metascoreColor, myScoreColor } from '../lib/scores';
import { latestLog, longDate, merged, releaseText } from '../lib/logic';
import {
  askAi, deleteLog, insertLog, loadChat, loadEpisodes, loadItem, loadItemLogs, loadMarks, loadSeasonRatings,
  refreshEpisodes, removeFromLibrary, saveSeasonRating, setMarks, updateItem, updateLog
} from '../lib/remote';
import { epLabel, isEnded, logScope, logSeasons, newSeasons, planOf, progress, scopeLabel, seasonAir, seasonsName, seasonsOf, showYears, todayIso } from '../lib/tv';
import { applyEpisodeMarks } from '../lib/tvActions';
import ScoreRing from '../components/ScoreRing';
import ScoreSlider from '../components/ScoreSlider';
import ScopeSheet from '../components/ScopeSheet';
import { IconBack } from '../components/Icons';
import { useBackLayer } from '../lib/back';
import { useLongPress } from '../lib/longpress';
import { EditDetails, QuickNumber, EYE_PLUS_ICON as EYE_PLUS, EXT_ICON as EXT, tierOfId as tierOf } from './MovieCard';

interface Props {
  itemId: string; initial?: LibItem | null; initialLogs?: ItemLog[] | null; settings: Settings; openTake?: boolean;
  onPrev?: (() => void) | null; onNext?: (() => void) | null; enterFrom?: 'left' | 'right' | null;
  onClose: () => void; onChanged: () => void; topPos: number;
}
const CHIPS = ['Similar shows', 'Is it worth continuing?', 'Recap the last season', 'Fun facts'];
const scopeShort = (l: { scope?: string; season_from?: number | null; season_to?: number | null; seasons?: number[] | null }) => seasonsName(logSeasons(l));

function ProgressRing({ pct, text, size = 48 }: { pct: number; text: string; size?: number }) {
  const C = 138.23;
  return (
    <span className="ring" role="img" aria-label={'Progress ' + text} style={{ width: size, height: size }}>
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 26 26)" />
        <text x="26" y="26.5" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="13">{pct}%</text>
      </svg>
    </span>
  );
}

export default function ShowCard({ itemId, initial, initialLogs, settings, openTake, onPrev, onNext, enterFrom, onClose, onChanged, topPos }: Props) {
  const [item, setItem] = useState<LibItem | null>(initial ?? null);
  const [logs, setLogs] = useState<ItemLog[]>(initialLogs ?? []);
  const [eps, setEps] = useState<SeasonEps[]>([]);
  const [marks, setMarksState] = useState<Mark[]>([]);
  const [ratings, setRatings] = useState<SeasonRating[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [ready, setReady] = useState(false);
  const [takeOpen, setTakeOpen] = useState(!!openTake);
  const [openS, setOpenS] = useState<Record<number, boolean>>({});
  const [aiOpen, setAiOpen] = useState(false);
  const [ovOpen, setOvOpen] = useState(false);
  const [quick, setQuick] = useState<null | 'metascore' | 'imdb_rating'>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [scopeFor, setScopeFor] = useState<'' | 'plan' | 'rewatch' | 'more'>('');
  const [delView, setDelView] = useState<string | null>(null);
  const [editLog, setEditLog] = useState<string | null>(null);
  const [scopeLog, setScopeLog] = useState<ItemLog | null>(null);
  const [preview, setPreview] = useState<number | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const scale = settings.scale;
  useBackLayer(editOpen, () => setEditOpen(false));
  useBackLayer(!!quick, () => setQuick(null));
  useBackLayer(!!scopeFor, () => setScopeFor(''));
  useBackLayer(!!scopeLog, () => setScopeLog(null));

  // swipe to the previous / next show (DOM transforms while dragging, like the movie card)
  const swipeEl = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const swRef = useRef<{ x: number; y: number; mode: '' | 'h' | 'v'; dx: number; vx: number; lx: number; lt: number } | null>(null);
  const lastSwipe = useRef(0);
  const paint = (dx: number) => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => { const el = swipeEl.current; if (!el) return; el.style.transition = 'none'; el.style.transform = `translate3d(${dx}px,0,0)`; el.style.opacity = String(1 - Math.min(Math.abs(dx) / 800, 0.25)); }); };
  const snapBack = () => { cancelAnimationFrame(raf.current); const el = swipeEl.current; if (!el) return; el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease'; el.style.transform = ''; el.style.opacity = ''; };
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => { if (e.button > 0 || (e.target as HTMLElement).closest('input, textarea, .chips.scroll, .chat-log, .no-swipe, .ep-row')) return; swRef.current = { x: e.clientX, y: e.clientY, mode: '', dx: 0, vx: 0, lx: e.clientX, lt: e.timeStamp }; },
    onPointerMove: (e: React.PointerEvent) => {
      const st = swRef.current; if (!st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.mode) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { st.mode = 'h'; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ } } else if (Math.abs(dy) > 14) { st.mode = 'v'; return; } }
      if (st.mode === 'h') { const dt = e.timeStamp - st.lt; if (dt > 0) st.vx = 0.7 * st.vx + 0.3 * ((e.clientX - st.lx) / dt); st.lx = e.clientX; st.lt = e.timeStamp; const edge = (dx > 0 && !onPrev) || (dx < 0 && !onNext); st.dx = edge ? dx * 0.2 : dx; paint(st.dx); }
    },
    onPointerUp: () => {
      const st = swRef.current; swRef.current = null; if (!st || st.mode !== 'h') return;
      lastSwipe.current = Date.now();
      const dx = st.dx, flick = Math.abs(st.vx) > 0.4 && Math.abs(dx) > 25;
      if ((dx < -60 || (flick && st.vx < 0)) && onNext) onNext(); else if ((dx > 60 || (flick && st.vx > 0)) && onPrev) onPrev(); else snapBack();
    },
    onPointerCancel: () => { if (swRef.current?.mode === 'h') snapBack(); swRef.current = null; },
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - lastSwipe.current < 350) { e.preventDefault(); e.stopPropagation(); } }
  };

  const reload = useCallback(async () => {
    const it = await loadItem(itemId);
    const [lg, ch, ep, mk, rt] = await Promise.all([loadItemLogs(itemId), loadChat(itemId), loadEpisodes([it.title_id]), loadMarks([itemId]), loadSeasonRatings(itemId)]);
    setItem(it); setLogs(lg); setChat(ch); setEps(ep); setMarksState(mk); setRatings(rt); setReady(true);
    return { it, ep };
  }, [itemId]);
  useEffect(() => {
    reload().then(async ({ it, ep }) => {
      const need = ep.length < seasonsOf(it.title).length || !isEnded(it.title);
      if (need) { await refreshEpisodes([it.title.source_id]); await reload(); onChanged(); }
    }).catch(() => setError('Couldn’t load this show.'));
  }, [reload]);

  const t = useMemo(() => (item ? merged(item.title, item.overrides) : null), [item]);
  const epHandler = useRef<(k: string) => void>(() => {});
  const epPress = useLongPress((k) => epHandler.current(k));
  if (!item || !t) return <div className="card-screen"><div className="card-loading">{error || 'Loading…'}</div></div>;

  const p = progress(item, t, eps, marks);
  const status = item.status, isBack = status === 'backlog', isPlaying = status === 'playing', isDone = status === 'done' || status === 'dropped';
  const last = latestLog(logs);
  const since = item.run_started_at ?? '';
  const runLog = logs.find((l) => since && l.watched_at >= since) ?? null;
  const currentLog = isDone ? (runLog ?? last) : null;
  const planned = (isBack || isPlaying) && logs.length > 0;
  const tr = currentLog ? tierOf(currentLog.tier) : null;
  const origTr = tierOf(last?.tier ?? null);
  const score = currentLog ? currentLog.score : item.score;
  const tileScore = currentLog ? currentLog.score : (item.score ?? last?.score ?? null);
  const seasons = seasonsOf(t);
  const plan = planOf(item);
  const planLabel = scopeLabel(plan, t);
  // An episode shows as watched whenever it's marked. Only during a rewatch, marks from before it started look faded ("seen before").
  const rewatching = !!item.rewatch && (isBack || isPlaying);
  const inPlanSeason = (n: number) => !plan || plan.includes(n);
  const markOf = (s: number, e: number) => marks.find((m) => m.season === s && m.episode === e);
  const runSeen = (s: number, e: number) => { const m = markOf(s, e); return !!m && (!rewatching || !inPlanSeason(s) || m.watched_at >= since); };
  const seenBefore = (s: number, e: number) => { const m = markOf(s, e); return !!m && !runSeen(s, e); };
  const today = todayIso();

  const changed = async () => { await reload(); onChanged(); };
  const guard = (fn: () => Promise<void>) => async () => { try { setError(''); await fn(); await changed(); } catch { setError('Something went wrong. Try again.'); } };

  const applyMarks = (list: { season: number; episode: number }[], on: boolean) => guard(async () => {
    const r = await applyEpisodeMarks(item, t, eps, marks, logs, list, on);
    setMarksState(r.marks);
    if (r.finished) setTakeOpen(true);
  })();
  const airedUpTo = (s: number, e: number) => {
    const out: { season: number; episode: number }[] = [];
    seasons.filter((x) => x.n <= s && (!plan || plan.includes(x.n))).forEach((x) => {
      (eps.find((y) => y.season === x.n)?.episodes ?? []).forEach((ep) => { if ((x.n < s || ep.n <= e) && ep.air_date && ep.air_date <= today && !runSeen(x.n, ep.n)) out.push({ season: x.n, episode: ep.n }); });
    });
    return out;
  };
  epHandler.current = (key) => { const [s, e] = key.split(':').map(Number); applyMarks(airedUpTo(s, e), true); };

  const pickTier = (id: string) => guard(async () => {
    if (currentLog) {
      if (currentLog.tier === id) { await updateLog(currentLog.id, { tier: null }); return; }
      await updateLog(currentLog.id, { tier: id });
      await updateItem(item.id, { status: id === 'dropped' ? 'dropped' : 'done' });
      return;
    }
    await insertLog(item.id, { ...logScope(plan), watched_at: new Date().toISOString(), tier: id, score: item.score, rewatch: !!item.rewatch } as Partial<ItemLog>);
    await updateItem(item.id, { status: id === 'dropped' ? 'dropped' : 'done', up_next: false, rewatch: false, score: null });
  })();
  const setScore = (v: number | null) => guard(async () => { setPreview(undefined); if (currentLog) await updateLog(currentLog.id, { score: v }); else await updateItem(item.id, { score: v }); })();
  const rewOn = currentLog ? currentLog.rewatch : !!item.rewatch;
  const optimistic = (apply: () => void, revert: () => void, save: () => Promise<void>) => {
    apply();
    save().then(() => onChanged()).catch(() => { revert(); setError('Couldn’t save. Try again.'); });
  };
  const toggleRew = () => {
    if (currentLog) { const l = currentLog, v = !l.rewatch; optimistic(() => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, rewatch: v } : x))), () => setLogs((ls) => ls.map((x) => (x.id === l.id ? { ...x, rewatch: !v } : x))), () => updateLog(l.id, { rewatch: v })); }
    else { const v = !item.rewatch; optimistic(() => setItem({ ...item, rewatch: v }), () => setItem({ ...item, rewatch: !v }), () => updateItem(item.id, { rewatch: v })); }
  };
  const toggleNext = () => { const v = !item.up_next; optimistic(() => setItem({ ...item, up_next: v }), () => setItem({ ...item, up_next: !v }), () => updateItem(item.id, { up_next: v, position: topPos })); };
  const cancelPlan = guard(async () => { await updateItem(item.id, { status: last?.tier === 'dropped' ? 'dropped' : 'done', rewatch: false, up_next: false, score: null }); });
  const doneScope = (list: number[] | null) => guard(async () => {
    const kind = scopeFor; setScopeFor('');
    const planPatch = { plan_seasons: list, plan_from: list ? list[0] : null, plan_to: list ? list[list.length - 1] : null };
    if (kind === 'plan') await updateItem(item.id, planPatch);
    else await updateItem(item.id, { status: 'backlog', ...planPatch, run_started_at: new Date().toISOString(), rewatch: kind === 'rewatch', score: null, position: topPos, up_next: false });
    setTakeOpen(false);
  })();
  const send = async (text: string) => {
    const q = text.trim(); if (!q) return; setDraft('');
    setChat((c) => c.concat([{ id: 'u' + Date.now(), role: 'user', content: q, created_at: '' }, { id: 'p' + Date.now(), role: 'model', content: 'Thinking…', created_at: '', pending: true }]));
    try { await askAi(item.id, q); setChat(await loadChat(item.id)); } catch { setChat((c) => c.map((m) => (m.pending ? { ...m, pending: false, content: 'Couldn’t get an answer right now. Try again in a moment.' } : m))); }
  };

  const data = (item.title.data ?? {}) as any;
  const facts = ([['Network', data.network ?? ''], ['Status', data.status ?? ''], ['Seasons', String(seasons.length)], ['Episodes', data.number_of_episodes ? String(data.number_of_episodes) : ''],
    ['Episode runtime', t.runtime ? t.runtime + ' min' : ''], ['Created by', t.directors.join(', ')], ['Country', (data.countries ?? []).join(', ')], ['Language', (data.language ?? '').toUpperCase()]] as [string, string][]).filter(([, v]) => v);
  const cast = ((data.cast ?? []) as { name: string }[]).slice(0, 4).map((c) => c.name);
  const imdbUrl = t.imdb_id ? 'https://www.imdb.com/title/' + t.imdb_id + '/' : 'https://www.imdb.com/find/?q=' + encodeURIComponent(t.title);
  const mcUrl = 'https://www.metacritic.com/search/' + encodeURIComponent(t.title) + '/?category=1';
  const tileMC = (kind: 'metascore' | 'imdb_rating') => {
    const v = t[kind]; const c = kind === 'metascore' ? metascoreColor(v) : imdbColor(v); const label = kind === 'metascore' ? 'Metascore' : 'IMDb';
    const sq = <span className="sq" style={{ background: c ?? 'var(--surface2)', color: c ? '#17161A' : 'var(--muted)' }}>{v ?? '—'}</span>;
    return v === null || v === undefined
      ? <button className="tile3" onClick={() => setQuick(kind)} aria-label={'Add ' + label}>{sq}<span className="muted small">Add {label} ✎</span></button>
      : <a className="tile3" href={kind === 'metascore' ? mcUrl : imdbUrl} target="_blank" rel="noopener">{sq}<span className="muted small">{label} {EXT}</span></a>;
  };
  const maxLogged = Math.max(0, ...logs.map((l) => { const ls = logSeasons(l); return ls ? Math.max(...ls) : seasons.length; }));
  const fresh = isDone && status !== 'dropped' && last?.tier !== 'dropped' ? newSeasons(t, logs).filter((n) => !isEnded(t) || ((seasonAir(t, n) ?? '') > (last?.watched_at.slice(0, 10) ?? ''))) : [];
  const freshAir = fresh.length ? seasonAir(t, fresh[0]) : null;
  const start = (list: number[] | null) => guard(async () => {
    await updateItem(item.id, { status: 'playing', plan_seasons: list, plan_from: list ? list[0] : null, plan_to: list ? list[list.length - 1] : null, run_started_at: new Date().toISOString(), started_on: today, up_next: false, score: null });
  })();
  const moreSeasons = seasons.filter((s) => s.n > maxLogged).length > 0;

  return (
    <div className={'card-screen' + (enterFrom ? ' enter-' + enterFrom : '')} {...swipe}>
      <div ref={swipeEl} className="card-swipe">
      <div className="hero">
        {t.backdrop_url && <img src={t.backdrop_url} alt="" />}
        <div className="hero-shade" />
        <button className="hero-btn left" aria-label="Back" onClick={onClose}><IconBack /></button>
        <button className="hero-btn right" aria-label="Edit details" onClick={() => setEditOpen(true)}>
          <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
        </button>
        <div className="hero-text">
          <h2>{t.title}</h2>
          <div className="row">{[showYears(t), seasons.length ? seasons.length + (seasons.length === 1 ? ' season' : ' seasons') + (data.number_of_episodes ? ' · ' + data.number_of_episodes + ' ep.' : '') : ''].filter(Boolean).map((c) => <span key={c} className="hero-chip">{c}</span>)}</div>
          {(data.network || data.status) && <span className="hero-sub">{[data.network, data.status].filter(Boolean).join(' · ')}</span>}
          {origTr && (isDone || planned) && <span className="hero-tier" style={{ background: origTr.color, color: '#17161A' }}>{origTr.label}</span>}
        </div>
      </div>

      <div className="card-body">
        {error && <p className="error" role="alert">{error}</p>}
        {t.overview && <div className="stack-sm"><p className={'overview' + (ovOpen ? ' open' : '')}>{t.overview}</p>{t.overview.length > 150 && <button className="link left" onClick={() => setOvOpen(!ovOpen)}>{ovOpen ? 'Less' : 'More'}</button>}</div>}

        <div className="tiles3">
          {tileMC('metascore')}
          {tileMC('imdb_rating')}
          {isPlaying
            ? <button className="tile3" onClick={() => setOpenS({ ...openS, [p.nextEp?.season ?? seasons[0]?.n ?? 1]: true })} aria-label="Show seasons"><ProgressRing pct={p.pct} text={p.pct + '%'} /><span className="muted small">Progress</span></button>
            : <button className="tile3" onClick={() => setTakeOpen(true)} aria-label="Change my take"><ScoreRing value={tileScore} scale={scale} size={48} fontSize={17} /><span className="muted small">My score</span></button>}
        </div>

        {isBack && (
          <button className="switch-row card" role="switch" aria-checked={item.up_next} onClick={toggleNext}>
            <span className="stack-sm"><strong>Up next</strong><span className="muted small">{item.up_next ? 'Pinned to the top of your Backlog' : 'Pin it to the top of your Backlog'}</span></span>
            <span className={'switch' + (item.up_next ? ' on' : '')}><span /></span>
          </button>
        )}

        {(isBack || isPlaying) && (
          <div className="plan-row card">
            <span className="stack-sm grow"><span className="muted small">{item.rewatch ? 'Rewatching' : 'Watching'}</span><strong>{planLabel}</strong></span>
            <button className="btn sm" onClick={() => setScopeFor('plan')}>Change</button>
            {isBack && <button className="btn primary sm" onClick={() => start(plan)}>Start watching</button>}
          </div>
        )}

        {fresh.length > 0 && (
          <div className="plan-row card">
            <span className="stack-sm grow"><span className="muted small upper">{freshAir && freshAir <= today ? 'New season out' : freshAir ? 'Premieres ' + longDate(freshAir) : 'Announced'}</span><strong>{seasonsName(fresh)}</strong></span>
            <button className="btn primary sm" onClick={() => start(fresh)}>Start watching</button>
          </div>
        )}

        {isPlaying && p.nextEp && (
          <div className="next-ep card">
            <span className="stack-sm grow"><span className="muted small upper">Next episode</span><strong>{epLabel(p.nextEp)} — {p.nextEp.name}</strong></span>
            <button className="btn primary sm" onClick={() => applyMarks([{ season: p.nextEp!.season, episode: p.nextEp!.episode }], true)}>Watched</button>
          </div>
        )}
        {isPlaying && !p.nextEp && p.caughtUp && (
          <div className="next-ep card"><span className="stack-sm grow"><span className="muted small upper">Caught up</span><strong>{p.nextFuture ? 'Next: ' + epLabel(p.nextFuture) + (p.nextFuture.air_date ? ' on ' + longDate(p.nextFuture.air_date) : '') : 'No new episodes announced yet'}</strong></span></div>
        )}

        <section className="card take">
          {!takeOpen ? (
            <button className="take-summary" onClick={() => setTakeOpen(true)} aria-expanded="false">
              <span className="h2">My take</span>
              {!ready ? null : tr ? <span className="pill" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span>
                : isDone ? <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--ink)' }}>Not rated</span>
                : <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{isPlaying ? 'Watching' : planned ? (item.rewatch ? 'Rewatch · Backlog' : 'Next seasons · Backlog') : 'Not watched yet'}</span>}
              {rewOn && <span className="rew-icon" role="img" aria-label="Rewatch">{EYE_PLUS}</span>}
              <span className="spacer" /><span className="muted" aria-hidden="true">▾</span>
            </button>
          ) : (
            <div className="stack">
              <div className="sec-head"><span className="h2">My take</span><button className="link" onClick={() => setTakeOpen(false)}>Done</button></div>
              <span className="muted small">{currentLog ? 'Your rating for ' + scopeShort(currentLog) : 'Rating for ' + planLabel.split(' · ')[0] + (isDone ? '' : ' — picking one finishes it now')}</span>
              <div className="chips">
                {TIERS.map((x) => { const on = currentLog?.tier === x.id; return <button key={x.id} aria-pressed={on} className="chip" style={on ? { background: x.color, borderColor: x.color, color: '#17161A' } : undefined} onClick={() => pickTier(x.id)}><span className="dot" style={{ background: on ? '#17161A' : x.color }} />{x.label}</button>; })}
              </div>
              <div className="divider" />
              <div className="score-row"><label htmlFor="score" className="strong">My score</label>{score !== null && <button className="link" onClick={() => setScore(null)}>Clear</button>}<ScoreRing value={preview !== undefined ? preview : score} scale={scale} size={46} fontSize={16} /></div>
              <ScoreSlider id="score" label="My score" value={score} scale={scale} onCommit={(v) => setScore(v)} onPreview={(v) => setPreview(v)} />
              {currentLog && <>
                <div className="divider" />
                <div className="score-row"><label htmlFor="wdate" className="strong">Finished on</label><input id="wdate" type="date" className="date-input" value={currentLog.watched_at.slice(0, 10)} onChange={(e) => { const d = e.target.value; if (d) guard(async () => { await updateLog(currentLog.id, { watched_at: d + (currentLog.watched_at.slice(10) || 'T20:00:00Z') }); })(); }} /></div>
              </>}
              <div className="divider" />
              <button className="switch-row flat" role="switch" aria-checked={rewOn} onClick={toggleRew}><span className="rew-icon">{EYE_PLUS}</span><strong className="grow">Rewatch</strong><span className={'switch' + (rewOn ? ' on-green' : '')}><span /></span></button>
            </div>
          )}
        </section>

        <section className="stack-sm">
          <span className="h2">Seasons</span>
          {seasons.length === 0 && <p className="muted small">Loading seasons…</p>}
          {seasons.map((s) => {
            const list = eps.find((x) => x.season === s.n)?.episodes ?? [];
            const aired = list.filter((e) => e.air_date && e.air_date <= today).length;
            const seen = list.filter((e) => runSeen(s.n, e.n)).length;
            const upcoming = list.length - aired;
            const rating = ratings.find((r) => r.season === s.n);
            const rt = tierOf(rating?.tier ?? null);
            const inPlan = !plan || plan.includes(s.n);
            const open = !!openS[s.n];
            const allSeen = aired > 0 && seen === aired;
            const lastAt = marks.filter((m) => m.season === s.n && (allSeen ? m.watched_at >= since : true)).map((m) => m.watched_at).sort().pop() ?? null;
            return (
              <div key={s.n} className={'season-card' + (inPlan ? '' : ' out')}>
                <button className="season-head" aria-expanded={open} onClick={() => setOpenS({ ...openS, [s.n]: !open })}>
                  <span className="stack-sm grow">
                    <span className="row nowrap"><strong>Season {s.n}</strong>{rt && <span className="pill" style={{ background: rt.color, color: '#17161A' }}>{rt.label}</span>}</span>
                    <span className="muted small">{seen}/{aired}{upcoming ? ' · ' + upcoming + ' upcoming' : ''}{s.air_date ? ' · ' + s.air_date.slice(0, 4) : ''}</span>
                    {lastAt && <span className={'small ' + (allSeen ? 'accent-text' : 'muted')}>{(allSeen ? 'Finished ' : 'Last watched ') + longDate(lastAt)}</span>}
                    <span className="mini-bar"><span style={{ width: (aired ? (seen / aired) * 100 : 0) + '%' }} /></span>
                  </span>
                  <ScoreRing value={rating?.score ?? null} scale={scale} size={32} fontSize={12} label={'Season ' + s.n + ' score'} />
                  <span className="muted" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }}>▾</span>
                </button>
                {open && (
                  <div className="season-body">
                    <div className="row between"><span className="muted small">{rating ? 'Rated ' + longDate(rating.rated_at) : 'Not rated yet'}</span>
                      {aired > 0 && <button className="btn sm" onClick={() => applyMarks(list.filter((e) => e.air_date && e.air_date <= today && (allSeen || !runSeen(s.n, e.n))).map((e) => ({ season: s.n, episode: e.n })), !allSeen)}>{allSeen ? 'Unmark all' : 'Mark season watched'}</button>}</div>
                    <div className="chips">
                      {TIERS.filter((x) => x.id !== 'dropped').map((x) => { const on = rating?.tier === x.id; return <button key={x.id} aria-pressed={on} className="chip sm" style={on ? { background: x.color, borderColor: x.color, color: '#17161A' } : undefined} onClick={guard(async () => { await saveSeasonRating(item.id, s.n, { tier: on ? null : x.id }); })}><span className="dot" style={{ background: on ? '#17161A' : x.color }} />{x.label}</button>; })}
                    </div>
                    <div className="score-row"><label htmlFor={'ss-' + s.n} className="small strong">Score</label>
                      <ScoreSlider compact id={'ss-' + s.n} label={'Season ' + s.n + ' score'} value={rating?.score ?? null} scale={scale} onCommit={(sc) => { setRatings((r) => { const o = r.filter((x) => x.season !== s.n); return o.concat([{ library_id: item.id, season: s.n, tier: rating?.tier ?? null, score: sc, rated_at: today }]); }); saveSeasonRating(item.id, s.n, { score: sc }); }} /></div>
                    <div className="ep-list">
                      {list.length === 0 && <span className="muted small">Loading episodes…</span>}
                      {list.map((e) => {
                        const future = !e.air_date || e.air_date > today, on = runSeen(s.n, e.n), before = !on && seenBefore(s.n, e.n);
                        return (
                          <button key={e.n} className={'ep-row' + (on ? ' on' : '') + (future ? ' future' : '')} disabled={future} aria-pressed={on}
                            {...(future ? {} : epPress(s.n + ':' + e.n))} onClick={() => applyMarks([{ season: s.n, episode: e.n }], !on)}>
                            <span className={'ep-box' + (on ? ' on' : before ? ' before' : '')} aria-hidden="true">{(on || before) && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}</span>
                            <span className="ep-n">{e.n}</span>
                            <span className="ep-name">{e.name}</span>
                            <span className={'ep-date' + (before ? ' before' : '')}>{future ? (e.air_date ? 'Airs ' + releaseText(e.air_date, null) : 'TBA') : (on || before) ? (before ? 'Seen ' : '') + releaseText((marks.find((m) => m.season === s.n && m.episode === e.n)?.watched_at ?? '').slice(0, 10), null) : releaseText(e.air_date, null)}</span>
                          </button>
                        );
                      })}
                      {list.length > 0 && <span className="muted tiny">Tip: press and hold an episode to mark everything up to it.</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="card stack-sm">
          <div className="sec-head"><span className="h2">Viewings <span className="muted small normal">{logs.length}</span></span>
            {isDone && <span className="row nowrap">{moreSeasons && <button className="btn sm" onClick={() => setScopeFor('more')}>Watch more</button>}<button className="btn primary sm" onClick={() => setScopeFor('rewatch')}>Log a rewatch</button></span>}
          </div>
          {logs.length === 0 && !planned && <span className="muted small">Finish the planned seasons and the entry appears here.</span>}
          {planned && (
            <div className="view-row">
              <span className="grow small strong">Planned: {planLabel.split(' · ')[0]} <span className="accent-text normal">Next</span></span>
              {item.rewatch && <span className="rew-icon" role="img" aria-label="Rewatch">{EYE_PLUS}</span>}
              <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--ink)' }}>{isPlaying ? 'Watching' : 'Backlog'}</span>
              <button className="del-x" aria-label="Cancel the plan" onClick={cancelPlan}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
          )}
          {logs.map((l, i) => {
            const x = tierOf(l.tier);
            if (delView === l.id) return (
              <div key={l.id} className="view-row"><span className="grow small strong">Delete this entry?</span><button className="btn sm" onClick={() => setDelView(null)}>Cancel</button>
                <button className="btn sm danger-fill" onClick={guard(async () => { await deleteLog(l.id); if (logs.length === 1 && isDone) await updateItem(item.id, { status: p.anySeen ? 'playing' : 'backlog' }); setDelView(null); })}>Delete</button></div>
            );
            return (
              <div key={l.id} className="view-wrap">
                <div className="view-row">
                  <button className="view-date grow" aria-expanded={editLog === l.id} onClick={() => setEditLog(editLog === l.id ? null : l.id)}>
                    <span className="small strong">{scopeShort(l)} · {longDate(l.watched_at)} {i === 0 && !planned && <span className="accent-text normal">Latest</span>}</span>
                    <span className="muted tiny">{editLog === l.id ? 'Done' : 'Edit'}</span>
                  </button>
                  <button className={'rew-toggle' + (l.rewatch ? ' on' : '')} aria-pressed={l.rewatch} aria-label="Rewatch" onClick={guard(async () => { await updateLog(l.id, { rewatch: !l.rewatch }); })}>{EYE_PLUS}</button>
                  {x ? <span className="pill" style={{ background: x.color, color: '#17161A' }}>{x.label}</span> : <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Not rated</span>}
                  <ScoreRing value={l.score} scale={scale} size={32} fontSize={12} />
                  <button className="del-x" aria-label="Delete this entry" onClick={() => setDelView(l.id)}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
                </div>
                {editLog === l.id && (
                  <div className="view-edit">
                    <div className="score-row"><span className="small strong">Covers</span><span className="grow small">{scopeShort(l)}</span><button className="btn sm" onClick={() => setScopeLog(l)}>Change</button></div>
                    <div className="chips">{TIERS.map((tt) => { const on = l.tier === tt.id; return <button key={tt.id} aria-pressed={on} className="chip sm" style={on ? { background: tt.color, borderColor: tt.color, color: '#17161A' } : undefined} onClick={guard(async () => { await updateLog(l.id, { tier: on ? null : tt.id }); })}><span className="dot" style={{ background: on ? '#17161A' : tt.color }} />{tt.label}</button>; })}</div>
                    <div className="score-row"><label htmlFor={'vs-' + l.id} className="small strong">Score</label>
                      <ScoreSlider compact id={'vs-' + l.id} label="Score" value={l.score} scale={scale} onCommit={(st) => { setLogs((ls) => ls.map((y) => (y.id === l.id ? { ...y, score: st } : y))); updateLog(l.id, { score: st }).then(onChanged); }} /></div>
                    <div className="score-row"><label htmlFor={'vd-' + l.id} className="small strong">Finished on</label>
                      <input id={'vd-' + l.id} type="date" className="date-input" value={l.watched_at.slice(0, 10)} onChange={(e) => { const d = e.target.value; if (d) guard(async () => { await updateLog(l.id, { watched_at: d + (l.watched_at.slice(10) || 'T20:00:00Z') }); })(); }} /></div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="card stack">
          <span className="h2">Details</span>
          {t.genres.length > 0 && <div className="stack-sm"><span className="muted small">Genres</span><div className="row">{t.genres.map((g) => <span key={g} className="pill" style={{ background: 'var(--surface2)' }}>{g}</span>)}</div></div>}
          <div className="facts">{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><strong>{v}</strong></div>)}</div>
          {cast.length > 0 && <div className="stack-sm top-line"><span className="muted small">Starring</span><strong>{cast.join(', ')}</strong></div>}
        </section>

        <section className="card ai">
          <button className="ai-head" onClick={() => setAiOpen(!aiOpen)} aria-expanded={aiOpen}>
            <span className="accent-text" aria-hidden="true">✦</span><span className="h2">Ask AI</span>
            <span className="muted small ellipsis grow">{chat.length ? `${chat.filter((m) => m.role === 'user').length} questions · ${chat[chat.length - 1].content}` : 'Recaps, trivia, what to watch next'}</span>
            <span className="muted" aria-hidden="true">{aiOpen ? '▴' : '▾'}</span>
          </button>
          {aiOpen && (
            <div className="stack">
              <div className="chat-log" role="log" aria-live="polite">
                {chat.length === 0 && <span className="muted small chat-empty">Ask anything about {t.title}.</span>}
                {chat.slice().reverse().map((m) => <div key={m.id} className={'bubble ' + m.role + (m.pending ? ' pending' : '')}>{m.content}</div>)}
              </div>
              <div className="chips scroll">{CHIPS.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div>
              <div className="row nowrap">
                <label htmlFor="ai" className="sr">Ask about this show</label>
                <input id="ai" className="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(draft); } }} placeholder="Ask about this show…" />
                <button className="send" aria-label="Send" onClick={() => send(draft)}>→</button>
              </div>
            </div>
          )}
        </section>
      </div>
      </div>

      {scopeFor && <ScopeSheet t={t} title={scopeFor === 'plan' ? 'What are you watching?' : scopeFor === 'rewatch' ? 'Rewatch which seasons?' : 'Watch more seasons'}
        confirm={scopeFor === 'plan' ? 'Save' : 'Add to Backlog'}
        initial={scopeFor === 'plan' ? plan : scopeFor === 'more' ? seasons.filter((x) => x.n > maxLogged).map((x) => x.n) : null}
        onCancel={() => setScopeFor('')} onDone={doneScope} />}
      {scopeLog && <ScopeSheet t={t} title="What does this entry cover?" confirm="Save" initial={logSeasons(scopeLog)}
        onCancel={() => setScopeLog(null)} onDone={(list) => { const l = scopeLog; setScopeLog(null); guard(async () => { await updateLog(l.id, logScope(list) as Partial<ItemLog>); })(); }} />}
      {quick && <QuickNumber kind={quick} title={t.title} titleRow={item.title} item={item} onClose={() => setQuick(null)} onSaved={async () => { setQuick(null); await changed(); }} />}
      {editOpen && <EditDetails kind="tv" item={item} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await changed(); }} onDeleted={async () => { await removeFromLibrary(item.id); onChanged(); onClose(); }} />}
    </div>
  );
}
