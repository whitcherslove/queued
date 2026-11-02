/**
 * Platforms you can pick for a game, and which section they go to (Console / PC / Retro).
 * IGDB gives each game a list of platforms; we turn them into our own keys and labels,
 * and add the ways you actually play that IGDB doesn't list (Steam Deck, PS VR2 on PC).
 */
export type GameSection = 'console' | 'pc' | 'retro';
export interface Platform { key: string; label: string; section: GameSection; group: string }
export interface IgdbPlatform { id: number; name: string; slug?: string | null; abbr?: string | null }

/** Default retro list (editable in Settings): PS1 / N64 / Saturn generation and older. PS2, GameCube, Xbox stay in Console. */
export const DEFAULT_RETRO = ['ps1', 'n64', 'saturn', 'snes', 'nes', 'genesis', 'master-system', 'game-gear', 'sega-cd', 'sega-32x',
  'gb', 'gbc', 'virtual-boy', 'atari-2600', 'atari-7800', 'atari-jaguar', 'atari-lynx', 'neo-geo', 'turbografx', '3do', 'arcade', 'amiga', 'c64', 'msx', 'zx-spectrum', 'dos'];

/** Our catalog: key, label shown in the app, which IGDB names map to it (lowercase), group for the picker. */
const CATALOG: { key: string; label: string; pc?: boolean; group: string; match: (string | RegExp)[] }[] = [
  { key: 'pc', label: 'PC', pc: true, group: 'PC', match: ['pc (microsoft windows)', 'windows', 'linux', 'mac', 'macos', 'pc'] },
  { key: 'steam-deck', label: 'Steam Deck', pc: true, group: 'PC', match: [] },
  { key: 'psvr2-pc', label: 'PS VR2 · PC', pc: true, group: 'VR', match: [] },
  { key: 'psvr2-ps5', label: 'PS VR2 · PS5', group: 'VR', match: [] },
  { key: 'ps5', label: 'PS5', group: 'PlayStation', match: ['playstation 5'] },
  { key: 'ps4', label: 'PS4', group: 'PlayStation', match: ['playstation 4'] },
  { key: 'ps3', label: 'PS3', group: 'PlayStation', match: ['playstation 3'] },
  { key: 'ps2', label: 'PS2', group: 'PlayStation', match: ['playstation 2'] },
  { key: 'ps1', label: 'PS1', group: 'PlayStation', match: ['playstation'] },
  { key: 'psp', label: 'PSP', group: 'PlayStation', match: ['playstation portable'] },
  { key: 'vita', label: 'PS Vita', group: 'PlayStation', match: ['playstation vita'] },
  { key: 'xbox-series', label: 'Xbox Series X|S', group: 'Xbox', match: ['xbox series x|s', /xbox series/] },
  { key: 'xbox-one', label: 'Xbox One', group: 'Xbox', match: ['xbox one'] },
  { key: 'xbox-360', label: 'Xbox 360', group: 'Xbox', match: ['xbox 360'] },
  { key: 'xbox', label: 'Xbox', group: 'Xbox', match: ['xbox'] },
  { key: 'switch-2', label: 'Switch 2', group: 'Nintendo', match: ['nintendo switch 2'] },
  { key: 'switch', label: 'Switch', group: 'Nintendo', match: ['nintendo switch'] },
  { key: 'wii-u', label: 'Wii U', group: 'Nintendo', match: ['wii u'] },
  { key: 'wii', label: 'Wii', group: 'Nintendo', match: ['wii'] },
  { key: 'gamecube', label: 'GameCube', group: 'Nintendo', match: ['nintendo gamecube', 'gamecube'] },
  { key: 'n64', label: 'N64', group: 'Nintendo', match: ['nintendo 64'] },
  { key: 'snes', label: 'SNES', group: 'Nintendo', match: ['super nintendo entertainment system', 'super famicom'] },
  { key: 'nes', label: 'NES', group: 'Nintendo', match: ['nintendo entertainment system', 'family computer', 'famicom'] },
  { key: '3ds', label: '3DS', group: 'Nintendo', match: ['nintendo 3ds', 'new nintendo 3ds'] },
  { key: 'ds', label: 'DS', group: 'Nintendo', match: ['nintendo ds', 'nintendo dsi'] },
  { key: 'gba', label: 'GBA', group: 'Nintendo', match: ['game boy advance'] },
  { key: 'gbc', label: 'GBC', group: 'Nintendo', match: ['game boy color'] },
  { key: 'gb', label: 'Game Boy', group: 'Nintendo', match: ['game boy'] },
  { key: 'virtual-boy', label: 'Virtual Boy', group: 'Nintendo', match: ['virtual boy'] },
  { key: 'dreamcast', label: 'Dreamcast', group: 'Sega', match: ['dreamcast'] },
  { key: 'saturn', label: 'Saturn', group: 'Sega', match: ['sega saturn'] },
  { key: 'genesis', label: 'Mega Drive', group: 'Sega', match: ['sega mega drive/genesis', /mega drive|genesis/] },
  { key: 'master-system', label: 'Master System', group: 'Sega', match: [/master system/] },
  { key: 'game-gear', label: 'Game Gear', group: 'Sega', match: ['sega game gear'] },
  { key: 'sega-cd', label: 'Sega CD', group: 'Sega', match: ['sega cd'] },
  { key: 'sega-32x', label: '32X', group: 'Sega', match: ['sega 32x'] },
  { key: 'atari-2600', label: 'Atari 2600', group: 'Other', match: ['atari 2600'] },
  { key: 'atari-7800', label: 'Atari 7800', group: 'Other', match: ['atari 7800'] },
  { key: 'atari-jaguar', label: 'Jaguar', group: 'Other', match: ['atari jaguar'] },
  { key: 'atari-lynx', label: 'Lynx', group: 'Other', match: ['atari lynx'] },
  { key: 'neo-geo', label: 'Neo Geo', group: 'Other', match: [/neo geo/] },
  { key: 'turbografx', label: 'PC Engine', group: 'Other', match: [/turbografx|pc engine/] },
  { key: '3do', label: '3DO', group: 'Other', match: [/3do/] },
  { key: 'arcade', label: 'Arcade', group: 'Other', match: ['arcade'] },
  { key: 'dos', label: 'DOS', pc: true, group: 'PC', match: ['dos'] },
  { key: 'amiga', label: 'Amiga', group: 'Other', match: ['amiga'] },
  { key: 'c64', label: 'C64', group: 'Other', match: ['commodore c64/128/max', /commodore 64/] },
  { key: 'msx', label: 'MSX', group: 'Other', match: [/^msx/] },
  { key: 'zx-spectrum', label: 'ZX Spectrum', group: 'Other', match: ['zx spectrum'] },
  { key: 'stadia', label: 'Stadia', group: 'Other', match: ['google stadia'] },
  { key: 'ios', label: 'iOS', group: 'Mobile', match: ['ios'] },
  { key: 'android', label: 'Android', group: 'Mobile', match: ['android'] }
];
const VR_PS = [/playstation vr2/];
const VR_PC = [/steamvr/, /oculus rift/, /windows mixed reality/, /meta quest/, /oculus quest/, /playstation vr2/];

const byKey = new Map(CATALOG.map((c) => [c.key, c]));
const lc = (s: string) => s.trim().toLowerCase();
const matches = (name: string, m: string | RegExp) => (typeof m === 'string' ? lc(name) === m : m.test(lc(name)));

/** Our key for one IGDB platform (null if it's a VR platform handled separately or unknown). */
export function keyOfIgdb(p: IgdbPlatform): string | null {
  for (const c of CATALOG) if (c.match.some((m) => matches(p.name, m))) return c.key;
  return null;
}

/** Section a platform goes to: PC-type platforms → PC; your retro list → Retro; everything else → Console. */
export function sectionOf(key: string, retro: string[] = DEFAULT_RETRO): GameSection {
  const c = byKey.get(key);
  if (c?.pc) return 'pc';
  if (key === 'psvr2-pc') return 'pc';
  return retro.includes(key) ? 'retro' : 'console';
}

export function platformLabel(key: string | null | undefined, fallback?: string): string {
  if (!key) return fallback ?? '';
  return byKey.get(key)?.label ?? fallback ?? key;
}

/**
 * What to offer when adding a game: its IGDB platforms in our words, plus
 * Steam Deck (when it's on PC) and PS VR2 on PS5 / on PC (when it's a VR game).
 */
export function platformChoices(igdbPlatforms: IgdbPlatform[], retro: string[] = DEFAULT_RETRO): Platform[] {
  const keys = new Set<string>();
  const unknown: Platform[] = [];
  igdbPlatforms.forEach((p) => {
    const k = keyOfIgdb(p);
    if (k) keys.add(k);
    if (VR_PS.some((r) => r.test(lc(p.name)))) keys.add('psvr2-ps5');
    if (VR_PC.some((r) => r.test(lc(p.name)))) keys.add('psvr2-pc');
    if (!k && !VR_PC.some((r) => r.test(lc(p.name)))) unknown.push({ key: 'igdb-' + (p.slug || p.id), label: p.abbr || p.name, section: 'console', group: 'Other' });
  });
  if (keys.has('pc')) keys.add('steam-deck');
  const order = CATALOG.map((c) => c.key);
  return [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((k) => ({ key: k, label: platformLabel(k), section: sectionOf(k, retro), group: byKey.get(k)?.group ?? 'Other' }))
    .concat(unknown);
}

/** Every platform we know, for "Other platform…" and for the retro list in Settings. */
export const ALL_PLATFORMS: Platform[] = CATALOG.map((c) => ({ key: c.key, label: c.label, section: sectionOf(c.key), group: c.group }));
