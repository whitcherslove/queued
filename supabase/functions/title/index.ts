// Queued · title — fetch full details (TMDB + OMDb), cache them in public.titles
// Secrets: TMDB_API_KEY, OMDB_API_KEY. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const IMG = 'https://image.tmdb.org/t/p/';
const FRESH_DAYS = 7;

function tmdbFetch(path: string, params: Record<string, string> = {}) {
  const key = Deno.env.get('TMDB_API_KEY') ?? '';
  const url = new URL('https://api.themoviedb.org/3' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; else url.searchParams.set('api_key', key);
  return fetch(url, { headers });
}

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}


async function omdbScores(imdbId: string | null) {
  const key = Deno.env.get('OMDB_API_KEY');
  if (!imdbId || !key) return { metascore: null as number | null, imdb: null as number | null };
  const o = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
  if (!o.ok) return { metascore: null, imdb: null };
  const j = await o.json();
  const ms = num(j.Metascore);
  return { metascore: ms !== null ? Math.round(ms) : null, imdb: num(j.imdbRating) };
}

/** Fetch a TV show from TMDB (+ OMDb scores) and upsert it into titles. */
async function fetchTv(db: any, id: string) {
  const r = await tmdbFetch('/tv/' + id, { language: 'en-US', append_to_response: 'credits,external_ids' });
  if (!r.ok) throw new Error('TMDB ' + r.status);
  const m = await r.json();
  const imdbId = m.external_ids?.imdb_id || null;
  const sc = await omdbScores(imdbId);
  const seasons = (m.seasons ?? []).filter((x: any) => x.season_number > 0)
    .map((x: any) => ({ n: x.season_number, name: x.name, air_date: x.air_date || null, episode_count: x.episode_count || 0 }));
  const row = {
    kind: 'tv', source: 'tmdb', source_id: String(m.id), imdb_id: imdbId, title: m.name,
    release_date: m.first_air_date || null, year: m.first_air_date ? Number(m.first_air_date.slice(0, 4)) : null,
    runtime: (m.episode_run_time ?? [])[0] || null,
    directors: (m.created_by ?? []).map((c: any) => c.name), genres: (m.genres ?? []).map((g: any) => g.name),
    overview: m.overview || null, poster_url: m.poster_path ? IMG + 'w342' + m.poster_path : null, backdrop_url: m.backdrop_path ? IMG + 'w1280' + m.backdrop_path : null,
    metascore: sc.metascore, imdb_rating: sc.imdb,
    data: {
      status: m.status, network: (m.networks ?? [])[0]?.name ?? null, seasons, number_of_episodes: m.number_of_episodes ?? null,
      last_air_date: m.last_air_date ?? null,
      next_episode: m.next_episode_to_air ? { season: m.next_episode_to_air.season_number, episode: m.next_episode_to_air.episode_number, air_date: m.next_episode_to_air.air_date } : null,
      cast: (m.credits?.cast ?? []).slice(0, 8).map((c: any) => ({ name: c.name, role: c.character })),
      countries: m.origin_country ?? [], language: m.original_language
    },
    fetched_at: new Date().toISOString()
  };
  const { data, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
  if (error) throw error;
  return data;
}

const ended = (t: any) => ['Ended', 'Canceled'].includes(t?.data?.status);
const stale = (iso: string, hours: number) => Date.now() - new Date(iso).getTime() > hours * 3600e3;

/** Make sure every season's episode list is cached; refresh running shows twice a day. */
async function ensureEpisodes(db: any, sourceId: string) {
  let { data: t } = await db.from('titles').select('*').eq('kind', 'tv').eq('source', 'tmdb').eq('source_id', sourceId).maybeSingle();
  if (!t || (!ended(t) && stale(t.fetched_at, 12))) t = await fetchTv(db, sourceId);
  const { data: have } = await db.from('title_seasons').select('season, fetched_at').eq('title_id', t.id);
  const got = new Map((have ?? []).map((h: any) => [h.season, h.fetched_at]));
  for (const s of t.data?.seasons ?? []) {
    const f = got.get(s.n);
    if (f && (ended(t) || !stale(f as string, 12))) continue;
    const r = await tmdbFetch('/tv/' + sourceId + '/season/' + s.n, { language: 'en-US' });
    if (!r.ok) continue;
    const j = await r.json();
    const episodes = (j.episodes ?? []).map((e: any) => ({ n: e.episode_number, name: e.name, air_date: e.air_date || null, runtime: e.runtime || null }));
    await db.from('title_seasons').upsert({ title_id: t.id, season: s.n, name: j.name ?? s.name, air_date: j.air_date || s.air_date, episodes, fetched_at: new Date().toISOString() }, { onConflict: 'title_id,season' });
  }
  return t;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    if (body.kind === 'tv' && body.action !== 'images') {
      const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      if (body.action === 'episodes') {
        const ids: string[] = (body.sourceIds ?? [body.sourceId]).filter(Boolean).slice(0, 10);
        for (const id of ids) { try { await ensureEpisodes(db, String(id)); } catch { /* keep going */ } }
        return Response.json({ ok: true }, { headers: CORS });
      }
      let sid = body.sourceId as string | undefined;
      if (!sid && typeof body.imdbId === 'string') {
        const f = await tmdbFetch('/find/' + body.imdbId, { external_source: 'imdb_id' });
        const fj = f.ok ? await f.json() : null;
        if (fj?.tv_results?.[0]) sid = String(fj.tv_results[0].id);
      }
      if (!sid) return Response.json({ error: 'Not found' }, { status: 404, headers: CORS });
      const { data: cached } = await db.from('titles').select('*').eq('kind', 'tv').eq('source', 'tmdb').eq('source_id', String(sid)).maybeSingle();
      if (cached && !body.force && (ended(cached) || !stale(cached.fetched_at, 12))) return Response.json({ title: cached }, { headers: CORS });
      const t = await fetchTv(db, String(sid));
      return Response.json({ title: t }, { headers: CORS });
    }
    if (body.action === 'images') {
      const r = await tmdbFetch('/' + (body.kind === 'tv' ? 'tv' : 'movie') + '/' + body.sourceId + '/images', { include_image_language: 'en,null' });
      if (!r.ok) return Response.json({ backdrops: [], posters: [] }, { headers: CORS });
      const j = await r.json();
      const backdrops = (j.backdrops ?? []).sort((a: any, b: any) => (b.vote_count ?? 0) - (a.vote_count ?? 0)).slice(0, 24)
        .map((b: any) => ({ thumb: IMG + 'w780' + b.file_path, full: IMG + 'w1280' + b.file_path }));
      const pr = await tmdbFetch('/' + (body.kind === 'tv' ? 'tv' : 'movie') + '/' + body.sourceId + '/images', { include_image_language: 'en,null,ru' });
      const pj = pr.ok ? await pr.json() : { posters: [] };
      const posters = (pj.posters ?? []).sort((a: any, b: any) => (b.vote_count ?? 0) - (a.vote_count ?? 0)).slice(0, 30)
        .map((p: any) => ({ thumb: IMG + 'w185' + p.file_path, full: IMG + 'w342' + p.file_path }));
      return Response.json({ backdrops, posters }, { headers: CORS });
    }
    const { kind, force } = body;
    let sourceId = body.sourceId as string | undefined;
    const imdbIn = typeof body.imdbId === 'string' && /^tt\d{6,10}$/.test(body.imdbId) ? body.imdbId : null;
    if (kind !== 'movie' || (!sourceId && !imdbIn)) return Response.json({ error: 'kind=movie and sourceId or imdbId are required' }, { status: 400, headers: CORS });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // IMDb id: prefer the TMDB movie; if TMDB doesn't have it (specials, shorts), build the title from OMDb
    if (!sourceId && imdbIn) {
      const f = await tmdbFetch('/find/' + imdbIn, { external_source: 'imdb_id' });
      const fj = f.ok ? await f.json() : null;
      const hit = fj?.movie_results?.[0];
      if (hit) sourceId = String(hit.id);
      else {
        const { data: have } = await db.from('titles').select('*').eq('kind', 'movie').eq('source', 'imdb').eq('source_id', imdbIn).maybeSingle();
        if (have && !force) return Response.json({ title: have }, { headers: CORS });
        const omdbKey = Deno.env.get('OMDB_API_KEY');
        const o = omdbKey ? await fetch(`https://www.omdbapi.com/?i=${imdbIn}&plot=full&apikey=${omdbKey}`) : null;
        const oj = o && o.ok ? await o.json() : null;
        if (!oj || oj.Response !== 'True') return Response.json({ error: 'Not found on TMDB or OMDb' }, { status: 404, headers: CORS });
        const list = (v: unknown) => String(v ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== 'N/A');
        const rel = Date.parse(oj.Released); const relIso = Number.isFinite(rel) ? new Date(rel).toISOString().slice(0, 10) : null;
        const row = {
          kind: 'movie', source: 'imdb', source_id: imdbIn, imdb_id: imdbIn, title: oj.Title,
          release_date: relIso, year: num(String(oj.Year).slice(0, 4)), runtime: num(oj.Runtime),
          directors: list(oj.Director), genres: list(oj.Genre), overview: oj.Plot && oj.Plot !== 'N/A' ? oj.Plot : null,
          poster_url: oj.Poster && oj.Poster !== 'N/A' ? oj.Poster : null, backdrop_url: null,
          metascore: num(oj.Metascore) !== null ? Math.round(num(oj.Metascore)!) : null, imdb_rating: num(oj.imdbRating),
          data: { cast: list(oj.Actors).map((n) => ({ name: n, role: '' })), collection: null, countries: list(oj.Country), language: (list(oj.Language)[0] ?? '').slice(0, 2).toLowerCase() },
          fetched_at: new Date().toISOString()
        };
        const { data, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
        if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
        return Response.json({ title: data }, { headers: CORS });
      }
    }

    const { data: cached } = await db.from('titles').select('*').eq('kind', 'movie').eq('source', 'tmdb').eq('source_id', String(sourceId)).maybeSingle();
    if (cached && !force && Date.now() - new Date(cached.fetched_at).getTime() < FRESH_DAYS * 864e5) return Response.json({ title: cached }, { headers: CORS });

    const r = await tmdbFetch('/movie/' + sourceId, { language: 'en-US', append_to_response: 'credits,external_ids' });
    if (!r.ok) return Response.json({ error: 'TMDB ' + r.status }, { status: 502, headers: CORS });
    const m = await r.json();
    const imdbId = m.imdb_id || m.external_ids?.imdb_id || null;

    let parts: unknown[] = [];
    if (m.belongs_to_collection?.id) {
      const c = await tmdbFetch('/collection/' + m.belongs_to_collection.id, { language: 'en-US' });
      if (c.ok) {
        const cj = await c.json();
        parts = (cj.parts ?? [])
          .filter((p: any) => p.release_date)
          .sort((a: any, b: any) => String(a.release_date).localeCompare(String(b.release_date)))
          .map((p: any) => ({ sourceId: String(p.id), title: p.title, year: Number(String(p.release_date).slice(0, 4)), posterUrl: p.poster_path ? IMG + 'w185' + p.poster_path : null }));
      }
    }

    let metascore: number | null = null, imdbRating: number | null = null;
    const omdbKey = Deno.env.get('OMDB_API_KEY');
    if (imdbId && omdbKey) {
      const o = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${omdbKey}`);
      if (o.ok) { const oj = await o.json(); metascore = num(oj.Metascore); imdbRating = num(oj.imdbRating); }
    }

    const row = {
      kind: 'movie', source: 'tmdb', source_id: String(m.id), imdb_id: imdbId,
      title: m.title,
      release_date: m.release_date || null,
      year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
      runtime: m.runtime || null,
      directors: (m.credits?.crew ?? []).filter((c: any) => c.job === 'Director').map((c: any) => c.name),
      genres: (m.genres ?? []).map((g: any) => g.name),
      overview: m.overview || null,
      poster_url: m.poster_path ? IMG + 'w342' + m.poster_path : null,
      backdrop_url: m.backdrop_path ? IMG + 'w1280' + m.backdrop_path : null,
      metascore: metascore !== null ? Math.round(metascore) : null,
      imdb_rating: imdbRating,
      data: {
        cast: (m.credits?.cast ?? []).slice(0, 8).map((c: any) => ({ name: c.name, role: c.character })),
        collection: m.belongs_to_collection ? { id: m.belongs_to_collection.id, name: m.belongs_to_collection.name, parts } : null,
        countries: (m.production_countries ?? []).map((c: any) => c.name),
        language: m.original_language, budget: m.budget || null, revenue: m.revenue || null, tagline: m.tagline || null
      },
      fetched_at: new Date().toISOString()
    };
    const { data, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
    if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
    return Response.json({ title: data }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
