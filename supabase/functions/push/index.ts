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

// ---------- Telegram: a post to the group's chat when someone finishes AND rates something ----------
const TG_EMOJI: Record<string, string> = { ten: '🤌🏻', awesome: '🔥', fine: '🙂', sobad: '🫠', filth: '🗑️' };
const TG_LINES: Record<string, string[]> = {
  ten: ['Instant classic — no notes.', 'Straight into the hall of fame.', 'Masterpiece, apparently.', 'Nothing will ever be this good again.'],
  awesome: ['Loved it.', 'Would recommend.', 'Worth every minute.', 'Good stuff, really good stuff.'],
  fine: ['It was… fine.', 'Not bad, not great.', 'Done it, that’s about it.', 'Perfectly okay.'],
  sobad: ['Terrible. Loved it.', 'A glorious mess.', 'So wrong it’s right.'],
  filth: ['Never again.', 'Want those hours back.', 'Avoid at all costs.']
};
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b64url = (x: string) => btoa(unescape(encodeURIComponent(x))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function tgCall(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return r.json().catch(() => ({ ok: false }));
}
async function telegramPost(db: any, id: string) {
  if (!env('TELEGRAM_BOT_TOKEN')) return { skipped: 'no bot token' };
  const { data: cfgRows } = await db.from('app_config').select('key, value').in('key', ['tg_chat_id', 'cloudinary_cloud', 'site_url']);
  const cfg: Record<string, string> = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.key, r.value]));
  if (!cfg.tg_chat_id) return { skipped: 'no chat' };
  const { data: a } = await db.from('activity').select('*, title:titles(title, poster_url, backdrop_url)').eq('id', id).maybeSingle();
  if (!a || a.kind !== 'finished' || !a.tier) return { skipped: 'not a rated finish' };
  const { data: p } = await db.from('profiles').select('display_name, handle, avatar_url, settings, telegram_off').eq('id', a.user_id).maybeSingle();
  if (p?.telegram_off) return { skipped: 'off' };
  const who = esc(nameOf(p)); const title = esc(a.title?.title ?? 'something');
  const verb = a.section === 'books' ? 'finished reading' : a.section === 'movies' ? 'watched' : a.section === 'tv' ? 'finished' : 'beat';
  const em = EMOJI[a.section] ?? '';
  // the same phrase for the same entry and rating (so an edit doesn't reshuffle it)
  const lines = TG_LINES[a.tier] ?? ['Done.']; let h = 0; for (const c of id + a.tier) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const scale = (p?.settings?.scale === 10 ? 10 : 5);
  const score = a.score != null ? (scale === 10 ? Math.round(Number(a.score) * 4) / 2 : Math.round(Number(a.score) * 2) / 2) + '/' + scale : '';
  const caption = `${em} <b>${who} ${verb} «${title}»</b>${a.section === 'tv' && a.seasons_label ? ' · ' + esc(a.seasons_label) : ''}\n${esc(lines[h % lines.length])}\n<b>${esc(TIER[a.tier] ?? a.tier)}${score ? ' · ' + score : ''}</b> ${TG_EMOJI[a.tier] ?? ''}`;
  // the picture: the title's image + your avatar in the corner + the rating badge (Cloudinary), or just the image
  const base = a.title?.backdrop_url ?? a.title?.poster_url ?? null;
  let photo = base;
  if (base && cfg.cloudinary_cloud) {
    let tr = 'c_scale,w_1280/';
    if (p?.avatar_url) tr += `l_fetch:${b64url(p.avatar_url)},g_north_west,x_30,y_30,w_250,h_250,c_fill,r_max/`;
    if (cfg.site_url) tr += `l_fetch:${b64url(cfg.site_url.replace(/\/$/, '') + '/tg/' + a.tier + '.png')},g_east,x_10,y_0,w_600,h_600,c_fit/`;
    photo = `https://res.cloudinary.com/${cfg.cloudinary_cloud}/image/fetch/${tr}${base}`;
  }
  const chat_id = cfg.tg_chat_id;
  if (a.tg_message_id) {
    // already posted: a new rating label → new picture and text; a new score only → new text
    const r = a.tg_tier !== a.tier && photo
      ? await tgCall('editMessageMedia', { chat_id, message_id: a.tg_message_id, media: { type: 'photo', media: photo, caption, parse_mode: 'HTML' } })
      : await tgCall(photo ? 'editMessageCaption' : 'editMessageText', { chat_id, message_id: a.tg_message_id, ...(photo ? { caption } : { text: caption }), parse_mode: 'HTML' });
    await db.from('activity').update({ tg_tier: a.tier }).eq('id', id);
    return { edited: !!r.ok };
  }
  let r = photo ? await tgCall('sendPhoto', { chat_id, photo, caption, parse_mode: 'HTML' }) : { ok: false };
  if (!r.ok) r = await tgCall('sendMessage', { chat_id, text: caption, parse_mode: 'HTML' });   // the picture failed → text only
  if (r.ok) await db.from('activity').update({ tg_message_id: r.result.message_id, tg_tier: a.tier }).eq('id', id);
  return { sent: !!r.ok, error: r.ok ? undefined : r.description };
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
      const coop = (a.coop_with ?? []).length ? 'with friends' : '';
      const details = (a.kind === 'started' ? [['console', 'pc', 'retro'].includes(a.section) && a.platform ? 'on ' + String(a.platform).toUpperCase() : '']
        : a.kind === 'season_rated' ? [a.seasons_label, rate]
        : a.kind === 'show_rated' ? ['The whole show', rate]
        : a.kind === 'dropped' ? [a.seasons_label]
        : [a.seasons_label, rate, coop]).filter(Boolean).join(' · ');
      const n = await sendTo(db, to, { title: head + (em ? ' ' + em : ''), body: details, url: '/?open=friends', tag: 'act-' + a.id });
      return Response.json({ sent: n });
    }
    if (b.type === 'telegram') return Response.json(await telegramPost(db, String(b.id)));
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
