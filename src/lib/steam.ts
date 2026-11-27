import { supabase } from './supabase';

export interface SteamStats { appid: number; name: string | null; playtime_min: number; playtime_deck_min: number; playtime_2w_min: number; last_played: string | null; ach_done: number | null; ach_total: number | null; updated_at: string }
export interface SteamCardData { connected: boolean; appid?: number | null; steamName?: string | null; stats?: SteamStats | null; refreshing?: boolean; error?: string }

const call = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke('steam', { body });
  if (error) { let m = error.message; try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) m = j.error; } catch { /* keep */ } throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data as T;
};
export const steamConnect = (profile: string) => call<{ ok: boolean; name?: string; games?: number; error?: string }>({ action: 'connect', profile });
export const steamDisconnect = () => call<{ ok: boolean }>({ action: 'disconnect' });
export const steamSync = () => call<{ connected: boolean; games?: number }>({ action: 'sync' });
export const steamCard = (libraryId: string, refresh = false) => call<SteamCardData>({ action: refresh ? 'refresh' : 'card', libraryId });
/** Started as soon as a game's card opens, so the Steam block arrives together with the rest. */
const early = new Map<string, Promise<SteamCardData>>();
export function prefetchSteam(libraryId: string) { if (!early.has(libraryId)) early.set(libraryId, steamCard(libraryId).catch(() => ({ connected: false }))); setTimeout(() => early.delete(libraryId), 15000); }
export const takeSteam = (libraryId: string) => early.get(libraryId) ?? steamCard(libraryId);
export const steamOwned = (q: string) => call<{ connected: boolean; games: { appid: number; name: string; playtime_min: number }[]; store?: { appid: number; name: string }[] }>({ action: 'owned', q });
/** appid: a Steam app id, 0 = "Not on Steam", null = back to automatic */
export const steamLink = (libraryId: string, appid: number | null) => call<{ ok: boolean }>({ action: 'link', libraryId, appid });
/** "store.steampowered.com/app/1145360/Hades/" or just "1145360" → 1145360 */
export const appIdFromInput = (s: string) => Number(s.match(/app\/(\d+)/)?.[1] ?? (/^\d{2,8}$/.test(s.trim()) ? s.trim() : 0)) || null;

/** How your pace compares with most players (hours vs HowLongToBeat Main vs your progress). */
export function paceLine(hours: number, main: number | null | undefined, progress: number | null | undefined, seed: string): string | null {
  if (!main || progress == null || hours < 1 || progress <= 0) return null;
  const expected = Math.min(100, (hours / main) * 100), diff = progress - expected;
  const pick = (l: string[]) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return l[h % l.length]; };
  if (Math.abs(diff) <= 15) return pick(['On pace with most players.', 'Right on schedule — like most people.', 'Steady — about where most players are.']);
  if (diff < 0) return pick(['Taking your time — the story will wait.', 'Exploring every corner, huh? The plot can wait.', 'Slow and thorough — the world is worth it.']);
  return pick(['Faster than most — speedrunner vibes.', 'Ahead of the pack — not stopping to smell the roses.', 'Moving quick — most players are behind you.']);
}
