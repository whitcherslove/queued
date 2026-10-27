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
  if (!r.id) {
    await user.from('import_reviews').insert({ section: 'movies', payload: g, candidates: r.candidates ?? [] });
    return { key: g.key, status: 'review' };
  }
  const t = await fetchTitle(admin, r.id);
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
      const rows = (body.rows ?? []).filter((r: any) => r.email && r.email.toLowerCase() !== email).map((r: any) => ({ email: r.email.toLowerCase(), section: 'movies', payload: r, created_by: uid }));
      for (let i = 0; i < rows.length; i += 200) { const e = await admin.from('pending_imports').insert(rows.slice(i, i + 200)); if (e.error) throw e.error; }
      return Response.json({ stored: rows.length }, { headers: CORS });
    }
    if (body.action === 'claim') {
      const { data } = await admin.from('pending_imports').select('id, payload').eq('email', email);
      const ids = (data ?? []).map((d: any) => d.id);
      if (ids.length) await admin.from('pending_imports').delete().in('id', ids);
      return Response.json({ rows: (data ?? []).map((d: any) => d.payload) }, { headers: CORS });
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
