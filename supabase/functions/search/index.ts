// Queued · search — live search on TMDB (movies for now)
// Secrets: TMDB_API_KEY (v3 key or v4 read access token)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const IMG = 'https://image.tmdb.org/t/p/';

function tmdbFetch(path: string, params: Record<string, string>) {
  const key = Deno.env.get('TMDB_API_KEY') ?? '';
  const url = new URL('https://api.themoviedb.org/3' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key; else url.searchParams.set('api_key', key);
  return fetch(url, { headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { q, kind } = await req.json();
    const query = String(q ?? '').trim();
    if (query.length < 1) return Response.json({ results: [] }, { headers: CORS });
    if (kind === 'tv') {
      const r = await tmdbFetch('/search/tv', { query, include_adult: 'false', language: 'en-US', page: '1' });
      if (!r.ok) return Response.json({ error: 'TMDB ' + r.status }, { status: 502, headers: CORS });
      const j = await r.json();
      const results = (j.results ?? []).slice(0, 10).map((m: any) => ({
        sourceId: String(m.id), title: m.name, year: m.first_air_date ? Number(m.first_air_date.slice(0, 4)) : null,
        releaseDate: m.first_air_date || null, posterUrl: m.poster_path ? IMG + 'w185' + m.poster_path : null
      }));
      return Response.json({ results }, { headers: CORS });
    }
    if (kind !== 'movie') return Response.json({ results: [] }, { headers: CORS });
    const r = await tmdbFetch('/search/movie', { query, include_adult: 'false', language: 'en-US', page: '1' });
    if (!r.ok) return Response.json({ error: 'TMDB ' + r.status }, { status: 502, headers: CORS });
    const j = await r.json();
    const results = (j.results ?? []).slice(0, 10).map((m: any) => ({
      sourceId: String(m.id),
      title: m.title,
      year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
      releaseDate: m.release_date || null,
      posterUrl: m.poster_path ? IMG + 'w185' + m.poster_path : null
    }));
    return Response.json({ results }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
