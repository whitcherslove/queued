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
