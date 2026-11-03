// Queued · ask — chat with Gemini about one item in the user's library
// Secrets: GEMINI_API_KEY, optional GEMINI_MODEL (default gemini-2.5-flash), optional GEMINI_FALLBACK_MODEL
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function gemini(model: string, body: unknown) {
  const key = Deno.env.get('GEMINI_API_KEY') ?? '';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Gemini ${model} ${r.status}`);
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim();
  if (!text) throw new Error('Empty answer');
  return text;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { libraryId, question, mode } = await req.json();
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
      t.kind === 'game' ? 'Type: video game' : t.kind === 'tv' ? 'Type: TV show' : 'Type: movie',
      t.directors?.length ? `${t.kind === 'game' ? 'Developer' : t.kind === 'tv' ? 'Created by' : 'Director'}: ${t.directors.join(', ')}` : '',
      t.kind === 'game' && t.data?.platforms?.length ? `Platforms: ${t.data.platforms.map((p: any) => p.name).join(', ')}` : '',
      t.kind === 'game' && t.data?.ttb?.main ? `Time to beat (story): about ${t.data.ttb.main} h` : '',
      t.genres?.length ? `Genres: ${t.genres.join(', ')}` : '',
      t.overview ? `Overview: ${t.overview}` : ''
    ].filter(Boolean).join('\n');

    const body = {
      systemInstruction: { parts: [{ text:
        (t.kind === 'game'
          ? 'You are a friendly video game expert inside a personal backlog app. Answer questions about the game below. '
          : 'You are a friendly film and TV expert inside a personal watch-log app. Answer questions about the title below. ') +
        'Reply in the same language as the question, briefly (2–6 sentences) unless asked for more. ' +
        'Use web search for facts you are not sure about. Do not reveal major plot twists unless the user clearly asks about the plot or ending.\n\n' + context } ] },
      contents: [...(history ?? []).map((h: any) => ({ role: h.role, parts: [{ text: h.content }] })), { role: 'user', parts: [{ text: q }] }],
      tools: [{ google_search: {} }]
    };

    const primary = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    const fallback = Deno.env.get('GEMINI_FALLBACK_MODEL');

    // mode "progress": estimate how far into the game the player is (0–100 %) from their description; saves it on the item
    if (mode === 'progress') {
      const pBody = {
        systemInstruction: { parts: [{ text:
          'You estimate a player\'s progress through a video game\'s main story. Use web search to check the game\'s structure (chapters, missions, bosses). ' +
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
