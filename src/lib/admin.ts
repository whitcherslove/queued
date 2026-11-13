import { supabase } from './supabase';

const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};
export const amAdmin = () => rpc<boolean>('is_admin').catch(() => false);
export const touchSeen = () => rpc<void>('touch_seen').catch(() => undefined);

export interface Overview {
  users: number; new_7d: number; active_7d: number; active_30d: number; added_7d: number; finished_7d: number; events_7d: number; reactions_7d: number;
  ai_today: number; ai_month: number; ai_by_kind: Record<string, number>; failed_24h: number; calls_24h: number; errors: { at: string; status: number | null; text: string }[];
}
export const adminOverview = () => rpc<Overview>('admin_overview');

export interface AdminUser { id: string; name: string | null; handle: string | null; avatar_url: string | null; email: string; joined: string; last_seen: string | null; telegram_off: boolean; items: number; friends: number; companies: string[] }
export const adminUsers = () => rpc<AdminUser[]>('admin_users');
export const adminUserAction = (target: string, action: 'reset_intro' | 'telegram_off' | 'delete') => rpc<void>('admin_user_action', { target, action });

export interface ConfigRow { key: string; value: string; editable: boolean }
export const adminConfig = () => rpc<ConfigRow[]>('admin_config');
export const adminSetConfig = (k: string, v: string) => rpc<void>('admin_set_config', { k, v });
export const adminTool = (tool: 'test_push' | 'releases') => rpc<void>('admin_tool', { tool });

// ---------- platforms, What's new, Telegram companies ----------
import type { CustomPlatform } from './platforms';
export async function loadCustomPlatforms(): Promise<CustomPlatform[]> {
  const { data } = await supabase.from('custom_platforms').select('key, label, grp, section, match, logo_url');
  return (data ?? []) as CustomPlatform[];
}
export async function saveCustomPlatform(p: CustomPlatform) { const { error } = await supabase.from('custom_platforms').upsert({ ...p, updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); }
export async function deleteCustomPlatform(key: string) { const { error } = await supabase.from('custom_platforms').delete().eq('key', key); if (error) throw new Error(error.message); }
/** Upload a prepared logo (white PNG) → its public URL (a new name each time, so caches don't keep the old one). */
export async function uploadLogo(key: string, png: Blob): Promise<string> {
  const path = key + '-' + Date.now() + '.png';
  const { error } = await supabase.storage.from('plogos').upload(path, png, { contentType: 'image/png' });
  if (error) throw new Error(error.message);
  return supabase.storage.from('plogos').getPublicUrl(path).data.publicUrl;
}

import type { ChangeEntry } from './changelog';
export async function loadChangelogDb(): Promise<ChangeEntry[]> {
  const { data } = await supabase.from('changelog_entries').select('version, title, items');
  return (data ?? []) as ChangeEntry[];
}
export async function saveChangelog(e: ChangeEntry) { const { error } = await supabase.from('changelog_entries').upsert(e); if (error) throw new Error(error.message); }
export async function deleteChangelog(version: string) { const { error } = await supabase.from('changelog_entries').delete().eq('version', version); if (error) throw new Error(error.message); }
export const seenCount = (v: string) => rpc<number>('admin_seen_count', { v });

export interface AdminTgGroup { id: string; title: string; active: boolean; chat_id: number | null; owner: string | null; posts_7d: number; members: { id: string; name: string | null; avatar_url: string | null; posting: boolean }[] }
export const adminTgGroups = () => rpc<AdminTgGroup[]>('admin_tg_groups');
export const adminTgRemove = (g: string, member: string) => rpc<void>('admin_tg_remove', { g, member });
export const adminTgTest = (g: string) => rpc<void>('admin_tg_test', { g });
