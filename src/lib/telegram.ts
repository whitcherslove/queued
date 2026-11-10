import { supabase } from './supabase';

export interface TgGroup { id: string; title: string; active: boolean; posting: boolean; members: { id: string; name: string | null; avatar_url: string | null; can_remove?: boolean }[] }
export async function myTgGroups(): Promise<TgGroup[]> {
  const { data, error } = await supabase.rpc('my_tg_groups');
  if (error) throw error;
  return (data ?? []) as TgGroup[];
}
export async function addTgMember(group: string, friend: string) { const { error } = await supabase.rpc('add_tg_member', { g: group, friend }); if (error) throw new Error(error.message); }
export async function leaveTgGroup(group: string) { const { error } = await supabase.rpc('leave_tg_group', { g: group }); if (error) throw error; }
export async function setTgPosting(group: string, on: boolean) { const { error } = await supabase.rpc('set_tg_posting', { g: group, on_: on }); if (error) throw error; }
/** A link to add the bot to a group: t.me/<bot>?startgroup=<code> */
export async function tgConnectLink(): Promise<string | null> {
  const { data, error } = await supabase.rpc('create_tg_link');
  if (error) throw error;
  return data?.bot ? `https://t.me/${data.bot}?startgroup=${data.code}` : null;
}
export async function removeTgMember(group: string, member: string) { const { error } = await supabase.rpc('remove_tg_member', { g: group, member }); if (error) throw new Error(error.message); }
