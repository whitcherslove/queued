import { supabase } from './supabase';
import { DEFAULT_SETTINGS, Settings } from './theme';

export interface Profile { id: string; email: string; avatar_url: string | null; settings: Settings; display_name?: string | null; handle?: string | null; invite_code?: string | null }

export async function loadProfile(userId: string, email: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('id, avatar_url, settings, display_name, handle, invite_code').eq('id', userId).maybeSingle();
  if (error) throw error;
  return {
    id: userId,
    email,
    avatar_url: data?.avatar_url ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) },
    display_name: data?.display_name ?? null, handle: data?.handle ?? null, invite_code: data?.invite_code ?? null
  };
}

export async function saveSettings(userId: string, settings: Settings) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, settings, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const up = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) throw up.error;
  const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error } = await supabase.from('profiles').upsert({ id: userId, avatar_url: url, updated_at: new Date().toISOString() });
  if (error) throw error;
  return url;
}

export async function removeAvatar(userId: string) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, avatar_url: null, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Your name and @handle (letters, digits, dot, underscore; 3–20). Throws "handle taken" if someone has it. */
export async function saveIdentity(userId: string, name: string, handle: string): Promise<void> {
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  if (h && !/^[a-z0-9._]{3,20}$/.test(h)) throw new Error('A handle is 3–20 letters, digits, dots or underscores.');
  const { error } = await supabase.from('profiles').upsert({ id: userId, display_name: name.trim() || null, handle: h || null, updated_at: new Date().toISOString() });
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'That @handle is taken.' : error.message);
}
