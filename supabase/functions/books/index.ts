// Queued · books — search and details from Hardcover (main), Open Library (backup) and Google Books (Russian and the rest),
// with editions of the same book merged into one result. Cached in public.titles (kind = 'book').
// Secrets: HARDCOVER_TOKEN (required for Hardcover), GOOGLE_BOOKS_KEY (optional, higher limits).
// Actions: { action: 'search', q } · { action: 'details', ref, force? } · { action: 'link', url }
//   ref = 'hc:<id>' (Hardcover) · 'ol:<OL…W>' (Open Library work) · 'gb:<volumeId>' (Google Books)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const env = (k: string) => Deno.env.get(k) ?? '';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const FRESH = 30 * 864e5;

async function fetchT(url: string, init: RequestInit = {}, ms = 7000): Promise<Response> {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); }
  catch { return new Response(null, { status: 599 }); }
  finally { clearTimeout(tm); }
}

// ---------- title matching (editions of one book → one key) ----------
const NOISE = new Set(['the', 'a', 'an', 'edition', 'illustrated', 'novel', 'роман', 'издание', 'подарочное', 'иллюстрированное', 'сборник', 'книга', 'том', 'vol', 'volume']);
function baseTitle(t: string): string {
  // drop subtitles and bracketed bits: "Мастер и Маргарита : роман (подарочное издание)" → "Мастер и Маргарита"
  return t.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').split(/\s+[:—–-]\s+|:\s/)[0].trim();
}
function key(t: string): string {
  return baseTitle(t).toLowerCase().replace(/ё/g, 'е').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w && !NOISE.has(w)).join(' ');
}
// last name: the last word longer than an initial ("Михаил Булгаков" and "Булгаков М." → "булгаков")
const authorKey = (a?: string | null) => (a ?? '').toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}]+/u).filter((w) => w.length > 2).pop() ?? '';
const cyr = (s: string) => /[а-яё]/i.test(s);
// Russian → Latin, so "Булгаков" = "Bulgakov" and "Мастер и Маргарита" ≈ "The Master and Margarita"
const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const translit = (x: string) => x.toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? c);
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'i', 'and', 'v', 'na', 's', 'k', 'o']);
/** language-free key: transliterated, without little words — "мастер и маргарита" and "the master and margarita" → "master margarita" */
const crossKey = (t: string) => translit(key(t)).replace(/kh/g, 'h').split(' ').filter((w) => w && !STOP.has(w)).join(' ');
/** same title, or one is the other plus a single word ("Dune" ≈ "Dune Messiah"? no — that's 1 word, so years must also match) */
const nearSame = (a: string, b: string) => {
  if (!a || !b) return false; if (a === b) return true;
  const [s1, s2] = a.length < b.length ? [a, b] : [b, a];
  return s2.startsWith(s1 + ' ') && s2.slice(s1.length).trim().split(' ').length === 1 && !/^\d+$|^(ii|iii|iv|2|3)$/.test(s2.slice(s1.length).trim());
};
const authorX = (a?: string | null) => translit(authorKey(a)).replace(/kh/g, 'h');

interface Hit { ref: string; source: 'hardcover' | 'openlibrary' | 'google'; title: string; authors: string[]; year: number | null; cover: string | null; pages: number | null; series: string | null; editions: number | null; readers?: number | null; displayTitle?: string; displayAuthors?: string[]; altRef?: string }

// ---------- Hardcover (GraphQL) ----------
async function hc(query: string, variables: Record<string, unknown>): Promise<any> {
  const tok = env('HARDCOVER_TOKEN'); if (!tok) throw new Error('HARDCOVER_TOKEN is not set');
  const r = await fetchT('https://api.hardcover.app/v1/graphql', { method: 'POST', headers: { 'content-type': 'application/json', authorization: tok.startsWith('Bearer ') ? tok : 'Bearer ' + tok, 'user-agent': 'Queued/1.0' }, body: JSON.stringify({ query, variables }) }, 8000);
  if (!r.ok) throw new Error('Hardcover ' + r.status);
  const j = await r.json();
  if (j.errors?.length) throw new Error('Hardcover: ' + j.errors[0].message);
  return j.data;
}
async function hcSearch(q: string): Promise<Hit[]> {
  const d = await hc('query S($q: String!) { search(query: $q, query_type: "Book", per_page: 15, page: 1) { results } }', { q });
  const hits: any[] = d?.search?.results?.hits ?? [];
  return hits.map((h) => h.document ?? {}).filter((b) => b.id && b.title).map((b) => ({
    ref: 'hc:' + b.id, source: 'hardcover' as const, title: b.title, authors: (b.author_names ?? []).slice(0, 3), year: b.release_year ?? null,
    cover: b.image?.url ?? null, pages: b.pages ?? null, series: (b.series_names ?? [])[0] ?? null, editions: null, readers: b.users_count ?? null
  }));
}

// ---------- Open Library ----------
async function olSearch(q: string): Promise<Hit[]> {
  const r = await fetchT(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median&limit=12`, { headers: { 'user-agent': 'Queued/1.0 (personal reading log)' } });
  if (!r.ok) return [];
  const docs: any[] = (await r.json()).docs ?? [];
  return docs.filter((d) => d.key && d.title).map((d) => ({
    ref: 'ol:' + String(d.key).replace('/works/', ''), source: 'openlibrary' as const, title: d.title, authors: (d.author_name ?? []).slice(0, 3),
    year: d.first_publish_year ?? null, cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    pages: d.number_of_pages_median ?? null, series: null, editions: d.edition_count ?? null
  }));
}

// ---------- Google Books (editions merged by title + author) ----------
const gbCover = (v: any) => { const l = v.volumeInfo?.imageLinks ?? {}; const u = l.extraLarge ?? l.large ?? l.medium ?? l.thumbnail ?? l.smallThumbnail; return u ? String(u).replace('http://', 'https://').replace('&edge=curl', '') : null; };
async function gbSearch(q: string): Promise<Hit[]> {
  const k = env('GOOGLE_BOOKS_KEY');
  const r = await fetchT(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=40&printType=books${k ? '&key=' + k : ''}`);
  if (!r.ok) return [];
  const items: any[] = (await r.json()).items ?? [];
  const groups = new Map<string, any[]>();
  items.forEach((v) => {
    const i = v.volumeInfo ?? {}; if (!i.title) return;
    const g = key(i.title) + '|' + authorKey(i.authors?.[0]);
    groups.set(g, [...(groups.get(g) ?? []), v]);
  });
  return [...groups.values()].map((vs) => {
    const years = vs.map((v) => Number(String(v.volumeInfo.publishedDate ?? '').slice(0, 4))).filter((y) => y > 0);
    // the best edition: has a cover and a description, most pages
    const best = vs.slice().sort((a, b) => Number(!!gbCover(b)) - Number(!!gbCover(a)) || Number(!!b.volumeInfo.description) - Number(!!a.volumeInfo.description) || (b.volumeInfo.pageCount ?? 0) - (a.volumeInfo.pageCount ?? 0))[0];
    const i = best.volumeInfo;
    return { ref: 'gb:' + best.id, source: 'google' as const, title: baseTitle(i.title), authors: (i.authors ?? []).slice(0, 3), year: years.length ? Math.min(...years) : null,
      cover: gbCover(best), pages: i.pageCount ?? null, series: null, editions: vs.length };
  });
}

/** One list, no duplicates across sources: Hardcover first, then Open Library, then Google Books. Cyrillic queries ask Google Books right away. */
async function search(q: string) {
  const ru = cyr(q);
  const [h, o, g] = await Promise.all([
    hcSearch(q).catch(() => [] as Hit[]),
    olSearch(q).catch(() => [] as Hit[]),
    ru ? gbSearch(q).catch(() => [] as Hit[]) : Promise.resolve([] as Hit[])
  ]);
  const extra = !ru && h.length + o.length === 0 ? await gbSearch(q).catch(() => [] as Hit[]) : [];
  // 1) merge the same book across sources and languages: same author (transliterated) + same title key, or a matching year
  const all = [...h, ...o, ...g, ...extra];
  const out: Hit[] = [];
  for (const x of all) {
    const ak = authorX(x.authors[0]); const tk = crossKey(x.title);
    const twin = out.find((y) => ak && authorX(y.authors[0]) === ak && (crossKey(y.title) === tk || (nearSame(crossKey(y.title), tk) && (!x.year || !y.year || Math.abs(x.year - y.year) <= 2))));
    if (twin) {
      // keep the richer source (Hardcover first), but show the title in the language you searched in
      if (ru && cyr(x.title) && !cyr(twin.displayTitle ?? twin.title)) twin.displayTitle = baseTitle(x.title);
      // searched in Russian: remember the Russian twin (Google Books first — it has descriptions) for the author and description
      if (ru && cyr(x.title + ' ' + (x.authors[0] ?? '')) && !cyr(twin.title)) {
        if (!twin.altRef || (x.source === 'google' && !twin.altRef.startsWith('gb:'))) twin.altRef = x.ref;
        if (x.authors.length && cyr(x.authors[0]) && !twin.displayAuthors) twin.displayAuthors = x.authors;
      }
      twin.editions = Math.max(twin.editions ?? 0, x.editions ?? 0) || twin.editions;
      twin.cover = twin.cover ?? x.cover; twin.pages = twin.pages ?? x.pages;
      if (x.year && (!twin.year || x.year < twin.year)) twin.year = x.year;
      continue;
    }
    out.push({ ...x });
  }
  // 2) the books you most likely mean first: an exact title, popular (readers / editions), with a cover; essays "about" a book and empty records last
  const qk = crossKey(q);
  const score = (x: Hit) => (crossKey(x.displayTitle ?? x.title) === qk ? 6 : crossKey(x.displayTitle ?? x.title).startsWith(qk) ? 3 : 0)
    + Math.log10(1 + (x.readers ?? 0)) * 1.5 + Math.log10(1 + (x.editions ?? 0)) * 1.5 + (x.cover ? 1 : 0) + (x.authors.length ? 0.5 : -2)
    + (x.source === 'hardcover' ? 0.5 : 0) - ((x.editions ?? 1) === 0 ? 3 : 0);
  return out.sort((a, b) => score(b) - score(a)).slice(0, 20);
}

// ---------- details → titles ----------
const SRC: Record<string, string> = { hc: 'hardcover', ol: 'openlibrary', gb: 'google' };
async function details(db: any, ref: string, force = false) {
  const [p, id] = [ref.slice(0, 2), ref.slice(3)];
  const source = SRC[p]; if (!source || !id) throw new Error('Unknown book reference ' + ref);
  const { data: cached } = await db.from('titles').select('*').eq('kind', 'book').eq('source', source).eq('source_id', id).maybeSingle();
  if (cached && !force && Date.now() - new Date(cached.fetched_at).getTime() < FRESH) return cached;
  let row: any;
  if (p === 'hc') {
    const d = await hc(`query B($id: Int!) { books_by_pk(id: $id) { id title subtitle description release_date release_year pages audio_seconds slug rating ratings_count
      image { url } cached_contributors cached_tags book_series { position series { id name } } } }`, { id: Number(id) });
    const b = d?.books_by_pk; if (!b) throw new Error('Hardcover book ' + id + ' not found');
    const authors = (b.cached_contributors ?? []).filter((c: any) => !c.contribution || /author/i.test(c.contribution)).map((c: any) => c.author?.name).filter(Boolean);
    const tags = (b.cached_tags?.Genre ?? b.cached_tags?.genre ?? []).slice().sort((x: any, y: any) => (y.count ?? 0) - (x.count ?? 0))
      .map((t: any) => String(t.tag ?? t)).filter((t: string) => /^[\p{L}][\p{L} '&-]{1,30}$/u.test(t)).map((t: string) => t[0].toUpperCase() + t.slice(1));
    const ser = b.book_series?.[0];
    let seriesBooks: any[] = [];
    if (ser?.series?.id) {
      const s = await hc(`query S($id: Int!) { book_series(where: {series_id: {_eq: $id}}, order_by: {position: asc}, limit: 100) { position book { id title release_year users_count } } }`, { id: ser.series.id }).catch(() => null);
      // only the real books of the series: whole-number positions, one per position (the most read one) — no editions, box sets or extras
      const best = new Map<number, any>();
      for (const x of s?.book_series ?? []) {
        const pos = Number(x.position);
        if (!x.book || !Number.isInteger(pos) || pos < 1) continue;
        const cur = best.get(pos);
        if (!cur || (x.book.users_count ?? 0) > (cur.book.users_count ?? 0)) best.set(pos, x);
      }
      seriesBooks = [...best.values()].sort((a, c) => a.position - c.position).filter((x: any) => x.book.id !== b.id)
        .map((x: any) => ({ ref: 'hc:' + x.book.id, id: String(x.book.id), name: x.book.title, position: x.position, year: x.book.release_year ?? null }));
    }
    row = { title: b.title, release_date: b.release_date ?? null, year: b.release_year ?? null, authors, genres: [...new Set(tags)].slice(0, 6),
      overview: b.description ?? null, poster: b.image?.url ?? null,
      data: { subtitle: b.subtitle ?? null, pages: b.pages ?? null, audio_min: b.audio_seconds ? Math.round(b.audio_seconds / 60) : null, rating: b.rating ?? null, ratings: b.ratings_count ?? null,
        series: ser?.series ? { id: String(ser.series.id), name: ser.series.name, position: ser.position ?? null } : null, series_books: seriesBooks, series_v: 2, url: 'https://hardcover.app/books/' + b.slug } };
  } else if (p === 'ol') {
    const r = await fetchT(`https://openlibrary.org/works/${id}.json`, { headers: { 'user-agent': 'Queued/1.0 (personal reading log)' } });
    if (!r.ok) throw new Error('Open Library ' + r.status);
    const w = await r.json();
    const authors = (await Promise.all((w.authors ?? []).slice(0, 3).map(async (a: any) => {
      const k = a.author?.key; if (!k) return null;
      const ar = await fetchT(`https://openlibrary.org${k}.json`); return ar.ok ? (await ar.json()).name : null;
    }))).filter(Boolean);
    const s = await fetchT(`https://openlibrary.org/search.json?q=key:/works/${id}&fields=first_publish_year,number_of_pages_median,edition_count`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const doc = s?.docs?.[0] ?? {};
    row = { title: w.title, release_date: null, year: doc.first_publish_year ?? null, authors, genres: (w.subjects ?? []).slice(0, 6),
      overview: typeof w.description === 'string' ? w.description : w.description?.value ?? null, poster: w.covers?.[0] ? `https://covers.openlibrary.org/b/id/${w.covers[0]}-L.jpg` : null,
      data: { pages: doc.number_of_pages_median ?? null, audio_min: null, editions: doc.edition_count ?? null, series: null, series_books: [], url: `https://openlibrary.org/works/${id}` } };
  } else {
    const k = env('GOOGLE_BOOKS_KEY');
    const r = await fetchT(`https://www.googleapis.com/books/v1/volumes/${id}${k ? '?key=' + k : ''}`);
    if (!r.ok) throw new Error('Google Books ' + r.status);
    const v = await r.json(); const i = v.volumeInfo ?? {};
    row = { title: baseTitle(i.title ?? ''), release_date: /^\d{4}-\d{2}-\d{2}$/.test(i.publishedDate ?? '') ? i.publishedDate : null, year: Number(String(i.publishedDate ?? '').slice(0, 4)) || null,
      authors: i.authors ?? [], genres: (i.categories ?? []).slice(0, 6), overview: (i.description ?? '').replace(/<[^>]+>/g, '') || null, poster: gbCover(v),
      data: { pages: i.pageCount ?? null, audio_min: null, language: i.language ?? null, series: null, series_books: [], url: i.infoLink ?? null } };
  }
  const full = {
    kind: 'book', source, source_id: id, imdb_id: null, title: row.title, release_date: row.release_date, year: row.year, runtime: null,
    directors: row.authors, genres: row.genres, overview: row.overview, poster_url: row.poster, backdrop_url: null, metascore: null, imdb_rating: null,
    data: row.data, fetched_at: new Date().toISOString()
  };
  const { data, error } = await db.from('titles').upsert(full, { onConflict: 'kind,source,source_id' }).select('*').single();
  if (error) throw error;
  return data;
}

/** Every cover we can find for a book: its Hardcover editions, Open Library editions, Google Books editions. */
async function images(ref: string, title: string, author: string, alt = '') {
  const [p, id] = [ref.slice(0, 2), ref.slice(3)];
  const out: { url: string; label: string }[] = [];
  const add = (url: string | null | undefined, label: string) => { if (url && !out.some((x) => x.url === url)) out.push({ url, label }); };
  await Promise.all([
    // Hardcover: covers of the book's editions, most read first
    (async () => {
      if (p !== 'hc' || !env('HARDCOVER_TOKEN')) return;
      const d = await hc(`query E($id: Int!) { editions(where: {book_id: {_eq: $id}}, order_by: {users_count: desc}, limit: 40) { image { url } release_date language { language } } }`, { id: Number(id) }).catch(() => null);
      (d?.editions ?? []).forEach((e: any) => add(e.image?.url, ['Hardcover', e.release_date?.slice(0, 4), e.language?.language].filter(Boolean).join(' · ')));
    })(),
    // Open Library: the work's covers, or the work found by title + author
    (async () => {
      let work = p === 'ol' ? id : null;
      if (!work) {
        const r = await fetchT(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&fields=key&limit=1`, { headers: { 'user-agent': 'Queued/1.0 (personal reading log)' } });
        work = r.ok ? String((await r.json()).docs?.[0]?.key ?? '').replace('/works/', '') || null : null;
      }
      if (!work) return;
      const ed = await fetchT(`https://openlibrary.org/works/${work}/editions.json?limit=60`, { headers: { 'user-agent': 'Queued/1.0 (personal reading log)' } });
      const list: any[] = ed.ok ? (await ed.json()).entries ?? [] : [];
      list.forEach((e) => { const c = e.covers?.find((x: number) => x > 0); if (c) add(`https://covers.openlibrary.org/b/id/${c}-L.jpg`, ['Open Library', String(e.publish_date ?? '').match(/\d{4}/)?.[0]].filter(Boolean).join(' · ')); });
    })(),
    // Google Books: editions with the same title and author (bigger images) — under the title you see and the source's one
    ...[...new Set([title, alt].filter(Boolean))].map((title) => (async () => {
      const k = env('GOOGLE_BOOKS_KEY');
      const q = `intitle:${baseTitle(title)}${author ? ' inauthor:' + authorKey(author) : ''}`;
      const r = await fetchT(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=30&printType=books${k ? '&key=' + k : ''}`);
      const items: any[] = r.ok ? (await r.json()).items ?? [] : [];
      items.filter((v) => key(v.volumeInfo?.title ?? '') === key(title) || crossKey(v.volumeInfo?.title ?? '') === crossKey(title))
        .forEach((v) => { const c = gbCover(v); if (c) add(c.replace(/&zoom=\d/, '') + '&fife=w600', ['Google Books', String(v.volumeInfo?.publishedDate ?? '').slice(0, 4)].filter(Boolean).join(' · ')); });
    })())
  ]);
  return { posters: out.slice(0, 60), backdrops: [] };
}

/** A pasted link → a book reference. */
async function fromLink(url: string): Promise<string | null> {
  const ol = url.match(/openlibrary\.org\/works\/(OL\d+W)/i)?.[1]; if (ol) return 'ol:' + ol;
  const gb = url.match(/books\.google\.[a-z.]+\/books(?:\/edition\/[^/]*\/|\?id=)([A-Za-z0-9_-]{8,})/i)?.[1] ?? url.match(/[?&]id=([A-Za-z0-9_-]{8,})/)?.[1]; if (gb && /google/.test(url)) return 'gb:' + gb;
  const slug = url.match(/hardcover\.app\/books\/([a-z0-9-]+)/i)?.[1];
  if (slug) { const d = await hc('query L($s: String!) { books(where: {slug: {_eq: $s}}, limit: 1) { id } }', { s: slug }); return d?.books?.[0]?.id ? 'hc:' + d.books[0].id : null; }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await req.json().catch(() => ({}));
    if (body.action === 'search') { const q = String(body.q ?? '').trim(); return json({ results: q ? await search(q) : [] }); }
    if (body.action === 'details') return json({ title: await details(db, String(body.ref), !!body.force) });
    if (body.action === 'link') return json({ ref: await fromLink(String(body.url ?? '')) });
    if (body.action === 'images') return json(await images(String(body.ref), String(body.title ?? ''), String(body.author ?? ''), String(body.alt ?? '')));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
