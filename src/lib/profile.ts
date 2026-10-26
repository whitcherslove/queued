import { supabase } from './supabase';
import { DEFAULT_SETTINGS, Settings } from './theme';

export interface Profile { id: string; email: string; avatar_url: string | null; settings: Settings }

export async function loadProfile(userId: string, email: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('id, avatar_url, settings').eq('id', userId).maybeSingle();
  if (error) throw error;
  return {
    id: userId,
    email,
    avatar_url: data?.avatar_url ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) }
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
