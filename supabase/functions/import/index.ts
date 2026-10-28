// Queued · import — bring AppSheet rows into the library
// actions: 'movies' (import groups for the caller), 'pending' (store other people's rows by email), 'claim' (take your pending rows)
// Secrets: TMDB_API_KEY, OMDB_API_KEY, optional ADMIN_EMAIL (only this account may store rows for other people)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const IMG = 'https://image.tmdb.org/t/p/';
const TIER: Record<string, string> = { '10 out of 10': 'ten', 'awesome': 'awesome', 'this is fine': 'fine', "so bad it's good": 'sobad', 'so bad it’s good': 'sobad', 'fucking filth': 'filth', 'dropped': 'dropped' };

interface Row { title: string; year: number | null; imdbId: string | null; rating: string | null; score: number | null; watchedAt: string | null; rewatch: boolean; metascore: number | null; imdb: number | null; ask: string | null; answer: string | null; order: number }
interface Group { key: string; sourceId?: string; imdbId?: string | null; title: string; year: number | null; rows: Row[] }

function tmdb(path: string, params: Record<string, string> = {}) {
  const key = Deno.env.get('TMDB_API_KEY') ?? '';
  const url = new URL('https://api.themoviedb.org/3' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; else url.searchParams.set('api_key', key);
  return fetch(url, { headers }).then((r) => (r.ok ? r.json() : null));
}
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v: unknown) => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };

async function resolve(g: Group): Promise<{ id?: string; candidates?: unknown[] }> {
  if (g.sourceId) return { id: g.sourceId };
  if (g.imdbId) {
    const f = await tmdb('/find/' + g.imdbId, { external_source: 'imdb_id' });
    const m = f?.movie_results?.[0];
    if (m) return { id: String(m.id) };
  }
  const params: Record<string, string> = { query: g.title, include_adult: 'false', language: 'en-US' };
  if (g.year) params.primary_release_year = String(g.year);
  let res = (await tmdb('/search/movie', params))?.results ?? [];
  if (!res.length && g.year) res = (await tmdb('/search/movie', { query: g.title, include_adult: 'false', language: 'en-US' }))?.results ?? [];
  const exact = res.filter((m: any) => norm(m.title) === norm(g.title) || norm(m.original_title ?? '') === norm(g.title));
  const sameYear = (m: any) => !g.year || String(m.release_date ?? '').startsWith(String(g.year));
  const strong = exact.filter(sameYear);
  if (strong.length === 1) return { id: String(strong[0].id) };
  if (strong.length === 0 && exact.length === 1 && res.length <= 3) return { id: String(exact[0].id) };
  return { candidates: res.slice(0, 4).map((m: any) => ({ sourceId: String(m.id), title: m.title, year: m.release_date ? Number(m.release_date.slice(0, 4)) : null, posterUrl: m.poster_path ? IMG + 'w185' + m.poster_path : null })) };
}

async function fetchTitle(db: any, id: string) {
  const { data: cached } = await db.from('titles').select('*').eq('kind', 'movie').eq('source', 'tmdb').eq('source_id', id).maybeSingle();
  if (cached) return cached;
  const m = await tmdb('/movie/' + id, { language: 'en-US', append_to_response: 'credits,external_ids' });
  if (!m) throw new Error('TMDB movie ' + id + ' not found');
  const imdbId = m.imdb_id || m.external_ids?.imdb_id || null;
  let parts: unknown[] = [];
  if (m.belongs_to_collection?.id) {
    const c = await tmdb('/collection/' + m.belongs_to_collection.id, { language: 'en-US' });
    parts = (c?.parts ?? []).filter((p: any) => p.release_date).sort((a: any, b: any) => String(a.release_date).localeCompare(String(b.release_date)))
      .map((p: any) => ({ sourceId: String(p.id), title: p.title, year: Number(String(p.release_date).slice(0, 4)), posterUrl: p.poster_path ? IMG + 'w185' + p.poster_path : null }));
  }
  let metascore: number | null = null, imdbRating: number | null = null;
  const ok = Deno.env.get('OMDB_API_KEY');
  if (imdbId && ok) { const o = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${ok}`); if (o.ok) { const oj = await o.json(); metascore = num(oj.Metascore); imdbRating = num(oj.imdbRating); } }
  const row = {
    kind: 'movie', source: 'tmdb', source_id: String(m.id), imdb_id: imdbId, title: m.title, release_date: m.release_date || null,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null, runtime: m.runtime || null,
    directors: (m.credits?.crew ?? []).filter((c: any) => c.job === 'Director').map((c: any) => c.name), genres: (m.genres ?? []).map((g: any) => g.name),
    overview: m.overview || null, poster_url: m.poster_path ? IMG + 'w342' + m.poster_path : null, backdrop_url: m.backdrop_path ? IMG + 'w1280' + m.backdrop_path : null,
    metascore: metascore !== null ? Math.round(metascore) : null, imdb_rating: imdbRating,
    data: { cast: (m.credits?.cast ?? []).slice(0, 8).map((c: any) => ({ name: c.name, role: c.character })), collection: m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name, parts } : null,
      countries: (m.production_countries ?? []).map((c: any) => c.name), language: m.original_language, budget: m.budget || null, revenue: m.revenue || null },
    fetched_at: new Date().toISOString()
  };
  const { data, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
  if (error) throw error;
  return data;
}

async function importGroup(admin: any, user: any, uid: string, g: Group, basePos: number) {
  const r = await resolve(g);
  if (!r.id && g.imdbId && (g as any).manual) {
    const res = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/title', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') }, body: JSON.stringify({ kind: 'movie', imdbId: g.imdbId }) });
    const j = res.ok ? await res.json() : null;
    if (j?.title) return finishGroup(admin, user, g, j.title, basePos);
  }
  if (!r.id) {
    if (!(g as any).manual) await user.from('import_reviews').insert({ section: 'movies', payload: g, candidates: r.candidates ?? [] });
    return { key: g.key, status: 'review' };
  }
  const t = await fetchTitle(admin, r.id);
  return finishGroup(admin, user, g, t, basePos);
}

async function finishGroup(admin: any, user: any, g: Group, t: any, basePos: number) {
  const rows = g.rows.slice().sort((a, b) => String(a.watchedAt ?? '').localeCompare(String(b.watchedAt ?? '')));
  const watched = rows.filter((x) => x.rating && x.rating.toLowerCase() !== 'backlog' && x.watchedAt);
  const backlog = rows.filter((x) => !x.rating || x.rating.toLowerCase() === 'backlog');
  const fallback: Record<string, unknown> = {};
  const src = rows.find((x) => x.metascore !== null) ; if (t.metascore === null && src) fallback.metascore = src.metascore;
  const srcI = rows.find((x) => x.imdb !== null); if (t.imdb_rating === null && srcI) fallback.imdb_rating = srcI.imdb;
  const lastTier = watched.length ? TIER[(watched[watched.length - 1].rating ?? '').toLowerCase()] ?? null : null;
  const status = watched.length ? (lastTier === 'dropped' ? 'dropped' : 'done') : 'backlog';
  const upNext = watched.length > 0 && backlog.length > 0;
  const { data: existing } = await user.from('library').select('id, overrides').eq('title_id', t.id).maybeSingle();
  let libId: string;
  if (existing) {
    libId = existing.id;
    await user.from('library').update({ status, ...(upNext ? { up_next: true } : {}), overrides: { ...fallback, ...(existing.overrides ?? {}) } }).eq('id', libId);
  } else {
    const ins = await user.from('library').insert({ title_id: t.id, section: 'movies', status, up_next: upNext, position: basePos + Math.min(...rows.map((x) => x.order)), overrides: fallback }).select('id').single();
    if (ins.error) throw ins.error;
    libId = ins.data.id;
  }
  if (watched.length) {
    const { data: have } = await user.from('logs').select('watched_at').eq('library_id', libId);
    const seen = new Set((have ?? []).map((h: any) => new Date(h.watched_at).toISOString()));
    const logs = watched.map((x, i) => {
      let score = x.score; if (score !== null && score > 5) score = score <= 10 ? score / 2 : null;
      return { library_id: libId, watched_at: new Date(x.watchedAt!).toISOString(), tier: TIER[(x.rating ?? '').toLowerCase()] ?? null, score: score === null ? null : Math.round(score * 4) / 4, rewatch: x.rewatch || i > 0 };
    }).filter((l) => !seen.has(l.watched_at));
    if (logs.length) { const e = await user.from('logs').insert(logs); if (e.error) throw e.error; }
  }
  const chats: { library_id: string; role: string; content: string }[] = [];
  rows.forEach((x) => { if (x.ask) { chats.push({ library_id: libId, role: 'user', content: x.ask }); if (x.answer) chats.push({ library_id: libId, role: 'model', content: x.answer }); } });
  if (chats.length) {
    const { count } = await user.from('chats').select('id', { count: 'exact', head: true }).eq('library_id', libId);
    if (!count) await user.from('chats').insert(chats);
  }
  return { key: g.key, status: 'ok', title: t.title };
}


// ---------------------------------------------------------------- TV shows
interface TvSeasonCell { n: number; value: string; date: string | null }
interface TvRow { title: string; year: number | null; rating: string | null; score: number | null; finishAt: string | null; rewatch: boolean; seasons: TvSeasonCell[]; metascore: number | null; imdb: number | null; ask: string | null; answer: string | null; order: number }
interface TvGroup { key: string; kind: 'tv'; sourceId?: string; imdbId?: string | null; title: string; year: number | null; rows: TvRow[]; manual?: boolean }

async function omdbScores(imdbId: string | null) {
  const key = Deno.env.get('OMDB_API_KEY');
  if (!imdbId || !key) return { metascore: null as number | null, imdb: null as number | null };
  const o = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
  if (!o.ok) return { metascore: null, imdb: null };
  const j = await o.json(); const ms = num(j.Metascore);
  return { metascore: ms !== null ? Math.round(ms) : null, imdb: num(j.imdbRating) };
}

async function fetchTv(db: any, id: string) {
  const { data: cached } = await db.from('titles').select('*').eq('kind', 'tv').eq('source', 'tmdb').eq('source_id', id).maybeSingle();
  if (cached) return cached;
  const m = await tmdb('/tv/' + id, { language: 'en-US', append_to_response: 'credits,external_ids' });
  if (!m) throw new Error('TMDB show ' + id + ' not found');
  const imdbId = m.external_ids?.imdb_id || null;
  const sc = await omdbScores(imdbId);
  const seasons = (m.seasons ?? []).filter((x: any) => x.season_number > 0).map((x: any) => ({ n: x.season_number, name: x.name, air_date: x.air_date || null, episode_count: x.episode_count || 0 }));
  const row = {
    kind: 'tv', source: 'tmdb', source_id: String(m.id), imdb_id: imdbId, title: m.name,
    release_date: m.first_air_date || null, year: m.first_air_date ? Number(m.first_air_date.slice(0, 4)) : null, runtime: (m.episode_run_time ?? [])[0] || null,
    directors: (m.created_by ?? []).map((c: any) => c.name), genres: (m.genres ?? []).map((g: any) => g.name), overview: m.overview || null,
    poster_url: m.poster_path ? IMG + 'w342' + m.poster_path : null, backdrop_url: m.backdrop_path ? IMG + 'w1280' + m.backdrop_path : null,
    metascore: sc.metascore, imdb_rating: sc.imdb,
    data: { status: m.status, network: (m.networks ?? [])[0]?.name ?? null, seasons, number_of_episodes: m.number_of_episodes ?? null, last_air_date: m.last_air_date ?? null,
      next_episode: m.next_episode_to_air ? { season: m.next_episode_to_air.season_number, episode: m.next_episode_to_air.episode_number, air_date: m.next_episode_to_air.air_date } : null,
      cast: (m.credits?.cast ?? []).slice(0, 8).map((c: any) => ({ name: c.name, role: c.character })), countries: m.origin_country ?? [], language: m.original_language },
    fetched_at: new Date().toISOString()
  };
  const { data, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
  if (error) throw error;
  return data;
}


/** Build a TV title from OMDb (IMDb data) when TMDB doesn't have the show: seasons and episodes included. */
async function tvFromOmdb(db: any, imdbId: string) {
  const key = Deno.env.get('OMDB_API_KEY'); if (!key) return null;
  const o = await fetch(`https://www.omdbapi.com/?i=${imdbId}&plot=full&apikey=${key}`);
  const j = o.ok ? await o.json() : null;
  if (!j || j.Response !== 'True') return null;
  const list = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'N/A');
  const date = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };
  const total = Number(j.totalSeasons) || 0;
  const seasons: { n: number; name: string; air_date: string | null; episode_count: number; episodes: any[] }[] = [];
  for (let n = 1; n <= Math.min(total, 40); n++) {
    const r = await fetch(`https://www.omdbapi.com/?i=${imdbId}&Season=${n}&apikey=${key}`);
    const sj = r.ok ? await r.json() : null;
    const eps = (sj?.Episodes ?? []).map((e: any) => ({ n: Number(e.Episode), name: e.Title, air_date: date(e.Released), runtime: null })).filter((e: any) => e.n > 0);
    if (eps.length) seasons.push({ n, name: 'Season ' + n, air_date: eps[0].air_date, episode_count: eps.length, episodes: eps });
  }
  if (!seasons.length) seasons.push({ n: 1, name: 'Season 1', air_date: date(j.Released), episode_count: 1, episodes: [{ n: 1, name: j.Title, air_date: date(j.Released), runtime: null }] });
  const years = String(j.Year ?? '');
  const running = /[–-]\s*$/.test(years);
  const ms = num(j.Metascore);
  const row = {
    kind: 'tv', source: 'imdb', source_id: imdbId, imdb_id: imdbId, title: j.Title,
    release_date: seasons[0].air_date ?? date(j.Released), year: num(years.slice(0, 4)), runtime: num(j.Runtime),
    directors: list(j.Writer).slice(0, 3), genres: list(j.Genre), overview: j.Plot && j.Plot !== 'N/A' ? j.Plot : null,
    poster_url: j.Poster && j.Poster !== 'N/A' ? j.Poster : null, backdrop_url: null,
    metascore: ms !== null ? Math.round(ms) : null, imdb_rating: num(j.imdbRating),
    data: { status: running ? 'Returning Series' : 'Ended', network: null, seasons: seasons.map(({ episodes, ...s }) => s), number_of_episodes: seasons.reduce((a, s) => a + s.episode_count, 0),
      last_air_date: seasons[seasons.length - 1].episodes.map((e) => e.air_date).filter(Boolean).pop() ?? null, next_episode: null,
      cast: list(j.Actors).map((n) => ({ name: n, role: '' })), countries: list(j.Country), language: (list(j.Language)[0] ?? '').slice(0, 2).toLowerCase() },
    fetched_at: new Date().toISOString()
  };
  const { data: t, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
  if (error) throw error;
  for (const s of seasons) await db.from('title_seasons').upsert({ title_id: t.id, season: s.n, name: s.name, air_date: s.air_date, episodes: s.episodes, fetched_at: new Date().toISOString() }, { onConflict: 'title_id,season' });
  return t;
}

async function episodesOf(db: any, t: any): Promise<Map<number, number[]>> {
  const { data: have } = await db.from('title_seasons').select('season, episodes').eq('title_id', t.id);
  const map = new Map<number, number[]>((have ?? []).map((h: any) => [h.season, (h.episodes ?? []).map((e: any) => e.n)]));
  for (const s of t.data?.seasons ?? []) {
    if (map.has(s.n) || t.source !== 'tmdb') continue;
    const j = await tmdb('/tv/' + t.source_id + '/season/' + s.n, { language: 'en-US' });
    if (!j) continue;
    const episodes = (j.episodes ?? []).map((e: any) => ({ n: e.episode_number, name: e.name, air_date: e.air_date || null, runtime: e.runtime || null }));
    await db.from('title_seasons').upsert({ title_id: t.id, season: s.n, name: j.name ?? s.name, air_date: j.air_date || s.air_date, episodes, fetched_at: new Date().toISOString() }, { onConflict: 'title_id,season' });
    map.set(s.n, episodes.map((e: any) => e.n));
  }
  return map;
}

async function resolveTv(g: TvGroup): Promise<{ id?: string; candidates?: unknown[] }> {
  if (g.sourceId) return { id: g.sourceId };
  if (g.imdbId) { const f = await tmdb('/find/' + g.imdbId, { external_source: 'imdb_id' }); if (f?.tv_results?.[0]) return { id: String(f.tv_results[0].id) }; }
  const params: Record<string, string> = { query: g.title, include_adult: 'false', language: 'en-US' };
  if (g.year) params.first_air_date_year = String(g.year);
  let res = (await tmdb('/search/tv', params))?.results ?? [];
  if (!res.length && g.year) res = (await tmdb('/search/tv', { query: g.title, include_adult: 'false', language: 'en-US' }))?.results ?? [];
  const exact = res.filter((m: any) => norm(m.name) === norm(g.title) || norm(m.original_name ?? '') === norm(g.title));
  const sameYear = (m: any) => !g.year || String(m.first_air_date ?? '').startsWith(String(g.year));
  const strong = exact.filter(sameYear);
  if (strong.length === 1) return { id: String(strong[0].id) };
  if (strong.length === 0 && exact.length === 1 && res.length <= 3) return { id: String(exact[0].id) };
  return { candidates: res.slice(0, 4).map((m: any) => ({ sourceId: String(m.id), title: m.name, year: m.first_air_date ? Number(m.first_air_date.slice(0, 4)) : null, posterUrl: m.poster_path ? IMG + 'w185' + m.poster_path : null })) };
}

const isTier = (v: string | null | undefined) => !!v && !!TIER[v.toLowerCase()];
const kindOf = (v: string | null | undefined) => (v ?? '').toLowerCase();

async function importTvGroup(admin: any, user: any, g: TvGroup, basePos: number) {
  const r = await resolveTv(g);
  let t: any = null;
  if (!r.id && g.imdbId && g.manual) {
    const { data: have } = await admin.from('titles').select('*').eq('kind', 'tv').eq('source', 'imdb').eq('source_id', g.imdbId).maybeSingle();
    t = have ?? await tvFromOmdb(admin, g.imdbId);
  }
  if (!r.id && !t) { if (!g.manual) await user.from('import_reviews').insert({ section: 'tv', payload: g, candidates: r.candidates ?? [] }); return { key: g.key, status: 'review' }; }
  if (!t) t = await fetchTv(admin, r.id!);
  const eps = await episodesOf(admin, t);
  const allSeasons: number[] = (t.data?.seasons ?? []).map((x: any) => x.n);
  const ended = ['Ended', 'Canceled'].includes(t.data?.status);
  const rows = g.rows.slice().sort((a, b) => String(a.finishAt ?? '9999').localeCompare(String(b.finishAt ?? '9999')));

  const logs: any[] = [], ratings = new Map<number, { tier: string; score: null; rated_at: string }>(), marks = new Map<string, string>();
  let covered = 0, plan: number[] | null | undefined, status: 'done' | 'playing' | 'backlog' = 'done', runStart: string | null = null, startedOn: string | null = null, rewPlan = false;
  const markSeason = (n: number, at: string) => (eps.get(n) ?? []).forEach((e) => marks.set(n + ':' + e, at));

  for (const row of rows) {
    const kind = kindOf(row.rating);
    if (kind === 'in progress') {
      const listed = row.seasons.map((c) => c.n).sort((a, b) => a - b);
      plan = listed.length ? listed : null;
      status = 'playing';
      const dates = row.seasons.map((c) => c.date).filter(Boolean).sort() as string[];
      runStart = dates[0] ? new Date(new Date(dates[0]).getTime() - 864e5).toISOString() : new Date().toISOString();
      startedOn = (dates[0] ?? new Date().toISOString()).slice(0, 10);
      row.seasons.filter((c) => isTier(c.value)).forEach((c) => {
        const at = c.date ?? row.finishAt ?? new Date().toISOString();
        markSeason(c.n, at);
        ratings.set(c.n, { tier: TIER[c.value.toLowerCase()], score: null, rated_at: at.slice(0, 10) });
      });
      rewPlan = row.rewatch;
      continue;
    }
    if (kind === 'backlog' || !kind) {
      if (status !== 'playing') {
        const listed = row.seasons.map((c) => c.n).sort((a, b) => a - b);
        plan = listed.length ? listed : null; status = 'backlog'; runStart = new Date().toISOString(); rewPlan = row.rewatch;
      }
      continue;
    }
    if (!isTier(row.rating)) continue;
    // seasons this entry covers (fixing the two known quirks: a dated "Backlog" cell, or no seasons at all)
    let cells = row.seasons.filter((c) => isTier(c.value));
    if (!cells.length) cells = row.seasons.filter((c) => c.date).map((c) => ({ ...c, value: row.rating! }));
    if (!cells.length) { const n = covered + 1; if (allSeasons.includes(n)) cells = [{ n, value: row.rating!, date: row.finishAt }]; }
    if (!cells.length) continue;
    const list = cells.map((c) => c.n).sort((a, b) => a - b);
    const at = row.finishAt ?? cells.map((c) => c.date).filter(Boolean).sort().pop() ?? new Date().toISOString();
    const full = ended && allSeasons.length > 0 && allSeasons.every((n) => list.includes(n));
    logs.push({ scope: full ? 'show' : list.length === 1 ? 'season' : 'seasons', season_from: full ? null : list[0], season_to: full ? null : list[list.length - 1], seasons: full ? null : list,
      watched_at: new Date(at).toISOString(), tier: TIER[row.rating!.toLowerCase()], score: row.score === null ? null : Math.min(5, Math.max(0, row.score)), rewatch: row.rewatch });
    cells.forEach((c) => { const d = c.date ?? at; markSeason(c.n, d); ratings.set(c.n, { tier: TIER[c.value.toLowerCase()] ?? TIER[row.rating!.toLowerCase()], score: null, rated_at: d.slice(0, 10) }); });
    covered = Math.max(covered, ...list);
    if (status === 'done') plan = undefined;
  }
  if (!logs.length && status === 'done') { status = 'backlog'; runStart = new Date().toISOString(); }

  const fallback: Record<string, unknown> = {};
  const ms = rows.find((x) => x.metascore !== null); if (t.metascore === null && ms) fallback.metascore = ms.metascore;
  const im = rows.find((x) => x.imdb !== null); if (t.imdb_rating === null && im) fallback.imdb_rating = im.imdb;
  const planPatch = plan === undefined ? {} : { plan_seasons: plan, plan_from: plan ? plan[0] : null, plan_to: plan ? plan[plan.length - 1] : null };
  const { data: existing } = await user.from('library').select('id').eq('title_id', t.id).maybeSingle();
  let libId: string;
  const base = { status, ...planPatch, run_started_at: runStart, started_on: startedOn, rewatch: status !== 'done' && rewPlan, overrides: fallback };
  if (existing) { libId = existing.id; await user.from('library').update(base).eq('id', libId); }
  else {
    const ins = await user.from('library').insert({ title_id: t.id, section: 'tv', position: basePos + Math.min(...rows.map((x) => x.order)), ...base }).select('id').single();
    if (ins.error) throw ins.error; libId = ins.data.id;
  }
  if (logs.length) {
    const { data: have } = await user.from('logs').select('watched_at').eq('library_id', libId);
    const seen = new Set((have ?? []).map((h: any) => new Date(h.watched_at).toISOString()));
    const fresh = logs.filter((l) => !seen.has(l.watched_at)).map((l) => ({ ...l, library_id: libId }));
    if (fresh.length) { const e = await user.from('logs').insert(fresh); if (e.error) throw e.error; }
  }
  const markRows = [...marks.entries()].map(([k, at]) => { const [s, e] = k.split(':').map(Number); return { library_id: libId, season: s, episode: e, watched_at: new Date(at).toISOString() }; });
  for (let i = 0; i < markRows.length; i += 500) { const e = await user.from('episode_marks').upsert(markRows.slice(i, i + 500), { onConflict: 'library_id,season,episode' }); if (e.error) throw e.error; }
  const rateRows = [...ratings.entries()].map(([n, v]) => ({ library_id: libId, season: n, tier: v.tier, rated_at: v.rated_at }));
  if (rateRows.length) { const e = await user.from('season_ratings').upsert(rateRows, { onConflict: 'library_id,season' }); if (e.error) throw e.error; }
  const chats: any[] = [];
  rows.forEach((x) => { if (x.ask) { chats.push({ library_id: libId, role: 'user', content: x.ask }); if (x.answer) chats.push({ library_id: libId, role: 'model', content: x.answer }); } });
  if (chats.length) { const { count } = await user.from('chats').select('id', { count: 'exact', head: true }).eq('library_id', libId); if (!count) await user.from('chats').insert(chats); }
  return { key: g.key, status: 'ok', title: t.title };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: who } = await user.auth.getUser();
    if (!who?.user) return Response.json({ error: 'Not signed in' }, { status: 401, headers: CORS });
    const uid = who.user.id, email = (who.user.email ?? '').toLowerCase();
    const body = await req.json();

    if (body.action === 'pending') {
      const adminEmail = (Deno.env.get('ADMIN_EMAIL') ?? '').toLowerCase();
      if (adminEmail && adminEmail !== email) return Response.json({ error: 'Only the admin can store rows for other people' }, { status: 403, headers: CORS });
      const section = body.section === 'tv' ? 'tv' : 'movies';
      const rows = (body.rows ?? []).filter((r: any) => r.email && r.email.toLowerCase() !== email).map((r: any) => ({ email: r.email.toLowerCase(), section, payload: r, created_by: uid }));
      for (let i = 0; i < rows.length; i += 200) { const e = await admin.from('pending_imports').insert(rows.slice(i, i + 200)); if (e.error) throw e.error; }
      return Response.json({ stored: rows.length }, { headers: CORS });
    }
    if (body.action === 'claim') {
      const { data } = await admin.from('pending_imports').select('id, payload, section').eq('email', email);
      const ids = (data ?? []).map((d: any) => d.id);
      if (ids.length) await admin.from('pending_imports').delete().in('id', ids);
      return Response.json({ rows: (data ?? []).filter((d: any) => d.section !== 'tv').map((d: any) => d.payload), tvRows: (data ?? []).filter((d: any) => d.section === 'tv').map((d: any) => d.payload) }, { headers: CORS });
    }
    if (body.action === 'tv') {
      const { data: maxRow } = await user.from('library').select('position').eq('section', 'tv').order('position', { ascending: false }).limit(1).maybeSingle();
      const basePos = (maxRow?.position ?? 0) + 1;
      const results = [];
      for (const g of (body.groups ?? []) as TvGroup[]) {
        try { results.push(await importTvGroup(admin, user, g, basePos)); }
        catch (e) { results.push({ key: g.key, status: 'error', message: String(e) }); }
      }
      return Response.json({ results }, { headers: CORS });
    }
    if (body.action === 'movies') {
      const { data: maxRow } = await user.from('library').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
      const basePos = (maxRow?.position ?? 0) + 1;
      const results = [];
      for (const g of (body.groups ?? []) as Group[]) {
        try { results.push(await importGroup(admin, user, uid, g, basePos)); }
        catch (e) { results.push({ key: g.key, status: 'error', message: String(e) }); }
      }
      return Response.json({ results }, { headers: CORS });
    }
    return Response.json({ error: 'Unknown action' }, { status: 400, headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
