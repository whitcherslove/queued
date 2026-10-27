export type ThemeId = 'dark' | 'light';
export type AccentId = 'blue' | 'violet' | 'teal' | 'coral' | 'amber';
export type Scale = 5 | 10;

export type View = 'list' | 'grid';
export interface Settings { theme: ThemeId; accent: AccentId; scale: Scale; view: View; posterScore: boolean; listMetascore: boolean }
export const DEFAULT_SETTINGS: Settings = { theme: 'dark', accent: 'blue', scale: 5, view: 'list', posterScore: true, listMetascore: true };

export const THEMES: Record<ThemeId, Record<string, string>> = {
  dark: { bg: '#121214', surface: '#1C1C21', surface2: '#2A2A30', line: '#30303A', ink: '#F2EFE8', muted: '#A19D94' },
  light: { bg: '#F3EFE6', surface: '#FFFFFF', surface2: '#E6E0D3', line: '#E2DCCF', ink: '#17161A', muted: '#6B675F' }
};

export const ACCENTS: { id: AccentId; label: string; dark: string; light: string }[] = [
  { id: 'blue', label: 'Blue', dark: '#6E9CF5', light: '#2F62D1' },
  { id: 'violet', label: 'Violet', dark: '#A68BF5', light: '#6A4BD1' },
  { id: 'teal', label: 'Teal', dark: '#4FC7B5', light: '#137A6C' },
  { id: 'coral', label: 'Coral', dark: '#E8583E', light: '#C23A22' },
  { id: 'amber', label: 'Amber', dark: '#F2B544', light: '#946500' }
];

export function themeVars(s: Settings): Record<string, string> {
  const t = THEMES[s.theme];
  const a = ACCENTS.find((x) => x.id === s.accent) ?? ACCENTS[0];
  return {
    '--bg': t.bg, '--surface': t.surface, '--surface2': t.surface2, '--line': t.line, '--ink': t.ink, '--muted': t.muted,
    '--accent': a[s.theme], '--on-accent': s.theme === 'dark' ? '#121214' : '#FFFFFF'
  };
}

export function applyTheme(s: Settings) {
  const vars = themeVars(s);
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.colorScheme = s.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']);
}
