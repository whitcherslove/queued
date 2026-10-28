import { supabase } from './supabase';
import type { ChatMsg, ItemLog, LibItem, LogRow, Mark, Overrides, SearchHit, SeasonEps, SeasonRating, Section, Status, Title } from './types';

export async function searchTitles(q: string, kind: 'movie' | 'tv'): Promise<SearchHit[]> {
  const { data, error } = await supabase.functions.invoke('search', { body: { q, kind } });
  if (error) throw error;
  return (data?.results ?? []) as SearchHit[];
}

export async function ensureTitle(kind: 'movie' | 'tv', sourceId: string, force = false): Promise<Title> {
  const { data, error } = await supabase.functions.invoke('title', { body: { kind, sourceId, force } });
  if (error) throw error;
  if (!data?.title) throw new Error(data?.error || 'No title returned');
  return data.title as Title;
}

const LIB_FIELDS = 'id, title_id, section, status, up_next, position, tier, score, rewatch, overrides, plan_from, plan_to, plan_seasons, run_started_at, started_on, title:titles(*)';

/** The server returns at most 1000 rows per request, so long lists are read page by page. */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadLibrary(section: Section): Promise<LibItem[]> {
  return allPages<LibItem>((a, b) => supabase.from('library').select(LIB_FIELDS).eq('section', section).order('position').order('id').range(a, b) as never);
}

export async function loadLogs(section: Section): Promise<LogRow[]> {
  return allPages<LogRow>((a, b) => supabase.from('logs')
    .select('id, library_id, scope, season_from, season_to, seasons, watched_at, tier, score, rewatch, position, library:library!inner(' + LIB_FIELDS + ')')
    .eq('library.section', section).eq('folded', false).order('watched_at', { ascending: false }).order('id').range(a, b) as never);
}

export async function addToBacklog(titleId: string, section: Section, position: number, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.from('library').insert({ title_id: titleId, section, position, ...extra });
  if (error) throw error;
}

export async function setUpNext(id: string, upNext: boolean, position: number): Promise<void> {
  const { error } = await supabase.from('library').update({ up_next: upNext, position }).eq('id', id);
  if (error) throw error;
}

export async function removeFromLibrary(id: string): Promise<void> {
  const { error } = await supabase.from('library').delete().eq('id', id);
  if (error) throw error;
}

export async function saveLibraryOrder(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => supabase.from('library').update({ position: i + 1 }).eq('id', id)));
}

export async function saveLogOrder(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) => supabase.from('logs').update({ position: i + 1 }).eq('id', id)));
}

export async function resetLogOrder(ids: string[]): Promise<void> {
  if (ids.length) await supabase.from('logs').update({ position: null }).in('id', ids);
}

export async function ensureTitleByImdb(imdbId: string, force = false, kind: 'movie' | 'tv' = 'movie'): Promise<Title> {
  const { data, error } = await supabase.functions.invoke('title', { body: { kind, imdbId, force } });
  if (error) throw error;
  if (!data?.title) throw new Error(data?.error || 'Not found');
  return data.title as Title;
}

export async function loadItem(id: string): Promise<LibItem> {
  const { data, error } = await supabase.from('library').select(LIB_FIELDS).eq('id', id).single();
  if (error) throw error;
  return data as unknown as LibItem;
}

export async function loadItemLogs(libraryId: string): Promise<ItemLog[]> {
  const { data, error } = await supabase.from('logs').select('id, watched_at, tier, score, rewatch, scope, season_from, season_to, seasons').eq('library_id', libraryId).order('watched_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ItemLog[];
}

export async function updateItem(id: string, patch: Partial<{ status: Status; up_next: boolean; position: number; score: number | null; rewatch: boolean; overrides: Overrides; plan_from: number | null; plan_to: number | null; plan_seasons: number[] | null; run_started_at: string | null; started_on: string | null }>): Promise<void> {
  const { error } = await supabase.from('library').update(patch).eq('id', id);
  if (error) throw error;
}

export async function insertLog(libraryId: string, log: Partial<ItemLog>): Promise<ItemLog> {
  const { data, error } = await supabase.from('logs').insert({ library_id: libraryId, ...log }).select('id, watched_at, tier, score, rewatch, scope, season_from, season_to, seasons').single();
  if (error) throw error;
  return data as ItemLog;
}

export async function updateLog(id: string, patch: Partial<ItemLog>): Promise<void> {
  const { error } = await supabase.from('logs').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteLog(id: string): Promise<void> {
  const { error } = await supabase.from('logs').delete().eq('id', id);
  if (error) throw error;
}

export async function loadChat(libraryId: string): Promise<ChatMsg[]> {
  const { data, error } = await supabase.from('chats').select('id, role, content, created_at').eq('library_id', libraryId).order('created_at');
  if (error) throw error;
  return (data ?? []) as ChatMsg[];
}

export async function askAi(libraryId: string, question: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ask', { body: { libraryId, question } });
  if (error) throw error;
  if (!data?.answer) throw new Error(data?.error || 'No answer');
  return data.answer as string;
}

export async function findOwnedBySource(sourceIds: string[], section: Section): Promise<Record<string, { id: string; status: Status; up_next: boolean }>> {
  if (!sourceIds.length) return {};
  const { data } = await supabase.from('library').select('id, status, up_next, title:titles!inner(source_id)').eq('section', section).in('titles.source_id', sourceIds);
  const out: Record<string, { id: string; status: Status; up_next: boolean }> = {};
  (data ?? []).forEach((r: any) => { out[r.title.source_id] = { id: r.id, status: r.status, up_next: r.up_next }; });
  return out;
}

export type Pic = { thumb: string; full: string };
export async function loadImages(sourceId: string, kind: 'movie' | 'tv' = 'movie'): Promise<{ backdrops: Pic[]; posters: Pic[] }> {
  const { data, error } = await supabase.functions.invoke('title', { body: { action: 'images', sourceId, kind } });
  if (error) return { backdrops: [], posters: [] };
  return { backdrops: (data?.backdrops ?? []) as Pic[], posters: (data?.posters ?? []) as Pic[] };
}

/** Upload an image from the device to the user's own folder and return its public link. */
export async function uploadCover(file: File, kind: 'poster' | 'backdrop'): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id; if (!uid) throw new Error('Not signed in');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${uid}/${kind}-${Date.now()}.${ext}`;
  const up = await supabase.storage.from('covers').upload(path, file, { contentType: file.type || 'image/jpeg' });
  if (up.error) throw up.error;
  return supabase.storage.from('covers').getPublicUrl(path).data.publicUrl;
}

// ---------- TV ----------
export async function refreshEpisodes(sourceIds: string[]): Promise<void> {
  if (!sourceIds.length) return;
  await supabase.functions.invoke('title', { body: { kind: 'tv', action: 'episodes', sourceIds } });
}

export async function loadEpisodes(titleIds: string[]): Promise<SeasonEps[]> {
  if (!titleIds.length) return [];
  return allPages<SeasonEps>((a, b) => supabase.from('title_seasons').select('title_id, season, name, air_date, episodes').in('title_id', titleIds).order('title_id').order('season').range(a, b));
}

export async function loadMarks(libraryIds: string[]): Promise<Mark[]> {
  if (!libraryIds.length) return [];
  return allPages<Mark>((a, b) => supabase.from('episode_marks').select('library_id, season, episode, watched_at').in('library_id', libraryIds).order('library_id').order('season').order('episode').range(a, b));
}

export async function setMarks(libraryId: string, eps: { season: number; episode: number }[], on: boolean): Promise<void> {
  if (!eps.length) return;
  if (on) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('episode_marks').upsert(eps.map((e) => ({ library_id: libraryId, season: e.season, episode: e.episode, watched_at: now })), { onConflict: 'library_id,season,episode' });
    if (error) throw error;
  } else {
    for (const e of eps) {
      const { error } = await supabase.from('episode_marks').delete().eq('library_id', libraryId).eq('season', e.season).eq('episode', e.episode);
      if (error) throw error;
    }
  }
}

export async function loadSeasonRatings(libraryId: string): Promise<SeasonRating[]> {
  const { data, error } = await supabase.from('season_ratings').select('library_id, season, tier, score, rated_at').eq('library_id', libraryId);
  if (error) throw error;
  return (data ?? []) as SeasonRating[];
}

export async function saveSeasonRating(libraryId: string, season: number, patch: { tier?: string | null; score?: number | null }): Promise<void> {
  const { error } = await supabase.from('season_ratings').upsert({ library_id: libraryId, season, ...patch, rated_at: new Date().toISOString().slice(0, 10) }, { onConflict: 'library_id,season' });
  if (error) throw error;
}
