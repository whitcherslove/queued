import { ChangeEvent, useEffect, useState } from 'react';
import { groupRows, importGroups, ImportRow, loadReviews, parseFile, resolveReview, ReviewItem, storePending } from '../lib/importer';

export default function ImportCard({ email }: { email: string }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
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
    try { const r = await parseFile(f); setRows(r); setPhase('ready'); }
    catch { setError('Couldn’t read this file. Export the sheet from AppSheet as .xlsx or .csv and try again.'); }
  };

  const mine = rows?.filter((r) => r.email === me) ?? [];
  const others = rows?.filter((r) => r.email && r.email !== me) ?? [];
  const groups = groupRows(mine);
  const people = new Set(others.map((r) => r.email)).size;

  const start = async () => {
    setPhase('running'); setProgress({ done: 0, total: groups.length });
    const res = await importGroups(groups, (done, total) => setProgress({ done, total }));
    let friends = 0;
    try { friends = await storePending(others); } catch { res.errors.push('Could not store rows for other people.'); }
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
      {phase === 'ready' && <>
        <div className="facts">
          <div><span className="muted small">Your rows</span><strong>{mine.length}</strong></div>
          <div><span className="muted small">Movies</span><strong>{groups.length}</strong></div>
          <div><span className="muted small">With IMDb ID</span><strong>{groups.filter((g) => g.imdbId).length}</strong></div>
          <div><span className="muted small">Other people</span><strong>{people} · {others.length} rows</strong></div>
        </div>
        <span className="muted small">Movies without an IMDb ID are matched by title and year. Unsure matches go to a review list. Other people’s rows wait until they sign in with their email.</span>
        <div className="row nowrap"><button className="btn grow" onClick={() => { setRows(null); setPhase('idle'); }}>Cancel</button><button className="btn primary grow" onClick={start} disabled={!groups.length && !others.length}>Start import</button></div>
      </>}
      {phase === 'running' && <>
        <span className="small">Importing… {progress.done} of {progress.total} movies</span>
        <div className="bar"><span style={{ width: (progress.total ? (progress.done / progress.total) * 100 : 0) + '%' }} /></div>
        <span className="muted small">Keep the app open — this takes a few minutes.</span>
      </>}
      {phase === 'done' && result && <>
        <span className="small"><strong>{result.ok}</strong> movies imported · <strong>{result.review}</strong> to review{result.friends ? <> · <strong>{result.friends}</strong> rows saved for other people</> : null}</span>
        {result.errors.length > 0 && <span className="error small">{result.errors.length} failed. You can run the import again — already imported movies are skipped.</span>}
        <button className="btn" onClick={() => { setRows(null); setResult(null); setPhase('idle'); }}>Import another file</button>
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
