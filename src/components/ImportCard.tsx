import { ChangeEvent, useEffect, useState } from 'react';
import { groupGameRows, groupRows, groupTvRows, importGroups, loadReviews, parseFileAll, parseManualId, Parsed, resolveReview, resolveReviewManual, ReviewItem, storePending } from '../lib/importer';
import { searchGames, searchTitles } from '../lib/remote';
import type { SearchHit } from '../lib/types';

export default function ImportCard({ email }: { email: string }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parts, setParts] = useState<Parsed[]>([]);
  const [phase, setPhase] = useState<'idle' | 'ready' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ ok: number; review: number; errors: string[]; friends: number } | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [error, setError] = useState('');
  const me = email.toLowerCase();

  useEffect(() => { loadReviews().then(setReviews); }, []);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setError('');
    // a full AppSheet export has movies, shows and games — pick which part to bring in
    try { const all = await parseFileAll(f); setParts(all); setParsed(all.length === 1 ? all[0] : null); setPhase('ready'); }
    catch { setError('Couldn’t read this file. Export the sheet from AppSheet as .xlsx or .csv and try again.'); }
  };

  const isTv = parsed?.kind === 'tv';
  const isGame = parsed?.kind === 'game';
  const all = (parsed?.rows ?? []) as { email: string }[];
  const mine = all.filter((r) => r.email === me);
  const others = all.filter((r) => r.email && r.email !== me);
  const groups = parsed?.kind === 'tv' ? groupTvRows(parsed.rows.filter((r) => r.email === me)) : parsed?.kind === 'game' ? groupGameRows(parsed.rows.filter((r) => r.email === me)) : parsed ? groupRows((parsed.rows as never[]).filter((r: { email: string }) => r.email === me)) : [];
  const people = new Set(others.map((r) => r.email)).size;
  const noun = isTv ? 'shows' : isGame ? 'games' : 'movies';

  const start = async () => {
    setPhase('running'); setProgress({ done: 0, total: groups.length });
    const res = await importGroups(groups, (done, total) => setProgress({ done, total }));
    let friends = 0;
    try { friends = await storePending(others as never[], isTv ? 'tv' : isGame ? 'games' : 'movies'); } catch { res.errors.push('Could not store rows for other people.'); }
    setResult({ ...res, friends }); setPhase('done'); setReviews(await loadReviews());
  };

  const choose = async (it: ReviewItem, sourceId: string | null) => {
    setReviews((r) => r.filter((x) => x.id !== it.id));
    await resolveReview(it, sourceId);
  };

  return (
    <section className="card stack">
      <h2 className="h2">Import from AppSheet</h2>
      {phase === 'idle' && <>
        <span className="muted small">Pick your AppSheet export (.xlsx or .csv). You’ll see a summary before anything is saved.</span>
        <label className="btn primary file-btn">Choose file<input type="file" accept=".xlsx,.xls,.csv" onChange={pick} /></label>
      </>}
      {phase === 'ready' && !parsed && <>
        <span className="small">This file has several parts. What do you want to import?</span>
        <div className="choice-buttons">
          {parts.map((p) => <button key={p.kind} className="choice" onClick={() => setParsed(p)}><strong>{p.kind === 'game' ? 'Games' : p.kind === 'tv' ? 'TV shows' : 'Movies'}</strong><span>{(p.rows as { email: string }[]).filter((r) => r.email === me).length} of your rows · already imported ones are skipped</span></button>)}
          <button className="choice ghost" onClick={() => { setParts([]); setPhase('idle'); }}>Cancel</button>
        </div>
      </>}
      {phase === 'ready' && parsed && <>
        <div className="facts">
          <div><span className="muted small">Your rows</span><strong>{mine.length}</strong></div>
          <div><span className="muted small">{isTv ? 'Shows' : isGame ? 'Games' : 'Movies'}</span><strong>{groups.length}</strong></div>
          {!isTv && !isGame && <div><span className="muted small">With IMDb ID</span><strong>{groups.filter((g) => (g as { imdbId?: string | null }).imdbId).length}</strong></div>}
          <div><span className="muted small">Other people</span><strong>{people} · {others.length} rows</strong></div>
        </div>
        <span className="muted small">{isGame ? 'Games are matched in IGDB by title, year and type (DLC too). Each row becomes a playthrough with its platform, date, rating and co-op; time to beat and Metascore are filled in afterwards.' : isTv ? 'Shows are matched by title and first year. Seasons, ratings and watch dates come along.' : 'Movies without an IMDb ID are matched by title and year.'} Unsure matches go to a review list. Other people’s rows wait until they sign in with their email.</span>
        <div className="row nowrap"><button className="btn grow" onClick={() => { setParsed(null); setPhase('idle'); }}>Cancel</button><button className="btn primary grow" onClick={start} disabled={!groups.length && !others.length}>Start import</button></div>
      </>}
      {phase === 'running' && <>
        <span className="small">Importing… {progress.done} of {progress.total} {noun}</span>
        <div className="bar"><span style={{ width: (progress.total ? (progress.done / progress.total) * 100 : 0) + '%' }} /></div>
        <span className="muted small">Keep the app open — this takes a few minutes.</span>
      </>}
      {phase === 'done' && result && <>
        <span className="small"><strong>{result.ok}</strong> {noun} imported · <strong>{result.review}</strong> to review{result.friends ? <> · <strong>{result.friends}</strong> rows saved for other people</> : null}</span>
        {result.errors.length > 0 && <span className="error small">{result.errors.length} failed. You can run the import again — already imported titles are skipped.</span>}
        <button className="btn" onClick={() => { setParsed(null); setResult(null); setPhase('idle'); }}>Import another file</button>
      </>}
      {error && <p className="error" role="alert">{error}</p>}

      {reviews.length > 0 && (
        <div className="stack">
          <span className="h2">Needs review · {reviews.length}</span>
          {reviews.map((it) => (
            <div key={it.id} className="review">
              <strong className="small">{it.payload.title} <span className="muted">{it.payload.year ?? ''}</span></strong>
              <div className="cands">
                {it.candidates.map((c) => (
                  <button key={c.sourceId} className="cand" onClick={() => choose(it, c.sourceId)}>
                    <span className="poster" style={{ width: 46, height: 68 }}>{c.posterUrl && <img src={c.posterUrl} alt="" />}</span>
                    <span className="small">{c.title}<br /><span className="muted">{c.year ?? ''}</span></span>
                  </button>
                ))}
                <button className="cand skip" onClick={() => choose(it, null)}>Skip</button>
              </div>
              <ManualPick item={it} onDone={() => setReviews((r) => r.filter((x) => x.id !== it.id))} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ManualPick({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(item.payload.title);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!open) return <button className="link left" onClick={() => setOpen(true)}>None of these — search or paste a link</button>;
  const run = async () => {
    const ref = parseManualId(q);
    setBusy(true); setMsg('');
    if (ref) {
      const ok = await resolveReviewManual(item, ref);
      setBusy(false);
      if (ok) onDone(); else setMsg('Couldn’t find that title. Check the link or ID.');
      return;
    }
    try { setHits(item.section === 'games' ? await searchGames(q) : await searchTitles(q, item.section === 'tv' ? 'tv' : 'movie')); } catch { setMsg('Search failed. Try again.'); }
    setBusy(false);
  };
  return (
    <div className="stack-sm">
      <div className="row nowrap">
        <label htmlFor={'mp-' + item.id} className="sr">Search for the movie or paste an IMDb link</label>
        <input id={'mp-' + item.id} className="text-input grow" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder="Title, or an IMDb link" />
        <button className="btn primary sm" onClick={run} disabled={busy}>{busy ? '…' : 'Find'}</button>
      </div>
      <span className="muted small">Try another spelling or the original title, or paste an IMDb link like imdb.com/title/tt0111161.</span>
      {msg && <span className="error small">{msg}</span>}
      {hits.length > 0 && (
        <div className="cands">
          {hits.slice(0, 8).map((c) => (
            <button key={c.sourceId} className="cand" disabled={busy} onClick={async () => { setBusy(true); const ok = await resolveReviewManual(item, { sourceId: c.sourceId }); setBusy(false); if (ok) onDone(); else setMsg('Import failed. Try again.'); }}>
              <span className="poster" style={{ width: 46, height: 68 }}>{c.posterUrl && <img src={c.posterUrl} alt="" />}</span>
              <span className="small">{c.title}<br /><span className="muted">{c.year ?? ''}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
