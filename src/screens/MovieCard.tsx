import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMsg, CollectionPart, ItemLog, LibItem, Overrides, Title } from '../lib/types';
import type { Settings } from '../lib/theme';
import { TIERS, displayScore, imdbColor, metascoreColor, myScoreColor } from '../lib/scores';
import { diffOverrides, latestLog, longDate, merged, money, nextPosition, parseNum, releaseText, runtimeText } from '../lib/logic';
import {
  addToBacklog, askAi, deleteLog, ensureTitle, ensureTitleByImdb, loadImages, uploadCover, findOwnedBySource, insertLog, loadChat, loadItem, loadItemLogs, removeFromLibrary, updateItem, updateLog
} from '../lib/remote';
import ScoreRing from '../components/ScoreRing';
import ScoreSlider from '../components/ScoreSlider';
import { IconBack } from '../components/Icons';
import { useBackLayer } from '../lib/back';

interface Props { itemId: string; onPrev?: (() => void) | null; onNext?: (() => void) | null; enterFrom?: 'left' | 'right' | null; openTake?: boolean; initial?: LibItem | null; initialLogs?: ItemLog[] | null; initialOwned?: Record<string, { id: string; status: string; up_next: boolean }>; settings: Settings; onClose: () => void; onChanged: () => void; onOpenOther: (id: string) => void; backlogCount: number }

const tierOf = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
const EXT = <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6" /><path d="M20 4l-9 9" /></svg>;
const EYE_PLUS = <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M12 18c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /><path d="M16 19h6" /><path d="M19 16v6" /></svg>;
const CHIPS = ['Similar movies', 'Fun facts', 'Post-credits scene?', 'Explain the ending'];

export const tierOfId = (id: string | null) => TIERS.find((t) => t.id === id) ?? null;
export const EYE_PLUS_ICON = EYE_PLUS;
export const EXT_ICON = EXT;

export default function MovieCard({ itemId, onPrev, onNext, enterFrom, openTake, initial, initialLogs, initialOwned, settings, onClose, onChanged, onOpenOther, backlogCount }: Props) {
  const [item, setItem] = useState<LibItem | null>(initial ?? null);
  const [logsReady, setLogsReady] = useState(!!initial && !!initialLogs);
  const [logs, setLogs] = useState<ItemLog[]>(initialLogs ?? []);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [owned, setOwned] = useState<Record<string, { id: string; status: string; up_next: boolean }>>(initialOwned ?? {});
  const [takeOpen, setTakeOpen] = useState(!!openTake || initial?.status === 'backlog');
  const [aiOpen, setAiOpen] = useState(false);
  const [ovOpen, setOvOpen] = useState(false);
  const [quick, setQuick] = useState<null | 'metascore' | 'imdb_rating'>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [delView, setDelView] = useState<string | null>(null);
  const [editLog, setEditLog] = useState<string | null>(null);
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
  const firstFor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const [it, lg, ch] = await Promise.all([loadItem(itemId), loadItemLogs(itemId), loadChat(itemId)]);
    setItem(it); setLogs(lg); setChat(ch); setLogsReady(true);
    if (firstFor.current !== it.id) { firstFor.current = it.id; setTakeOpen(!!openTake || it.status === 'backlog'); }
    const parts = ((it.title.data as any)?.collection?.parts ?? []) as CollectionPart[];
    setOwned(await findOwnedBySource(parts.map((p) => p.sourceId), 'movies'));
  }, [itemId]);
  useEffect(() => { reload().catch(() => setError('Couldn’t load this movie.')); }, [reload]);

  const t = useMemo(() => (item ? merged(item.title, item.overrides) : null), [item]);
  const last = latestLog(logs);
  const done = item ? item.status === 'done' || item.status === 'dropped' : false;
  const planned = item?.status === 'backlog';
  const score = planned ? item?.score ?? null : last ? last.score : item?.score ?? null;

  if (!item || !t) return <div className="card-screen"><div className="card-loading">{error || 'Loading…'}</div></div>;

  const changed = async () => { await reload(); onChanged(); };
  const guard = (fn: () => Promise<void>) => async () => { try { setError(''); await fn(); await changed(); } catch { setError('Something went wrong. Try again.'); } };

  const pickTier = (id: string) => guard(async () => {
    if (!planned && last && last.tier === id) {
      await deleteLog(last.id);
      const remaining = logs.filter((l) => l.id !== last.id);
      await updateItem(item.id, { status: remaining.length ? ((latestLog(remaining)!.tier === 'dropped') ? 'dropped' : 'done') : 'backlog' });
      return;
    }
    if (last && !planned) await updateLog(last.id, { tier: id });
    else await insertLog(item.id, { tier: id, score: item.score, rewatch: !!item.rewatch, watched_at: new Date().toISOString() });
    await updateItem(item.id, { status: id === 'dropped' ? 'dropped' : 'done', up_next: false, rewatch: false });
  })();

  const setScore = (v: number | null) => guard(async () => {
    setPreview(undefined);
    if (last && !planned) await updateLog(last.id, { score: v }); else await updateItem(item.id, { score: v });
  })();

  const setDate = (d: string) => guard(async () => {
    if (!last || !d) return;
    const time = last.watched_at.slice(10) || 'T20:00:00Z';
    await updateLog(last.id, { watched_at: d + time });
  })();

  const rewOn = planned || !last ? !!item.rewatch : last.rewatch;
  const toggleRew = guard(async () => {
    if (last && !planned) await updateLog(last.id, { rewatch: !last.rewatch });
    else await updateItem(item.id, { rewatch: !item.rewatch });
  });
  const planRewatch = async () => { await updateItem(item.id, { status: 'backlog', rewatch: true, score: null, position: backlogCount }); setTakeOpen(true); };
  const cancelRewatch = async () => { await updateItem(item.id, { status: last?.tier === 'dropped' ? 'dropped' : 'done', rewatch: false, up_next: false, score: null }); };
  const logRewatch = guard(async () => { if (planned && logs.length) await cancelRewatch(); else await planRewatch(); });
  const toggleNext = guard(async () => { await updateItem(item.id, { up_next: !item.up_next, position: backlogCount }); });

  const send = async (text: string) => {
    const q = text.trim(); if (!q) return;
    setDraft('');
    setChat((c) => c.concat([{ id: 'u' + Date.now(), role: 'user', content: q, created_at: '' }, { id: 'p' + Date.now(), role: 'model', content: 'Thinking…', created_at: '', pending: true }]));
    try { await askAi(item.id, q); setChat(await loadChat(item.id)); }
    catch { setChat((c) => c.map((m) => (m.pending ? { ...m, pending: false, content: 'Couldn’t get an answer right now. Try again in a moment.' } : m))); }
  };

  const data = (item.title.data ?? {}) as any;
  const coll = data.collection as { name: string; parts: CollectionPart[] } | null;
  const cast = ((data.cast ?? []) as { name: string }[]).slice(0, 4).map((c) => c.name);
  const facts = ([
    ['Country', (data.countries ?? []).join(', ')], ['Language', (data.language ?? '').toUpperCase()],
    ['Budget', money(data.budget)], ['Box office', money(data.revenue)]
  ] as [string, string][]).filter(([, v]) => v);
  const mcUrl = 'https://www.metacritic.com/search/' + encodeURIComponent(t.title) + '/?category=2';
  const imdbUrl = t.imdb_id ? 'https://www.imdb.com/title/' + t.imdb_id + '/' : 'https://www.imdb.com/find/?q=' + encodeURIComponent(t.title);
  const tr = planned ? null : tierOf(last?.tier ?? null);
  const origTr = tierOf(last?.tier ?? null);
  const shownScore = planned ? (item.score ?? last?.score ?? null) : score;
  const ov = t.overview ?? '';

  const tile = (kind: 'metascore' | 'imdb_rating') => {
    const v = t[kind]; const c = kind === 'metascore' ? metascoreColor(v) : imdbColor(v);
    const label = kind === 'metascore' ? 'Metascore' : 'IMDb';
    const sq = <span className="sq" style={{ background: c ?? 'var(--surface2)', color: c ? '#17161A' : 'var(--muted)' }}>{v ?? '—'}</span>;
    return v === null || v === undefined
      ? <button className="tile3" onClick={() => setQuick(kind)} aria-label={'Add ' + label}>{sq}<span className="muted small">Add {label} ✎</span></button>
      : <a className="tile3" href={kind === 'metascore' ? mcUrl : imdbUrl} target="_blank" rel="noopener" aria-label={'Open on ' + (kind === 'metascore' ? 'Metacritic' : 'IMDb')}>{sq}<span className="muted small">{label} {EXT}</span></a>;
  };

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
          <div className="row">{[releaseText(t.release_date, t.year), runtimeText(t.runtime)].filter(Boolean).map((c) => <span key={c} className="hero-chip">{c}</span>)}</div>
          {t.directors.length > 0 && <span className="hero-sub">{t.directors.join(', ')}</span>}
          {origTr && (done || planned) && (() => { const tr = origTr; return <span className="hero-tier" style={{ background: tr.color, color: tr.id === 'dropped' ? '#17161A' : '#17161A' }}>{tr.label}</span>; })()}
        </div>
      </div>

      <div className="card-body">
        {error && <p className="error" role="alert">{error}</p>}
        {ov && (
          <div className="stack-sm">
            <p className={'overview' + (ovOpen ? ' open' : '')}>{ov}</p>
            {ov.length > 150 && <button className="link left" onClick={() => setOvOpen(!ovOpen)}>{ovOpen ? 'Less' : 'More'}</button>}
          </div>
        )}

        <div className="tiles3">
          {tile('metascore')}
          {tile('imdb_rating')}
          <button className="tile3" onClick={() => setTakeOpen(true)} aria-label="Change my take">
            <ScoreRing value={shownScore} scale={scale} size={48} fontSize={17} />
            <span className="muted small">My score</span>
          </button>
        </div>

        {item.status === 'backlog' && (
          <button className="switch-row card" role="switch" aria-checked={item.up_next} onClick={toggleNext}>
            <span className="stack-sm"><strong>Up next</strong><span className="muted small">{item.up_next ? 'Pinned to the top of your Backlog' : 'Pin it to the top of your Backlog'}</span></span>
            <span className={'switch' + (item.up_next ? ' on' : '')}><span /></span>
          </button>
        )}

        <section className="card take">
          {!takeOpen ? (
            <button className="take-summary" onClick={() => setTakeOpen(true)} aria-expanded="false">
              <span className="h2">My take</span>
              {!logsReady ? null : planned && logs.length ? <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--ink)' }}>Rewatch · Backlog</span> : tr ? <span className="pill" style={{ background: tr.color, color: '#17161A' }}>{tr.label}</span> : <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>Not watched yet</span>}
              {rewOn && <span className="rew-icon" role="img" aria-label="Rewatch">{EYE_PLUS}</span>}
              <span className="spacer" />
              <span className="muted" aria-hidden="true">▾</span>
            </button>
          ) : (
            <div className="stack">
              <div className="sec-head"><span className="h2">My take</span><button className="link" onClick={() => setTakeOpen(false)}>Done</button></div>
              <div className="chips">
                {TIERS.map((x) => {
                  const on = last?.tier === x.id;
                  return <button key={x.id} aria-pressed={on} className="chip" style={on ? { background: x.color, borderColor: x.color, color: '#17161A' } : undefined} onClick={() => pickTier(x.id)}><span className="dot" style={{ background: on ? '#17161A' : x.color }} />{x.label}</button>;
                })}
              </div>
              {!done && <span className="muted small">{planned && logs.length ? 'Rewatch in your Backlog — pick a rating when you’ve watched it again' : 'Pick a rating to move it to Watched'}</span>}
              <div className="divider" />
              <div className="score-row">
                <label htmlFor="score" className="strong">My score</label>
                {score !== null && <button className="link" onClick={() => setScore(null)}>Clear</button>}
                <ScoreRing value={preview !== undefined ? preview : score} scale={scale} size={46} fontSize={16} />
              </div>
              <ScoreSlider id="score" label="My score" value={score} scale={scale} onCommit={(v) => setScore(v)} onPreview={(v) => setPreview(v)} />
              {last && !planned && (
                <>
                  <div className="divider" />
                  <div className="score-row"><label htmlFor="wdate" className="strong">Watched on</label><input id="wdate" type="date" value={last.watched_at.slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="date-input" /></div>
                </>
              )}
              <div className="divider" />
                  <button className="switch-row flat" role="switch" aria-checked={rewOn} onClick={toggleRew}>
                    <span className="rew-icon">{EYE_PLUS}</span><strong className="grow">Rewatch</strong>
                    <span className={'switch' + (rewOn ? ' on-green' : '')}><span /></span>
                  </button>
            </div>
          )}
        </section>

        <section className="card stack">
          <span className="h2">Details</span>
          {t.genres.length > 0 && <div className="stack-sm"><span className="muted small">Genres</span><div className="row">{t.genres.map((g) => <span key={g} className="pill" style={{ background: 'var(--surface2)' }}>{g}</span>)}</div></div>}
          <div className="facts">{facts.map(([k, v]) => <div key={k}><span className="muted small">{k}</span><strong>{v}</strong></div>)}</div>
          {cast.length > 0 && <div className="stack-sm top-line"><span className="muted small">Starring</span><strong>{cast.join(', ')}</strong></div>}
        </section>

        {coll && coll.parts?.length > 1 && (
          <section className="card stack-sm">
            <div className="sec-head"><span className="h2">{coll.name}</span><span className="muted small">{coll.parts.findIndex((p) => p.sourceId === item.title.source_id) + 1} of {coll.parts.length}</span></div>
            {coll.parts.map((p, i) => {
              const o = owned[p.sourceId]; const isCur = p.sourceId === item.title.source_id;
              const st = isCur ? 'This movie' : o ? (o.status === 'backlog' ? (o.up_next ? 'Up next' : 'Backlog') : o.status === 'dropped' ? 'Dropped' : 'Watched') : '';
              return (
                <div key={p.sourceId} className={'coll-row' + (isCur ? ' cur' : '')}>
                  <span className="coll-n">{i + 1}</span>
                  <button className="coll-title" disabled={!o || isCur} onClick={() => o && onOpenOther(o.id)}>{p.title} <span className="muted">{p.year}</span></button>
                  {!o && <button className="add-btn sm" aria-label={'Add ' + p.title + ' to backlog'} onClick={guard(async () => { const tt = await ensureTitle('movie', p.sourceId); await addToBacklog(tt.id, 'movies', backlogCount); })}>+</button>}
                  {st && <span className={'pill status' + (st === 'Watched' ? ' accent' : isCur ? ' outline' : '')}>{st}</span>}
                </div>
              );
            })}
          </section>
        )}

        {logs.length > 0 && (
          <section className="card stack-sm">
            <div className="sec-head"><span className="h2">Viewings <span className="muted small normal">{logs.length} {logs.length === 1 ? 'viewing' : 'viewings'}</span></span>
              <button className={'btn sm' + (planned ? ' planned' : ' primary')} aria-pressed={planned} onClick={logRewatch}>{planned ? '✓ Rewatch planned' : 'Log a rewatch'}</button></div>
            {planned && logs.length > 0 && (
              <div className="view-row">
                <span className="grow small strong">Planned rewatch <span className="accent-text normal">Next</span></span>
                <span className="rew-icon" role="img" aria-label="Rewatch">{EYE_PLUS}</span>
                <span className="pill" style={{ background: 'var(--surface2)', color: 'var(--ink)' }}>Backlog</span>
                <ScoreRing value={item.score} scale={scale} size={32} fontSize={12} />
                <button className="del-x" aria-label="Cancel the planned rewatch" onClick={logRewatch}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
              </div>
            )}
            {logs.map((l, i) => {
              const x = tierOf(l.tier);
              return delView === l.id ? (
                <div key={l.id} className="view-row"><span className="grow small strong">Delete the {longDate(l.watched_at)} viewing?</span>
                  <button className="btn sm" onClick={() => setDelView(null)}>Cancel</button>
                  <button className="btn sm danger-fill" onClick={guard(async () => { await deleteLog(l.id); const rem = logs.filter((y) => y.id !== l.id); if (!planned) await updateItem(item.id, { status: rem.length ? (latestLog(rem)!.tier === 'dropped' ? 'dropped' : 'done') : 'backlog' }); setDelView(null); })}>Delete</button></div>
              ) : (
                <div key={l.id} className="view-wrap">
                <div className="view-row">
                  <button className="view-date grow" aria-expanded={editLog === l.id} onClick={() => setEditLog(editLog === l.id ? null : l.id)}>
                    <span className="small strong">{longDate(l.watched_at)} {i === 0 && !planned && <span className="accent-text normal">Latest</span>}</span>
                    <span className="muted tiny">{editLog === l.id ? 'Done' : 'Edit'}</span>
                  </button>
                  <button className={'rew-toggle' + (l.rewatch ? ' on' : '')} aria-pressed={l.rewatch} aria-label={l.rewatch ? 'Marked as rewatch — tap to unmark' : 'Mark this viewing as a rewatch'} onClick={guard(async () => { await updateLog(l.id, { rewatch: !l.rewatch }); })}>{EYE_PLUS}</button>
                  {x && <span className="pill" style={{ background: x.color, color: '#17161A' }}>{x.label}</span>}
                  <ScoreRing value={l.score} scale={scale} size={32} fontSize={12} />
                  <button className="del-x" aria-label="Delete this viewing" onClick={() => setDelView(l.id)}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
                </div>
                {editLog === l.id && (
                  <div className="view-edit">
                    <div className="chips">
                      {TIERS.map((tt) => {
                        const on = l.tier === tt.id;
                        return <button key={tt.id} aria-pressed={on} className="chip sm" style={on ? { background: tt.color, borderColor: tt.color, color: '#17161A' } : undefined}
                          onClick={guard(async () => { await updateLog(l.id, { tier: tt.id }); if (i === 0 && !planned) await updateItem(item.id, { status: tt.id === 'dropped' ? 'dropped' : 'done' }); })}>
                          <span className="dot" style={{ background: on ? '#17161A' : tt.color }} />{tt.label}</button>;
                      })}
                    </div>
                    <div className="score-row">
                      <label htmlFor={'vs-' + l.id} className="small strong">Score</label>
                      <ScoreSlider compact id={'vs-' + l.id} label="Score" value={l.score} scale={scale} onCommit={(st) => { setLogs((ls) => ls.map((y) => (y.id === l.id ? { ...y, score: st } : y))); updateLog(l.id, { score: st }).then(onChanged); }} />
                    </div>
                    <div className="score-row">
                      <label htmlFor={'vd-' + l.id} className="small strong">Watched on</label>
                      <input id={'vd-' + l.id} type="date" className="date-input" value={l.watched_at.slice(0, 10)} onChange={(e) => { const d = e.target.value; if (d) guard(async () => { await updateLog(l.id, { watched_at: d + (l.watched_at.slice(10) || 'T20:00:00Z') }); })(); }} />
                    </div>
                  </div>
                )}
                </div>
              );
            })}
          </section>
        )}

        <section className="card ai">
          <button className="ai-head" onClick={() => setAiOpen(!aiOpen)} aria-expanded={aiOpen}>
            <span className="accent-text" aria-hidden="true">✦</span><span className="h2">Ask AI</span>
            <span className="muted small ellipsis grow">{chat.length ? `${chat.filter((m) => m.role === 'user').length} questions · ${chat[chat.length - 1].content}` : 'Trivia, endings, what to watch next'}</span>
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
                <label htmlFor="ai" className="sr">Ask about this movie</label>
                <input id="ai" className="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(draft); } }} placeholder="Ask about this movie…" />
                <button className="send" aria-label="Send" onClick={() => send(draft)}>→</button>
              </div>
            </div>
          )}
        </section>
      </div>

      </div>
      {quick && <QuickNumber kind={quick} title={t.title} titleRow={item.title} item={item} onClose={() => setQuick(null)} onSaved={async () => { setQuick(null); await changed(); }} />}
      {editOpen && <EditDetails item={item} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await changed(); }}
        onDeleted={async () => { await removeFromLibrary(item.id); onChanged(); onClose(); }} />}
    </div>
  );
}

export function QuickNumber({ kind, title, item, onClose, onSaved }: { kind: 'metascore' | 'imdb_rating'; title: string; titleRow: Title; item: LibItem; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState('');
  const max = kind === 'metascore' ? 100 : 10, step = kind === 'metascore' ? 1 : 0.1;
  const p = parseNum(v, max, step);
  const c = p.ok && p.n !== null ? (kind === 'metascore' ? metascoreColor(p.n) : imdbColor(+p.n.toFixed(1))) : null;
  const look = kind === 'metascore' ? 'https://www.metacritic.com/search/' + encodeURIComponent(title) + '/?category=2' : 'https://www.imdb.com/find/?q=' + encodeURIComponent(title);
  const save = async () => { if (!p.ok) return; await updateItem(item.id, { overrides: { ...item.overrides, [kind]: p.n === null ? null : kind === 'imdb_rating' ? +p.n.toFixed(1) : p.n } }); onSaved(); };
  return (
    <div className="modal-wrap">
      <div className="modal" role="dialog" aria-label={kind === 'metascore' ? 'Metascore' : 'IMDb rating'}>
        <span className="h2">{kind === 'metascore' ? 'Metascore' : 'IMDb rating'}</span>
        <span className="sq big" style={{ background: c ?? 'var(--surface2)', color: c ? '#17161A' : 'var(--muted)' }}>{p.ok && p.n !== null ? (kind === 'imdb_rating' ? p.n.toFixed(1) : p.n) : '—'}</span>
        <label htmlFor="qn" className="sr">Value</label>
        <input id="qn" className={'num-input' + (p.ok ? '' : ' bad')} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); }} placeholder={kind === 'metascore' ? '0–100' : '0.0–10'} autoFocus />
        <span className={'small' + (p.ok ? ' muted' : ' error')}>{p.ok ? 'From 0 to ' + max : 'Enter a number from 0 to ' + max}</span>
        <a className="btn outline-accent wide" href={look} target="_blank" rel="noopener">Look it up on {kind === 'metascore' ? 'Metacritic' : 'IMDb'} ↗</a>
        <div className="row nowrap wide"><button className="btn grow" onClick={onClose}>Cancel</button><button className="btn primary grow" onClick={save} disabled={!p.ok}>Save</button></div>
      </div>
    </div>
  );
}

export function EditDetails({ item, onClose, onSaved, onDeleted, kind = 'movie' }: { item: LibItem; onClose: () => void; onSaved: () => void; onDeleted: () => void; kind?: 'movie' | 'tv' }) {
  const m = merged(item.title, item.overrides);
  const [f, setF] = useState({
    title: m.title, release_date: m.release_date ?? '', runtime: m.runtime ? String(m.runtime) : '', directors: m.directors.join(', '),
    genres: m.genres.join(', '), metascore: m.metascore === null ? '' : String(m.metascore), imdb_rating: m.imdb_rating === null ? '' : String(m.imdb_rating)
  });
  const [backdrop, setBackdrop] = useState<string | null>(m.backdrop_url);
  const [poster, setPoster] = useState<string | null>(m.poster_url);
  const [pics, setPics] = useState<null | { backdrops: { thumb: string; full: string }[]; posters: { thumb: string; full: string }[] }>(null);
  const [picker, setPicker] = useState<'' | 'poster' | 'backdrop'>('');
  const [uploading, setUploading] = useState<'' | 'poster' | 'backdrop'>('');
  const isTmdb = item.title.source === 'tmdb';
  const openPicker = async (k: 'poster' | 'backdrop') => { setPicker(picker === k ? '' : k); if (!pics) setPics(await loadImages(item.title.source_id, kind)); };
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
        <span className="muted small strong">{k === 'poster' ? 'Poster' : 'Background'}</span>
        <div className={k === 'poster' ? 'pp-preview' : 'bd-preview'}>{cur ? <img src={cur} alt="" /> : <span className="muted small">None</span>}</div>
        <div className="row">
          {isTmdb && <button className="btn sm" aria-expanded={picker === k} onClick={() => openPicker(k)}>{k === 'poster' ? 'Choose a different poster' : 'Choose a different background'}</button>}
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
    const edited: Overrides = { title: f.title.trim() || item.title.title, release_date: f.release_date || null, runtime: Number.isFinite(rt as number) ? rt : null, directors: list(f.directors), genres: list(f.genres), metascore: ms, imdb_rating: im, backdrop_url: backdrop, poster_url: poster };
    setBusy(true); await updateItem(item.id, { overrides: diffOverrides(item.title, edited) }); setBusy(false); onSaved();
  };
  const refresh = async () => { setBusy(true); try { if (item.title.source === 'imdb') await ensureTitleByImdb(item.title.source_id, true); else await ensureTitle(kind, item.title.source_id, true); setNote('Info updated. Your own edits are kept.'); } catch { setNote('Couldn’t update right now. Try again later.'); } setBusy(false); };
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
        {imageBlock('backdrop')}
        {field('title', 'Title', 'text', 'Title')}
        {field('release_date', kind === 'tv' ? 'First aired (YYYY-MM-DD)' : 'Release date (YYYY-MM-DD)', 'numeric', '2019-11-22')}
        {field('runtime', kind === 'tv' ? 'Episode runtime, minutes' : 'Runtime, minutes', 'numeric', '103')}
        {field('directors', kind === 'tv' ? 'Created by' : 'Director', 'text', 'Name, Name')}
        {field('genres', 'Genres', 'text', 'Drama, Comedy')}
        {field('metascore', 'Metascore (0–100)', 'numeric', '64')}
        {field('imdb_rating', 'IMDb (0–10)', 'decimal', '6.8')}
        {Object.keys(item.overrides ?? {}).length > 0 && <button className="link left" onClick={clearEdits}>Clear my edits</button>}
        {confirm
          ? <div className="row"><span className="small">Delete “{m.title}” and its viewings?</span><button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button><button className="btn sm danger-fill" onClick={onDeleted}>Delete</button></div>
          : <button className="btn danger" onClick={() => setConfirm(true)}>{kind === 'tv' ? 'Delete show' : 'Delete movie'}</button>}
      </div>
    </div>
  );
}
