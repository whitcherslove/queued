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
/** fetch that gives up after `ms` — a slow outside service must never make the app wait (RAWG sometimes hangs and returns 522) */
async function fetchT(url: string, init: RequestInit = {}, ms = 6000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); }
  catch (e) { if ((e as Error).name === 'AbortError') return new Response(null, { status: 599, statusText: 'timeout' }); throw e; }
  finally { clearTimeout(timer); }
}
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
  const r = await fetchT('https://api.igdb.com/v4/' + endpoint, { method: 'POST', headers: { 'Client-ID': env('IGDB_CLIENT_ID'), Authorization: 'Bearer ' + token, Accept: 'application/json' }, body }, 12000);
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
const RAWG_HEADERS = { 'User-Agent': 'Queued/1.0 (personal backlog app)', Accept: 'application/json' };
let rawgNote = '';
async function rawgGame(slug: string, name: string, year: number | null) {
  const key = env('RAWG_API_KEY'); if (!key) { rawgNote = 'RAWG_API_KEY is not set'; return null; }
  // IGDB slugs sometimes carry a "--1" suffix ("hades--1"); RAWG uses the plain one ("hades")
  const clean = slug.replace(/--\d+$/, '');
  let r = await fetchT(`https://api.rawg.io/api/games/${encodeURIComponent(clean)}?key=${key}`, { headers: RAWG_HEADERS });
  if (r.ok) { const j = await r.json(); if (j?.id) return j; }
  if (r.status === 401 || r.status === 403) { rawgNote = 'RAWG refused the key (' + r.status + ')'; return null; }
  if (r.status >= 500) { rawgNote = r.status === 599 ? 'RAWG timed out' : 'RAWG is down (' + r.status + ')'; return null; }
  // fall back to a precise search by name (+ year)
  r = await fetchT(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(name)}&search_precise=true&page_size=5`, { headers: RAWG_HEADERS });
  if (!r.ok) { rawgNote = 'RAWG search ' + r.status; return null; }
  const list = (await r.json()).results ?? [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit = list.find((g: any) => norm(g.name) === norm(name) && (!year || String(g.released ?? '').startsWith(String(year)))) ?? list.find((g: any) => norm(g.name) === norm(name));
  if (!hit) { rawgNote = 'RAWG: no match for "' + name + '"'; return null; }
  const d = await fetchT(`https://api.rawg.io/api/games/${hit.id}?key=${key}`, { headers: RAWG_HEADERS });
  return d.ok ? await d.json() : hit;
}


// ---------- Metacritic (unofficial: the same backend the metacritic.com site uses) ----------
// 1) search Metacritic by title (type + year must fit) → its score and page slug;
// 2) no score in the search result → read the score from the title's page (JSON-LD aggregateRating).
// The site's public key is read from metacritic.com and cached; a known key is the fallback.
const MC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MC_FALLBACK_KEY = '1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u';
const MC_TYPE: Record<string, { id: number; path: string }> = { game: { id: 13, path: 'game' }, movie: { id: 2, path: 'movie' }, tv: { id: 1, path: 'tv' } };
async function mcFetch(url: string, ms = 6000): Promise<Response> {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { headers: { 'User-Agent': MC_UA, Accept: 'application/json, text/html;q=0.9', Referer: 'https://www.metacritic.com/' }, signal: ac.signal }); }
  catch { return new Response(null, { status: 599 }); }
  finally { clearTimeout(tm); }
}
async function mcKey(db: any): Promise<string> {
  const { data } = await db.from('app_cache').select('value, expires_at').eq('key', 'mc_key').maybeSingle();
  if (data && data.expires_at && new Date(data.expires_at).getTime() > Date.now()) return data.value.key;
  const r = await mcFetch('https://www.metacritic.com/', 7000);
  const html = r.ok ? await r.text() : '';
  const key = html.match(/apiKey=([A-Za-z0-9]{20,})/)?.[1] ?? MC_FALLBACK_KEY;
  await db.from('app_cache').upsert({ key: 'mc_key', value: { key }, expires_at: new Date(Date.now() + 3 * 864e5).toISOString() });
  return key;
}
const mcNorm = (x: string) => x.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
async function mcPageScore(kind: string, slug: string): Promise<number | null> {
  const r = await mcFetch(`https://www.metacritic.com/${MC_TYPE[kind].path}/${slug}/`, 7000);
  if (!r.ok) return null;
  const html = await r.text();
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const ld = JSON.parse(m[1]); const v = Number(ld?.aggregateRating?.ratingValue); if (Number.isFinite(v) && v > 0) return Math.round(v); } catch { /* next block */ }
  }
  return null;
}
let mcNote = '';
async function metacritic(db: any, kind: 'game' | 'movie' | 'tv', title: string, year: number | null): Promise<{ score: number | null; url: string } | null> {
  mcNote = '';
  const key = await mcKey(db);
  const r = await mcFetch(`https://backend.metacritic.com/finder/metacritic/search/${encodeURIComponent(title)}/web?apiKey=${key}&offset=0&limit=12&mcoTypeId=${MC_TYPE[kind].id}`);
  let items: any[] = [];
  if (r.ok) items = (await r.json().catch(() => null))?.data?.items ?? [];
  else { mcNote = 'Metacritic search ' + r.status; if (r.status === 401 || r.status === 403) await db.from('app_cache').delete().eq('key', 'mc_key'); }
  const yearOf = (it: any) => Number(it.premiereYear ?? String(it.releaseDate ?? '').slice(0, 4)) || null;
  const same = items.filter((it) => mcNorm(it.title ?? '') === mcNorm(title));
  const hit = same.find((it) => !year || !yearOf(it) || Math.abs((yearOf(it) as number) - year) <= 1) ?? (same.length === 1 && !year ? same[0] : null);
  let slug: string | null = hit?.slug ?? null;
  let score: number | null = typeof hit?.criticScoreSummary?.score === 'number' ? hit.criticScoreSummary.score : null;
  // nothing from the search: try the page Metacritic would have for that name
  if (!slug) slug = title.toLowerCase().replace(/['’.]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (score === null) score = await mcPageScore(kind, slug);
  if (score === null) { mcNote = mcNote || 'Metacritic: no score for "' + title + '"'; return null; }
  return { score, url: `https://www.metacritic.com/${MC_TYPE[kind].path}/${slug}/` };
}

// ---------- HowLongToBeat (unofficial; their endpoint moves from time to time) ----------
// Flow as of autumn 2026: GET .../init → { token, hpKey?, hpVal? }, then POST the search with x-auth-token.
const HLTB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HLTB_ROUTES: [string, string][] = [
  ['https://howlongtobeat.com/api/search/site/init', 'https://howlongtobeat.com/api/search/site'],
  ['https://howlongtobeat.com/api/bleed/init', 'https://howlongtobeat.com/api/bleed']
];
let hltbNote = '';
async function hltb(name: string, year: number | null): Promise<{ main: number | null; plus: number | null; full: number | null; id: number } | null> {
  const clean = name.replace(/[™®©]/g, '').replace(/\s*[:\-–]\s*(game of the year|goty|definitive|complete|deluxe|director'?s cut|remastered|enhanced)( edition)?\s*$/i, '').trim();
  for (const [initUrl, searchUrl] of HLTB_ROUTES) {
    const init = await fetchT(initUrl + '?t=' + Date.now(), { headers: { 'User-Agent': HLTB_UA, Accept: '*/*', Referer: 'https://howlongtobeat.com/' } }, 7000);
    if (!init.ok) { hltbNote = 'HLTB init ' + init.status; continue; }
    const api = await init.json().catch(() => null);
    if (!api?.token) { hltbNote = 'HLTB: no token'; continue; }
    const payload: Record<string, unknown> = {
      searchType: 'games', searchTerms: clean.split(/\s+/), searchPage: 1, size: 20,
      searchOptions: {
        games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main', rangeTime: { min: 0, max: 0 },
          gameplay: { perspective: '', flow: '', genre: '', difficulty: '' }, rangeYear: { min: '', max: '' }, year: '', modifier: '' },
        users: { sortCategory: 'postcount' }, lists: { sortCategory: 'follows' }, filter: '', sort: 0, randomizer: 0
      },
      useCache: true
    };
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': HLTB_UA, 'x-auth-token': api.token, Referer: 'https://howlongtobeat.com/', Origin: 'https://howlongtobeat.com' };
    if (api.hpKey && api.hpVal) { payload[api.hpKey] = api.hpVal; headers['x-hp-key'] = api.hpKey; headers['x-hp-val'] = api.hpVal; }
    const r = await fetchT(searchUrl, { method: 'POST', headers, body: JSON.stringify(payload) }, 8000);
    if (!r.ok) { hltbNote = 'HLTB search ' + r.status; continue; }
    const list: any[] = (await r.json().catch(() => null))?.data ?? [];
    if (!list.length) { hltbNote = 'HLTB: no match for "' + clean + '"'; return null; }
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const same = list.filter((g) => norm(g.game_name ?? '') === norm(clean) || norm(g.game_name ?? '') === norm(name));
    const pick = same.find((g) => !year || Number(g.release_world) === year || Math.abs(Number(g.release_world) - year) <= 1) ?? same[0];
    // no exact name: take a close one (same start, e.g. "Control" → "Control: Ultimate Edition") if the year fits
    const close = pick ? null : list.find((g) => norm(g.game_name ?? '').startsWith(norm(clean)) && (!year || Math.abs(Number(g.release_world) - year) <= 1));
    if (!pick && !close) { hltbNote = 'HLTB: nothing with that exact name'; return null; }
    if (!pick) { const h0 = (sec: number) => (sec > 0 ? Math.round(sec / 360) / 10 : null); hltbNote = ''; return { main: h0(close.comp_main), plus: h0(close.comp_plus), full: h0(close.comp_100), id: Number(close.game_id) }; }
    const h = (sec: number) => (sec > 0 ? Math.round(sec / 360) / 10 : null);   // seconds → hours, 1 decimal
    hltbNote = '';
    return { main: h(pick.comp_main), plus: h(pick.comp_plus), full: h(pick.comp_100), id: Number(pick.game_id) };
  }
  return null;
}

// ---------- details → titles ----------
async function details(db: any, igdbId: string, force = false) {
  const { data: cached } = await db.from('titles').select('*').eq('kind', 'game').eq('source', 'igdb').eq('source_id', igdbId).maybeSingle();
  const age = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  // fresh for a week — but if RAWG was down last time, try again after a day
  // if RAWG or HowLongToBeat didn't answer last time, try again after a day instead of a week
  const missed = !!cached?.data?.rawg_note || !!cached?.data?.hltb_note || cached?.data?.ttb?.source !== 'hltb' || cached?.metascore == null;
  if (cached && !force && age < (missed ? 864e5 : FRESH_DAYS * 864e5)) return cached;
  const [g] = await igdb(db, 'games', `fields name,slug,summary,first_release_date,game_type,cover.image_id,artworks.image_id,screenshots.image_id,genres.name,themes.name,
    platforms.id,platforms.name,platforms.slug,platforms.abbreviation,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,
    aggregated_rating,aggregated_rating_count,total_rating,parent_game.id,parent_game.name,dlcs.id,dlcs.name,dlcs.cover.image_id,dlcs.first_release_date,
    expansions.id,expansions.name,expansions.cover.image_id,expansions.first_release_date,standalone_expansions.id,standalone_expansions.name,
    game_modes.name,franchises.name,collections.name; where id = ${Number(igdbId)};`);
  if (!g) throw new Error('IGDB game ' + igdbId + ' not found');
  const year = g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
  const [ttb] = await igdb(db, 'game_time_to_beats', `fields hastily,normally,completely,count; where game_id = ${g.id};`).catch(() => [null]);
  hltbNote = '';
  const hl = await hltb(g.name, year).catch((e) => { hltbNote = 'HLTB error: ' + String(e); return null; });
  rawgNote = '';
  const rawg = await rawgGame(g.slug, g.name, year).catch((e) => { rawgNote = 'RAWG error: ' + String(e); return null; });
  const mc = await metacritic(db, 'game', g.name, year).catch((e) => { mcNote = 'Metacritic error: ' + String(e); return null; });
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
    metascore: mc?.score ?? (typeof rawg?.metacritic === 'number' ? rawg.metacritic : null),   // Metacritic first, RAWG second
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
      // time to beat: HowLongToBeat first (community times), IGDB only if HLTB has nothing; your own number (Edit details) wins in the app
      ttb: hl && (hl.main || hl.full)
        ? { quick: null, main: hl.main, plus: hl.plus, full: hl.full, source: 'hltb', hltb_id: hl.id }   // all three from HLTB — never mixed with IGDB
        : ttb ? { quick: ttb.hastily ? Math.round(ttb.hastily / 360) / 10 : null, main: ttb.normally ? Math.round(ttb.normally / 360) / 10 : null, full: ttb.completely ? Math.round(ttb.completely / 360) / 10 : null, source: 'igdb' } : null,
      hltb_note: hltbNote || null,
      mc_url: mc?.url ?? null, mc_note: mcNote || null,
      rawg_slug: rawg?.slug ?? null,
      rawg_note: rawgNote || null   // why RAWG gave nothing (shown only in the raw data, for checking)
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
  const r = await fetchT(`https://api.thegamesdb.net/v1.1/Games/ByGameName?apikey=${key}&name=${encodeURIComponent(name)}&include=boxart,platform`);
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
  if (platformName) out.sort((a, b) => Number(norm(b.platform).endsWith(norm(platformName))) - Number(norm(a.platform).endsWith(norm(platformName))));
  return out.slice(0, 12);
}
async function sgdbGrids(name: string) {
  const key = env('SGDB_API_KEY'); if (!key) return [];
  const h = { Authorization: 'Bearer ' + key };
  const s = await fetchT(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(name)}`, { headers: h });
  if (!s.ok) return [];
  const id = (await s.json()).data?.[0]?.id; if (!id) return [];
  const g = await fetchT(`https://www.steamgriddb.com/api/v2/grids/game/${id}?dimensions=600x900&types=static`, { headers: h });
  if (!g.ok) return [];
  return ((await g.json()).data ?? []).slice(0, 10).map((x: any) => ({ url: x.url, label: 'SteamGridDB' }));
}
async function images(db: any, titleId: string, platformName: string | null) {
  const { data: t } = await db.from('titles').select('*').eq('id', titleId).single();
  if (!t) throw new Error('Title not found');
  const [g] = await igdb(db, 'games', `fields cover.image_id,artworks.image_id,screenshots.image_id; where id = ${Number(t.source_id)};`);
  const rawgKey = env('RAWG_API_KEY');
  const rawg = rawgKey && t.data?.rawg_slug ? await fetchT(`https://api.rawg.io/api/games/${t.data.rawg_slug}/screenshots?key=${rawgKey}`, { headers: RAWG_HEADERS }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  const rawgBg = rawgKey && t.data?.rawg_slug ? await fetchT(`https://api.rawg.io/api/games/${t.data.rawg_slug}?key=${rawgKey}`, { headers: RAWG_HEADERS }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  void platformName; // box art (TheGamesDB / SteamGridDB) dropped — IGDB posters look right
  const posters = [
    ...(g?.cover?.image_id ? [{ url: IGDB_IMG(g.cover.image_id, 'cover_big'), label: 'IGDB' }] : []),
    ...((g?.artworks ?? []).slice(0, 6).map((x: any) => ({ url: IGDB_IMG(x.image_id, 'cover_big'), label: 'IGDB artwork' })))
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
    // imported games got IGDB data only; fill time to beat (HLTB), Metascore and backgrounds two at a time
    if (body.action === 'enrich') {
      const { data: list } = await db.from('titles').select('source_id').eq('kind', 'game').eq('data->>needs_enrich', 'true').limit(2);
      for (const t of list ?? []) await details(db, t.source_id, true).catch(() => undefined);
      const { count } = await db.from('titles').select('id', { count: 'exact', head: true }).eq('kind', 'game').eq('data->>needs_enrich', 'true');
      return json({ done: (list ?? []).length, left: count ?? 0 });
    }
    if (body.action === 'images') return json(await images(db, String(body.titleId), body.platform ? String(body.platform) : null));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
