// Queued · ask — chat with Gemini about one item in the user's library
// Secrets: GEMINI_API_KEY, optional GEMINI_MODEL (default gemini-2.5-flash), optional GEMINI_FALLBACK_MODEL
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/** Gemini call with a readable error. If web search (grounding) is refused — free tier on newer models, daily limit — retry without it. */
async function gemini(model: string, body: any): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!key) throw new Error('GEMINI_API_KEY is not set in this Supabase project (Edge Functions → Secrets).');
  const call = async (b: any) => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
    });
    const raw = await r.text();
    if (!r.ok) {
      let msg = raw.slice(0, 300);
      try { msg = JSON.parse(raw)?.error?.message ?? msg; } catch { /* plain text */ }
      const e = new Error(`Gemini ${model} ${r.status}: ${msg}`) as Error & { status?: number }; e.status = r.status; throw e;
    }
    const j = JSON.parse(raw);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim();
    if (!text) throw new Error(`Gemini ${model}: empty answer (${j.candidates?.[0]?.finishReason ?? 'no candidates'})`);
    return text;
  };
  try { return await call(body); }
  catch (e) {
    const status = (e as { status?: number }).status;
    // search not available / quota for grounding → answer from the model's own knowledge instead of failing
    if (body?.tools && (status === 400 || status === 403 || status === 429)) { const { tools: _t, ...rest } = body; return await call(rest); }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { libraryId, question, mode, text, lang } = await req.json();
    // AI usage: counted per person, with a daily limit (set in Admin → Settings); the admin has none
    {
      const { data: okAi } = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
        .rpc('ai_take', { kind: mode === 'translate' ? 'translate' : mode === 'tonight' ? 'tonight' : 'ask' });
      if (okAi === false) return Response.json({ error: 'You’ve used today’s AI picks — try again tomorrow.' }, { status: 429, headers: CORS });
    }
    // mode "translate": a book description in the language you read in (signed-in users only)
    if (mode === 'translate') {
      const { data: who } = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }).auth.getUser();
      if (!who?.user) return Response.json({ error: 'Sign in first' }, { status: 401, headers: CORS });
      const src = String(text ?? '').slice(0, 6000); if (!src) return Response.json({ text: '' }, { headers: CORS });
      const target = lang === 'ru' ? 'Russian' : 'English';
      const tBody = { systemInstruction: { parts: [{ text: `Translate this book description into natural, literary ${target}. Keep names as they are usually written in ${target} editions. Reply with the translation only.` }] }, contents: [{ role: 'user', parts: [{ text: src }] }] };
      const m1 = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash', m2 = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.5-flash-lite';
      let out: string; try { out = await gemini(m1, tBody); } catch { out = await gemini(m2, tBody); }
      return Response.json({ text: out }, { headers: CORS });
    }
    // mode "tonight": pick one thing from your backlog for tonight (time, mood, what you've liked)
    if (mode === 'tonight') {
      const { data: who } = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }).auth.getUser();
      if (!who?.user) return Response.json({ error: 'Sign in first' }, { status: 401, headers: CORS });
      const reqBody = text as { wish?: string; candidates?: unknown[]; liked?: unknown[]; skip?: string[] } | undefined;
      const cands = (reqBody?.candidates ?? []).slice(0, 120);
      if (!cands.length) return Response.json({ error: 'Your backlog is empty.' }, { status: 400, headers: CORS });
      const tBody = {
        systemInstruction: { parts: [{ text:
          'You help someone pick ONE thing from their own backlog for tonight. The backlog mixes movies, TV shows, games and books (the "kind" field) — treat every kind as equally possible and don’t lean towards one kind unless the wish asks for it; their favourites ("liked") are taste hints across kinds, not a reason to pick the same kind. Consider the time they have (runtime, episode length, time to beat / to read) and their mood. ' +
          'Use what they rated highly as taste hints. Never pick an id from "skip". Reply ONLY with JSON: {"id": "<id from the list>", "why": "<one or two warm sentences, in the language of the wish>"}. No markdown.' }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ wish: reqBody?.wish ?? 'something good tonight', skip: reqBody?.skip ?? [], liked: (reqBody?.liked ?? []).slice(0, 30), backlog: cands }) }] }]
      };
      const m1 = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash', m2 = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.5-flash-lite';
      let raw: string; try { raw = await gemini(m1, tBody); } catch { raw = await gemini(m2, tBody); }
      try { const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw); return Response.json({ id: String(j.id), why: String(j.why ?? '') }, { headers: CORS }); }
      catch { return Response.json({ error: 'Couldn’t pick — try again.' }, { status: 502, headers: CORS }); }
    }
    const q = String(question ?? '').trim();
    if (!libraryId || !q) return Response.json({ error: 'libraryId and question are required' }, { status: 400, headers: CORS });

    // act as the signed-in user, so row level security proves the item is theirs
    const auth = req.headers.get('Authorization') ?? '';
    const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: item, error } = await userDb.from('library').select('id, user_id, section, overrides, title:titles(*)').eq('id', libraryId).single();
    if (error || !item) return Response.json({ error: 'Not found' }, { status: 404, headers: CORS });
    const t: any = { ...(item as any).title, ...((item as any).overrides ?? {}) };

    const { data: history } = await userDb.from('chats').select('role, content').eq('library_id', libraryId).order('created_at').limit(20);

    const context = [
      `Title: ${t.title}${t.year ? ` (${t.year})` : ''}`,
      t.kind === 'game' ? 'Type: video game' : t.kind === 'book' ? 'Type: book' : t.kind === 'tv' ? 'Type: TV show' : 'Type: movie',
      t.directors?.length ? `${t.kind === 'game' ? 'Developer' : t.kind === 'book' ? 'Author' : t.kind === 'tv' ? 'Created by' : 'Director'}: ${t.directors.join(', ')}` : '',
      t.kind === 'game' && t.data?.platforms?.length ? `Platforms: ${t.data.platforms.map((p: any) => p.name).join(', ')}` : '',
      t.kind === 'game' && t.data?.ttb?.main ? `Time to beat (story): about ${t.data.ttb.main} h` : '',
      t.genres?.length ? `Genres: ${t.genres.join(', ')}` : '',
      t.overview ? `Overview: ${t.overview}` : ''
    ].filter(Boolean).join('\n');

    const body = {
      systemInstruction: { parts: [{ text:
        (t.kind === 'game'
          ? 'You are a friendly video game expert inside a personal backlog app. Answer questions about the game below. '
          : t.kind === 'book'
          ? 'You are a friendly literature expert inside a personal reading log. Answer questions about the book below; avoid spoilers unless asked. Reply in the language of the question. '
          : 'You are a friendly film and TV expert inside a personal watch-log app. Answer questions about the title below. ') +
        'Reply in the same language as the question, briefly (2–6 sentences) unless asked for more. ' +
        'Use web search for facts you are not sure about. Do not reveal major plot twists unless the user clearly asks about the plot or ending.\n\n' + context } ] },
      contents: [...(history ?? []).map((h: any) => ({ role: h.role, parts: [{ text: h.content }] })), { role: 'user', parts: [{ text: q }] }],
      tools: [{ google_search: {} }]
    };

    const primary = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash';
    const fallback = Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.5-flash-lite';

    // mode "progress": estimate how far into the game the player is (0–100 %) from their description; saves it on the item
    if (mode === 'progress') {
      const pBody = {
        systemInstruction: { parts: [{ text:
          (t.kind === 'book' ? 'You estimate how far a reader is through a book (percent of the whole book). Use web search to check its structure (parts, chapters, key events). ' : 'You estimate a player\'s progress through a video game\'s main story. Use web search to check the game\'s structure (chapters, missions, bosses). ') +
          'Reply ONLY with JSON: {"progress": <integer 0-100>, "note": "<one short sentence: where that point is in the game>"}. No markdown.\n\n' + context } ] },
        contents: [{ role: 'user', parts: [{ text: 'Where I am: ' + q }] }],
        tools: [{ google_search: {} }]
      };
      let raw: string;
      try { raw = await gemini(primary, pBody); } catch (e) { if (!fallback) throw e; raw = await gemini(fallback, pBody); }
      const m = raw.match(/\{[\s\S]*\}/);
      let progress = NaN, note = '';
      try { const j = JSON.parse(m ? m[0] : raw); progress = Number(j.progress); note = String(j.note ?? ''); } catch { const n = raw.match(/(\d{1,3})\s*%?/); progress = n ? Number(n[1]) : NaN; }
      if (!Number.isFinite(progress)) return Response.json({ error: 'Couldn’t work out the progress — try describing it differently.' }, { status: 422, headers: CORS });
      progress = Math.max(0, Math.min(100, Math.round(progress)));
      const { error: upErr } = await userDb.from('library').update({ progress }).eq('id', libraryId);
      if (upErr) return Response.json({ error: upErr.message }, { status: 500, headers: CORS });
      return Response.json({ progress, note }, { headers: CORS });
    }
    let answer: string;
    try { answer = await gemini(primary, body); }
    catch (e) { if (!fallback) throw e; answer = await gemini(fallback, body); }

    const { error: insErr } = await userDb.from('chats').insert([
      { library_id: libraryId, role: 'user', content: q },
      { library_id: libraryId, role: 'model', content: answer }
    ]);
    if (insErr) return Response.json({ error: insErr.message }, { status: 500, headers: CORS });
    return Response.json({ answer }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: CORS });
  }
});
