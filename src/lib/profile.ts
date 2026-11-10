import { supabase } from './supabase';
import { DEFAULT_SETTINGS, Settings } from './theme';

export interface Profile { id: string; email: string; avatar_url: string | null; settings: Settings; display_name?: string | null; handle?: string | null; invite_code?: string | null; telegram_off?: boolean }

export async function loadProfile(userId: string, email: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('id, avatar_url, settings, display_name, handle, invite_code, telegram_off').eq('id', userId).maybeSingle();
  if (error) throw error;
  return {
    id: userId,
    email,
    avatar_url: data?.avatar_url ?? null,
    settings: { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) },
    display_name: data?.display_name ?? null, handle: data?.handle ?? null, invite_code: data?.invite_code ?? null, telegram_off: !!data?.telegram_off
  };
}

export async function saveSettings(userId: string, settings: Settings) {
  const { error } = await supabase.from('profiles').upsert({ id: userId, settings, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Any photo → a square-ish 512 px JPEG (small, and iPhone HEIC photos become JPEG too). Falls back to the original file. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.86));
  } catch { return file; }
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const blob = await shrink(file);
  const jpeg = blob.type === 'image/jpeg';
  const ext = jpeg ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  // a new file name every time, so no "upsert" (that needs extra storage permissions and was failing)
  const up = await supabase.storage.from('avatars').upload(path, blob, { contentType: jpeg ? 'image/jpeg' : file.type || 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
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

/** Telegram group posts of your ratings: on by default, this turns them off (or back on). */
export async function setTelegramOff(userId: string, off: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ telegram_off: off }).eq('id', userId);
  if (error) throw new Error(error.message);
}
