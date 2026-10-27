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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { kind, sourceId, force } = await req.json();
    if (kind !== 'movie' || !sourceId) return Response.json({ error: 'kind=movie and sourceId are required' }, { status: 400, headers: CORS });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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
