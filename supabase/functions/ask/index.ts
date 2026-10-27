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
    const { libraryId, question } = await req.json();
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
      t.directors?.length ? `Director: ${t.directors.join(', ')}` : '',
      t.genres?.length ? `Genres: ${t.genres.join(', ')}` : '',
      t.overview ? `Overview: ${t.overview}` : ''
    ].filter(Boolean).join('\n');

    const body = {
      systemInstruction: { parts: [{ text:
        'You are a friendly film and TV expert inside a personal watch-log app. Answer questions about the title below. ' +
        'Reply in the same language as the question, briefly (2–6 sentences) unless asked for more. ' +
        'Use web search for facts you are not sure about. Do not reveal major plot twists unless the user clearly asks about the plot or ending.\n\n' + context } ] },
      contents: [...(history ?? []).map((h: any) => ({ role: h.role, parts: [{ text: h.content }] })), { role: 'user', parts: [{ text: q }] }],
      tools: [{ google_search: {} }]
    };

    const primary = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
    const fallback = Deno.env.get('GEMINI_FALLBACK_MODEL');
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
