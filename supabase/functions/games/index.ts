// Queued · games — search and details from IGDB, plus RAWG (Metascore, backgrounds), TheGamesDB (box art per platform),
// SteamGridDB (PC covers) and IGDB time to beat. Everything is cached in public.titles (kind = 'game', source = 'igdb').
// Secrets: IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, RAWG_API_KEY, TGDB_API_KEY, SGDB_API_KEY.
// Actions: { action: 'search', q } · { action: 'details', igdbId, force? } · { action: 'images', titleId, platform? }
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const FRESH_DAYS = 7;
const IGDB_IMG = (id: string, size: string) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;
// game_type ids: 0 main game, 1 DLC, 2 expansion, 4 standalone expansion, 8 remake, 9 remaster, 10 expanded game, 11 port
const GAME_TYPES = '(0,1,2,4,8,9,10,11)';
const TYPE_NAME: Record<number, string> = { 0: 'game', 1: 'dlc', 2: 'expansion', 4: 'standalone', 8: 'remake', 9: 'remaster', 10: 'expanded', 11: 'port' };

const env = (k: string) => Deno.env.get(k) ?? '';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

// ---------- IGDB (Twitch app token, cached in app_cache) ----------
async function igdbToken(db: any): Promise<string> {
  const { data } = await db.from('app_cache').select('value, expires_at').eq('key', 'igdb_token').maybeSingle();
  if (data && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 3600e3) return data.value.token;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env('IGDB_CLIENT_ID')}&client_secret=${env('IGDB_CLIENT_SECRET')}&grant_type=client_credentials`, { method: 'POST' });
  if (!r.ok) throw new Error('Twitch token ' + r.status + ' — check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET');
  const j = await r.json();
  await db.from('app_cache').upsert({ key: 'igdb_token', value: { token: j.access_token }, expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString() });
  return j.access_token;
}
async function igdb(db: any, endpoint: string, body: string): Promise<any[]> {
  const token = await igdbToken(db);
  const r = await fetch('https://api.igdb.com/v4/' + endpoint, { method: 'POST', headers: { 'Client-ID': env('IGDB_CLIENT_ID'), Authorization: 'Bearer ' + token, Accept: 'application/json' }, body });
  if (!r.ok) throw new Error('IGDB ' + endpoint + ' ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return await r.json();
}
const isoDay = (unix?: number | null) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

// ---------- search ----------
async function search(db: any, q: string) {
  const safe = q.replace(/"/g, '');
  const rows = await igdb(db, 'games', `search "${safe}"; fields name,first_release_date,cover.image_id,game_type,parent_game.name,platforms.abbreviation,platforms.name; where game_type = ${GAME_TYPES}; limit 25;`);
  return rows.map((g) => ({
    sourceId: String(g.id), title: g.name, year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    releaseDate: isoDay(g.first_release_date), posterUrl: g.cover?.image_id ? IGDB_IMG(g.cover.image_id, 'cover_small') : null,
    type: TYPE_NAME[g.game_type] ?? 'game', parent: g.parent_game?.name ?? null,
    platforms: (g.platforms ?? []).map((p: any) => p.abbreviation || p.name)
  }));
}

// ---------- RAWG ----------
async function rawgGame(slug: string, name: string, year: number | null) {
  const key = env('RAWG_API_KEY'); if (!key) return null;
  let r = await fetch(`https://api.rawg.io/api/games/${encodeURIComponent(slug)}?key=${key}`);
  if (r.ok) return await r.json();
  // fall back to a precise search by name (+ year)
  r = await fetch(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(name)}&search_precise=true&page_size=5`);
  if (!r.ok) return null;
  const list = (await r.json()).results ?? [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit = list.find((g: any) => norm(g.name) === norm(name) && (!year || String(g.released ?? '').startsWith(String(year)))) ?? list.find((g: any) => norm(g.name) === norm(name));
  if (!hit) return null;
  const d = await fetch(`https://api.rawg.io/api/games/${hit.id}?key=${key}`);
  return d.ok ? await d.json() : hit;
}

// ---------- details → titles ----------
async function details(db: any, igdbId: string, force = false) {
  const { data: cached } = await db.from('titles').select('*').eq('kind', 'game').eq('source', 'igdb').eq('source_id', igdbId).maybeSingle();
  if (cached && !force && Date.now() - new Date(cached.fetched_at).getTime() < FRESH_DAYS * 864e5) return cached;
  const [g] = await igdb(db, 'games', `fields name,slug,summary,first_release_date,game_type,cover.image_id,artworks.image_id,screenshots.image_id,genres.name,themes.name,
    platforms.id,platforms.name,platforms.slug,platforms.abbreviation,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,
    aggregated_rating,aggregated_rating_count,total_rating,parent_game.id,parent_game.name,dlcs.id,dlcs.name,dlcs.cover.image_id,dlcs.first_release_date,
    expansions.id,expansions.name,expansions.cover.image_id,expansions.first_release_date,standalone_expansions.id,standalone_expansions.name,
    game_modes.name,franchises.name,collections.name; where id = ${Number(igdbId)};`);
  if (!g) throw new Error('IGDB game ' + igdbId + ' not found');
  const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
  const [ttb] = await igdb(db, 'game_time_to_beats', `fields hastily,normally,completely,count; where game_id = ${g.id};`).catch(() => [null]);
  const rawg = await rawgGame(g.slug, g.name, year).catch(() => null);
  const companies = g.involved_companies ?? [];
  const extras = (list: any[] | undefined, kind: string) => (list ?? []).map((x) => ({ id: String(x.id), name: x.name, kind, cover: x.cover?.image_id ? IGDB_IMG(x.cover.image_id, 'cover_small') : null, release_date: isoDay(x.first_release_date) }));
  const igdbBackdrop = g.artworks?.[0]?.image_id ? IGDB_IMG(g.artworks[0].image_id, '1080p') : g.screenshots?.[0]?.image_id ? IGDB_IMG(g.screenshots[0].image_id, '1080p') : null;
  const row = {
    kind: 'game', source: 'igdb', source_id: String(g.id), imdb_id: null, title: g.name,
    release_date: isoDay(g.first_release_date), year, runtime: null,
    directors: companies.filter((c: any) => c.developer).map((c: any) => c.company?.name).filter(Boolean),
    genres: (g.genres ?? []).map((x: any) => x.name), overview: g.summary || null,
    poster_url: g.cover?.image_id ? IGDB_IMG(g.cover.image_id, 'cover_big') : null,
    backdrop_url: rawg?.background_image || igdbBackdrop,                       // RAWG first, then IGDB art
    metascore: typeof rawg?.metacritic === 'number' ? rawg.metacritic : null,   // Metascore comes from RAWG
    imdb_rating: null,
    data: {
      type: TYPE_NAME[g.game_type] ?? 'game', slug: g.slug,
      parent: g.parent_game ? { id: String(g.parent_game.id), name: g.parent_game.name } : null,
      dlcs: [...extras(g.dlcs, 'dlc'), ...extras(g.expansions, 'expansion'), ...extras(g.standalone_expansions, 'standalone')],
      platforms: (g.platforms ?? []).map((p: any) => ({ id: p.id, name: p.name, slug: p.slug, abbr: p.abbreviation ?? null })),
      developers: companies.filter((c: any) => c.developer).map((c: any) => c.company?.name).filter(Boolean),
      publishers: companies.filter((c: any) => c.publisher).map((c: any) => c.company?.name).filter(Boolean),
      modes: (g.game_modes ?? []).map((x: any) => x.name), themes: (g.themes ?? []).map((x: any) => x.name),
      franchise: g.franchises?.[0]?.name ?? g.collections?.[0]?.name ?? null,
      critics: typeof g.aggregated_rating === 'number' ? Math.round(g.aggregated_rating) : null,
      // time to beat in hours (IGDB gives seconds); HLTB fallback comes in a later step
      ttb: ttb ? { quick: ttb.hastily ? Math.round(ttb.hastily / 360) / 10 : null, main: ttb.normally ? Math.round(ttb.normally / 360) / 10 : null, full: ttb.completely ? Math.round(ttb.completely / 360) / 10 : null, source: 'igdb' } : null,
      rawg_slug: rawg?.slug ?? null
    },
    fetched_at: new Date().toISOString()
  };
  const { data, error } = await db.from('titles').upsert(row, { onConflict: 'kind,source,source_id' }).select('*').single();
  if (error) throw error;
  return data;
}

// ---------- images: every cover / background candidate for "Edit details" ----------
async function tgdbBoxart(name: string, platformName: string | null) {
  const key = env('TGDB_API_KEY'); if (!key) return [];
  const r = await fetch(`https://api.thegamesdb.net/v1.1/Games/ByGameName?apikey=${key}&name=${encodeURIComponent(name)}&include=boxart,platform`);
  if (!r.ok) return [];
  const j = await r.json();
  const games: any[] = j.data?.games ?? [];
  const plats: Record<string, any> = j.include?.platform?.data ?? j.include?.platform ?? {};
  const base = j.include?.boxart?.base_url?.original ?? 'https://cdn.thegamesdb.net/images/original/';
  const art: Record<string, any[]> = j.include?.boxart?.data ?? {};
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const out: { url: string; label: string; platform: string }[] = [];
  games.filter((g) => norm(g.game_title).startsWith(norm(name).slice(0, 12))).forEach((g) => {
    const pName = plats[g.platform]?.name ?? String(g.platform);
    (art[String(g.id)] ?? []).filter((a) => a.side === 'front').forEach((a) => out.push({ url: base + a.filename, label: 'TheGamesDB · ' + pName, platform: pName }));
  });
  // the chosen platform's boxes first
  if (platformName) out.sort((a, b) => Number(norm(b.platform).includes(norm(platformName))) - Number(norm(a.platform).includes(norm(platformName))));
  return out.slice(0, 12);
}
async function sgdbGrids(name: string) {
  const key = env('SGDB_API_KEY'); if (!key) return [];
  const h = { Authorization: 'Bearer ' + key };
  const s = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(name)}`, { headers: h });
  if (!s.ok) return [];
  const id = (await s.json()).data?.[0]?.id; if (!id) return [];
  const g = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${id}?dimensions=600x900&types=static`, { headers: h });
  if (!g.ok) return [];
  return ((await g.json()).data ?? []).slice(0, 10).map((x: any) => ({ url: x.url, label: 'SteamGridDB' }));
}
async function images(db: any, titleId: string, platformName: string | null) {
  const { data: t } = await db.from('titles').select('*').eq('id', titleId).single();
  if (!t) throw new Error('Title not found');
  const [g] = await igdb(db, 'games', `fields cover.image_id,artworks.image_id,screenshots.image_id; where id = ${Number(t.source_id)};`);
  const rawgKey = env('RAWG_API_KEY');
  const rawg = rawgKey && t.data?.rawg_slug ? await fetch(`https://api.rawg.io/api/games/${t.data.rawg_slug}/screenshots?key=${rawgKey}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  const rawgBg = rawgKey && t.data?.rawg_slug ? await fetch(`https://api.rawg.io/api/games/${t.data.rawg_slug}?key=${rawgKey}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  const [tgdb, sgdb] = await Promise.all([tgdbBoxart(t.title, platformName).catch(() => []), sgdbGrids(t.title).catch(() => [])]);
  const posters = [
    ...(g?.cover?.image_id ? [{ url: IGDB_IMG(g.cover.image_id, 'cover_big'), label: 'IGDB' }] : []),
    ...tgdb, ...sgdb
  ];
  const backdrops = [
    ...(rawgBg?.background_image ? [{ url: rawgBg.background_image, label: 'RAWG' }] : []),
    ...(rawgBg?.background_image_additional ? [{ url: rawgBg.background_image_additional, label: 'RAWG' }] : []),
    ...((rawg?.results ?? []).slice(0, 8).map((x: any) => ({ url: x.image, label: 'RAWG' }))),
    ...((g?.artworks ?? []).map((x: any) => ({ url: IGDB_IMG(x.image_id, '1080p'), label: 'IGDB artwork' }))),
    ...((g?.screenshots ?? []).slice(0, 8).map((x: any) => ({ url: IGDB_IMG(x.image_id, '1080p'), label: 'IGDB screenshot' })))
  ];
  return { posters, backdrops };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await req.json().catch(() => ({}));
    if (body.action === 'search') {
      const q = String(body.q ?? '').trim();
      if (!q) return json({ results: [] });
      return json({ results: await search(db, q) });
    }
    if (body.action === 'details') return json({ title: await details(db, String(body.igdbId), !!body.force) });
    if (body.action === 'images') return json(await images(db, String(body.titleId), body.platform ? String(body.platform) : null));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
