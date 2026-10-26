import { supabase } from './supabase';
import type { LibItem, LogRow, SearchHit, Section, Title } from './types';

export async function searchTitles(q: string, kind: 'movie'): Promise<SearchHit[]> {
  const { data, error } = await supabase.functions.invoke('search', { body: { q, kind } });
  if (error) throw error;
  return (data?.results ?? []) as SearchHit[];
}

export async function ensureTitle(kind: 'movie', sourceId: string): Promise<Title> {
  const { data, error } = await supabase.functions.invoke('title', { body: { kind, sourceId } });
  if (error) throw error;
  if (!data?.title) throw new Error(data?.error || 'No title returned');
  return data.title as Title;
}

const LIB_FIELDS = 'id, title_id, section, status, up_next, position, tier, score, title:titles(*)';

export async function loadLibrary(section: Section): Promise<LibItem[]> {
  const { data, error } = await supabase.from('library').select(LIB_FIELDS).eq('section', section).order('position');
  if (error) throw error;
  return (data ?? []) as unknown as LibItem[];
}

export async function loadLogs(section: Section): Promise<LogRow[]> {
  const { data, error } = await supabase.from('logs')
    .select('id, library_id, scope, season_from, season_to, watched_at, tier, score, rewatch, position, library:library!inner(' + LIB_FIELDS + ')')
    .eq('library.section', section).eq('folded', false).order('watched_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as LogRow[];
}

export async function addToBacklog(titleId: string, section: Section, position: number): Promise<void> {
  const { error } = await supabase.from('library').insert({ title_id: titleId, section, position });
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
