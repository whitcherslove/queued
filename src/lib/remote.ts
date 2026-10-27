import { supabase } from './supabase';
import type { ChatMsg, ItemLog, LibItem, LogRow, Overrides, SearchHit, Section, Status, Title } from './types';

export async function searchTitles(q: string, kind: 'movie'): Promise<SearchHit[]> {
  const { data, error } = await supabase.functions.invoke('search', { body: { q, kind } });
  if (error) throw error;
  return (data?.results ?? []) as SearchHit[];
}

export async function ensureTitle(kind: 'movie', sourceId: string, force = false): Promise<Title> {
  const { data, error } = await supabase.functions.invoke('title', { body: { kind, sourceId, force } });
  if (error) throw error;
  if (!data?.title) throw new Error(data?.error || 'No title returned');
  return data.title as Title;
}

const LIB_FIELDS = 'id, title_id, section, status, up_next, position, tier, score, overrides, title:titles(*)';

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

export async function loadItem(id: string): Promise<LibItem> {
  const { data, error } = await supabase.from('library').select(LIB_FIELDS).eq('id', id).single();
  if (error) throw error;
  return data as unknown as LibItem;
}

export async function loadItemLogs(libraryId: string): Promise<ItemLog[]> {
  const { data, error } = await supabase.from('logs').select('id, watched_at, tier, score, rewatch').eq('library_id', libraryId).order('watched_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ItemLog[];
}

export async function updateItem(id: string, patch: Partial<{ status: Status; up_next: boolean; position: number; score: number | null; overrides: Overrides }>): Promise<void> {
  const { error } = await supabase.from('library').update(patch).eq('id', id);
  if (error) throw error;
}

export async function insertLog(libraryId: string, log: Partial<ItemLog>): Promise<ItemLog> {
  const { data, error } = await supabase.from('logs').insert({ library_id: libraryId, ...log }).select('id, watched_at, tier, score, rewatch').single();
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
