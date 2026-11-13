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
