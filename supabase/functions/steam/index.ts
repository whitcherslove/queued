// Queued · steam — your Steam profile → hours, hours on Steam Deck, last played and achievements per game.
// Secrets: STEAM_API_KEY (steamcommunity.com/dev/apikey), IGDB_CLIENT_ID, IGDB_CLIENT_SECRET (to find a game's Steam app id).
// Actions (signed in): connect { profile } · disconnect · sync · card { libraryId } · owned { q } · link { libraryId, appid | 0 | null }
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: CORS });
const STEAM = 'https://api.steampowered.com';
async function fetchT(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } catch { return new Response(null, { status: 599 }); } finally { clearTimeout(t); }
}
const steamGet = async (path: string, q: Record<string, string>) => {
  const u = new URL(STEAM + path); u.searchParams.set('key', env('STEAM_API_KEY')); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const r = await fetchT(u.toString()); if (!r.ok) throw new Error('Steam ' + r.status); return r.json();
};

// ---------- IGDB: a game's Steam app id ----------
async function igdbToken(db: any): Promise<string> {
  const { data } = await db.from('app_cache').select('value, expires_at').eq('key', 'igdb_token').maybeSingle();
  if (data?.expires_at && new Date(data.expires_at).getTime() > Date.now() + 3600e3) return data.value.token;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${env('IGDB_CLIENT_ID')}&client_secret=${env('IGDB_CLIENT_SECRET')}&grant_type=client_credentials`, { method: 'POST' });
  const j = await r.json();
  await db.from('app_cache').upsert({ key: 'igdb_token', value: { token: j.access_token }, expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString() });
  return j.access_token;
}
async function steamAppIds(db: any, igdbIds: string[]): Promise<Record<string, number>> {
  if (!igdbIds.length) return {};
  const token = await igdbToken(db);
  const r = await fetchT('https://api.igdb.com/v4/external_games', { method: 'POST', headers: { 'Client-ID': env('IGDB_CLIENT_ID'), Authorization: 'Bearer ' + token },
    body: `fields game, uid, url, category, external_game_source; where game = (${igdbIds.join(',')}); limit 500;` }, 12000);
  if (!r.ok) return {};
  const out: Record<string, number> = {};
  for (const x of await r.json()) {
    const isSteam = x.category === 1 || x.external_game_source === 1 || /store\.steampowered\.com\/app\//.test(String(x.url ?? ''));
    const id = Number(x.uid) || Number(String(x.url ?? '').match(/app\/(\d+)/)?.[1]);
    if (isSteam && id && !out[String(x.game)]) out[String(x.game)] = id;
  }
  return out;
}

// the app id for one of your games: yours (Edit details / Link), or IGDB's (looked up once, remembered on the title)
async function appIdFor(db: any, lib: any): Promise<number | null> {
  const mine = lib.overrides?.steam_appid;
  if (mine === 0) return 0;                       // "Not on Steam"
  if (mine) return Number(mine);
  const t = lib.title;
  if (t?.data?.steam_appid !== undefined) return t.data.steam_appid || null;
  if (t?.source !== 'igdb') return null;
  const ids = await steamAppIds(db, [t.source_id]);
  const appid = ids[t.source_id] ?? null;
  await db.from('titles').update({ data: { ...(t.data ?? {}), steam_appid: appid ?? 0 } }).eq('id', t.id);
  return appid;
}

// ---------- Steam data ----------
async function ownedGames(steamid: string) {
  const j = await steamGet('/IPlayerService/GetOwnedGames/v1/', { steamid, include_appinfo: '1', include_played_free_games: '1', skip_unvetted_apps: '0' });
  if (!j?.response || j.response.game_count === undefined) throw new Error('Steam shows no games — make “Game details” public in your Steam privacy settings');
  return (j.response.games ?? []) as any[];
}
async function achievements(steamid: string, appid: number): Promise<{ done: number; total: number } | null> {
  try {
    const j = await steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid, appid: String(appid) });
    const list = j?.playerstats?.achievements;
    if (!Array.isArray(list) || !list.length) return { done: 0, total: 0 };   // the game has no achievements
    return { done: list.filter((a: any) => a.achieved === 1).length, total: list.length };
  } catch { return { done: 0, total: 0 }; }                                  // no stats for this game
}
async function syncAll(db: any, uid: string, steamid: string, focusAppIds: number[] = []) {
  const games = await ownedGames(steamid);
  const rows = games.map((g) => ({ user_id: uid, appid: g.appid, name: g.name ?? null, playtime_min: g.playtime_forever ?? 0, playtime_deck_min: g.playtime_deck_forever ?? 0,
    playtime_2w_min: g.playtime_2weeks ?? 0, last_played: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 400) await db.from('steam_stats').upsert(rows.slice(i, i + 400), { onConflict: 'user_id,appid', ignoreDuplicates: false });
  // achievements: the games you asked about + the ones played in the last two weeks (a few at a time — Steam is slow per game)
  const recent = games.filter((g) => (g.playtime_2weeks ?? 0) > 0).map((g) => g.appid);
  const want = [...new Set([...focusAppIds, ...recent])].filter((a) => games.some((g) => g.appid === a && (g.playtime_forever ?? 0) > 0)).slice(0, 25);
  await Promise.all(want.map(async (appid) => { const a = await achievements(steamid, appid); if (a) await db.from('steam_stats').update({ ach_done: a.done, ach_total: a.total }).eq('user_id', uid).eq('appid', appid); }));
  await db.from('profiles').update({ steam_synced_at: new Date().toISOString() }).eq('id', uid);
  return { games: games.length };
}

async function refreshOne(db: any, uid: string, steamid: string, appid: number) {
  const games = await ownedGames(steamid).catch(() => [] as any[]);
  const g = games.find((x) => x.appid === appid);
  if (games.length) {
    const rows = games.map((x) => ({ user_id: uid, appid: x.appid, name: x.name ?? null, playtime_min: x.playtime_forever ?? 0, playtime_deck_min: x.playtime_deck_forever ?? 0,
      playtime_2w_min: x.playtime_2weeks ?? 0, last_played: x.rtime_last_played ? new Date(x.rtime_last_played * 1000).toISOString() : null, updated_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 400) await db.from('steam_stats').upsert(rows.slice(i, i + 400), { onConflict: 'user_id,appid' });
  }
  if (g && (g.playtime_forever ?? 0) > 0) {
    const a = await achievements(steamid, appid);
    if (a) await db.from('steam_stats').update({ ach_done: a.done, ach_total: a.total }).eq('user_id', uid).eq('appid', appid);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!env('STEAM_API_KEY')) return json({ error: 'STEAM_API_KEY is not set' }, 500);
    const auth = req.headers.get('Authorization') ?? '';
    const { data: who } = await createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } }).auth.getUser();
    const uid = who?.user?.id; if (!uid) return json({ error: 'Sign in first' }, 401);
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const b = await req.json().catch(() => ({}));
    const { data: me } = await db.from('profiles').select('steam_id, steam_name, steam_synced_at').eq('id', uid).maybeSingle();

    if (b.action === 'connect') {
      // a profile link (…/profiles/7656…, …/id/name), a SteamID64, or just the custom name
      const raw = String(b.profile ?? '').trim();
      let steamid = raw.match(/(7656\d{13})/)?.[1] ?? '';
      if (!steamid) {
        const vanity = raw.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? raw.replace(/\/+$/, '');
        const r = await steamGet('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity });
        steamid = r?.response?.steamid ?? '';
      }
      if (!steamid) return json({ error: 'Couldn’t find that Steam profile — paste its link from Steam' }, 400);
      const s = await steamGet('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamid });
      const p = s?.response?.players?.[0];
      if (!p) return json({ error: 'Couldn’t find that Steam profile' }, 400);
      if (p.communityvisibilitystate !== 3) return json({ error: 'That Steam profile is private — make the profile and “Game details” public' }, 400);
      await db.from('profiles').update({ steam_id: steamid, steam_name: p.personaname ?? null }).eq('id', uid);
      const r = await syncAll(db, uid, steamid).catch((e) => ({ error: (e as Error).message }));
      return json({ ok: true, name: p.personaname, ...r });
    }
    if (b.action === 'disconnect') {
      await db.from('profiles').update({ steam_id: null, steam_name: null, steam_synced_at: null }).eq('id', uid);
      await db.from('steam_stats').delete().eq('user_id', uid);
      return json({ ok: true });
    }
    if (!me?.steam_id) return json({ connected: false });

    if (b.action === 'sync') return json({ connected: true, ...(await syncAll(db, uid, me.steam_id)) });

    if (b.action === 'owned') {
      const q = String(b.q ?? '').trim();
      let qb = db.from('steam_stats').select('appid, name, playtime_min').eq('user_id', uid).order('playtime_min', { ascending: false }).limit(30);
      if (q) qb = qb.ilike('name', '%' + q.replace(/[%_]/g, '') + '%');
      const { data } = await qb;
      let store: { appid: number; name: string }[] = [];
      if (q) {
        const r = await fetchT('https://store.steampowered.com/api/storesearch/?l=english&cc=US&term=' + encodeURIComponent(q), {}, 6000);
        if (r.ok) store = ((await r.json())?.items ?? []).slice(0, 10).map((x: any) => ({ appid: Number(x.id), name: String(x.name) }));
      }
      return json({ connected: true, games: data ?? [], store });
    }

    if (b.action === 'link') {
      const { data: lib } = await db.from('library').select('id, overrides').eq('id', b.libraryId).eq('user_id', uid).maybeSingle();
      if (!lib) return json({ error: 'Not your game' }, 404);
      const ov = { ...(lib.overrides ?? {}) } as any;
      if (b.appid === null || b.appid === undefined) delete ov.steam_appid; else ov.steam_appid = Number(b.appid);
      await db.from('library').update({ overrides: ov }).eq('id', lib.id);
      return json({ ok: true });
    }

    if (b.action === 'card' || b.action === 'refresh') {
      const { data: lib } = await db.from('library').select('id, overrides, title:titles(id, source, source_id, data)').eq('id', b.libraryId).eq('user_id', uid).maybeSingle();
      if (!lib) return json({ connected: true, appid: null });
      const appid = await appIdFor(db, lib);
      if (!appid) return json({ connected: true, appid, steamName: me.steam_name });
      const read = async () => (await db.from('steam_stats').select('*').eq('user_id', uid).eq('appid', appid).maybeSingle()).data;
      let st = await read();
      const stale = !st || Date.now() - new Date(st.updated_at).getTime() > 3 * 3600e3 || (st.playtime_min > 0 && st.ach_total == null);
      if (b.action === 'refresh' || !st) { await refreshOne(db, uid, me.steam_id, appid).catch(() => undefined); st = await read(); }
      else if (stale) {
        // answer now with what we have; fresh numbers land in the background (the app asks again in a few seconds)
        const job = refreshOne(db, uid, me.steam_id, appid).catch(() => undefined);
        try { (globalThis as any).EdgeRuntime?.waitUntil(job); } catch { /* older runtime: it still runs while we answer */ }
        return json({ connected: true, appid, steamName: me.steam_name, stats: st, refreshing: true });
      }
      return json({ connected: true, appid, steamName: me.steam_name, stats: st ?? null });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
