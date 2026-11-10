import { supabase } from './supabase';

/** A friend, a request (incoming / sent) or a suggestion (someone who uploaded your AppSheet rows). */
export interface FriendRow { id: string | null; other: string; status: 'accepted' | 'pending' | 'suggested'; incoming: boolean; kind: 'friend' | 'suggestion'; name: string | null; handle: string | null; avatar_url: string | null }

export async function friendList(): Promise<FriendRow[]> {
  const { data, error } = await supabase.rpc('friend_list');
  if (error) throw error;
  return (data ?? []) as FriendRow[];
}
export async function acceptInvite(code: string): Promise<{ name: string | null; handle: string | null }> {
  const { data, error } = await supabase.rpc('accept_invite', { code });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] ?? { name: null, handle: null }) as { name: string | null; handle: string | null };
}
export async function findByHandle(h: string): Promise<{ id: string; name: string | null; handle: string | null; avatar_url: string | null } | null> {
  const { data, error } = await supabase.rpc('find_by_handle', { h });
  if (error) throw error;
  return (data ?? [])[0] ?? null;
}
export async function requestFriend(me: string, other: string): Promise<void> {
  const { error } = await supabase.from('friendships').insert({ requester: me, addressee: other });
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
}
export async function answerRequest(id: string, accept: boolean): Promise<void> {
  const { error } = accept ? await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id) : await supabase.from('friendships').delete().eq('id', id);
  if (error) throw error;
}
export async function removeFriend(id: string): Promise<void> {
  const { error } = await supabase.from('friendships').delete().eq('id', id);
  if (error) throw error;
}
export async function dismissSuggestion(me: string, from: string): Promise<void> {
  await supabase.from('friend_suggestions').delete().eq('user_id', me).eq('from_user', from);
}
export const inviteUrl = (code: string) => `${window.location.origin}/?invite=${code}`;

// ---------- activity feed and a friend's summary (never their lists) ----------
export interface Activity { id: string; user_id: string; name: string | null; handle: string | null; avatar_url: string | null; kind: 'started' | 'finished' | 'dropped' | 'season_rated' | 'show_rated';
  section: string; seasons_label: string | null; season: number | null; tier: string | null; score: number | null; platform: string | null; format: string | null; created_at: string;
  title_id: string; title: string; poster_url: string | null; year: number | null; mine?: boolean; coop_names?: string[] | null; can_delete?: boolean }
export async function activityFeed(before?: string): Promise<Activity[]> {
  const { data, error } = await supabase.rpc('activity_feed', { lim: 40, before: before ?? null });
  if (error) throw error;
  return (data ?? []) as Activity[];
}
export interface MiniTitle { title_id?: string; title: string; poster_url: string | null; section?: string; tier?: string | null; score?: number | null; dropped?: boolean; seasons_label?: string | null; platform?: string | null; format?: string | null; at?: string }
export interface FriendSummary {
  profile: { name: string | null; handle: string | null; avatar_url: string | null } | null;
  now: MiniTitle[]; recent: MiniTitle[]; year: Record<string, number> | null; favorites: MiniTitle[];
  match: { common: number; pct: number | null; both: { title: string; poster_url: string | null; mine: string; theirs: string }[] } | null;
}
export async function friendSummary(friend: string): Promise<FriendSummary> {
  const { data, error } = await supabase.rpc('friend_summary', { friend });
  if (error) throw new Error(error.message);
  return data as FriendSummary;
}
/** title ids you already have — to say "In your lists" instead of offering to add */
export async function myTitleIds(): Promise<Set<string>> {
  const { data } = await supabase.from('library').select('title_id');
  return new Set((data ?? []).map((r: { title_id: string }) => r.title_id));
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase.from('activity').delete().eq('id', id);
  if (error) throw error;
}

// ---------- co-op invites ("Slava says you played Hades together") ----------
export interface CoopInvite { id: string; from_name: string | null; from_avatar: string | null; title: string; poster_url: string | null; platform: string | null; playing: boolean; finished_at: string | null }
export async function myCoopInvites(): Promise<CoopInvite[]> { const { data, error } = await supabase.rpc('my_coop_invites'); if (error) throw error; return (data ?? []) as CoopInvite[]; }
export async function answerCoop(id: string, accept: boolean) { const { error } = await supabase.rpc('answer_coop', { inv: id, accept }); if (error) throw new Error(error.message); }
