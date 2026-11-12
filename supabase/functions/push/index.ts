// Queued · push — sends web push notifications.
// Called by the database (never by the app): friend requests / accepts, new feed events, and the daily "out today" check.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), PUSH_SECRET (same as in app_config).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => Deno.env.get(k) ?? '';
const EMOJI: Record<string, string> = { movies: '🎬', tv: '📺', console: '🎮', pc: '🎮', retro: '🎮', books: '📖' };
const TIER: Record<string, string> = { ten: '10 out of 10', awesome: 'Awesome', fine: 'This is fine', sobad: 'So bad it’s good', filth: 'Fucking filth' };

type Note = { title: string; body: string; url: string; tag?: string };

async function sendTo(db: any, userIds: string[], note: Note) {
  if (!userIds.length) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').in('user_id', userIds);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(note), { TTL: 60 * 60 * 12 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);   // the phone unsubscribed
    }
  }
  return sent;
}
const nameOf = (p: any) => p?.display_name || (p?.handle ? '@' + p.handle : 'A friend');

// ---------- Telegram: posts to the group's chat — finished & rated, started, dropped ----------
const TG_EMOJI: Record<string, string> = { ten: '🤌🏻', awesome: '🔥', fine: '🙂', sobad: '🫠', filth: '🗑️' };
const TG_LINES: Record<string, string[]> = {
  ten: ['Instant classic — no notes.', 'Straight into the hall of fame.', 'Masterpiece, apparently.', 'Nothing will ever be this good again.'],
  awesome: ['Loved it.', 'Would recommend.', 'Worth every minute.', 'Good stuff, really good stuff.'],
  fine: ['It was… fine.', 'Not bad, not great.', 'Done it, that’s about it.', 'Perfectly okay.'],
  sobad: ['Terrible. Loved it.', 'A glorious mess.', 'So wrong it’s right.'],
  filth: ['Never again.', 'Want those hours back.', 'Avoid at all costs.'],
  started: ['Let’s see what the hype is about.', 'Here we go.', 'Wish them luck.', 'See you on the other side.'],
  dropped: ['Life’s too short.', 'Nope. Not for me.', 'Gave it a chance. That’s enough.', 'Quietly closing the door.']
};
const PLAT: Record<string, string> = { ps5: 'PS5', ps4: 'PS4', ps3: 'PS3', ps2: 'PS2', ps1: 'PS1', psvr: 'PS VR', 'xbox-series': 'Xbox Series', 'xbox-one': 'Xbox One', switch: 'Switch', 'switch-2': 'Switch 2', pc: 'PC', 'steam-deck': 'Steam Deck',
  'psvr2-pc': 'PS VR2 · PC', 'psvr2-ps5': 'PS VR2', psp: 'PSP', vita: 'PS Vita', 'xbox-360': 'Xbox 360', xbox: 'Xbox', 'wii-u': 'Wii U', wii: 'Wii', gamecube: 'GameCube',
  n64: 'N64', snes: 'SNES', nes: 'NES', '3ds': '3DS', ds: 'DS', gba: 'GBA', gbc: 'GBC', gb: 'Game Boy', 'virtual-boy': 'Virtual Boy' };
const FMT: Record<string, string> = { paper: 'Paper', ebook: 'E-book', audio: 'Audiobook' };
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64url = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function tgCall(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return r.json().catch(() => ({ ok: false }));
}
async function telegramPost(db: any, id: string) {
  if (!env('TELEGRAM_BOT_TOKEN')) return { skipped: 'no bot token' };
  const { data: cfgRows } = await db.from('app_config').select('key, value').in('key', ['cloudinary_cloud', 'site_url']);
  const cfg: Record<string, string> = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.key, r.value]));
  const { data: a } = await db.from('activity').select('*, title:titles(title, poster_url, backdrop_url)').eq('id', id).maybeSingle();
  if (!a) return { skipped: 'no event' };
  if (a.kind === 'finished' && !a.tier) return { skipped: 'not rated yet' };
  if (!['finished', 'started', 'dropped'].includes(a.kind)) return { skipped: 'not posted' };
  const { data: p } = await db.from('profiles').select('display_name, handle, avatar_url, settings, telegram_off').eq('id', a.user_id).maybeSingle();
  if (p?.telegram_off) return { skipped: 'off' };
  const who = esc(nameOf(p)); const title = esc(a.title?.title ?? 'something'); const em = EMOJI[a.section] ?? '';
  const isGame = ['console', 'pc', 'retro'].includes(a.section);
  const verbDone = a.section === 'books' ? 'finished reading' : a.section === 'movies' ? 'watched' : a.section === 'tv' ? 'finished' : 'beat';
  const verbStart = a.section === 'books' ? 'started reading' : a.section === 'tv' || a.section === 'movies' ? 'started watching' : 'started playing';
  // the same phrase for the same post (an edit doesn't reshuffle it)
  const key = a.kind === 'finished' ? a.tier : a.kind;
  const lines = TG_LINES[key] ?? ['Done.']; let h = 0; for (const c of id + key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const line = lines[h % lines.length];
  // details: platform / format, season, co-op friends
  const partners: { id: string; name: string }[] = [];
  if ((a.coop_with ?? []).length) { const { data: cp } = await db.from('profiles').select('id, display_name, handle').in('id', a.coop_with); (cp ?? []).forEach((x: any) => partners.push({ id: x.id, name: nameOf(x) })); }
  const metaFor = (inChat: Set<string>) => {
    const names = partners.filter((x) => inChat.has(x.id)).map((x) => x.name);
    return [isGame && a.platform ? PLAT[a.platform] ?? String(a.platform).toUpperCase() : '', a.section === 'books' && a.format ? FMT[a.format] ?? '' : '', a.section === 'tv' && a.seasons_label ? a.seasons_label : '', names.length ? 'with ' + names.join(', ') : ''].filter(Boolean).map(esc).join(' · ');
  };
  const scale = (p?.settings?.scale === 10 ? 10 : 5);
  const score = a.score != null ? (scale === 10 ? Math.round(Number(a.score) * 4) / 2 : Math.round(Number(a.score) * 2) / 2) + '/' + scale : '';
  const head = a.kind === 'finished' ? `${em} <b>${who}</b> ${verbDone} <b>${title}</b>`
    : a.kind === 'started' ? `▶️ <b>${who}</b> ${verbStart} <b>${title}</b>`
    : `🚪 <b>${who}</b> dropped <b>${title}</b>`;
  const captionFor = (meta: string) => [
    head,
    meta ? `<i>${meta}</i>` : '',
    `<blockquote><i>${esc(line)}</i></blockquote>`,
    a.kind === 'finished' ? `${TG_EMOJI[a.tier] ?? ''} <b>${esc(TIER[a.tier] ?? a.tier)}</b>${score ? '  ·  <b>' + score + '</b>' : ''}` : ''
  ].filter(Boolean).join('\n');
  // the picture: the title's image + avatar in the corner + the rating badge (or "in progress" when started)
  const base = a.title?.backdrop_url ?? a.title?.poster_url ?? null;
  let photo = base;
  if (base && cfg.cloudinary_cloud) {
    let tr = 'c_scale,w_1280/';
    if (p?.avatar_url) tr += `l_fetch:${b64url(p.avatar_url)},g_north_west,x_30,y_30,w_250,h_250,c_fill,r_max/`;
    const badge = a.kind === 'finished' ? a.tier : a.kind === 'started' ? 'in_progress' : null;
    if (cfg.site_url && badge) { const size = badge === 'in_progress' ? 350 : 600; tr += `l_fetch:${b64url(cfg.site_url.replace(/\/$/, '') + '/tg/' + badge + '.png')},g_east,x_10,y_0,w_${size},h_${size},c_fit/`; }
    photo = `https://res.cloudinary.com/${cfg.cloudinary_cloud}/image/fetch/${tr}${base}`;
  }
  // the chats of every company this person is in (and posts to)
  const { data: chats } = await db.from('tg_members').select('posting, group_id, group:tg_groups(chat_id, active)').eq('user_id', a.user_id);
  const mine = (chats ?? []).filter((m: any) => m.posting && m.group?.active);
  const targets = mine.map((m: any) => Number(m.group.chat_id));
  const { data: allMembers } = mine.length ? await db.from('tg_members').select('group_id, user_id').in('group_id', mine.map((m: any) => m.group_id)) : { data: [] };
  const chatMembers = (chat_id: number) => { const g = mine.find((m: any) => Number(m.group.chat_id) === chat_id)?.group_id; return new Set((allMembers ?? []).filter((x: any) => x.group_id === g).map((x: any) => x.user_id)); };
  if (!targets.length) return { skipped: 'no chats' };
  const { data: done } = await db.from('tg_posts').select('chat_id, message_id, tier').eq('activity_id', id);
  const out: any[] = [];
  for (const chat_id of targets) {
    const caption = captionFor(metaFor(chatMembers(chat_id)));
    const prev = (done ?? []).find((d: any) => Number(d.chat_id) === chat_id);
    if (prev) {
      if (a.kind !== 'finished') { out.push({ chat_id, skipped: 'already posted' }); continue; }
      // already posted here: a new rating label → new picture and text; a new score only → new text
      const r = prev.tier !== a.tier && photo
        ? await tgCall('editMessageMedia', { chat_id, message_id: prev.message_id, media: { type: 'photo', media: photo, caption, parse_mode: 'HTML' } })
        : await tgCall(photo ? 'editMessageCaption' : 'editMessageText', { chat_id, message_id: prev.message_id, ...(photo ? { caption } : { text: caption }), parse_mode: 'HTML' });
      await db.from('tg_posts').update({ tier: a.tier }).eq('activity_id', id).eq('chat_id', chat_id);
      out.push({ chat_id, edited: !!r.ok }); continue;
    }
    let r = photo ? await tgCall('sendPhoto', { chat_id, photo, caption, parse_mode: 'HTML' }) : { ok: false };
    if (!r.ok) r = await tgCall('sendMessage', { chat_id, text: caption, parse_mode: 'HTML' });   // the picture failed → text only
    if (r.ok) await db.from('tg_posts').upsert({ activity_id: id, chat_id, message_id: r.result.message_id, tier: a.tier });
    else if (/kicked|not a member|chat not found/i.test(String(r.description))) await db.from('tg_groups').update({ active: false }).eq('chat_id', chat_id);
    out.push({ chat_id, sent: !!r.ok, error: r.ok ? undefined : r.description });
  }
  return { results: out };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-push-secret') !== env('PUSH_SECRET') || !env('PUSH_SECRET')) return new Response('forbidden', { status: 403 });
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const b = await req.json().catch(() => ({}));
  try {
    if (b.type === 'friend_request' || b.type === 'friend_accepted') {
      const { data: p } = await db.from('profiles').select('display_name, handle').eq('id', b.from).maybeSingle();
      const n = await sendTo(db, [b.to], b.type === 'friend_request'
        ? { title: 'New friend request', body: nameOf(p) + ' wants to add you on Queued', url: '/?open=friends', tag: 'friend-' + b.from }
        : { title: 'You’re friends now', body: nameOf(p) + ' accepted your request', url: '/?open=friends', tag: 'friend-' + b.from });
      return Response.json({ sent: n });
    }
    if (b.type === 'activity') {
      const { data: a } = await db.from('activity').select('*, title:titles(title)').eq('id', b.id).maybeSingle();
      if (!a) return Response.json({ sent: 0 });
      const [{ data: p }, { data: fr }] = await Promise.all([
        db.from('profiles').select('display_name, handle').eq('id', a.user_id).maybeSingle(),
        db.from('friendships').select('requester, addressee').eq('status', 'accepted').or(`requester.eq.${a.user_id},addressee.eq.${a.user_id}`)
      ]);
      const to = (fr ?? []).map((f: any) => (f.requester === a.user_id ? f.addressee : f.requester));
      // a whole sentence as the title (with the kind's emoji), the details underneath
      const title = a.title?.title ?? 'something';
      const who = nameOf(p); const em = EMOJI[a.section] ?? '';
      const rate = [a.tier ? TIER[a.tier] ?? a.tier : '', a.score != null ? String(Number(a.score)) : ''].filter(Boolean).join(' ');
      const verbStart = a.section === 'books' ? 'started reading' : a.section === 'tv' || a.section === 'movies' ? 'started watching' : 'started playing';
      const verbDone = a.section === 'books' ? 'finished reading' : a.section === 'movies' ? 'watched' : a.section === 'tv' ? 'finished' : 'beat';
      const head = a.kind === 'started' ? `${who} ${verbStart} ${title}`
        : a.kind === 'dropped' ? `${who} dropped ${title}`
        : a.kind === 'season_rated' || a.kind === 'show_rated' ? `${who} rated ${title}`
        : `${who} ${verbDone} ${title}`;
      const coop = '';   // co-op partners aren't named in pushes (only people who share a company may see them)
      const details = (a.kind === 'started' ? [a.section === 'tv' ? a.seasons_label : '', ['console', 'pc', 'retro'].includes(a.section) && a.platform ? 'on ' + String(a.platform).toUpperCase() : '']
        : a.kind === 'season_rated' ? [a.seasons_label, rate]
        : a.kind === 'show_rated' ? ['The whole show', rate]
        : a.kind === 'dropped' ? [a.seasons_label]
        : [a.seasons_label, rate, coop]).filter(Boolean).join(' · ');
      const n = await sendTo(db, to, { title: head + (em ? ' ' + em : ''), body: details, url: '/?open=friends', tag: 'act-' + a.id });
      return Response.json({ sent: n });
    }
    if (b.type === 'telegram') return Response.json(await telegramPost(db, String(b.id)));
    if (b.type === 'reaction') {
      const [{ data: p }, { data: a }] = await Promise.all([db.from('profiles').select('display_name, handle').eq('id', b.from).maybeSingle(), db.from('activity').select('user_id, title:titles(title)').eq('id', b.id).maybeSingle()]);
      if (!a) return Response.json({ skipped: 'no event' });
      const n = await sendTo(db, [a.user_id], { title: `${nameOf(p)} reacted ${b.emoji}`, body: 'to your ' + (a.title?.title ?? 'update'), url: '/?open=friends', tag: 'react-' + b.id });
      return Response.json({ sent: n });
    }
    if (b.type === 'coop') {
      const [{ data: p }, { data: t }] = await Promise.all([db.from('profiles').select('display_name, handle').eq('id', b.from).maybeSingle(), db.from('titles').select('title, kind').eq('id', b.title_id).maybeSingle()]);
      const n = await sendTo(db, [b.to], { title: `${nameOf(p)} played ${t?.title ?? 'a game'} with you 🎮`, body: 'Add it to your lists? Open Friends → People.', url: '/?open=friends', tag: 'coop-' + b.title_id });
      return Response.json({ sent: n });
    }
    if (b.type === 'releases') {
      const { data: rows } = await db.rpc('releases_today');
      const byUser = new Map<string, { title: string; what: string; section: string }[]>();
      (rows ?? []).forEach((r: any) => { const l = byUser.get(r.user_id) ?? []; if (!l.some((x) => x.title === r.title)) l.push({ title: r.title, what: r.what, section: r.section }); byUser.set(r.user_id, l); });
      let n = 0;
      for (const [uid, list] of byUser) {
        n += await sendTo(db, [uid], list.length === 1
          ? { title: 'Out today: ' + list[0].title + (EMOJI[list[0].section] ? ' ' + EMOJI[list[0].section] : ''), body: list[0].what, url: '/?open=home', tag: 'out-today' }
          : { title: list.length + ' things out today', body: list.slice(0, 4).map((x) => (EMOJI[x.section] ? EMOJI[x.section] + ' ' : '') + x.title).join(' · '), url: '/?open=home', tag: 'out-today' });
      }
      return Response.json({ sent: n });
    }
    return Response.json({ error: 'unknown type' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});
