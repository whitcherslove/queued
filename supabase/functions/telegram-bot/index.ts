// Queued · telegram-bot — receives updates from the Telegram bot (webhook).
// Connects a group to a person's companies: they open t.me/<bot>?startgroup=<code>, pick a group, the bot gets "/start <code>" there.
// Also notices when the bot is removed from a group (the company is marked inactive).
// Secrets: TELEGRAM_BOT_TOKEN, TG_WEBHOOK_SECRET (the same value you pass to setWebhook as secret_token). "Verify JWT" must be OFF.
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';
async function tg(method: string, payload: unknown) {
  await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => undefined);
}

Deno.serve(async (req) => {
  if (!env('TG_WEBHOOK_SECRET') || req.headers.get('x-telegram-bot-api-secret-token') !== env('TG_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 });
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const u = await req.json().catch(() => ({}));
  try {
    // the bot was removed from / added back to a group
    const mc = u.my_chat_member;
    if (mc?.chat?.id) {
      const st = mc.new_chat_member?.status;
      const active = st === 'member' || st === 'administrator';
      await db.from('tg_groups').update({ active, ...(mc.chat.title ? { title: mc.chat.title } : {}) }).eq('chat_id', mc.chat.id);
      return new Response('ok');
    }
    const m = u.message;
    const text: string = m?.text ?? '';
    const chat = m?.chat;
    const code = text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{6,32})/i)?.[1];
    if (!chat || !code) return new Response('ok');
    if (chat.type !== 'group' && chat.type !== 'supergroup') {
      await tg('sendMessage', { chat_id: chat.id, text: 'Open the link from Queued again and pick a group — I post to group chats.' });
      return new Response('ok');
    }
    const { data: link } = await db.from('tg_links').select('user_id').eq('code', code).maybeSingle();
    if (!link) { await tg('sendMessage', { chat_id: chat.id, text: 'This link has expired. Make a new one in Queued → Friends → Telegram.' }); return new Response('ok'); }
    // the company for this chat (new or existing), and the person in it
    const { data: g } = await db.from('tg_groups').upsert({ chat_id: chat.id, title: chat.title ?? 'Telegram chat', active: true, created_by: link.user_id }, { onConflict: 'chat_id', ignoreDuplicates: false }).select('id, title').single();
    await db.from('tg_members').upsert({ group_id: g.id, user_id: link.user_id, added_by: link.user_id }, { onConflict: 'group_id,user_id', ignoreDuplicates: true });
    await db.from('tg_links').delete().eq('code', code);
    const { data: p } = await db.from('profiles').select('display_name, handle').eq('id', link.user_id).maybeSingle();
    const who = p?.display_name || (p?.handle ? '@' + p.handle : 'Someone');
    await tg('sendMessage', { chat_id: chat.id, text: `👋 Queued is connected. ${who}’s finished-and-rated titles will be posted here.\nAdd friends to “${g.title}” in Queued → Friends → Telegram.` });
  } catch (_e) { /* never make Telegram retry forever */ }
  return new Response('ok');
});
