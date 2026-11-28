// Queued · steam — your Steam profile → hours (PC / Steam Deck), last played, achievements (+ highlights), Steam Deck status.
// Secrets: STEAM_API_KEY, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, PUSH_SECRET (the same secret the database uses for "push").
// From the app (signed in): connect · disconnect · sync · refresh { libraryId } · owned { q } · link { libraryId, appid | 0 | null }
// From the database (x-push-secret): resolve { library_id } (a new PC game) · nightly (everyone with Steam)
// Verify JWT: OFF (the database calls it with the secret; app calls are checked inside).
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
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
/** the Steam app id of one of your games — yours (Link / Not on Steam), else IGDB's (remembered on the title) — saved on the game */
async function resolveLib(db: any, lib: any): Promise<number> {
  const mine = lib.overrides?.steam_appid;
  let appid: number;
  if (mine !== undefined && mine !== null) appid = Number(mine);
  else if (lib.title?.data?.steam_appid !== undefined) appid = Number(lib.title.data.steam_appid) || 0;
  else if (lib.title?.source === 'igdb') {
    appid = (await steamAppIds(db, [lib.title.source_id]))[lib.title.source_id] ?? 0;
    await db.from('titles').update({ data: { ...(lib.title.data ?? {}), steam_appid: appid } }).eq('id', lib.title.id);
  } else appid = 0;
  if (!appid && mine === undefined && lib.user_id) appid = await byName(db, lib.user_id, lib.title?.title);
  if (lib.steam_appid !== appid) await db.from('library').update({ steam_appid: appid }).eq('id', lib.id);
  return appid;
}
/** IGDB didn't know the Steam id: look for the same name in your Steam library (Red Faction: Guerrilla → "Red Faction Guerrilla Re-Mars-tered") */
async function byName(db: any, uid: string, title: string | undefined): Promise<number> {
  if (!title) return 0;
  const norm = (x: string) => x.toLowerCase().replace(/[™®©:’'\-–—.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const t = norm(title);
  const { data } = await db.from('steam_stats').select('appid, name').eq('user_id', uid).ilike('name', '%' + title.split(/[:\-–—]/)[0].trim().replace(/[%_]/g, '') + '%').limit(20);
  const list = (data ?? []).map((r: any) => ({ appid: r.appid, n: norm(r.name ?? '') }));
  const hit = list.find((r: any) => r.n === t) ?? list.find((r: any) => r.n.startsWith(t + ' ')) ?? (list.length === 1 && list[0].n.includes(t) ? list[0] : null);
  return hit?.appid ?? 0;
}

// ---------- Steam data ----------
async function ownedGames(steamid: string) {
  const j = await steamGet('/IPlayerService/GetOwnedGames/v1/', { steamid, include_appinfo: '1', include_played_free_games: '1', skip_unvetted_apps: '0' });
  if (!j?.response || j.response.game_count === undefined) throw new Error('Steam shows no games — make “Game details” public in your Steam privacy settings');
  const games = (j.response.games ?? []) as any[];
  // minutes in the last two weeks: Steam gives them to everyone only in "recently played"
  // (the owned-games list carries them — and the last-played date — just for the API key's owner)
  const rp = await steamGet('/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid, count: '0' }).catch(() => null);
  const recent = new Map<number, number>(((rp?.response?.games ?? []) as any[]).map((g) => [g.appid, g.playtime_2weeks ?? 0]));
  for (const g of games) g.playtime_2weeks = recent.get(g.appid) ?? g.playtime_2weeks ?? 0;
  return games;
}
async function saveOwned(db: any, uid: string, games: any[]) {
  const rows = games.map((x) => ({ user_id: uid, appid: x.appid, name: x.name ?? null, playtime_min: x.playtime_forever ?? 0, playtime_deck_min: x.playtime_deck_forever ?? 0,
    playtime_2w_min: x.playtime_2weeks ?? 0, last_played: x.rtime_last_played ? new Date(x.rtime_last_played * 1000).toISOString() : null, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 400) await db.from('steam_stats').upsert(rows.slice(i, i + 400), { onConflict: 'user_id,appid' });
}
const ICON = (appid: number, h: string) => (h && !/^https?:/.test(h) ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${h}.jpg` : h);
/** achievements of one game: counts + the rarest you have, your latest, and the easiest one left */
async function achievementsFull(steamid: string, appid: number) {
  let mine: any[] = [];
  try { mine = (await steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid, appid: String(appid) }))?.playerstats?.achievements ?? []; } catch { mine = []; }
  if (!mine.length) return { ach_done: 0, ach_total: 0, ach_rarest: null, ach_latest: null, ach_easiest: null };
  const [schema, global] = await Promise.all([
    steamGet('/ISteamUserStats/GetSchemaForGame/v2/', { appid: String(appid), l: 'english' }).catch(() => null),
    steamGet('/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/', { gameid: String(appid) }).catch(() => null)
  ]);
  const meta = new Map<string, any>(((schema?.game?.availableGameStats?.achievements ?? []) as any[]).map((a) => [a.name, a]));
  const pct = new Map<string, number>(((global?.achievementpercentages?.achievements ?? []) as any[]).map((a) => [a.name, Number(a.percent)]));
  const view = (a: any, locked = false) => { const m = meta.get(a.apiname) ?? {};
    return { name: m.displayName ?? a.apiname, desc: m.description ?? '', icon: ICON(appid, locked ? (m.icongray ?? m.icon) : m.icon) ?? null, pct: pct.has(a.apiname) ? Math.round(pct.get(a.apiname)! * 10) / 10 : null, at: a.unlocktime ? new Date(a.unlocktime * 1000).toISOString() : null }; };
  const got = mine.filter((a) => a.achieved === 1), left = mine.filter((a) => a.achieved !== 1);
  const byPct = (l: any[]) => l.filter((a) => pct.has(a.apiname)).sort((x, y) => pct.get(x.apiname)! - pct.get(y.apiname)!);
  const rarest = byPct(got)[0], easiest = byPct(left).slice(-1)[0], latest = [...got].sort((x, y) => (y.unlocktime ?? 0) - (x.unlocktime ?? 0))[0];
  return { ach_done: got.length, ach_total: mine.length, ach_rarest: rarest ? view(rarest) : null, ach_latest: latest ? view(latest) : null, ach_easiest: easiest ? view(easiest, true) : null };
}
/** Steam Deck status from the Store: verified / playable / unsupported / unknown */
async function deckStatus(appid: number): Promise<string> {
  const r = await fetchT(`https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}`, {}, 6000);
  if (!r.ok) return 'unknown';
  const c = (await r.json().catch(() => null))?.results?.resolved_category;
  return c === 3 ? 'verified' : c === 2 ? 'playable' : c === 1 ? 'unsupported' : 'unknown';
}
/** full details for one of your games (achievements and Steam Deck status — for every game), and the "every achievement" mark */
async function detailOne(db: any, uid: string, steamid: string, appid: number, withDeck: boolean) {
  const [a, deck] = await Promise.all([achievementsFull(steamid, appid), withDeck ? deckStatus(appid) : Promise.resolve(null)]);
  await db.from('steam_stats').update({ ...a, ...(deck ? { deck } : {}), ach_checked_at: new Date().toISOString() }).eq('user_id', uid).eq('appid', appid);
  // "100% achievements" is a switch: Steam turns it on when everything is earned (and says so), never over your own choice
  const all = a.ach_total > 0 && a.ach_done === a.ach_total;
  const { data: rows } = await db.from('library').select('id, steam_complete, overrides').eq('user_id', uid).eq('steam_appid', appid);
  for (const r of rows ?? []) {
    const ov = { ...(r.overrides ?? {}) } as any;
    if (all && !r.steam_complete && !ov.steam_complete_off) { ov.steam_complete_by = 'steam'; await db.from('library').update({ steam_complete: true, overrides: ov }).eq('id', r.id); }
    else if (!all && r.steam_complete && ov.steam_complete_by === 'steam') { delete ov.steam_complete_by; await db.from('library').update({ steam_complete: false, overrides: ov }).eq('id', r.id); }   // new achievements were added
  }
}

/** everything for one person: hours for all owned games; links for PC games; details for what changed */
async function syncUser(db: any, uid: string, steamid: string, limit = 40) {
  const games = await ownedGames(steamid);
  const { data: before } = await db.from('steam_stats').select('appid, playtime_min, ach_checked_at').eq('user_id', uid);
  const prev = new Map<number, any>((before ?? []).map((r: any) => [r.appid, r]));
  await saveOwned(db, uid, games);
  // link PC games that aren't linked yet
  const { data: libs } = await db.from('library').select('id, user_id, steam_appid, overrides, platform, section, title:titles(id, title, source, source_id, data)').eq('user_id', uid);
  const pcs = (libs ?? []).filter((l: any) => l.section === 'pc' || ['pc', 'steam-deck'].includes(l.platform));
  const missing = pcs.filter((l: any) => l.steam_appid == null && l.overrides?.steam_appid == null && l.title?.data?.steam_appid === undefined && l.title?.source === 'igdb');
  if (missing.length) {
    const ids = await steamAppIds(db, [...new Set(missing.map((l: any) => l.title.source_id))] as string[]);
    for (const l of missing) await db.from('titles').update({ data: { ...(l.title.data ?? {}), steam_appid: ids[l.title.source_id] ?? 0 } }).eq('id', l.title.id).then(() => { l.title.data = { ...(l.title.data ?? {}), steam_appid: ids[l.title.source_id] ?? 0 }; });
  }
  for (const l of pcs) if (l.steam_appid == null || l.overrides?.steam_appid != null || (l.steam_appid === 0 && l.overrides?.steam_appid === undefined)) await resolveLib(db, l);   // "not found" gets another try by name
  // details: linked games played since the last check, or never checked
  const owned = new Map<number, any>(games.map((g) => [g.appid, g]));
  const linked = pcs.map((l: any) => ({ appid: Number(l.overrides?.steam_appid ?? l.title?.data?.steam_appid ?? l.steam_appid ?? 0), deck: l.platform === 'steam-deck' })).filter((x: any) => x.appid > 0 && owned.has(x.appid));
  // achievements again for games played lately: minutes in the last two weeks, or more hours than last time
  const due = linked.filter((x: any) => { const p = prev.get(x.appid), g = owned.get(x.appid);
    return !p?.ach_checked_at || (g.playtime_2weeks ?? 0) > 0 || (g.playtime_forever ?? 0) > (p.playtime_min ?? 0); }).slice(0, limit);
  for (const x of due) await detailOne(db, uid, steamid, x.appid, true).catch(() => undefined);
  await db.from('profiles').update({ steam_synced_at: new Date().toISOString() }).eq('id', uid);
  return { games: games.length, detailed: due.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!env('STEAM_API_KEY')) return json({ error: 'STEAM_API_KEY is not set' }, 500);
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const b = await req.json().catch(() => ({}));

    // ---- from the database ----
    const secret = req.headers.get('x-push-secret');
    if (secret) {
      const { data: s } = await db.from('app_config').select('value').eq('key', 'push_secret').maybeSingle();
      if (!s?.value || s.value !== secret) return json({ error: 'Bad secret' }, 401);
      if (b.action === 'resolve') {
        const { data: lib } = await db.from('library').select('id, user_id, steam_appid, platform, overrides, title:titles(id, title, source, source_id, data)').eq('id', b.library_id).maybeSingle();
        if (!lib) return json({ ok: false });
        const { data: p } = await db.from('profiles').select('steam_id').eq('id', lib.user_id).maybeSingle();
        const appid = await resolveLib(db, lib);
        if (appid && p?.steam_id) {
          const { data: st } = await db.from('steam_stats').select('appid').eq('user_id', lib.user_id).eq('appid', appid).maybeSingle();
          if (st) await detailOne(db, lib.user_id, p.steam_id, appid, true).catch(() => undefined);
        }
        return json({ ok: true, appid });
      }
      if (b.action === 'nightly') {
        const { data: people } = await db.from('profiles').select('id, steam_id').not('steam_id', 'is', null);
        let n = 0;
        for (const p of people ?? []) { await syncUser(db, p.id, p.steam_id, 30).catch(() => undefined); n++; }
        return json({ ok: true, people: n });
      }
      return json({ error: 'Unknown action' }, 400);
    }

    // ---- from the app ----
    const auth = req.headers.get('Authorization') ?? '';
    const { data: who } = await createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } } }).auth.getUser();
    const uid = who?.user?.id; if (!uid) return json({ error: 'Sign in first' }, 401);
    const { data: me } = await db.from('profiles').select('steam_id, steam_name').eq('id', uid).maybeSingle();

    if (b.action === 'connect') {
      const raw = String(b.profile ?? '').trim();
      let steamid = raw.match(/(7656\d{13})/)?.[1] ?? '';
      if (!steamid) {
        const vanity = raw.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? raw.replace(/\/+$/, '');
        steamid = (await steamGet('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity }))?.response?.steamid ?? '';
      }
      if (!steamid) return json({ error: 'Couldn’t find that Steam profile — paste its link from Steam' }, 400);
      const p = (await steamGet('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamid }))?.response?.players?.[0];
      if (!p) return json({ error: 'Couldn’t find that Steam profile' }, 400);
      if (p.communityvisibilitystate !== 3) return json({ error: 'That Steam profile is private — make the profile and “Game details” public' }, 400);
      await db.from('profiles').update({ steam_id: steamid, steam_name: p.personaname ?? null }).eq('id', uid);
      const r = await syncUser(db, uid, steamid, 25).catch((e) => ({ error: (e as Error).message }));
      return json({ ok: true, name: p.personaname, ...r });
    }
    if (b.action === 'disconnect') {
      await db.from('profiles').update({ steam_id: null, steam_name: null, steam_synced_at: null }).eq('id', uid);
      await db.from('steam_stats').delete().eq('user_id', uid);
      await db.from('library').update({ steam_complete: false }).eq('user_id', uid);
      return json({ ok: true });
    }
    if (!me?.steam_id) return json({ connected: false });

    if (b.action === 'sync') return json({ connected: true, ...(await syncUser(db, uid, me.steam_id, 40)) });

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

    if (b.action === 'link' || b.action === 'refresh' || b.action === 'resolve') {
      const { data: lib } = await db.from('library').select('id, user_id, steam_appid, platform, overrides, title:titles(id, title, source, source_id, data)').eq('id', b.libraryId).eq('user_id', uid).maybeSingle();
      if (!lib) return json({ error: 'Not your game' }, 404);
      if (b.action === 'link') {
        const ov = { ...(lib.overrides ?? {}) } as any;
        if (b.appid === null || b.appid === undefined) delete ov.steam_appid; else ov.steam_appid = Number(b.appid);
        await db.from('library').update({ overrides: ov, steam_appid: null, steam_complete: false }).eq('id', lib.id);
        lib.overrides = ov; lib.steam_appid = null;
      }
      const appid = await resolveLib(db, lib);
      if (appid > 0) {
        if (b.action !== 'resolve') {
          const g = (await ownedGames(me.steam_id).catch(() => [] as any[]));
          if (g.length) await saveOwned(db, uid, g);
        }
        const { data: st0 } = await db.from('steam_stats').select('appid').eq('user_id', uid).eq('appid', appid).maybeSingle();
        if (st0) await detailOne(db, uid, me.steam_id, appid, true).catch(() => undefined);
      }
      const { data: st } = appid > 0 ? await db.from('steam_stats').select('*').eq('user_id', uid).eq('appid', appid).maybeSingle() : { data: null };
      const { data: l2 } = await db.from('library').select('steam_complete').eq('id', lib.id).maybeSingle();
      return json({ connected: true, appid, stats: st ?? null, complete: !!l2?.steam_complete });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
