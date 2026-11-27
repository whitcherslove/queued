import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface AchPick { name: string; icon: string | null; pct: number | null; at: string | null }
export interface SteamStats {
  appid: number; name: string | null; playtime_min: number; playtime_deck_min: number; playtime_2w_min: number; last_played: string | null;
  ach_done: number | null; ach_total: number | null; ach_rarest: AchPick | null; ach_latest: AchPick | null; ach_easiest: AchPick | null;
  deck: 'verified' | 'playable' | 'unsupported' | 'unknown' | null; ach_checked_at: string | null; updated_at: string;
}

const call = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke('steam', { body });
  if (error) { let m = error.message; try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) m = j.error; } catch { /* keep */ } throw new Error(m); }
  if (data?.error) throw new Error(data.error);
  return data as T;
};
export const steamConnect = (profile: string) => call<{ ok: boolean; name?: string; games?: number }>({ action: 'connect', profile });
export const steamDisconnect = () => call<{ ok: boolean }>({ action: 'disconnect' });
export const steamSync = () => call<{ connected: boolean; games?: number }>({ action: 'sync' });
export const steamOwned = (q: string) => call<{ connected: boolean; games: { appid: number; name: string; playtime_min: number }[]; store?: { appid: number; name: string }[] }>({ action: 'owned', q });
type One = { connected: boolean; appid: number; stats: SteamStats | null; complete: boolean };
/** fresh numbers for one game (also links it when needed); appid: link it to this (0 = not on Steam, null = automatic) */
export const steamRefresh = (libraryId: string) => call<One>({ action: 'refresh', libraryId }).then(remember);
export const steamResolve = (libraryId: string) => call<One>({ action: 'resolve', libraryId }).then(remember);
export const steamLink = (libraryId: string, appid: number | null) => call<One>({ action: 'link', libraryId, appid }).then(remember);
/** "store.steampowered.com/app/1145360/Hades/" or just "1145360" → 1145360 */
export const appIdFromInput = (s: string) => Number(s.match(/app\/(\d+)/)?.[1] ?? (/^\d{2,8}$/.test(s.trim()) ? s.trim() : 0)) || null;

// ---------- your Steam numbers, kept in memory and on the phone ----------
const KEY = 'queued.steam';
let store: Record<number, SteamStats> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })();
const subs = new Set<() => void>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* full */ } subs.forEach((f) => f()); };
function remember(r: One): One { if (r?.stats) { store = { ...store, [r.stats.appid]: r.stats }; save(); } return r; }
/** once at start (after Home is drawn): the Steam numbers of the games in your lists, straight from the database */
export async function loadMySteam() {
  const { data, error } = await supabase.rpc('my_steam');
  if (error || !data) return;
  store = Object.fromEntries((data as SteamStats[]).map((s) => [s.appid, s])); save();
}
export const steamOf = (appid: number | null | undefined) => (appid ? store[appid] ?? null : null);
export function useSteam(appid: number | null | undefined): SteamStats | null {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return steamOf(appid);
}
export function useSteamAll(): Record<number, SteamStats> {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return store;
}
export const clearSteam = () => { store = {}; save(); };

/** How your pace compares with most players (hours vs HowLongToBeat Main vs your progress). */
export function paceLine(hours: number, main: number | null | undefined, progress: number | null | undefined, seed: string): string | null {
  if (!main || progress == null || hours < 1 || progress <= 0) return null;
  const expected = Math.min(100, (hours / main) * 100), diff = progress - expected;
  const pick = (l: string[]) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return l[h % l.length]; };
  if (Math.abs(diff) <= 15) return pick(['On pace with most players.', 'Right on schedule — like most people.', 'Steady — about where most players are.']);
  if (diff < 0) return pick(['Taking your time — the story will wait.', 'Exploring every corner, huh? The plot can wait.', 'Slow and thorough — the world is worth it.']);
  return pick(['Faster than most — speedrunner vibes.', 'Ahead of the pack — not stopping to smell the roses.', 'Moving quick — most players are behind you.']);
}
/** Steam says you've been playing it, and you haven't said "Not now" since */
export function steamHint(s: SteamStats | null, status: string, lastFinished: string | null, offAt: string | null | undefined): 'start' | 'replay' | null {
  if (!s || s.playtime_2w_min <= 0 || !s.last_played) return null;
  if (offAt && new Date(s.last_played) <= new Date(offAt)) return null;
  if (status === 'backlog') return 'start';
  if (status === 'done' && (!lastFinished || new Date(s.last_played) > new Date(lastFinished))) return 'replay';
  return null;
}

/** is Steam connected on this account (set from the profile; remembered on the phone) */
export const steamConnected = () => { try { return localStorage.getItem('queued.steam.on') === '1'; } catch { return false; } };
export const setSteamConnected = (on: boolean) => { try { localStorage.setItem('queued.steam.on', on ? '1' : '0'); } catch { /* ignore */ } if (!on) clearSteam(); };
